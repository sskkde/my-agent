import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { createTriggerStore, type TriggerStore } from '../../../src/storage/trigger-store.js'
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js'
import { createEventTriggerRuntime, type EventTriggerRuntime } from '../../../src/triggers/event-trigger-runtime.js'
import { eventTriggerRuntimeMigrations } from './event-trigger-runtime.test.js'

describe('Connector event trigger integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let triggerStore: TriggerStore
  let waitConditionStore: WaitConditionStore
  let eventStore: EventStore
  let runtimeActionStore: RuntimeActionStore
  let eventTriggerRuntime: EventTriggerRuntime

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(eventTriggerRuntimeMigrations)

    triggerStore = createTriggerStore(connection)
    waitConditionStore = createWaitConditionStore(connection)
    eventStore = createEventStore(connection)
    runtimeActionStore = createRuntimeActionStore(connection)

    eventTriggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore,
      runtimeActionStore,
    })
  })

  afterEach(() => {
    connection.close()
  })

  it('connector email event starts workflow once', () => {
    eventTriggerRuntime.registerTrigger({
      triggerType: 'connector_event',
      conditionType: 'connector_event',
      conditionPattern: '{"eventType":"email.received","connectorId":"gmail"}',
      targetType: 'workflow_run',
      targetRef: 'wf_def_email_triage',
    })

    const event = {
      eventId: 'email_evt_1',
      eventType: 'email.received',
      connectorId: 'gmail',
      connectorInstanceId: 'gmail_primary',
      payload: { messageId: 'msg_1', subject: 'Hello' },
    }

    const first = eventTriggerRuntime.handleConnectorEvent(event)
    const duplicate = eventTriggerRuntime.handleConnectorEvent(event)

    expect(first.matched).toBe(1)
    expect(first.actions[0]?.targetRuntime).toBe('workflow_runtime')
    expect(first.actions[0]?.targetAction).toBe('start_workflow_run')
    expect(duplicate.matched).toBe(0)
    expect(runtimeActionStore.query({ status: 'created' })).toHaveLength(1)
    expect(eventStore.query({ eventType: 'connector_event_trigger_fired' })).toHaveLength(1)
  })
})
