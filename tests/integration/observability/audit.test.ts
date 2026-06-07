import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createAuditStore } from '../../../src/observability/audit-store.js'
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js'
import type {
  AuditStore,
  AuditRecorder,
  UserInputRequest,
  AssistantOutputResponse,
  ToolCallAuditRequest,
  ExternalWriteAuditRequest,
  PermissionDecisionAuditRequest,
  ApprovalRequestAuditRequest,
  ApprovalResponseAuditRequest,
  WorkflowChangeAuditRequest,
  SubagentRunAuditRequest,
  ConnectorAccessAuditRequest,
  MemoryWriteAuditRequest,
  DispatchAuditRequest,
} from '../../../src/observability/audit-types.js'

const auditMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_audit_records_table',
    up: `
      CREATE TABLE audit_records (
        audit_id TEXT PRIMARY KEY,
        audit_type TEXT NOT NULL CHECK(audit_type IN ('user_input', 'assistant_output', 'tool_call', 'external_write', 'permission_decision', 'approval_request', 'approval_response', 'workflow_change', 'workflow_run', 'subagent_run', 'connector_access', 'memory_write', 'memory_delete', 'summary_write', 'dispatch')),
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        source_module TEXT NOT NULL CHECK(source_module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory', 'system')),
        source_action TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        target_type TEXT,
        target_ref TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed', 'blocked')),
        payload TEXT NOT NULL,
        input_hash TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        approval_id TEXT,
        tool_call_id TEXT,
        permission_decision_id TEXT,
        risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
        sensitivity TEXT NOT NULL CHECK(sensitivity IN ('low', 'medium', 'high', 'restricted'))
      );
      CREATE INDEX idx_audit_records_user_timestamp ON audit_records(user_id, timestamp DESC);
      CREATE INDEX idx_audit_records_session_timestamp ON audit_records(session_id, timestamp DESC);
      CREATE INDEX idx_audit_records_type_timestamp ON audit_records(audit_type, timestamp DESC);
      CREATE INDEX idx_audit_records_module_timestamp ON audit_records(source_module, timestamp DESC);
      CREATE INDEX idx_audit_records_correlation ON audit_records(correlation_id);
      CREATE INDEX idx_audit_records_approval ON audit_records(approval_id) WHERE approval_id IS NOT NULL;
      CREATE INDEX idx_audit_records_tool_call ON audit_records(tool_call_id) WHERE tool_call_id IS NOT NULL;
      CREATE INDEX idx_audit_records_permission ON audit_records(permission_decision_id) WHERE permission_decision_id IS NOT NULL;
      CREATE INDEX idx_audit_records_status ON audit_records(status);
      CREATE INDEX idx_audit_records_risk_level ON audit_records(risk_level);
      CREATE INDEX idx_audit_records_sensitivity ON audit_records(sensitivity);
    `,
    down: `
      DROP INDEX IF EXISTS idx_audit_records_user_timestamp;
      DROP INDEX IF EXISTS idx_audit_records_session_timestamp;
      DROP INDEX IF EXISTS idx_audit_records_type_timestamp;
      DROP INDEX IF EXISTS idx_audit_records_module_timestamp;
      DROP INDEX IF EXISTS idx_audit_records_correlation;
      DROP INDEX IF EXISTS idx_audit_records_approval;
      DROP INDEX IF EXISTS idx_audit_records_tool_call;
      DROP INDEX IF EXISTS idx_audit_records_permission;
      DROP INDEX IF EXISTS idx_audit_records_status;
      DROP INDEX IF EXISTS idx_audit_records_risk_level;
      DROP INDEX IF EXISTS idx_audit_records_sensitivity;
      DROP TABLE IF EXISTS audit_records;
    `,
  },
]

