import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type Migration, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js';
import { McpNotificationBridge } from '../../../src/connectors/mcp/mcp-notification-bridge.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createTriggerStore, type TriggerStore } from '../../../src/storage/trigger-store.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js';
import type { AuditRecorder } from '../../../src/observability/audit-types.js';

const migrationsForNotificationBridge: Migration[] = [
  {
    version: 1,
    name: 'create_mcp_sessions_table',
    up: `CREATE TABLE mcp_sessions (
      session_id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      connector_instance_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('connecting', 'connected', 'disconnected', 'error')),
      auth_token_ref TEXT,
      metadata TEXT,
      last_error TEXT,
      last_health_check TEXT,
      connected_at TEXT,
      last_activity_at TEXT,
      disconnected_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    down: 'DROP TABLE IF EXISTS mcp_sessions',
  },
  {
    version: 2,
    name: 'create_events_table',
    up: `CREATE TABLE events (
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
      sensitivity TEXT NOT NULL DEFAULT 'low',
      retention_class TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL
    )`,
    down: 'DROP TABLE IF EXISTS events',
  },
  {
    version: 3,
    name: 'create_runtime_actions_table',
    up: `CREATE TABLE runtime_actions (
      action_id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      source_module TEXT NOT NULL,
      source_action TEXT,
      target_runtime TEXT NOT NULL,
      target_action TEXT NOT NULL,
      payload TEXT NOT NULL,
      correlation_id TEXT,
      causation_id TEXT,
      session_id TEXT,
      user_id TEXT,
      planner_run_id TEXT,
      plan_id TEXT,
      run_id TEXT,
      workflow_run_id TEXT,
      workflow_step_run_id TEXT,
      background_run_id TEXT,
      subagent_run_id TEXT,
      tool_call_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      status_message TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    down: 'DROP TABLE IF EXISTS runtime_actions',
  },
  {
    version: 4,
    name: 'create_trigger_registrations_table',
    up: `CREATE TABLE trigger_registrations (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_pattern TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      max_triggers INTEGER,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    down: 'DROP TABLE IF EXISTS trigger_registrations',
  },
  {
    version: 5,
    name: 'create_audit_records_table',
    up: `CREATE TABLE audit_records (
      audit_id TEXT PRIMARY KEY,
      audit_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      source_module TEXT NOT NULL,
      source_action TEXT NOT NULL,
      action_summary TEXT NOT NULL,
      target_type TEXT,
      target_ref TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      input_hash TEXT,
      correlation_id TEXT,
      causation_id TEXT,
      approval_id TEXT,
      tool_call_id TEXT,
      permission_decision_id TEXT,
      risk_level TEXT NOT NULL,
      sensitivity TEXT NOT NULL
    )`,
    down: 'DROP TABLE IF EXISTS audit_records',
  },
];

describe('MCP notification trigger bridge', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let sessionManager: McpSessionManager;
  let eventStore: EventStore;
  let triggerStore: TriggerStore;
  let runtimeActionStore: RuntimeActionStore;
  let auditRecorder: AuditRecorder;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(migrationsForNotificationBridge);
    sessionManager = createMcpSessionManager(connection);
    eventStore = createEventStore(connection);
    triggerStore = createTriggerStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    auditRecorder = createAuditRecorder({ auditStore: createAuditStore(connection) });
  });

  afterEach(() => {
    connection.close();
  });

  it('MCP notification wakes trigger', () => {
    const session = sessionManager.openSession('mock');
    const trigger = triggerStore.create({
      id: 'trig_mcp_notification',
      triggerType: 'event',
      conditionType: 'event',
      conditionPattern: '{"eventType":"mcp_notification","source":"mcp.mock"}',
      targetType: 'workflow_step_run',
      targetRef: 'wf_step_mcp',
      status: 'active',
    });
    const bridge = new McpNotificationBridge({
      sessionManager,
      eventStore,
      triggerStore,
      runtimeActionStore,
      auditRecorder,
      defaultUserId: 'user_mcp',
    });

    const event = bridge.handleNotification(session.sessionId, {
      idempotencyKey: 'notif_1',
      method: 'resources/updated',
      params: { path: '/phase3.txt' },
    });

    expect(event.eventType).toBe('mcp_notification');
    expect(event.payload.source).toBe('mcp.mock');
    expect(eventStore.query({ eventType: 'mcp_notification' })).toHaveLength(1);
    expect(triggerStore.getById(trigger.id)?.triggerCount).toBe(1);
    const actions = runtimeActionStore.query({ status: 'created' });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.targetAction).toBe('resume_workflow_step');
    expect(actions[0]?.payload.notification).toMatchObject({ method: 'resources/updated' });
    expect(auditRecorder.getStore().query({ auditType: 'connector_access' })).toHaveLength(1);

    const duplicate = bridge.handleNotification(session.sessionId, {
      idempotencyKey: 'notif_1',
      method: 'resources/updated',
      params: { path: '/phase3.txt' },
    });
    expect(duplicate.eventId).toBe(event.eventId);
    expect(runtimeActionStore.query({ status: 'created' })).toHaveLength(1);
  });
});
