import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createEventStore, type EventStore, type EventRecord } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore, type RuntimeAction } from '../../../src/storage/runtime-action-store.js';

const eventsMigration = {
  version: 1,
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
      sensitivity TEXT NOT NULL DEFAULT 'low',
      retention_class TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_session_created ON events(session_id, created_at);
    CREATE INDEX idx_events_user_created ON events(user_id, created_at);
    CREATE INDEX idx_events_correlation ON events(correlation_id);
    CREATE INDEX idx_events_causation ON events(causation_id);
    CREATE INDEX idx_events_planner_run ON events(planner_run_id);
    CREATE INDEX idx_events_plan ON events(plan_id);
    CREATE INDEX idx_events_run ON events(run_id);
    CREATE INDEX idx_events_workflow_run ON events(workflow_run_id);
    CREATE INDEX idx_events_workflow_step ON events(workflow_step_run_id);
    CREATE INDEX idx_events_background_run ON events(background_run_id);
    CREATE INDEX idx_events_subagent_run ON events(subagent_run_id);
    CREATE INDEX idx_events_tool_call ON events(tool_call_id);
    CREATE INDEX idx_events_approval ON events(approval_id);
    CREATE INDEX idx_events_event_type ON events(event_type, created_at);
    CREATE INDEX idx_events_source_module ON events(source_module, created_at);
  `,
  down: `
    DROP INDEX IF EXISTS idx_events_session_created;
    DROP INDEX IF EXISTS idx_events_user_created;
    DROP INDEX IF EXISTS idx_events_correlation;
    DROP INDEX IF EXISTS idx_events_causation;
    DROP INDEX IF EXISTS idx_events_planner_run;
    DROP INDEX IF EXISTS idx_events_plan;
    DROP INDEX IF EXISTS idx_events_run;
    DROP INDEX IF EXISTS idx_events_workflow_run;
    DROP INDEX IF EXISTS idx_events_workflow_step;
    DROP INDEX IF EXISTS idx_events_background_run;
    DROP INDEX IF EXISTS idx_events_subagent_run;
    DROP INDEX IF EXISTS idx_events_tool_call;
    DROP INDEX IF EXISTS idx_events_approval;
    DROP INDEX IF EXISTS idx_events_event_type;
    DROP INDEX IF EXISTS idx_events_source_module;
    DROP TABLE IF EXISTS events;
  `
};

const runtimeActionsMigration = {
  version: 2,
  name: 'create_runtime_actions_table',
  up: `
    CREATE TABLE runtime_actions (
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
    );
    CREATE INDEX idx_runtime_actions_idempotency ON runtime_actions(idempotency_key);
    CREATE INDEX idx_runtime_actions_source ON runtime_actions(source_module, created_at);
    CREATE INDEX idx_runtime_actions_target ON runtime_actions(target_runtime, created_at);
    CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
    CREATE INDEX idx_runtime_actions_correlation ON runtime_actions(correlation_id);
    CREATE INDEX idx_runtime_actions_session ON runtime_actions(session_id);
    CREATE INDEX idx_runtime_actions_user ON runtime_actions(user_id);
  `,
  down: `
    DROP INDEX IF EXISTS idx_runtime_actions_idempotency;
    DROP INDEX IF EXISTS idx_runtime_actions_source;
    DROP INDEX IF EXISTS idx_runtime_actions_target;
    DROP INDEX IF EXISTS idx_runtime_actions_status;
    DROP INDEX IF EXISTS idx_runtime_actions_correlation;
    DROP INDEX IF EXISTS idx_runtime_actions_session;
    DROP INDEX IF EXISTS idx_runtime_actions_user;
    DROP TABLE IF EXISTS runtime_actions;
  `
};

describe('Event Store', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let eventStore: EventStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply([eventsMigration, runtimeActionsMigration]);
    eventStore = createEventStore(connection);
  });

  afterEach(() => {
    connection?.close();
  });

  describe('append()', () => {
    it('should append a single event', () => {
      const event: EventRecord = {
        eventId: 'evt-001',
        eventType: 'inbound_received',
        sourceModule: 'gateway',
        userId: 'user-001',
        sessionId: 'sess-001',
        correlationId: 'corr-001',
        payload: { message: 'Hello' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString()
      };

      eventStore.append(event);

      const result = connection.query<{ count: number }>('SELECT COUNT(*) as count FROM events');
      expect(result[0]?.count).toBe(1);
    });

    it('should append multiple events', () => {
      const events: EventRecord[] = [
        {
          eventId: 'evt-001',
          eventType: 'inbound_received',
          sourceModule: 'gateway',
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date().toISOString()
        },
        {
          eventId: 'evt-002',
          eventType: 'foreground_decision_made',
          sourceModule: 'foreground_agent',
          payload: {},
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: new Date().toISOString()
        }
      ];

      eventStore.append(events);

      const result = connection.query<{ count: number }>('SELECT COUNT(*) as count FROM events');
      expect(result[0]?.count).toBe(2);
    });

    it('should store all event fields correctly', () => {
      const event: EventRecord = {
        eventId: 'evt-001',
        eventType: 'runtime_action_created',
        sourceModule: 'dispatcher',
        userId: 'user-001',
        sessionId: 'sess-001',
        correlationId: 'corr-001',
        causationId: 'cause-001',
        idempotencyKey: 'idem-001',
        relatedRefs: {
          plannerRunId: 'planrun-001',
          planId: 'plan-001',
          runId: 'run-001',
          workflowRunId: 'wf-001',
          workflowStepRunId: 'wfstep-001',
          backgroundRunId: 'bg-001',
          subagentRunId: 'sub-001',
          toolCallId: 'tool-001',
          approvalId: 'appr-001',
          waitConditionId: 'wait-001',
          artifactId: 'art-001',
          memoryId: 'mem-001'
        },
        payload: { action: 'test' },
        sensitivity: 'high',
        retentionClass: 'long',
        createdAt: '2024-01-15T10:30:00.000Z'
      };

      eventStore.append(event);

      const result = connection.query<{
        event_id: string;
        event_type: string;
        source_module: string;
        user_id: string;
        session_id: string;
        correlation_id: string;
        causation_id: string;
        idempotency_key: string;
        planner_run_id: string;
        plan_id: string;
        run_id: string;
        workflow_run_id: string;
        workflow_step_run_id: string;
        background_run_id: string;
        subagent_run_id: string;
        tool_call_id: string;
        approval_id: string;
        wait_condition_id: string;
        artifact_id: string;
        memory_id: string;
        payload: string;
        sensitivity: string;
        retention_class: string;
        created_at: string;
      }>('SELECT * FROM events WHERE event_id = ?', ['evt-001']);

      expect(result.length).toBe(1);
      expect(result[0]?.event_id).toBe('evt-001');
      expect(result[0]?.event_type).toBe('runtime_action_created');
      expect(result[0]?.source_module).toBe('dispatcher');
      expect(result[0]?.user_id).toBe('user-001');
      expect(result[0]?.session_id).toBe('sess-001');
      expect(result[0]?.correlation_id).toBe('corr-001');
      expect(result[0]?.causation_id).toBe('cause-001');
      expect(result[0]?.idempotency_key).toBe('idem-001');
      expect(result[0]?.planner_run_id).toBe('planrun-001');
      expect(result[0]?.plan_id).toBe('plan-001');
      expect(result[0]?.run_id).toBe('run-001');
      expect(result[0]?.workflow_run_id).toBe('wf-001');
      expect(result[0]?.workflow_step_run_id).toBe('wfstep-001');
      expect(result[0]?.background_run_id).toBe('bg-001');
      expect(result[0]?.subagent_run_id).toBe('sub-001');
      expect(result[0]?.tool_call_id).toBe('tool-001');
      expect(result[0]?.approval_id).toBe('appr-001');
      expect(result[0]?.wait_condition_id).toBe('wait-001');
      expect(result[0]?.artifact_id).toBe('art-001');
      expect(result[0]?.memory_id).toBe('mem-001');
      expect(JSON.parse(result[0]?.payload ?? '{}')).toEqual({ action: 'test' });
      expect(result[0]?.sensitivity).toBe('high');
      expect(result[0]?.retention_class).toBe('long');
      expect(result[0]?.created_at).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should throw on duplicate eventId', () => {
      const event: EventRecord = {
        eventId: 'evt-001',
        eventType: 'inbound_received',
        sourceModule: 'gateway',
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString()
      };

      eventStore.append(event);

      expect(() => {
        eventStore.append(event);
      }).toThrow();
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      const events: EventRecord[] = [
        {
          eventId: 'evt-001',
          eventType: 'inbound_received',
          sourceModule: 'gateway',
          userId: 'user-001',
          sessionId: 'sess-001',
          correlationId: 'corr-001',
          causationId: 'cause-001',
          payload: { seq: 1 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:00:00.000Z'
        },
        {
          eventId: 'evt-002',
          eventType: 'foreground_decision_made',
          sourceModule: 'foreground_agent',
          userId: 'user-001',
          sessionId: 'sess-001',
          correlationId: 'corr-001',
          causationId: 'evt-001',
          payload: { seq: 2 },
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:01:00.000Z'
        },
        {
          eventId: 'evt-003',
          eventType: 'planner_run_created',
          sourceModule: 'planner',
          userId: 'user-002',
          sessionId: 'sess-002',
          correlationId: 'corr-002',
          causationId: 'cause-002',
          payload: { seq: 3 },
          sensitivity: 'low',
          retentionClass: 'short',
          createdAt: '2024-01-15T10:02:00.000Z'
        }
      ];
      eventStore.append(events);
    });

    it('should query by sessionId', () => {
      const result = eventStore.query({ sessionId: 'sess-001' });
      expect(result.length).toBe(2);
      expect(result.map(e => e.eventId)).toContain('evt-001');
      expect(result.map(e => e.eventId)).toContain('evt-002');
    });

    it('should query by userId', () => {
      const result = eventStore.query({ userId: 'user-001' });
      expect(result.length).toBe(2);
    });

    it('should query by eventType', () => {
      const result = eventStore.query({ eventType: 'inbound_received' });
      expect(result.length).toBe(1);
      expect(result[0]?.eventId).toBe('evt-001');
    });

    it('should query by sourceModule', () => {
      const result = eventStore.query({ sourceModule: 'gateway' });
      expect(result.length).toBe(1);
      expect(result[0]?.sourceModule).toBe('gateway');
    });

    it('should query with limit', () => {
      const result = eventStore.query({ sessionId: 'sess-001', limit: 1 });
      expect(result.length).toBe(1);
    });

    it('should query with limit and offset', () => {
      const result = eventStore.query({ sessionId: 'sess-001', limit: 1, offset: 1 });
      expect(result.length).toBe(1);
      expect(result[0]?.eventId).toBe('evt-002');
    });

    it('should return empty array when no matches', () => {
      const result = eventStore.query({ sessionId: 'non-existent' });
      expect(result).toEqual([]);
    });
  });

  describe('findByCorrelationId()', () => {
    beforeEach(() => {
      const events: EventRecord[] = [
        {
          eventId: 'evt-001',
          eventType: 'inbound_received',
          sourceModule: 'gateway',
          correlationId: 'corr-001',
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:00:00.000Z'
        },
        {
          eventId: 'evt-002',
          eventType: 'foreground_decision_made',
          sourceModule: 'foreground_agent',
          correlationId: 'corr-001',
          payload: {},
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:01:00.000Z'
        },
        {
          eventId: 'evt-003',
          eventType: 'planner_run_created',
          sourceModule: 'planner',
          correlationId: 'corr-002',
          payload: {},
          sensitivity: 'low',
          retentionClass: 'short',
          createdAt: '2024-01-15T10:02:00.000Z'
        }
      ];
      eventStore.append(events);
    });

    it('should find events by correlationId', () => {
      const result = eventStore.findByCorrelationId('corr-001');
      expect(result.length).toBe(2);
      expect(result.map(e => e.eventId).sort()).toEqual(['evt-001', 'evt-002']);
    });

    it('should return empty array when correlationId not found', () => {
      const result = eventStore.findByCorrelationId('non-existent');
      expect(result).toEqual([]);
    });

    it('should return events ordered by createdAt', () => {
      const result = eventStore.findByCorrelationId('corr-001');
      expect(result[0]?.eventId).toBe('evt-001');
      expect(result[1]?.eventId).toBe('evt-002');
    });
  });

  describe('findByCausationId()', () => {
    beforeEach(() => {
      const events: EventRecord[] = [
        {
          eventId: 'evt-001',
          eventType: 'inbound_received',
          sourceModule: 'gateway',
          causationId: 'cause-001',
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:00:00.000Z'
        },
        {
          eventId: 'evt-002',
          eventType: 'foreground_decision_made',
          sourceModule: 'foreground_agent',
          causationId: 'cause-001',
          payload: {},
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: '2024-01-15T10:01:00.000Z'
        }
      ];
      eventStore.append(events);
    });

    it('should find events by causationId', () => {
      const result = eventStore.findByCausationId('cause-001');
      expect(result.length).toBe(2);
    });
  });
});

describe('RuntimeAction Store', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let actionStore: RuntimeActionStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply([eventsMigration, runtimeActionsMigration]);
    actionStore = createRuntimeActionStore(connection);
  });

  afterEach(() => {
    connection?.close();
  });

  describe('save()', () => {
    it('should save a new runtime action', () => {
      const action: RuntimeAction = {
        actionId: 'act-001',
        actionType: 'execute_tool',
        idempotencyKey: 'idem-001',
        source: { sourceModule: 'dispatcher', sourceAction: 'dispatch' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { data: 'test' },
        correlationId: 'corr-001',
        causationId: 'cause-001',
        sessionId: 'sess-001',
        userId: 'user-001',
        targetRef: {
          plannerRunId: 'planrun-001',
          runId: 'run-001'
        },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      actionStore.save(action);

      const result = connection.query<{ count: number }>('SELECT COUNT(*) as count FROM runtime_actions');
      expect(result[0]?.count).toBe(1);
    });

    it('should store all action fields correctly', () => {
      const action: RuntimeAction = {
        actionId: 'act-001',
        actionType: 'execute_tool',
        idempotencyKey: 'idem-001',
        source: { sourceModule: 'dispatcher', sourceAction: 'dispatch' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { data: 'test-payload' },
        correlationId: 'corr-001',
        causationId: 'cause-001',
        sessionId: 'sess-001',
        userId: 'user-001',
        targetRef: {
          plannerRunId: 'planrun-001',
          planId: 'plan-001',
          runId: 'run-001',
          workflowRunId: 'wf-001',
          workflowStepRunId: 'wfstep-001',
          backgroundRunId: 'bg-001',
          subagentRunId: 'sub-001',
          toolCallId: 'tool-001'
        },
        status: 'accepted',
        statusMessage: 'Action accepted for execution',
        result: { success: true },
        createdAt: '2024-01-15T10:30:00.000Z',
        updatedAt: '2024-01-15T10:31:00.000Z'
      };

      actionStore.save(action);

      const result = connection.query<{
        action_id: string;
        idempotency_key: string;
        source_module: string;
        source_action: string;
        target_runtime: string;
        target_action: string;
        payload: string;
        correlation_id: string;
        causation_id: string;
        session_id: string;
        user_id: string;
        planner_run_id: string;
        plan_id: string;
        run_id: string;
        workflow_run_id: string;
        workflow_step_run_id: string;
        background_run_id: string;
        subagent_run_id: string;
        tool_call_id: string;
        status: string;
        status_message: string;
        result: string;
        created_at: string;
        updated_at: string;
      }>('SELECT * FROM runtime_actions WHERE action_id = ?', ['act-001']);

      expect(result.length).toBe(1);
      expect(result[0]?.action_id).toBe('act-001');
      expect(result[0]?.idempotency_key).toBe('idem-001');
      expect(result[0]?.source_module).toBe('dispatcher');
      expect(result[0]?.source_action).toBe('dispatch');
      expect(result[0]?.target_runtime).toBe('kernel');
      expect(result[0]?.target_action).toBe('execute');
      expect(JSON.parse(result[0]?.payload ?? '{}')).toEqual({ data: 'test-payload' });
      expect(result[0]?.correlation_id).toBe('corr-001');
      expect(result[0]?.causation_id).toBe('cause-001');
      expect(result[0]?.session_id).toBe('sess-001');
      expect(result[0]?.user_id).toBe('user-001');
      expect(result[0]?.planner_run_id).toBe('planrun-001');
      expect(result[0]?.plan_id).toBe('plan-001');
      expect(result[0]?.run_id).toBe('run-001');
      expect(result[0]?.workflow_run_id).toBe('wf-001');
      expect(result[0]?.workflow_step_run_id).toBe('wfstep-001');
      expect(result[0]?.background_run_id).toBe('bg-001');
      expect(result[0]?.subagent_run_id).toBe('sub-001');
      expect(result[0]?.tool_call_id).toBe('tool-001');
      expect(result[0]?.status).toBe('accepted');
      expect(result[0]?.status_message).toBe('Action accepted for execution');
      expect(JSON.parse(result[0]?.result ?? '{}')).toEqual({ success: true });
      expect(result[0]?.created_at).toBe('2024-01-15T10:30:00.000Z');
      expect(result[0]?.updated_at).toBe('2024-01-15T10:31:00.000Z');
    });
  });

  describe('findByIdempotencyKey()', () => {
    beforeEach(() => {
      const action: RuntimeAction = {
        actionId: 'act-001',
        actionType: 'execute_tool',
        idempotencyKey: 'idem-001',
        source: { sourceModule: 'dispatcher', sourceAction: 'dispatch' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { data: 'test' },
        status: 'accepted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      actionStore.save(action);
    });

    it('should find action by idempotency key', () => {
      const result = actionStore.findByIdempotencyKey('idem-001');
      expect(result).not.toBeNull();
      expect(result?.actionId).toBe('act-001');
      expect(result?.idempotencyKey).toBe('idem-001');
    });

    it('should return null when idempotency key not found', () => {
      const result = actionStore.findByIdempotencyKey('non-existent');
      expect(result).toBeNull();
    });

    it('should support idempotency check for duplicate action', () => {
      const existing = actionStore.findByIdempotencyKey('idem-001');
      expect(existing).not.toBeNull();

      const duplicate = actionStore.findByIdempotencyKey('idem-001');
      expect(duplicate?.actionId).toBe(existing?.actionId);
    });
  });

  describe('updateStatus()', () => {
    beforeEach(() => {
      const action: RuntimeAction = {
        actionId: 'act-001',
        actionType: 'execute_tool',
        idempotencyKey: 'idem-001',
        source: { sourceModule: 'dispatcher', sourceAction: 'dispatch' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { data: 'test' },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      actionStore.save(action);
    });

    it('should update action status', () => {
      actionStore.updateStatus('act-001', 'accepted');

      const result = connection.query<{ status: string }>('SELECT status FROM runtime_actions WHERE action_id = ?', ['act-001']);
      expect(result[0]?.status).toBe('accepted');
    });

    it('should update action status with message', () => {
      actionStore.updateStatus('act-001', 'accepted', 'Action validated and queued');

      const result = connection.query<{ status: string; status_message: string }>(
        'SELECT status, status_message FROM runtime_actions WHERE action_id = ?',
        ['act-001']
      );
      expect(result[0]?.status).toBe('accepted');
      expect(result[0]?.status_message).toBe('Action validated and queued');
    });

    it('should update action status with result', () => {
      const resultData = { output: 'success', duration: 100 };
      actionStore.updateStatus('act-001', 'completed', undefined, resultData);

      const result = connection.query<{ status: string; result: string }>(
        'SELECT status, result FROM runtime_actions WHERE action_id = ?',
        ['act-001']
      );
      expect(result[0]?.status).toBe('completed');
      expect(JSON.parse(result[0]?.result ?? '{}')).toEqual(resultData);
    });

    it('should update updatedAt timestamp', () => {
      const before = Date.now();
      actionStore.updateStatus('act-001', 'accepted');
      const after = Date.now();

      const result = connection.query<{ updated_at: string }>(
        'SELECT updated_at FROM runtime_actions WHERE action_id = ?',
        ['act-001']
      );
      const updatedAt = new Date(result[0]?.updated_at ?? '').getTime();
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
    });

    it('should throw when action not found', () => {
      expect(() => {
        actionStore.updateStatus('non-existent', 'accepted');
      }).toThrow('Action not found');
    });
  });

  describe('findById()', () => {
    beforeEach(() => {
      const action: RuntimeAction = {
        actionId: 'act-001',
        actionType: 'execute_tool',
        idempotencyKey: 'idem-001',
        source: { sourceModule: 'dispatcher', sourceAction: 'dispatch' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { data: 'test' },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      actionStore.save(action);
    });

    it('should find action by actionId', () => {
      const result = actionStore.findById('act-001');
      expect(result).not.toBeNull();
      expect(result?.actionId).toBe('act-001');
    });

    it('should return null when action not found', () => {
      const result = actionStore.findById('non-existent');
      expect(result).toBeNull();
    });
  });
});