describe('Observability Audit Integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let auditStore: AuditStore
  let auditRecorder: AuditRecorder

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(auditMigrations)

    auditStore = createAuditStore(connection)
    auditRecorder = createAuditRecorder({
      auditStore,
      enabled: true,
      generateHash: true,
    })
  })

  afterEach(() => {
    connection?.close()
  })

  describe('AuditRecord creation for user input', () => {
    it('should record user input with required fields', () => {
      const request: UserInputRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        input: 'Hello, how can you help me?',
        inputType: 'text',
      }

      const record = auditRecorder.recordUserInput(request)

      expect(record.auditId).toBeDefined()
      expect(record.auditType).toBe('user_input')
      expect(record.userId).toBe('user_001')
      expect(record.sessionId).toBe('session_001')
      expect(record.sourceModule).toBe('gateway')
      expect(record.sourceAction).toBe('receive_user_input')
      expect(record.status).toBe('completed')
      expect(record.riskLevel).toBe('low')
      expect(record.sensitivity).toBe('low')
      expect(record.payload.input).toBe('Hello, how can you help me?')
      expect(record.inputHash).toBeDefined()

      const retrieved = auditStore.get(record.auditId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe('user_001')
    })

    it('should include correlationId when provided', () => {
      const request: UserInputRequest = {
        userId: 'user_001',
        input: 'Test input',
        correlationId: 'corr_abc123',
      }

      const record = auditRecorder.recordUserInput(request)

      expect(record.correlationId).toBe('corr_abc123')
    })

    it('should find records by user', () => {
      auditRecorder.recordUserInput({ userId: 'user_001', input: 'Input 1' })
      auditRecorder.recordUserInput({ userId: 'user_001', input: 'Input 2' })
      auditRecorder.recordUserInput({ userId: 'user_002', input: 'Input 3' })

      const userRecords = auditStore.findByUser('user_001')
      expect(userRecords).toHaveLength(2)
      expect(userRecords.every((r) => r.userId === 'user_001')).toBe(true)
    })

    it('should find records by session', () => {
      auditRecorder.recordUserInput({ userId: 'user_001', sessionId: 'session_001', input: 'Input 1' })
      auditRecorder.recordUserInput({ userId: 'user_001', sessionId: 'session_001', input: 'Input 2' })
      auditRecorder.recordUserInput({ userId: 'user_001', sessionId: 'session_002', input: 'Input 3' })

      const sessionRecords = auditStore.findBySession('session_001')
      expect(sessionRecords).toHaveLength(2)
    })
  })

  describe('AuditRecord creation for assistant output', () => {
    it('should record assistant output with required fields', () => {
      const response: AssistantOutputResponse = {
        userId: 'user_001',
        sessionId: 'session_001',
        output: 'I can help you with various tasks.',
        outputType: 'response',
      }

      const record = auditRecorder.recordAssistantOutput(response)

      expect(record.auditType).toBe('assistant_output')
      expect(record.sourceModule).toBe('kernel')
      expect(record.payload.output).toBe('I can help you with various tasks.')
      expect(record.status).toBe('completed')
    })
  })

  describe('AuditRecord creation for tool call', () => {
    it('should record successful tool call', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_001',
        toolName: 'file_read',
        userId: 'user_001',
        sessionId: 'session_001',
        params: { path: '/home/user/file.txt' },
        result: { content: 'file contents' },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)

      expect(record.auditType).toBe('tool_call')
      expect(record.toolCallId).toBe('tool_001')
      expect(record.targetType).toBe('tool')
      expect(record.targetRef).toBe('file_read')
      expect(record.status).toBe('completed')
      expect(record.riskLevel).toBe('low')
    })

    it('should record failed tool call with higher risk', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_002',
        toolName: 'file_write',
        userId: 'user_001',
        sessionId: 'session_001',
        params: { path: '/home/user/file.txt', content: 'new data' },
        status: 'failure',
      }

      const record = auditRecorder.recordToolCall(toolCall)

      expect(record.auditType).toBe('tool_call')
      expect(record.status).toBe('failed')
      expect(record.riskLevel).toBe('medium')
    })

    it('should find records by tool call ID', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_search_001',
        toolName: 'search_files',
        userId: 'user_001',
        params: { query: 'test' },
        status: 'success',
      }

      auditRecorder.recordToolCall(toolCall)

      const records = auditStore.findByToolCallId('tool_search_001')
      expect(records).toHaveLength(1)
      expect(records[0]?.toolCallId).toBe('tool_search_001')
    })
  })

  describe('AuditRecord creation for external write', () => {
    it('should record external write with approvalId and toolCallId', () => {
      const write: ExternalWriteAuditRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        targetType: 'file',
        targetRef: '/home/user/output.txt',
        writeData: { content: 'sensitive data' },
        approvalId: 'approval_001',
        toolCallId: 'tool_003',
      }

      const record = auditRecorder.recordExternalWrite(write)

      expect(record.auditType).toBe('external_write')
      expect(record.approvalId).toBe('approval_001')
      expect(record.toolCallId).toBe('tool_003')
      expect(record.targetType).toBe('file')
      expect(record.targetRef).toBe('/home/user/output.txt')
      expect(record.riskLevel).toBe('high')
      expect(record.sensitivity).toBe('high')
    })

    it('should find records by approval ID', () => {
      const write: ExternalWriteAuditRequest = {
        userId: 'user_001',
        targetType: 'api',
        targetRef: 'https://api.example.com/data',
        writeData: { payload: 'data' },
        approvalId: 'approval_ext_001',
      }

      auditRecorder.recordExternalWrite(write)

      const records = auditStore.findByApprovalId('approval_ext_001')
      expect(records).toHaveLength(1)
      expect(records[0]?.approvalId).toBe('approval_ext_001')
    })
  })

  describe('Audit for permission decision', () => {
    it('should record allowed permission decision', () => {
      const decision: PermissionDecisionAuditRequest = {
        decisionId: 'perm_001',
        userId: 'user_001',
        sessionId: 'session_001',
        actionType: 'file_read',
        resource: '/home/user/file.txt',
        operationType: 'read',
        decision: 'allowed',
        reason: 'User has read permission',
      }

      const record = auditRecorder.recordPermissionDecision(decision)

      expect(record.auditType).toBe('permission_decision')
      expect(record.permissionDecisionId).toBe('perm_001')
      expect(record.payload.decision).toBe('allowed')
      expect(record.status).toBe('completed')
    })

    it('should record denied permission decision with higher risk', () => {
      const decision: PermissionDecisionAuditRequest = {
        decisionId: 'perm_002',
        userId: 'user_001',
        sessionId: 'session_001',
        actionType: 'file_delete',
        resource: '/system/config.txt',
        operationType: 'delete',
        decision: 'denied',
        reason: 'Insufficient permissions for delete operation',
      }

      const record = auditRecorder.recordPermissionDecision(decision)

      expect(record.payload.decision).toBe('denied')
      expect(record.riskLevel).toBe('high')
    })

    it('should record requires_approval decision with approvalId', () => {
      const decision: PermissionDecisionAuditRequest = {
        decisionId: 'perm_003',
        userId: 'user_001',
        sessionId: 'session_001',
        actionType: 'file_write',
        resource: '/home/user/important.txt',
        operationType: 'write',
        decision: 'requires_approval',
        reason: 'Write operation requires approval',
        approvalId: 'approval_perm_003',
      }

      const record = auditRecorder.recordPermissionDecision(decision)

      expect(record.payload.decision).toBe('requires_approval')
      expect(record.approvalId).toBe('approval_perm_003')
    })

    it('should find records by permission decision ID', () => {
      const decision: PermissionDecisionAuditRequest = {
        decisionId: 'perm_search_001',
        userId: 'user_001',
        actionType: 'search',
        operationType: 'read',
        decision: 'allowed',
        reason: 'Allowed',
      }

      auditRecorder.recordPermissionDecision(decision)

      const records = auditStore.findByPermissionDecisionId('perm_search_001')
      expect(records).toHaveLength(1)
      expect(records[0]?.permissionDecisionId).toBe('perm_search_001')
    })
  })

  describe('Audit for approval request/response', () => {
    it('should record approval request', () => {
      const request: ApprovalRequestAuditRequest = {
        requestId: 'approval_req_001',
        userId: 'user_001',
        sessionId: 'session_001',
        actionType: 'file_delete',
        resource: '/home/user/old_file.txt',
        riskLevel: 'medium',
        justification: 'Cleaning up old files',
      }

      const record = auditRecorder.recordApprovalRequest(request)

      expect(record.auditType).toBe('approval_request')
      expect(record.approvalId).toBe('approval_req_001')
      expect(record.payload.riskLevel).toBe('medium')
      expect(record.status).toBe('pending')
    })

    it('should record high risk approval request with high risk level', () => {
      const request: ApprovalRequestAuditRequest = {
        requestId: 'approval_req_002',
        userId: 'user_001',
        sessionId: 'session_001',
        actionType: 'system_config_change',
        riskLevel: 'high',
        justification: 'System maintenance',
      }

      const record = auditRecorder.recordApprovalRequest(request)

      expect(record.riskLevel).toBe('high')
      expect(record.sensitivity).toBe('high')
    })

    it('should record approval response', () => {
      const response: ApprovalResponseAuditRequest = {
        requestId: 'approval_req_001',
        userId: 'user_001',
        sessionId: 'session_001',
        responseType: 'approve_once',
        respondedBy: 'admin_001',
        reason: 'Approved for this instance',
      }

      const record = auditRecorder.recordApprovalResponse(response)

      expect(record.auditType).toBe('approval_response')
      expect(record.approvalId).toBe('approval_req_001')
      expect(record.payload.responseType).toBe('approve_once')
      expect(record.payload.respondedBy).toBe('admin_001')
      expect(record.status).toBe('completed')
    })

    it('should record rejection with medium risk', () => {
      const response: ApprovalResponseAuditRequest = {
        requestId: 'approval_req_002',
        userId: 'user_001',
        sessionId: 'session_001',
        responseType: 'reject',
        respondedBy: 'admin_002',
        reason: 'Not authorized',
      }

      const record = auditRecorder.recordApprovalResponse(response)

      expect(record.payload.responseType).toBe('reject')
      expect(record.riskLevel).toBe('medium')
    })
  })

  describe('Audit for workflow change/run', () => {
    it('should record workflow change', () => {
      const change: WorkflowChangeAuditRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        workflowId: 'wf_001',
        changeType: 'update',
        changeSummary: 'Updated step configuration',
      }

      const record = auditRecorder.recordWorkflowChange(change)

      expect(record.auditType).toBe('workflow_change')
      expect(record.sourceModule).toBe('workflow')
      expect(record.targetType).toBe('workflow')
      expect(record.targetRef).toBe('wf_001')
      expect(record.payload.changeType).toBe('update')
    })

    it('should record workflow delete with high risk', () => {
      const change: WorkflowChangeAuditRequest = {
        userId: 'user_001',
        workflowId: 'wf_002',
        changeType: 'delete',
        changeSummary: 'Removed obsolete workflow',
      }

      const record = auditRecorder.recordWorkflowChange(change)

      expect(record.payload.changeType).toBe('delete')
      expect(record.riskLevel).toBe('high')
    })
  })

  describe('Audit for subagent run', () => {
    it('should record subagent run start', () => {
      const run: SubagentRunAuditRequest = {
        subagentRunId: 'sub_001',
        userId: 'user_001',
        sessionId: 'session_001',
        agentType: 'code_reviewer',
        objective: 'Review pull request #123',
        status: 'started',
      }

      const record = auditRecorder.recordSubagentRun(run)

      expect(record.auditType).toBe('subagent_run')
      expect(record.sourceModule).toBe('subagent')
      expect(record.targetType).toBe('subagent')
      expect(record.targetRef).toBe('sub_001')
      expect(record.status).toBe('pending')
      expect(record.payload.status).toBe('started')
    })

    it('should record completed subagent run', () => {
      const run: SubagentRunAuditRequest = {
        subagentRunId: 'sub_002',
        userId: 'user_001',
        agentType: 'test_runner',
        objective: 'Run unit tests',
        status: 'completed',
      }

      const record = auditRecorder.recordSubagentRun(run)

      expect(record.status).toBe('completed')
      expect(record.riskLevel).toBe('medium')
    })

    it('should record failed subagent run', () => {
      const run: SubagentRunAuditRequest = {
        subagentRunId: 'sub_003',
        userId: 'user_001',
        agentType: 'deploy_agent',
        objective: 'Deploy to production',
        status: 'failed',
      }

      const record = auditRecorder.recordSubagentRun(run)

      expect(record.status).toBe('failed')
    })
  })

  describe('Audit for connector access', () => {
    it('should record successful connector access', () => {
      const access: ConnectorAccessAuditRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        connectorInstanceId: 'conn_slack_001',
        operation: 'send_message',
        status: 'success',
      }

      const record = auditRecorder.recordConnectorAccess(access)

      expect(record.auditType).toBe('connector_access')
      expect(record.sourceModule).toBe('connector')
      expect(record.targetType).toBe('connector')
      expect(record.targetRef).toBe('conn_slack_001')
      expect(record.status).toBe('completed')
    })

    it('should record failed connector access with high risk', () => {
      const access: ConnectorAccessAuditRequest = {
        userId: 'user_001',
        connectorInstanceId: 'conn_api_001',
        operation: 'write_data',
        status: 'failure',
      }

      const record = auditRecorder.recordConnectorAccess(access)

      expect(record.status).toBe('failed')
      expect(record.riskLevel).toBe('high')
    })
  })

  describe('Audit for memory write/delete', () => {
    it('should record memory write', () => {
      const write: MemoryWriteAuditRequest = {
        memoryId: 'mem_001',
        userId: 'user_001',
        sessionId: 'session_001',
        operation: 'write',
        contentSummary: 'User preferences updated',
      }

      const record = auditRecorder.recordMemoryWrite(write)

      expect(record.auditType).toBe('memory_write')
      expect(record.sourceModule).toBe('memory')
      expect(record.targetType).toBe('memory')
      expect(record.targetRef).toBe('mem_001')
      expect(record.payload.operation).toBe('write')
    })

    it('should record memory delete as memory_write audit type', () => {
      const write: MemoryWriteAuditRequest = {
        memoryId: 'mem_002',
        userId: 'user_001',
        operation: 'delete',
        contentSummary: 'Old context removed',
      }

      const record = auditRecorder.recordMemoryWrite(write)

      expect(record.payload.operation).toBe('delete')
    })
  })

  describe('Audit for dispatch', () => {
    it('should record dispatch', () => {
      const dispatch: DispatchAuditRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        targetRuntime: 'kernel_plane',
        targetAction: 'run_agent',
        payloadSummary: 'Execute agent with context',
      }

      const record = auditRecorder.recordDispatch(dispatch)

      expect(record.auditType).toBe('dispatch')
      expect(record.sourceModule).toBe('dispatcher')
      expect(record.targetType).toBe('runtime')
      expect(record.targetRef).toBe('kernel_plane')
      expect(record.payload.targetAction).toBe('run_agent')
      expect(record.riskLevel).toBe('low')
    })
  })

  describe('Sensitive payload redaction', () => {
    it('should redact password in payload', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_004',
        toolName: 'api_call',
        userId: 'user_001',
        params: {
          url: 'https://api.example.com',
          password: 'super_secret_123',
          username: 'test_user',
        },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)
      const params = record.payload.params as Record<string, unknown>

      expect(params.password).toBe('[REDACTED]')
      expect(params.username).toBe('test_user')
      expect(record.inputHash).toBeDefined()
    })

    it('should redact secret in payload', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_005',
        toolName: 'db_query',
        userId: 'user_001',
        params: {
          connectionString: 'postgres://localhost',
          secret: 'my_api_secret_key',
          query: 'SELECT * FROM users',
        },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)
      const params = record.payload.params as Record<string, unknown>

      expect(params.secret).toBe('[REDACTED]')
      expect(params.query).toBe('SELECT * FROM users')
    })

    it('should redact api_key in payload', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_006',
        toolName: 'external_api',
        userId: 'user_001',
        params: {
          endpoint: '/data',
          api_key: 'sk-1234567890abcdef',
          method: 'POST',
        },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)
      const params = record.payload.params as Record<string, unknown>

      expect(params.api_key).toBe('[REDACTED]')
      expect(params.method).toBe('POST')
    })

    it('should redact token in payload', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_007',
        toolName: 'auth_request',
        userId: 'user_001',
        params: {
          service: 'github',
          token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
          action: 'list_repos',
        },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)
      const params = record.payload.params as Record<string, unknown>

      expect(params.token).toBe('[REDACTED]')
      expect(params.action).toBe('list_repos')
    })

    it('should not redact low sensitivity payloads', () => {
      const response: AssistantOutputResponse = {
        userId: 'user_001',
        output: 'Here is the information you requested.',
        outputType: 'response',
      }

      const record = auditRecorder.recordAssistantOutput(response)

      expect(record.sensitivity).toBe('low')
      expect(record.payload.output).toBe('Here is the information you requested.')
    })

    it('should include inputHash for redacted payloads', () => {
      const toolCall: ToolCallAuditRequest = {
        toolCallId: 'tool_008',
        toolName: 'secure_api',
        userId: 'user_001',
        params: {
          data: 'sensitive info',
          secret: 'secret_value',
        },
        status: 'success',
      }

      const record = auditRecorder.recordToolCall(toolCall)

      expect(record.inputHash).toBeDefined()
      expect(record.inputHash).toMatch(/^[a-f0-9]{64}$/)
    })
  })

  describe('Audit query by user/time/type', () => {
    beforeEach(() => {
      auditRecorder.recordUserInput({ userId: 'user_001', input: 'Input 1' })
      auditRecorder.recordUserInput({ userId: 'user_001', input: 'Input 2' })
      auditRecorder.recordUserInput({ userId: 'user_002', input: 'Input 3' })
      auditRecorder.recordToolCall({
        toolCallId: 'tool_001',
        toolName: 'file_read',
        userId: 'user_001',
        params: {},
        status: 'success',
      })
      auditRecorder.recordExternalWrite({
        userId: 'user_001',
        targetType: 'file',
        targetRef: '/output.txt',
        writeData: {},
      })
    })

    it('should query by userId', () => {
      const records = auditStore.query({ userId: 'user_001' })
      expect(records.length).toBeGreaterThan(0)
      expect(records.every((r) => r.userId === 'user_001')).toBe(true)
    })

    it('should query by auditType', () => {
      const records = auditStore.query({ auditType: 'user_input' })
      expect(records).toHaveLength(3)
      expect(records.every((r) => r.auditType === 'user_input')).toBe(true)
    })

    it('should query by sourceModule', () => {
      const records = auditStore.query({ sourceModule: 'gateway' })
      expect(records.length).toBeGreaterThan(0)
      expect(records.every((r) => r.sourceModule === 'gateway')).toBe(true)
    })

    it('should query with limit', () => {
      const records = auditStore.query({ limit: 2 })
      expect(records).toHaveLength(2)
    })

    it('should query with time range', () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

      auditRecorder.recordUserInput({
        userId: 'user_003',
        input: 'Recent input',
      })

      const records = auditStore.query({
        userId: 'user_003',
        startTime: oneHourAgo.toISOString(),
      })

      expect(records.length).toBeGreaterThan(0)
    })

    it('should query with offset', () => {
      const allRecords = auditStore.query({ userId: 'user_001' })
      const offsetRecords = auditStore.query({ userId: 'user_001', offset: 1 })

      expect(offsetRecords.length).toBe(allRecords.length - 1)
    })

    it('should find records by correlationId', () => {
      const correlationId = 'test_correlation_123'
      auditRecorder.recordUserInput({
        userId: 'user_001',
        input: 'Correlated input',
        correlationId,
      })

      const records = auditStore.findByCorrelationId(correlationId)
      expect(records.length).toBeGreaterThan(0)
      expect(records[0]?.correlationId).toBe(correlationId)
    })

    it('should count records matching query', () => {
      const count = auditStore.count({ userId: 'user_001' })
      expect(count).toBeGreaterThan(0)

      const typeCount = auditStore.count({ auditType: 'user_input' })
      expect(typeCount).toBe(3)
    })
  })

  describe('External write audit includes approvalId and toolCallId', () => {
    it('external write should include both approvalId and toolCallId', () => {
      const write: ExternalWriteAuditRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        targetType: 'database',
        targetRef: 'users_table',
        writeData: { name: 'John' },
        approvalId: 'approval_db_001',
        toolCallId: 'tool_db_001',
      }

      const record = auditRecorder.recordExternalWrite(write)

      expect(record.approvalId).toBe('approval_db_001')
      expect(record.toolCallId).toBe('tool_db_001')

      const retrieved = auditStore.get(record.auditId)
      expect(retrieved?.approvalId).toBe('approval_db_001')
      expect(retrieved?.toolCallId).toBe('tool_db_001')
    })
  })

  describe('Audit record structure', () => {
    it('should have all required fields', () => {
      const request: UserInputRequest = {
        userId: 'user_001',
        sessionId: 'session_001',
        input: 'Test',
      }

      const record = auditRecorder.recordUserInput(request)

      expect(record.auditId).toBeDefined()
      expect(record.auditType).toBeDefined()
      expect(record.timestamp).toBeDefined()
      expect(record.userId).toBeDefined()
      expect(record.sourceModule).toBeDefined()
      expect(record.sourceAction).toBeDefined()
      expect(record.actionSummary).toBeDefined()
      expect(record.status).toBeDefined()
      expect(record.payload).toBeDefined()
      expect(record.riskLevel).toBeDefined()
      expect(record.sensitivity).toBeDefined()
    })

    it('should return audit store from recorder', () => {
      const store = auditRecorder.getStore()
      expect(store).toBe(auditStore)
    })

    it('should return and set policy', () => {
      const policy = auditRecorder.getPolicy()
      expect(policy).toBeDefined()
      expect(policy.id).toBe('default_audit_policy')

      const newPolicy = {
        ...policy,
        id: 'custom_policy',
        name: 'Custom Policy',
      }

      auditRecorder.setPolicy(newPolicy)
      expect(auditRecorder.getPolicy().id).toBe('custom_policy')
    })
  })
})
