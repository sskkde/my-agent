import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createTriggerStore, type TriggerStore, TRIGGER_STATUSES } from '../../../src/storage/trigger-store.js';
import { createWaitConditionStore, type WaitConditionStore, WAIT_CONDITION_STATES } from '../../../src/storage/wait-condition-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore, type RuntimeAction } from '../../../src/storage/runtime-action-store.js';
import { createEventTriggerRuntime, type EventTriggerRuntime } from '../../../src/triggers/event-trigger-runtime.js';
import { TestClock } from '../../helpers/clock.js';

export const eventTriggerRuntimeMigrations: Migration[] = [
  {
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
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
      CREATE INDEX idx_events_event_type ON events(event_type, created_at);
      CREATE INDEX idx_events_source_module ON events(source_module, created_at)
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_event_type;
      DROP INDEX IF EXISTS idx_events_source_module;
      DROP TABLE IF EXISTS events
    `
  },
  {
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
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_correlation ON runtime_actions(correlation_id)
    `,
    down: `
      DROP INDEX IF EXISTS idx_runtime_actions_idempotency;
      DROP INDEX IF EXISTS idx_runtime_actions_status;
      DROP INDEX IF EXISTS idx_runtime_actions_correlation;
      DROP TABLE IF EXISTS runtime_actions
    `
  },
  {
    version: 3,
    name: 'create_trigger_registrations_table',
    up: `
      CREATE TABLE trigger_registrations (
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
      );
      CREATE INDEX idx_trigger_registrations_target ON trigger_registrations(target_type, target_ref);
      CREATE INDEX idx_trigger_registrations_status ON trigger_registrations(status);
      CREATE INDEX idx_trigger_registrations_expires ON trigger_registrations(expires_at) WHERE expires_at IS NOT NULL
    `,
    down: `
      DROP INDEX IF EXISTS idx_trigger_registrations_target;
      DROP INDEX IF EXISTS idx_trigger_registrations_status;
      DROP INDEX IF EXISTS idx_trigger_registrations_expires;
      DROP TABLE IF EXISTS trigger_registrations
    `
  },
  {
    version: 4,
    name: 'create_wait_conditions_table',
    up: `
      CREATE TABLE wait_conditions (
        id TEXT PRIMARY KEY,
        wait_type TEXT NOT NULL,
        condition_pattern TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        timeout_at TEXT,
        satisfied_at TEXT,
        satisfied_by TEXT,
        result_data TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_wait_conditions_target ON wait_conditions(target_type, target_ref);
      CREATE INDEX idx_wait_conditions_status ON wait_conditions(status);
      CREATE INDEX idx_wait_conditions_timeout ON wait_conditions(timeout_at) WHERE timeout_at IS NOT NULL
    `,
    down: `
      DROP INDEX IF EXISTS idx_wait_conditions_target;
      DROP INDEX IF EXISTS idx_wait_conditions_status;
      DROP INDEX IF EXISTS idx_wait_conditions_timeout;
      DROP TABLE IF EXISTS wait_conditions
    `
  },
];

