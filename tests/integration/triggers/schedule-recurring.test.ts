import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createTriggerStore, type TriggerStore } from '../../../src/storage/trigger-store.js';
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventTriggerRuntime, type EventTriggerRuntime } from '../../../src/triggers/event-trigger-runtime.js';
import { TestClock } from '../../helpers/clock.js';
import { eventTriggerRuntimeMigrations } from './event-trigger-runtime.test.js';

describe('Recurring schedule triggers', () => {
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
    connection.close();
  });

  it('recurring schedule advances nextRunAt', () => {
    const clock = new TestClock('2026-05-09T09:00:00.000Z');
    const schedule = eventTriggerRuntime.registerSchedule({
      intervalMs: 60 * 60 * 1000,
      nextRunAt: '2026-05-09T10:00:00.000Z',
      targetType: 'workflow_step_run',
      targetRef: 'wf_step_hourly',
    });

    clock.advance(60 * 60 * 1000);
    const result = eventTriggerRuntime.evaluateScheduleTriggers(new Date(clock.now()));

    expect(result.fired).toBe(1);
    expect(result.actions).toHaveLength(1);

    const updated = eventTriggerRuntime.getTrigger(schedule.id);
    const metadata = JSON.parse(updated?.metadata ?? '{}') as { nextRunAt?: string };
    expect(metadata.nextRunAt).toBe('2026-05-09T11:00:00.000Z');

    const duplicateSameTick = eventTriggerRuntime.evaluateScheduleTriggers(new Date(clock.now()));
    expect(duplicateSameTick.fired).toBe(0);
  });
});
