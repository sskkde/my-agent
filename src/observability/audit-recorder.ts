import { createHash } from 'crypto';
import type {
  AuditRecord,
  AuditStore,
  AuditPolicy,
  AuditRecorder,
  AuditRecorderConfig,
  AuditType,
  AuditSourceModule,
  AuditStatus,
  RiskLevel,
  SensitivityLevel,
  RedactionResult,
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
  SummaryWriteAuditRequest,
  DispatchAuditRequest,
} from './audit-types.js';

function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateHash(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function redactPayload(
  payload: Record<string, unknown>,
  sensitivePatterns: Array<{ pattern: RegExp; replacement: string }>,
  redactFields: string[]
): RedactionResult {
  const redactedFields: string[] = [];

  function shouldRedactKey(key: string): boolean {
    const keyLower = key.toLowerCase();
    for (const field of redactFields) {
      if (keyLower === field.toLowerCase()) {
        return true;
      }
      if (keyLower.endsWith('.' + field.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  function redactValue(key: string, value: unknown): unknown {
    if (shouldRedactKey(key)) {
      redactedFields.push(key);
      return '[REDACTED]';
    }

    if (typeof value === 'string') {
      let redactedValue = value;
      for (const { pattern, replacement } of sensitivePatterns) {
        if (pattern.test(redactedValue)) {
          redactedFields.push(key);
          redactedValue = redactedValue.replace(pattern, replacement);
        }
      }
      return redactedValue;
    }

    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map((item, index) => redactValue(`${key}[${index}]`, item));
      }
      return redactObject(value as Record<string, unknown>, key);
    }

    return value;
  }

  function redactObject(
    obj: Record<string, unknown>,
    prefix = ''
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      result[key] = redactValue(fullKey, value);
    }
    return result;
  }

  const redacted = redactObject(payload);
  const originalJson = JSON.stringify(payload);
  const inputHash = generateHash(originalJson);

  return { redacted, inputHash, redactedFields };
}

const DEFAULT_SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /password['"]?:\s*['"][^'"]+['"]/gi, replacement: 'password: [REDACTED]' },
  { pattern: /secret['"]?:\s*['"][^'"]+['"]/gi, replacement: 'secret: [REDACTED]' },
  { pattern: /token['"]?:\s*['"][^'"]+['"]/gi, replacement: 'token: [REDACTED]' },
  { pattern: /api[_-]?key['"]?:\s*['"][^'"]+['"]/gi, replacement: 'api_key: [REDACTED]' },
  { pattern: /authorization['"]?:\s*['"][^'"]+['"]/gi, replacement: 'authorization: [REDACTED]' },
  { pattern: /private[_-]?key['"]?:\s*['"][^'"]+['"]/gi, replacement: 'private_key: [REDACTED]' },
  { pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, replacement: '[REDACTED]' },
];

const DEFAULT_REDACT_FIELDS = [
  'password',
  'secret',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'access_token',
  'privateKey',
  'private_key',
  'secretKey',
  'secret_key',
  'authToken',
  'auth_token',
  'credential',
  'credentials',
  'authorization',
  'authHeader',
];

const DEFAULT_POLICY: AuditPolicy = {
  id: 'default_audit_policy',
  name: 'Default Audit Policy',
  description: 'Default policy for audit logging with standard redaction rules',
  version: 1,
  enabled: true,
  defaultShouldAudit: true,
  defaultShouldRedact: true,
  defaultRetentionDays: 90,
  rules: [],
  sensitivePatterns: DEFAULT_SENSITIVE_PATTERNS,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

class AuditRecorderImpl implements AuditRecorder {
  private auditStore: AuditStore;
  private policy: AuditPolicy;
  private enabled: boolean;
  private generateHash: boolean;

  constructor(config: AuditRecorderConfig) {
    this.auditStore = config.auditStore;
    this.policy = config.policy ?? DEFAULT_POLICY;
    this.enabled = config.enabled ?? true;
    this.generateHash = config.generateHash ?? true;
  }

  private createBaseRecord(
    auditType: AuditType,
    userId: string,
    sessionId: string | undefined,
    sourceModule: AuditSourceModule,
    sourceAction: string,
    actionSummary: string,
    payload: Record<string, unknown>,
    riskLevel: RiskLevel,
    sensitivity: SensitivityLevel,
    status: AuditStatus,
    options: {
      correlationId?: string;
      causationId?: string;
      approvalId?: string;
      toolCallId?: string;
      permissionDecisionId?: string;
      targetType?: string;
      targetRef?: string;
    } = {}
  ): AuditRecord {
    let finalPayload = payload;
    let inputHash: string | undefined;

    if (this.policy.defaultShouldRedact && sensitivity !== 'low') {
      const redactionResult = redactPayload(
        payload,
        this.policy.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS,
        DEFAULT_REDACT_FIELDS
      );
      finalPayload = redactionResult.redacted;
      inputHash = redactionResult.inputHash;
    } else if (this.generateHash) {
      inputHash = generateHash(JSON.stringify(payload));
    }

    return {
      auditId: generateId(),
      auditType,
      timestamp: new Date().toISOString(),
      userId,
      sessionId,
      sourceModule,
      sourceAction,
      actionSummary,
      targetType: options.targetType,
      targetRef: options.targetRef,
      status,
      payload: finalPayload,
      inputHash,
      correlationId: options.correlationId ?? generateCorrelationId(),
      causationId: options.causationId,
      approvalId: options.approvalId,
      toolCallId: options.toolCallId,
      permissionDecisionId: options.permissionDecisionId,
      riskLevel,
      sensitivity,
    };
  }

  private storeRecord(record: AuditRecord): AuditRecord {
    if (this.enabled && this.policy.enabled) {
      this.auditStore.record(record);
    }
    return record;
  }

  recordUserInput(request: UserInputRequest): AuditRecord {
    const record = this.createBaseRecord(
      'user_input',
      request.userId,
      request.sessionId,
      'gateway',
      'receive_user_input',
      `User input received: ${request.inputType ?? 'text'}`,
      {
        input: request.input,
        inputType: request.inputType,
        metadata: request.metadata,
      },
      'low',
      'low',
      'completed',
      {
        correlationId: request.correlationId,
        causationId: request.causationId,
      }
    );
    return this.storeRecord(record);
  }

  recordAssistantOutput(response: AssistantOutputResponse): AuditRecord {
    const record = this.createBaseRecord(
      'assistant_output',
      response.userId,
      response.sessionId,
      'kernel',
      'generate_assistant_output',
      `Assistant output generated: ${response.outputType ?? 'response'}`,
      {
        output: response.output,
        outputType: response.outputType,
        metadata: response.metadata,
      },
      'low',
      'low',
      'completed',
      {
        correlationId: response.correlationId,
        causationId: response.causationId,
      }
    );
    return this.storeRecord(record);
  }

  recordToolCall(toolCall: ToolCallAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'tool_call',
      toolCall.userId,
      toolCall.sessionId,
      'tool',
      'execute_tool',
      `Tool ${toolCall.toolName} executed with status: ${toolCall.status}`,
      {
        toolName: toolCall.toolName,
        params: toolCall.params,
        result: toolCall.result,
        status: toolCall.status,
      },
      toolCall.status === 'failure' ? 'medium' : 'low',
      'medium',
      toolCall.status === 'success' ? 'completed' : 'failed',
      {
        toolCallId: toolCall.toolCallId,
        correlationId: toolCall.correlationId,
        causationId: toolCall.causationId,
        targetType: 'tool',
        targetRef: toolCall.toolName,
      }
    );
    return this.storeRecord(record);
  }

  recordExternalWrite(write: ExternalWriteAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'external_write',
      write.userId,
      write.sessionId,
      'tool',
      'external_write_operation',
      `External write to ${write.targetType}:${write.targetRef}`,
      {
        targetType: write.targetType,
        targetRef: write.targetRef,
        writeData: write.writeData,
      },
      'high',
      'high',
      'completed',
      {
        approvalId: write.approvalId,
        toolCallId: write.toolCallId,
        correlationId: write.correlationId,
        causationId: write.causationId,
        targetType: write.targetType,
        targetRef: write.targetRef,
      }
    );
    return this.storeRecord(record);
  }

  recordPermissionDecision(decision: PermissionDecisionAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'permission_decision',
      decision.userId,
      decision.sessionId,
      'permission',
      'check_permission',
      `Permission ${decision.decision} for ${decision.actionType}`,
      {
        actionType: decision.actionType,
        resource: decision.resource,
        operationType: decision.operationType,
        decision: decision.decision,
        reason: decision.reason,
      },
      decision.decision === 'denied' ? 'high' : 'medium',
      'medium',
      'completed',
      {
        permissionDecisionId: decision.decisionId,
        approvalId: decision.approvalId,
        correlationId: decision.correlationId,
        causationId: decision.causationId,
      }
    );
    return this.storeRecord(record);
  }

  recordApprovalRequest(request: ApprovalRequestAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'approval_request',
      request.userId,
      request.sessionId,
      'permission',
      'create_approval_request',
      `Approval requested for ${request.actionType}`,
      {
        actionType: request.actionType,
        resource: request.resource,
        riskLevel: request.riskLevel,
        justification: request.justification,
      },
      request.riskLevel === 'high' || request.riskLevel === 'critical' ? 'high' : 'medium',
      'high',
      'pending',
      {
        approvalId: request.requestId,
        correlationId: request.correlationId,
        causationId: request.causationId,
      }
    );
    return this.storeRecord(record);
  }

  recordApprovalResponse(response: ApprovalResponseAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'approval_response',
      response.userId,
      response.sessionId,
      'permission',
      'respond_to_approval',
      `Approval ${response.responseType} by ${response.respondedBy}`,
      {
        responseType: response.responseType,
        respondedBy: response.respondedBy,
        reason: response.reason,
      },
      response.responseType === 'reject' ? 'medium' : 'low',
      'medium',
      'completed',
      {
        approvalId: response.requestId,
        correlationId: response.correlationId,
        causationId: response.causationId,
      }
    );
    return this.storeRecord(record);
  }

  recordWorkflowChange(change: WorkflowChangeAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'workflow_change',
      change.userId,
      change.sessionId,
      'workflow',
      change.changeType,
      `Workflow ${change.workflowId} ${change.changeType}: ${change.changeSummary}`,
      {
        workflowId: change.workflowId,
        changeType: change.changeType,
        changeSummary: change.changeSummary,
      },
      change.changeType === 'delete' ? 'high' : 'medium',
      'medium',
      'completed',
      {
        correlationId: change.correlationId,
        causationId: change.causationId,
        targetType: 'workflow',
        targetRef: change.workflowId,
      }
    );
    return this.storeRecord(record);
  }

  recordSubagentRun(run: SubagentRunAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'subagent_run',
      run.userId,
      run.sessionId,
      'subagent',
      'execute_subagent',
      `Subagent ${run.agentType} run ${run.status}`,
      {
        subagentRunId: run.subagentRunId,
        agentType: run.agentType,
        objective: run.objective,
        status: run.status,
      },
      'medium',
      'medium',
      run.status === 'started' ? 'pending' : run.status === 'completed' ? 'completed' : 'failed',
      {
        correlationId: run.correlationId,
        causationId: run.causationId,
        targetType: 'subagent',
        targetRef: run.subagentRunId,
      }
    );
    return this.storeRecord(record);
  }

  recordConnectorAccess(access: ConnectorAccessAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      access.resourceRef ? 'connector_resource_access' : 'connector_access',
      access.userId,
      access.sessionId,
      'connector',
      'access_connector',
      `Connector ${access.connectorInstanceId} accessed: ${access.operation}`,
      {
        connectorId: access.connectorInstanceId,
        connectorInstanceId: access.connectorInstanceId,
        operation: access.operation,
        resourceRef: access.resourceRef ?? access.connectorInstanceId,
        redacted: true,
        payloadSummary: access.payloadSummary,
        status: access.status,
      },
      access.status === 'failure' ? 'high' : 'medium',
      'high',
      access.status === 'success' ? 'completed' : 'failed',
      {
        correlationId: access.correlationId,
        causationId: access.causationId,
        targetType: 'connector',
        targetRef: access.connectorInstanceId,
      }
    );
    return this.storeRecord(record);
  }

  recordMemoryWrite(write: MemoryWriteAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      write.operation === 'delete' ? 'memory_delete' : 'memory_write',
      write.userId,
      write.sessionId,
      'memory',
      write.operation,
      `Memory ${write.operation} operation on ${write.memoryId}`,
      {
        memoryId: write.memoryId,
        operation: write.operation,
        contentSummary: write.contentSummary,
      },
      'medium',
      'medium',
      'completed',
      {
        correlationId: write.correlationId,
        causationId: write.causationId,
        targetType: 'memory',
        targetRef: write.memoryId,
      }
    );
    return this.storeRecord(record);
  }

  recordSummaryWrite(write: SummaryWriteAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'summary_write',
      write.userId,
      write.sessionId,
      'memory',
      'summary_write',
      `Summary ${write.summaryId} written: ${write.summaryType}`,
      {
        summaryId: write.summaryId,
        summaryType: write.summaryType,
        sessionId: write.sessionId,
        runId: write.runId,
      },
      'medium',
      'medium',
      'completed',
      {
        correlationId: write.correlationId ?? write.runId,
        causationId: write.causationId,
        targetType: 'summary',
        targetRef: write.summaryId,
      }
    );
    return this.storeRecord(record);
  }

  recordDispatch(dispatch: DispatchAuditRequest): AuditRecord {
    const record = this.createBaseRecord(
      'dispatch',
      dispatch.userId,
      dispatch.sessionId,
      'dispatcher',
      'dispatch_request',
      `Dispatch to ${dispatch.targetRuntime}:${dispatch.targetAction}`,
      {
        actionId: dispatch.actionId,
        targetRuntime: dispatch.targetRuntime,
        targetAction: dispatch.targetAction,
        status: dispatch.status ?? 'completed',
        payloadSummary: dispatch.payloadSummary,
      },
      'low',
      'low',
      dispatch.status ?? 'completed',
      {
        correlationId: dispatch.correlationId,
        causationId: dispatch.causationId,
        targetType: 'runtime',
        targetRef: dispatch.targetRuntime,
      }
    );
    return this.storeRecord(record);
  }

  getStore(): AuditStore {
    return this.auditStore;
  }

  getPolicy(): AuditPolicy {
    return this.policy;
  }

  setPolicy(policy: AuditPolicy): void {
    this.policy = policy;
  }
}

export function createAuditRecorder(config: AuditRecorderConfig): AuditRecorder {
  return new AuditRecorderImpl(config);
}