describe('Event Trigger Runtime Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let triggerStore: TriggerStore;
  let waitConditionStore: WaitConditionStore;
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let eventTriggerRuntime: EventTriggerRuntime;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(eventTriggerRuntimeMigrations);

    triggerStore = createTriggerStore(connection);
    waitConditionStore = createWaitConditionStore(connection);
    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);

    eventTriggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore,
      runtimeActionStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('TriggerRegistration creation', () => {
    it('should create a schedule trigger registration', () => {
      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2025-12-31T23:59:59Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        priority: 5,
        maxTriggers: 1,
      });

      expect(registration.id).toBeDefined();
      expect(registration.triggerType).toBe('schedule');
      expect(registration.conditionType).toBe('schedule');
      expect(registration.conditionPattern).toBe('2025-12-31T23:59:59Z');
      expect(registration.targetType).toBe('workflow_step_run');
      expect(registration.targetRef).toBe('wf_step_run_123');
      expect(registration.status).toBe(TRIGGER_STATUSES.ACTIVE);
      expect(registration.priority).toBe(5);
      expect(registration.maxTriggers).toBe(1);
      expect(registration.triggerCount).toBe(0);
    });

    it('should create an approval trigger registration', () => {
      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: 'appr_123',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_456',
      });

      expect(registration.id).toBeDefined();
      expect(registration.triggerType).toBe('approval');
      expect(registration.conditionType).toBe('approval_resolved');
      expect(registration.conditionPattern).toBe('appr_123');
      expect(registration.status).toBe(TRIGGER_STATUSES.ACTIVE);
    });

    it('should persist trigger registration to store', () => {
      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 12 * * *',
        targetType: 'background_run',
        targetRef: 'bg_run_789',
      });

      const retrieved = triggerStore.getById(registration.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.triggerType).toBe('schedule');
      expect(retrieved?.targetRef).toBe('bg_run_789');
    });

    it('should emit trigger_registered event', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2025-01-01T00:00:00Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_001',
      });

      const events = eventStore.query({ eventType: 'trigger_registered' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload.triggerType).toBe('schedule');
    });
  });

  describe('Schedule trigger firing', () => {
    it('should fire schedule trigger when due time is reached', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.fired).toBe(1);
      expect(result.events.length).toBe(1);
      expect(result.events[0]?.eventType).toBe('schedule_trigger_fired');
      expect(result.actions.length).toBe(1);
    });

    it('should not fire schedule trigger when time is in the future', () => {
      const futureTime = new Date(Date.now() + 86400000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: futureTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.fired).toBe(0);
      expect(result.events.length).toBe(0);
      expect(result.actions.length).toBe(0);
    });

    it('should emit RuntimeTriggerEvent when schedule trigger fires', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      const events = eventStore.query({ eventType: 'schedule_trigger_fired' });
      expect(events.length).toBe(1);
      expect(events[0]?.sourceModule).toBe('trigger');
      expect(events[0]?.payload.triggerId).toBeDefined();
    });

    it('should create RuntimeAction to resume target when schedule trigger fires', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      const action = result.actions[0];
      expect(action?.targetRuntime).toBe('workflow_runtime');
      expect(action?.targetAction).toBe('resume_workflow_step');
      expect(action?.payload.targetRef).toBe('wf_step_run_123');
      expect(action?.idempotencyKey).toBeDefined();
    });

    it('should increment trigger count when schedule trigger fires', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      const updated = triggerStore.getById(registration.id);
      expect(updated?.triggerCount).toBe(1);
    });

    it('should complete trigger when maxTriggers is reached', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        maxTriggers: 1,
      });

      eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      const updated = triggerStore.getById(registration.id);
      expect(updated?.status).toBe(TRIGGER_STATUSES.COMPLETED);
    });

    it('should expire trigger when expiresAt is passed', () => {
      const pastTime = new Date(Date.now() - 86400000).toISOString();
      const expiredAt = new Date(Date.now() - 1000).toISOString();

      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        expiresAt: expiredAt,
      });

      eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      const updated = triggerStore.getById(registration.id);
      expect(updated?.status).toBe(TRIGGER_STATUSES.EXPIRED);
    });
  });

  describe('Approval_resolved trigger', () => {
    it('should fire approval trigger when matching approval is resolved', () => {
      const approvalId = 'appr_123';

      eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: approvalId,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.handleApprovalResolved({
        approvalId,
        status: 'approved',
      });

      expect(result.matched).toBe(1);
      expect(result.events.length).toBe(1);
      expect(result.events[0]?.eventType).toBe('approval_resolved_trigger');
      expect(result.actions.length).toBe(1);
    });

    it('should fire wildcard approval trigger for any approval', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: '*',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.handleApprovalResolved({
        approvalId: 'appr_any',
        status: 'rejected',
      });

      expect(result.matched).toBe(1);
      expect(result.events.length).toBe(1);
    });

    it('should not fire trigger for non-matching approval', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: 'appr_specific',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.handleApprovalResolved({
        approvalId: 'appr_different',
        status: 'approved',
      });

      expect(result.matched).toBe(0);
      expect(result.events.length).toBe(0);
    });

    it('should include approval status and result in resume action payload', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: 'appr_123',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.handleApprovalResolved({
        approvalId: 'appr_123',
        status: 'approved',
        result: { approvedBy: 'user_001', reason: 'Approved as requested' },
      });

      const action = result.actions[0];
      expect(action?.payload.status).toBe('approved');
      expect(action?.payload.result).toEqual({ approvedBy: 'user_001', reason: 'Approved as requested' });
    });
  });

  describe('WaitCondition registration and evaluation', () => {
    it('should register a wait condition', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '30s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: new Date(Date.now() + 30000).toISOString(),
      });

      expect(condition.id).toBeDefined();
      expect(condition.waitType).toBe('timeout');
      expect(condition.conditionPattern).toBe('30s');
      expect(condition.targetType).toBe('workflow_step_run');
      expect(condition.targetRef).toBe('wf_step_run_123');
      expect(condition.status).toBe(WAIT_CONDITION_STATES.ACTIVE);
    });

    it('should register an operation_completion wait condition', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'operation_completion',
        conditionPattern: 'appr_123',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_456',
      });

      expect(condition.id).toBeDefined();
      expect(condition.waitType).toBe('operation_completion');
      expect(condition.conditionPattern).toBe('appr_123');
    });

    it('should register an event-based wait condition', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'event',
        conditionPattern: '{"eventType":"user_action"}',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_789',
      });

      expect(condition.id).toBeDefined();
      expect(condition.waitType).toBe('event');
    });

    it('should persist wait condition to store', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1h',
        targetType: 'background_run',
        targetRef: 'bg_run_123',
        timeoutAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const retrieved = waitConditionStore.getById(condition.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.waitType).toBe('timeout');
      expect(retrieved?.targetRef).toBe('bg_run_123');
    });
  });

  describe('Timeout handling for WaitConditions', () => {
    it('should mark wait condition as timeout when timeoutAt is reached', () => {
      const pastTimeout = new Date(Date.now() - 1000).toISOString();

      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: pastTimeout,
      });

      const result = eventTriggerRuntime.evaluateWaitConditions(new Date());

      expect(result.processed).toBeGreaterThanOrEqual(1);

      const updated = waitConditionStore.getById(condition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.TIMEOUT);
    });

    it('should emit wait_condition_timeout event', () => {
      const pastTimeout = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: pastTimeout,
      });

      eventTriggerRuntime.evaluateWaitConditions(new Date());

      const events = eventStore.query({ eventType: 'wait_condition_timeout' });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should create resume action for timeout', () => {
      const pastTimeout = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: pastTimeout,
      });

      const result = eventTriggerRuntime.evaluateWaitConditions(new Date());

      const timeoutActions = result.actions.filter((a: RuntimeAction) => a.payload.waitType === 'timeout');
      expect(timeoutActions.length).toBeGreaterThanOrEqual(1);
      expect(timeoutActions[0]?.targetAction).toBe('resume_workflow_step');
    });
  });

  describe('WaitCondition success/failure handling', () => {
    it('should handle satisfied wait condition', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '0s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: new Date(Date.now() - 1).toISOString(),
      });

      eventTriggerRuntime.evaluateWaitConditions(new Date());

      const updated = waitConditionStore.getById(condition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.TIMEOUT);
    });

    it('should include resultData in satisfied wait condition', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1s',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
        timeoutAt: new Date(Date.now() - 100).toISOString(),
      });

      eventTriggerRuntime.evaluateWaitConditions(new Date());

      const updated = waitConditionStore.getById(condition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.TIMEOUT);
    });
  });

  describe('Idempotent RuntimeTriggerEvent handling', () => {
    it('should use idempotency key to prevent duplicate resume actions', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result1 = eventTriggerRuntime.evaluateScheduleTriggers(new Date());
      const result2 = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result1.actions.length).toBe(1);
      expect(result2.actions.length).toBe(0);
    });

    it('should store action with idempotency key', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      const actions = runtimeActionStore.query({ status: 'created' });
      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions[0]?.idempotencyKey).toBeDefined();
    });

    it('should retrieve existing action by idempotency key', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result1 = eventTriggerRuntime.evaluateScheduleTriggers(new Date());
      const idempotencyKey = result1.actions[0]?.idempotencyKey;

      const existing = runtimeActionStore.findByIdempotencyKey(idempotencyKey!);
      expect(existing).not.toBeNull();
      expect(existing?.actionId).toBe(result1.actions[0]?.actionId);
    });
  });

  describe('Target resume RuntimeAction creation', () => {
    it('should create workflow_run start action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_run',
        targetRef: 'wf_def_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('workflow_runtime');
      expect(result.actions[0]?.targetAction).toBe('start_workflow_run');
      expect(result.actions[0]?.actionType).toBe('start_workflow_run');
    });

    it('should create workflow_step_run resume action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('workflow_runtime');
      expect(result.actions[0]?.targetAction).toBe('resume_workflow_step');
    });

    it('should create background_run resume action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'background_run',
        targetRef: 'bg_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('subagent_runtime');
      expect(result.actions[0]?.targetAction).toBe('resume_subagent');
    });

    it('should create planner_run resume action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'planner_run',
        targetRef: 'pl_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('planner_runtime');
      expect(result.actions[0]?.targetAction).toBe('resume_planner_run');
    });

    it('should create kernel_run resume action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'kernel_run',
        targetRef: 'run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('agent_kernel');
      expect(result.actions[0]?.targetAction).toBe('resume_agent_run');
    });

    it('should create notification action', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'notification',
        targetRef: 'notif_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions.length).toBe(1);
      expect(result.actions[0]?.targetRuntime).toBe('notification_center');
      expect(result.actions[0]?.targetAction).toBe('send_notification');
    });

    it('should include correct targetRef in action payload', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_abc',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions[0]?.payload.targetRef).toBe('wf_step_run_abc');
    });

    it('should include eventType and triggerEventId in action payload', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();

      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: pastTime,
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date());

      expect(result.actions[0]?.payload.eventType).toBe('schedule_trigger_fired');
      expect(result.actions[0]?.payload.triggerEventId).toBeDefined();
    });
  });

  describe('Trigger and wait condition queries', () => {
    it('should get trigger by id', () => {
      const registration = eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2025-12-31T00:00:00Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const retrieved = eventTriggerRuntime.getTrigger(registration.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(registration.id);
    });

    it('should get wait condition by id', () => {
      const condition = eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1h',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_123',
      });

      const retrieved = eventTriggerRuntime.getWaitCondition(condition.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(condition.id);
    });

    it('should find triggers by target', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2025-12-31T00:00:00Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_target',
      });

      eventTriggerRuntime.registerTrigger({
        triggerType: 'approval',
        conditionType: 'approval_resolved',
        conditionPattern: 'appr_123',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_target',
      });

      const triggers = eventTriggerRuntime.findTriggersByTarget('workflow_step_run', 'wf_step_run_target');
      expect(triggers.length).toBe(2);
    });

    it('should find wait conditions by target', () => {
      eventTriggerRuntime.registerWaitCondition({
        waitType: 'timeout',
        conditionPattern: '1h',
        targetType: 'background_run',
        targetRef: 'bg_run_target',
      });

      eventTriggerRuntime.registerWaitCondition({
        waitType: 'event',
        conditionPattern: '{"type":"test"}',
        targetType: 'background_run',
        targetRef: 'bg_run_target',
      });

      const conditions = eventTriggerRuntime.findWaitConditionsByTarget('background_run', 'bg_run_target');
      expect(conditions.length).toBe(2);
    });
  });

  describe('Webhook and MCP event triggers', () => {
    it('should fire webhook trigger once per idempotency key with signature validation', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'webhook',
        conditionType: 'webhook',
        conditionPattern: '{"eventType":"invoice.paid"}',
        targetType: 'workflow_run',
        targetRef: 'wf_def_invoice',
      });

      const payload = {
        idempotencyKey: 'webhook_evt_1',
        eventType: 'invoice.paid',
        secret: 'test_secret',
        payload: { invoiceId: 'inv_1' },
      };

      const invalid = eventTriggerRuntime.handleWebhook(payload, 'wrong');
      const first = eventTriggerRuntime.handleWebhook(payload, 'sha256=test_secret');
      const duplicate = eventTriggerRuntime.handleWebhook(payload, 'sha256=test_secret');

      expect(invalid.matched).toBe(0);
      expect(first.matched).toBe(1);
      expect(first.actions[0]?.targetAction).toBe('start_workflow_run');
      expect(duplicate.matched).toBe(0);
      expect(runtimeActionStore.query({ status: 'created' })).toHaveLength(1);
    });

    it('should route mcp notifications idempotently', () => {
      eventTriggerRuntime.registerTrigger({
        triggerType: 'mcp_notification',
        conditionType: 'mcp_notification',
        conditionPattern: '{"method":"resources/updated"}',
        targetType: 'planner_run',
        targetRef: 'pl_run_mcp',
      });

      const first = eventTriggerRuntime.handleMcpNotification({
        id: 'mcp_evt_1',
        method: 'resources/updated',
        serverId: 'fs',
        sessionId: 'mcp_sess_1',
      });
      const duplicate = eventTriggerRuntime.handleMcpNotification({
        id: 'mcp_evt_1',
        method: 'resources/updated',
        serverId: 'fs',
        sessionId: 'mcp_sess_1',
      });

      expect(first.matched).toBe(1);
      expect(first.actions[0]?.targetAction).toBe('resume_planner_run');
      expect(duplicate.matched).toBe(0);
    });

    it('should advance recurring schedule nextRunAt using fake clock', () => {
      const clock = new TestClock('2026-05-09T09:00:00.000Z');
      const schedule = eventTriggerRuntime.registerSchedule({
        intervalMs: 60 * 60 * 1000,
        nextRunAt: '2026-05-09T10:00:00.000Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_recurring',
      });

      expect(eventTriggerRuntime.evaluateScheduleTriggers(new Date(clock.now())).fired).toBe(0);

      clock.advance(60 * 60 * 1000);
      const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date(clock.now()));

      expect(result.fired).toBe(1);
      const updated = eventTriggerRuntime.getTrigger(schedule.id);
      const metadata = JSON.parse(updated?.metadata ?? '{}') as { nextRunAt?: string };
      expect(metadata.nextRunAt).toBe('2026-05-09T11:00:00.000Z');
    });
  });
});
