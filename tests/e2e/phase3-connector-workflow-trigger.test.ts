/**
 * Phase 3 E2E: Connector Event to Workflow Trigger
 *
 * Tests the event-driven automation path:
 * - Event → Trigger → Workflow creation
 * - Trigger → Tool execution
 * - Notification path with source metadata
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMigrationRunner } from '../../src/storage/migrations.js'
import { allStoreMigrations } from '../../src/storage/all-stores-migrations.js'
import { createEventStore, type EventStore } from '../../src/storage/event-store.js'
import { createRuntimeActionStore, type RuntimeActionStore } from '../../src/storage/runtime-action-store.js'
import { createTriggerStore, type TriggerStore } from '../../src/storage/trigger-store.js'
import { createWaitConditionStore, type WaitConditionStore } from '../../src/storage/wait-condition-store.js'
import { createWorkflowDraftStore } from '../../src/storage/workflow-draft-store.js'
import { createWorkflowDefinitionStore } from '../../src/storage/workflow-definition-store.js'
import { createWorkflowRunStore } from '../../src/storage/workflow-run-store.js'
import { createConnectorStore } from '../../src/storage/connector-store.js'
import { createEventTriggerRuntime } from '../../src/triggers/event-trigger-runtime.js'
import { createWorkflowRuntime } from '../../src/workflows/workflow-runtime.js'
import { createConnectorRuntime } from '../../src/connectors/connector-runtime.js'
import { createConnectorToolBridge } from '../../src/connectors/connector-tool-bridge.js'
import { registerMockConnectors } from '../../src/connectors/mocks/index.js'
import { WORKFLOW_RUN_STATES } from '../../src/shared/states.js'
import type { WorkflowStep } from '../../src/workflows/types.js'
import type { ConnectorInstance } from '../../src/storage/connector-store.js'
import type { ConnectorRuntime } from '../../src/connectors/types.js'
import type { ConnectorTriggerEvent } from '../../src/triggers/types.js'

describe('Phase 3 E2E: Connector Event to Workflow', () => {
  let connection: ConnectionManager
  let eventStore: EventStore
  let runtimeActionStore: RuntimeActionStore
  let triggerStore: TriggerStore
  let waitConditionStore: WaitConditionStore
  let triggerRuntime: ReturnType<typeof createEventTriggerRuntime>
  let workflowRuntime: ReturnType<typeof createWorkflowRuntime>
  let connectorRuntime: ConnectorRuntime

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    eventStore = createEventStore(connection)
    runtimeActionStore = createRuntimeActionStore(connection)
    triggerStore = createTriggerStore(connection)
    waitConditionStore = createWaitConditionStore(connection)
    const workflowDraftStore = createWorkflowDraftStore(connection)
    const workflowDefinitionStore = createWorkflowDefinitionStore(connection)
    const workflowRunStore = createWorkflowRunStore(connection)
    const connectorStore = createConnectorStore(connection)

    triggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore,
      runtimeActionStore,
    })

    workflowRuntime = createWorkflowRuntime({
      draftStore: workflowDraftStore,
      definitionStore: workflowDefinitionStore,
      workflowRunStore,
      runtimeActionStore,
      eventStore,
      dispatcher: {
        dispatch: async () => ({ success: true, result: {} }),
      },
    })

    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
    })
    registerMockConnectors(connectorRuntime)

    registerMockConnectorInstance(connectorRuntime, 'mock_email', 'messaging', 'mock-email-trigger', 'test-user-001')
  })

  afterEach(() => {
    connection?.close()
  })

  describe('Event → Trigger → Workflow path', () => {
    it('should register trigger targeting a workflow', () => {
      const workflowId = 'wf_target_001'

      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-12-31T23:59:59Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      expect(trigger).toBeDefined()
      expect(trigger.id).toBeDefined()
      expect(trigger.id.startsWith('trig_')).toBe(true)
      expect(trigger.triggerType).toBe('schedule')
      expect(trigger.targetType).toBe('workflow')
      expect(trigger.targetRef).toBe(workflowId)
      expect(trigger.status).toBe('active')
    })

    it('should create RuntimeTriggerEvent when trigger fires', () => {
      const workflowId = 'wf_event_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.fired).toBe(1)
      expect(result.events).toHaveLength(1)
      expect(result.actions).toHaveLength(1)

      const firedEvent = result.events[0]
      expect(firedEvent?.eventType).toBe('schedule_trigger_fired')
      expect(firedEvent?.payload?.targetRef).toBe(workflowId)
      expect(firedEvent?.relatedRefs?.triggerRegistrationId).toBeDefined()
    })

    it('should handle connector event trigger with matching condition', () => {
      const workflowId = 'wf_connector_001'

      triggerRuntime.registerTrigger({
        triggerType: 'event',
        conditionType: 'connector_event',
        conditionPattern: JSON.stringify({ eventType: 'email_received' }),
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const connectorEvent: ConnectorTriggerEvent = {
        eventType: 'email_received',
        payload: { from: 'sender@example.com', subject: 'Test' },
        userId: 'test-user-001',
        sessionId: 'session-connector-001',
      }

      const result = triggerRuntime.handleConnectorEvent(connectorEvent)

      expect(result.matched).toBe(1)
      expect(result.events).toHaveLength(1)
      expect(result.actions).toHaveLength(1)

      const triggerEvent = result.events[0]
      expect(triggerEvent?.eventType).toBe('connector_event_trigger_fired')
      expect(triggerEvent?.payload?.eventType).toBe('email_received')
    })

    it('should persist trigger events in event store', () => {
      const workflowId = 'wf_persist_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const events = eventStore.query({})
      const triggerEvents = events.filter((e) => e.eventType === 'schedule_trigger_fired')

      expect(triggerEvents.length).toBe(1)
      expect(triggerEvents[0]?.sourceModule).toBe('trigger')
    })
  })

  describe('Trigger → Tool path', () => {
    it('should create RuntimeActions with correct target runtime', () => {
      const workflowId = 'wf_action_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.actions).toHaveLength(1)

      const action = result.actions[0]
      expect(action?.targetRuntime).toBe('workflow_runtime')
      expect(action?.payload?.targetRef).toBe(workflowId)
    })

    it('should create RuntimeActions for background_run target type', () => {
      const backgroundRunId = 'bg_run_target_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'background_run',
        targetRef: backgroundRunId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.actions).toHaveLength(1)

      const action = result.actions[0]
      expect(action?.targetRuntime).toBe('subagent_runtime')
      expect(action?.targetAction).toBe('resume_subagent')
    })

    it('should save RuntimeActions to action store', () => {
      const workflowId = 'wf_save_action_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const actions = runtimeActionStore.query({})
      const triggerActions = actions.filter((a) => a.source?.sourceModule === 'trigger')

      expect(triggerActions.length).toBeGreaterThan(0)
      expect(triggerActions[0]?.actionId).toBeDefined()
      expect(triggerActions[0]?.status).toBe('created')
    })

    it('should use idempotency key to prevent duplicate actions', () => {
      const workflowId = 'wf_idempotent_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)
      triggerRuntime.evaluateScheduleTriggers(now)

      const actions = runtimeActionStore.query({})
      const triggerActions = actions.filter(
        (a) => a.payload?.targetRef === workflowId && a.source?.sourceModule === 'trigger',
      )

      const uniqueActionIds = new Set(triggerActions.map((a) => a.actionId))
      expect(uniqueActionIds.size).toBe(1)
    })
  })

  describe('Notification path', () => {
    it('should include source metadata in trigger events', () => {
      const workflowId = 'wf_metadata_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      const event = result.events[0]
      expect(event?.sourceModule).toBe('trigger')
      expect(event?.relatedRefs?.triggerRegistrationId).toBeDefined()
      expect(event?.relatedRefs?.targetRef).toBe(workflowId)
    })

    it('should include correlation ID for event tracing', () => {
      const workflowId = 'wf_correlation_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      const event = result.events[0]
      const action = result.actions[0]

      expect(event?.correlationId).toBeDefined()
      expect(action?.correlationId).toBeDefined()
    })

    it('should preserve user context through trigger chain', () => {
      const workflowId = 'wf_user_ctx_001'
      const userId = 'test-user-trigger'

      triggerRuntime.registerTrigger({
        triggerType: 'event',
        conditionType: 'connector_event',
        conditionPattern: JSON.stringify({ eventType: 'user_action' }),
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const connectorEvent: ConnectorTriggerEvent = {
        eventType: 'user_action',
        payload: { action: 'click' },
        userId,
        sessionId: 'session-user-ctx-001',
      }

      const result = triggerRuntime.handleConnectorEvent(connectorEvent)

      expect(result.events[0]?.userId).toBe(userId)
      expect(result.actions[0]?.userId).toBe(userId)
    })

    it('should emit trigger_registered event when trigger is created', () => {
      const workflowId = 'wf_registered_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 9 * * *',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const events = eventStore.query({})
      const registeredEvent = events.find((e) => e.eventType === 'trigger_registered')

      expect(registeredEvent).toBeDefined()
      expect(registeredEvent?.sourceModule).toBe('trigger')
      expect(registeredEvent?.payload?.triggerType).toBe('schedule')
      expect(registeredEvent?.payload?.targetType).toBe('workflow')
      expect(registeredEvent?.payload?.targetRef).toBe(workflowId)
    })
  })

  describe('Workflow integration with triggers', () => {
    it('should start workflow from trigger event', async () => {
      const userId = 'test-user-001'
      const sessionId = 'session-workflow-trigger-001'

      const steps: WorkflowStep[] = [
        {
          stepId: 'step_1',
          name: 'Triggered Step',
          stepType: 'tool_call',
          config: {
            toolName: 'connector_mock_email_search_emails',
            toolParams: { query: 'triggered' },
          },
        },
      ]

      const draft = workflowRuntime.createDraft({
        name: 'Trigger-Initiated Workflow',
        description: 'Workflow started by trigger',
        steps,
        ownerUserId: userId,
      })

      workflowRuntime.validateDraft(draft.draftId)
      const definition = workflowRuntime.publishDraft(draft.draftId)

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: definition.workflowId,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      const run = workflowRuntime.startWorkflowRun({
        definitionId: definition.workflowId,
        userId,
        sessionId,
        inputData: { triggeredBy: result.events[0]?.eventId },
      })

      expect(run.status).toBe(WORKFLOW_RUN_STATES.RUNNING)
      expect(run.currentStepIds).toContain('step_1')
    })

    it('should complete trigger after maxTriggers reached', () => {
      const workflowId = 'wf_max_001'

      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
        maxTriggers: 1,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const updatedTrigger = triggerRuntime.getTrigger(trigger.id)
      expect(updatedTrigger?.status).toBe('completed')
      expect(updatedTrigger?.triggerCount).toBe(1)
    })
  })
})

function registerMockConnectorInstance(
  runtime: ConnectorRuntime,
  connectorId: string,
  connectorType: 'api' | 'messaging' | 'storage' | 'database' | 'custom',
  instanceId: string,
  userId: string,
): ConnectorInstance {
  const definition = runtime.registerDefinition({
    connectorId,
    name: `Mock ${connectorId} Connector`,
    connectorType,
    version: '1.0.0',
    capabilities: [],
    status: 'active',
  })

  return runtime.createInstance({
    connectorInstanceId: instanceId,
    connectorDefinitionId: definition.id,
    userId,
    name: `Test ${connectorId} Instance`,
    authStateRef: 'auth-mock-001',
    config: { connectorId },
    status: 'active',
  })
}
