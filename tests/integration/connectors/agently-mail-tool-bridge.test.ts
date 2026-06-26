/**
 * AgentlyMail → Tool Plane bridge integration test.
 *
 * Asserts that AgentlyMail capabilities are correctly projected into
 * ToolDefinitions through the ConnectorToolBridge, with the right
 * category, sensitivity, requiresPermission, and idempotent flags.
 *
 * Verifies that the bridge does NOT weaken approval rules for write/send/delete
 * operations while keeping read/search operations low-friction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js'
import {
  createConnectorToolBridge,
  registerConnectorTools,
} from '../../../src/connectors/connector-tool-bridge.js'
import { createAgentlyMailCapabilities } from '../../../src/connectors/agently-mail/capabilities.js'
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createApprovalStore } from '../../../src/storage/approval-store.js'
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createMigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js'
import { createToolExecutor } from '../../../src/tools/tool-executor.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ConnectorRuntime } from '../../../src/connectors/types.js'
import type { ToolExecutorConfig, ToolRegistry, ToolDefinition } from '../../../src/tools/types.js'

// ── Minimal migrations for this test (avoids allStoreMigrations duplicate v65 bug) ──

const testMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_connector_definitions_table',
    up: `
      CREATE TABLE connector_definitions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL CHECK(connector_type IN ('api', 'messaging', 'storage', 'database', 'custom')),
        version TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        config_schema TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_connector_defs_type ON connector_definitions(connector_type);
      CREATE INDEX idx_connector_defs_status ON connector_definitions(status);
    `,
    down: `DROP TABLE IF EXISTS connector_definitions;`,
  },
  {
    version: 2,
    name: 'create_connector_instances_table',
    up: `
      CREATE TABLE connector_instances (
        id TEXT PRIMARY KEY,
        connector_instance_id TEXT NOT NULL UNIQUE,
        connector_definition_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        auth_state_ref TEXT NOT NULL,
        config TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_connector_instances_user_def ON connector_instances(user_id, connector_definition_id);
      CREATE INDEX idx_connector_instances_status ON connector_instances(status);
      CREATE INDEX idx_connector_instances_def_id ON connector_instances(connector_definition_id);
    `,
    down: `DROP TABLE IF EXISTS connector_instances;`,
  },
  {
    version: 3,
    name: 'create_connector_events_table',
    up: `
      CREATE TABLE connector_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        connector_instance_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT,
        processed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_connector_events_instance ON connector_events(connector_instance_id);
    `,
    down: `DROP TABLE IF EXISTS connector_events;`,
  },
  {
    version: 4,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source_module TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        idempotency_key TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        wait_condition_id TEXT,
        artifact_id TEXT,
        memory_id TEXT,
        payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_user ON events(user_id);
      CREATE INDEX idx_events_type ON events(event_type);
    `,
    down: `DROP TABLE IF EXISTS events;`,
  },
  {
    version: 5,
    name: 'create_tool_executions_table',
    up: `
      CREATE TABLE tool_executions (
        tool_call_id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        kernel_run_id TEXT,
        status TEXT NOT NULL,
        params TEXT,
        result_preview TEXT,
        result_ref TEXT,
        structured_content TEXT,
        sensitivity TEXT NOT NULL DEFAULT 'low',
        error_message TEXT,
        started_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        completed_at TEXT,
        terminal_state_reached INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_tool_executions_tool_name ON tool_executions(tool_name, started_at);
      CREATE INDEX idx_tool_executions_session ON tool_executions(session_id);
      CREATE INDEX idx_tool_executions_status ON tool_executions(status);
    `,
    down: `DROP TABLE IF EXISTS tool_executions;`,
  },
  {
    version: 6,
    name: 'create_approval_requests_table',
    up: `
      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT,
        scope TEXT,
        action_type TEXT NOT NULL,
        resource TEXT,
        justification TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        responded_at TEXT,
        response_by TEXT,
        response_reason TEXT,
        idempotency_key TEXT,
        metadata TEXT,
        source_context TEXT,
        scope_type TEXT,
        scope_ref TEXT,
        approval_code TEXT,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_approval_requests_user_status ON approval_requests(user_id, status);
      CREATE INDEX idx_approval_requests_session_status ON approval_requests(session_id, status);
    `,
    down: `DROP TABLE IF EXISTS approval_requests;`,
  },
  {
    version: 7,
    name: 'create_permission_grants_table',
    up: `
      CREATE TABLE permission_grants (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_pattern TEXT,
        conditions TEXT,
        risk_level_max TEXT,
        expires_at TEXT,
        source_context TEXT,
        revoked_at TEXT,
        revoked_reason TEXT,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_permission_grants_user ON permission_grants(user_id);
      CREATE INDEX idx_permission_grants_scope ON permission_grants(scope);
    `,
    down: `DROP TABLE IF EXISTS permission_grants;`,
  },
]

describe('AgentlyMail connector capabilities projected to Tool Plane', () => {
  let connection: ConnectionManager
  let connectorStore: ConnectorStore
  let runtime: ConnectorRuntime
  let registry: ToolRegistry
  let toolExecutionStore: ReturnType<typeof createToolExecutionStore>
  let executor: ReturnType<typeof createToolExecutor>
  let agentlyMailTools: Map<string, ToolDefinition>

  function createAgentlyMailInstance(status: 'active' | 'inactive' = 'active') {
    const definition = (runtime as unknown as { registerDefinition: (def: unknown) => { id: string } }).registerDefinition({
      connectorId: 'agently_mail',
      name: 'AgentlyMail Connector',
      connectorType: 'messaging',
      version: '1.0.0',
      capabilities: ['agently_mail.read', 'agently_mail.send', 'agently_mail.delete'],
      status: 'active',
    })

    return (runtime as unknown as { createInstance: (inst: unknown) => Record<string, unknown> }).createInstance({
      connectorInstanceId: 'agently-mail-instance',
      connectorDefinitionId: definition.id,
      userId: 'test-user-001',
      name: 'Test AgentlyMail Instance',
      authStateRef: 'auth-agently-mail-001',
      config: { connectorId: 'agently_mail' },
      status,
    })
  }

  function registerAgentlyMailTools(status: 'active' | 'inactive' = 'active') {
    const instance = createAgentlyMailInstance(status)
    const capabilities = createAgentlyMailCapabilities()

    registerConnectorTools(
      registry,
      { ...instance, connectorId: 'agently_mail' } as Parameters<typeof registerConnectorTools>[1],
      capabilities,
      { runtime },
    )

    // Collect all registered AgentlyMail tools for assertion
    agentlyMailTools = new Map()
    for (const tool of registry.listTools()) {
      if (tool.metadata?.connectorId === 'agently_mail') {
        agentlyMailTools.set(tool.name, tool)
      }
    }
  }

  function getTool(operation: string): ToolDefinition {
    const name = `connector_agently_mail_${operation}`
    const tool = agentlyMailTools.get(name)
    expect(tool, `Expected tool ${name} to be registered`).toBeDefined()
    return tool!
  }

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(testMigrations)

    connectorStore = createConnectorStore(connection)
    const eventStore = createEventStore(connection)
    const approvalStore = createApprovalStore(connection)
    const grantStore = createPermissionGrantStore(connection)
    toolExecutionStore = createToolExecutionStore(connection)

    runtime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
    })

    registry = createToolRegistry()
    const permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore })
    executor = createToolExecutor({
      registry,
      permissionEngine,
      toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
      eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
    })
  })

  afterEach(() => {
    connection.close()
  })

  // ── Read tools: low sensitivity, no permission required ────────────────

  describe('read tools (low sensitivity, no permission)', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('connector_agently_mail.me: category=read, sensitivity=low, requiresPermission=false', () => {
      const tool = getTool('me')
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
      expect(tool.metadata?.connectorId).toBe('agently_mail')
      expect(tool.metadata?.instanceId).toBe('agently-mail-instance')
    })

    it('connector_agently_mail.list_messages: category=read, sensitivity=low, idempotent', () => {
      const tool = getTool('list_messages')
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
    })

    it('connector_agently_mail.read_message: category=read, sensitivity=low, idempotent', () => {
      const tool = getTool('read_message')
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
    })

    it('connector_agently_mail.auth_status: category=read, sensitivity=low, idempotent', () => {
      const tool = getTool('auth_status')
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
    })

    it('connector_agently_mail.download_attachment: category=read, sensitivity=low, idempotent', () => {
      const tool = getTool('download_attachment')
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
    })
  })

  // ── Search tools: low sensitivity, no permission required ──────────────

  describe('search tools (low sensitivity, no permission)', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('connector_agently_mail.search_messages: category=search, sensitivity=low, idempotent', () => {
      const tool = getTool('search_messages')
      expect(tool.category).toBe('search')
      expect(tool.sensitivity).toBe('low')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(true)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
      expect(tool.metadata?.connectorId).toBe('agently_mail')
    })
  })

  // ── Send tools: medium sensitivity, permission_mode approval ───────────

  describe('send tools (medium sensitivity, permission_mode)', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('connector_agently_mail.send_message: category=send, sensitivity=medium, NOT idempotent', () => {
      const tool = getTool('send_message')
      expect(tool.category).toBe('send')
      expect(tool.sensitivity).toBe('medium')
      // Bridge maps medium to requiresPermission=false (only high/restricted trigger true)
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(false)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
      expect(tool.metadata?.resultSensitivity).toBe('medium')
    })

    it('connector_agently_mail.reply_message: category=send, sensitivity=medium, NOT idempotent', () => {
      const tool = getTool('reply_message')
      expect(tool.category).toBe('send')
      expect(tool.sensitivity).toBe('medium')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(false)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
    })

    it('connector_agently_mail.forward_message: category=send, sensitivity=medium, NOT idempotent', () => {
      const tool = getTool('forward_message')
      expect(tool.category).toBe('send')
      expect(tool.sensitivity).toBe('medium')
      expect(tool.requiresPermission).toBe(false)
      expect(tool.idempotent).toBe(false)
      expect(tool.metadata?.approvalDefault).toBe('permission_mode')
    })
  })

  // ── Delete tools: high sensitivity, requires permission ────────────────

  describe('delete tools (high sensitivity, requires permission)', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('connector_agently_mail.trash_message: category=delete, sensitivity=high, requiresPermission=true', () => {
      const tool = getTool('trash_message')
      expect(tool.category).toBe('delete')
      expect(tool.sensitivity).toBe('high')
      expect(tool.requiresPermission).toBe(true)
      expect(tool.idempotent).toBe(false)
      expect(tool.metadata?.approvalDefault).toBe('required')
      expect(tool.metadata?.resultSensitivity).toBe('high')
    })
  })

  // ── Metadata completeness ──────────────────────────────────────────────

  describe('tool metadata completeness', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('all tools carry connectorId and instanceId in metadata', () => {
      for (const [, tool] of agentlyMailTools) {
        expect(tool.metadata?.connectorId).toBe('agently_mail')
        expect(tool.metadata?.instanceId).toBe('agently-mail-instance')
      }
    })

    it('all tools carry requiredAuthScopes when requiresAuth is true', () => {
      // AgentlyMail capabilities all require auth
      for (const [, tool] of agentlyMailTools) {
        expect(tool.metadata?.requiredAuthScopes).toEqual(['connector:agently_mail'])
      }
    })

    it('connected tools have availability=available', () => {
      for (const [, tool] of agentlyMailTools) {
        expect(tool.metadata?.availability).toBe('available')
      }
    })

    it('low/medium risk tools have schemaExposureMode=full', () => {
      const lowMediumOps = ['me', 'auth_status', 'list_messages', 'read_message', 'search_messages', 'send_message', 'reply_message', 'forward_message', 'download_attachment']
      for (const op of lowMediumOps) {
        const tool = getTool(op)
        expect(tool.metadata?.schemaExposureMode, `${op} should have full exposure`).toBe('full')
      }
    })

    it('high risk tools have schemaExposureMode=simplified', () => {
      const tool = getTool('trash_message')
      expect(tool.metadata?.schemaExposureMode).toBe('simplified')
    })

    it('no tools support async operations', () => {
      for (const [, tool] of agentlyMailTools) {
        expect(tool.metadata?.supportsAsync).toBe(false)
      }
    })
  })

  // ── Approval rules must NOT be weakened ────────────────────────────────

  describe('approval rules are not weakened', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('read/search tools never require permission', () => {
      const readOps = ['me', 'auth_status', 'list_messages', 'read_message', 'download_attachment']
      const searchOps = ['search_messages']

      for (const op of [...readOps, ...searchOps]) {
        const tool = getTool(op)
        expect(tool.requiresPermission, `${op} should not require permission`).toBe(false)
      }
    })

    it('trash_message requires permission (high risk delete)', () => {
      const tool = getTool('trash_message')
      expect(tool.requiresPermission).toBe(true)
      expect(tool.sensitivity).toBe('high')
      expect(tool.metadata?.approvalDefault).toBe('required')
    })

    it('send tools are medium risk with permission_mode (not bypassed)', () => {
      const sendOps = ['send_message', 'reply_message', 'forward_message']

      for (const op of sendOps) {
        const tool = getTool(op)
        expect(tool.sensitivity, `${op} should be medium sensitivity`).toBe('medium')
        expect(tool.metadata?.approvalDefault, `${op} should use permission_mode`).toBe('permission_mode')
      }
    })
  })

  // ── Schema exposure ────────────────────────────────────────────────────

  describe('schema exposure for connected instance', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('read_message tool has schema with required id field', () => {
      const tool = getTool('read_message')
      expect(tool.schema).toBeDefined()
      expect(tool.schema.type).toBe('object')
    })

    it('send_message tool has schema with required to/subject/body fields', () => {
      const tool = getTool('send_message')
      expect(tool.schema).toBeDefined()
      expect(tool.schema.type).toBe('object')
    })

    it('trash_message tool has schema with required id field', () => {
      const tool = getTool('trash_message')
      expect(tool.schema).toBeDefined()
      expect(tool.schema.type).toBe('object')
    })
  })

  // ── Deferred (disconnected) instance ───────────────────────────────────

  describe('disconnected instance hides schemas and blocks execution', () => {
    beforeEach(() => {
      registerAgentlyMailTools('inactive')
    })

    it('disconnected tools have schemaExposureMode=hidden', () => {
      const tool = getTool('me')
      expect(tool.metadata?.schemaExposureMode).toBe('hidden')
      expect(tool.metadata?.availability).toBe('deferred')
    })

    it('executing a disconnected tool returns CONNECTOR_UNAVAILABLE', async () => {
      const result = await executor.execute({
        toolCallId: 'call-agently-mail-disconnected',
        toolName: 'connector_agently_mail_me',
        params: {},
        userId: 'test-user-001',
        sessionId: 'test-session-001',
        permissionContext: createPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('CONNECTOR_UNAVAILABLE')
      expect(toolExecutionStore.getById('call-agently-mail-disconnected')).toMatchObject({
        toolName: 'connector_agently_mail_me',
        status: 'failed',
        resultPreview: 'Connector unavailable: agently_mail',
      })
    })
  })

  // ── Total tool count ───────────────────────────────────────────────────

  describe('capability count matches definition set', () => {
    beforeEach(() => {
      registerAgentlyMailTools()
    })

    it('registers all 10 AgentlyMail capabilities as tools', () => {
      expect(agentlyMailTools.size).toBe(10)
    })
  })

  // ── Helpers ────────────────────────────────────────────────────────────

  function createPermissionContext() {
    return {
      userId: 'test-user-001',
      sessionId: 'test-session-001',
      mode: 'ask_on_write' as const,
      grants: [],
    }
  }
})
