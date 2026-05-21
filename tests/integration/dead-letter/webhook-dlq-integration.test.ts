import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createTriggerStore, type TriggerStore } from '../../../src/storage/trigger-store.js';
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventTriggerRuntime, type EventTriggerRuntime } from '../../../src/triggers/event-trigger-runtime.js';
import { createDeadLetterStore, type DeadLetterStore } from '../../../src/dead-letter/dead-letter-store.js';
import { createDeadLetterQueue, type DeadLetterQueue } from '../../../src/dead-letter/dead-letter-queue.js';

const migrations: Migration[] = [
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
        created_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
      )
    `,
    down: 'DROP TABLE IF EXISTS events'
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
      )
    `,
    down: 'DROP TABLE IF EXISTS runtime_actions'
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
      )
    `,
    down: 'DROP TABLE IF EXISTS trigger_registrations'
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
      )
    `,
    down: 'DROP TABLE IF EXISTS wait_conditions'
  },
  {
    version: 5,
    name: 'create_dead_letter_table',
    up: `
      CREATE TABLE IF NOT EXISTS dead_letter (
        event_id TEXT PRIMARY KEY,
        source_module TEXT NOT NULL,
        source_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'retrying', 'discarded', 'resolved')),
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        enqueued_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        discarded_at TEXT,
        resolved_at TEXT
      )
    `,
    down: 'DROP TABLE IF EXISTS dead_letter'
  }
];

describe('Webhook DLQ Integration', () => {
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let triggerStore: TriggerStore;
  let waitConditionStore: WaitConditionStore;
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let deadLetterStore: DeadLetterStore;
  let dlq: DeadLetterQueue;
  let eventTriggerRuntime: EventTriggerRuntime;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(migrations);

    triggerStore = createTriggerStore(connection);
    waitConditionStore = createWaitConditionStore(connection);
    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    deadLetterStore = createDeadLetterStore(connection);
    dlq = createDeadLetterQueue(deadLetterStore, async () => ({ success: true }));

    eventTriggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore,
      runtimeActionStore,
      dlq,
    });
  });

  afterEach(() => {
    connection.close();
  });

  describe('webhook failure → DLQ', () => {
    it('should enqueue to DLQ after 3 signature failures', () => {
      const payload = {
        eventId: 'test-webhook-event',
        data: 'test-data',
      };

      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');

      const beforeThird = dlq.count({ module: 'trigger.webhook' });
      expect(beforeThird).toBe(0);

      eventTriggerRuntime.handleWebhook(payload, '');

      const records = dlq.list({ module: 'trigger.webhook' });
      expect(records.length).toBe(1);
      expect(records[0]?.sourceModule).toBe('trigger.webhook');
      expect(records[0]?.sourceId).toBe('test-webhook-event');
      expect(records[0]?.reason).toBe('Invalid signature');
      expect(records[0]?.status).toBe('pending');
    });

    it('should not enqueue before reaching 3 failures', () => {
      const payload = { eventId: 'gradual-fail' };

      eventTriggerRuntime.handleWebhook(payload, '');
      expect(dlq.count({ module: 'trigger.webhook' })).toBe(0);

      eventTriggerRuntime.handleWebhook(payload, '');
      expect(dlq.count({ module: 'trigger.webhook' })).toBe(0);
    });

    it('should reset failure count after enqueue (4th failure creates new record)', () => {
      const payload = { eventId: 'reset-test' };

      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');

      expect(dlq.count({ module: 'trigger.webhook' })).toBe(1);

      eventTriggerRuntime.handleWebhook(payload, '');
      expect(dlq.count({ module: 'trigger.webhook' })).toBe(1);
    });

    it('should record with correct source_module', () => {
      const payload = { eventId: 'correct-module' };

      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');

      const records = dlq.list({ module: 'trigger.webhook' });
      expect(records[0]?.sourceModule).toBe('trigger.webhook');
    });

    it('should not enqueue when no DLQ configured', () => {
      const runtimeWithoutDlq = createEventTriggerRuntime({
        triggerStore,
        waitConditionStore,
        eventStore,
        runtimeActionStore,
      });

      const payload = { eventId: 'no-dlq-test' };

      runtimeWithoutDlq.handleWebhook(payload, '');
      runtimeWithoutDlq.handleWebhook(payload, '');
      runtimeWithoutDlq.handleWebhook(payload, '');

      expect(dlq.count({ module: 'trigger.webhook' })).toBe(0);
    });
  });

  describe('DLQ record existence', () => {
    it('should persist DLQ record after 3 webhook failures', () => {
      const payload = { eventId: 'persist-test' };

      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');

      const records = dlq.list();
      expect(records.length).toBe(1);
    });

    it('should store original payload in DLQ record', () => {
      const payload = { eventId: 'payload-test', customField: 'value', nested: { key: 'val' } };

      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');
      eventTriggerRuntime.handleWebhook(payload, '');

      const records = dlq.list();
      expect(records[0]?.payload).toBeDefined();
      expect(records[0]?.payload?.eventId).toBe('payload-test');
      expect(records[0]?.payload?.failureCount).toBe(3);
    });
  });

  describe('retry from DLQ', () => {
    it('should re-dispatch retried record', async () => {
      const retryFn = vi.fn().mockResolvedValue({ success: true });
      const retryDlq = createDeadLetterQueue(deadLetterStore, retryFn);

      const record = retryDlq.enqueue('trigger.webhook', 'webhook-1', 'Signature mismatch');
      const result = await retryDlq.retry(record.eventId);

      expect(result.success).toBe(true);
      expect(retryFn).toHaveBeenCalledTimes(1);

      const updated = retryDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('resolved');
    });
  });

  describe('discard from DLQ', () => {
    it('should mark record as discarded', () => {
      const record = dlq.enqueue('trigger.webhook', 'webhook-2', 'Unrecoverable error');
      dlq.discard(record.eventId);

      const updated = dlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('discarded');
      expect(updated?.discardedAt).toBeTruthy();
    });

    it('should keep discarded record for audit', () => {
      const record = dlq.enqueue('trigger.webhook', 'webhook-3', 'Error');
      dlq.discard(record.eventId);

      const exists = dlq.getByEventId(record.eventId);
      expect(exists).not.toBeNull();
      expect(exists?.status).toBe('discarded');
    });
  });
});
