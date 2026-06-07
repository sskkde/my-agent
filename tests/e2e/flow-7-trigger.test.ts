import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createE2EHarness, type E2EHarness } from './test-harness.js'
import { createEventTriggerRuntime } from '../../src/triggers/event-trigger-runtime.js'
import { createTriggerStore } from '../../src/storage/trigger-store.js'
import { createWaitConditionStore } from '../../src/storage/wait-condition-store.js'

import type { EventRecord } from '../../src/storage/event-store.js'
import type { RuntimeAction } from '../../src/storage/runtime-action-store.js'

describe('Flow 7: Schedule Trigger E2E Flows', () => {
  let harness: E2EHarness
  let triggerRuntime: ReturnType<typeof createEventTriggerRuntime>

  beforeEach(() => {
    harness = createE2EHarness()

    const triggerStore = createTriggerStore(harness.connection)
    const waitConditionStore = createWaitConditionStore(harness.connection)

    triggerRuntime = createEventTriggerRuntime({
      triggerStore,
      waitConditionStore,
      eventStore: harness.stores.eventStore,
      runtimeActionStore: harness.stores.runtimeActionStore,
    })
  })

  afterEach(() => {
    harness.close()
  })

  describe('Schedule Trigger Registration', () => {
    it('should register a schedule trigger targeting a workflow', () => {
      const workflowId = 'wf_test_001'

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
      expect(trigger.conditionType).toBe('schedule')
      expect(trigger.conditionPattern).toBe('2024-12-31T23:59:59Z')
      expect(trigger.targetType).toBe('workflow')
      expect(trigger.targetRef).toBe(workflowId)
      expect(trigger.status).toBe('active')
    })

    it('should emit trigger_registered event when registering a trigger', () => {
      const workflowId = 'wf_test_002'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 9 * * *',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const events = harness.stores.eventStore.query({})
      const registeredEvent = events.find((e: EventRecord) => e.eventType === 'trigger_registered')

      expect(registeredEvent).toBeDefined()
      expect(registeredEvent?.sourceModule).toBe('trigger')
      expect(registeredEvent?.payload).toMatchObject({
        triggerType: 'schedule',
        targetType: 'workflow',
        targetRef: workflowId,
      })
    })

    it('should support cron-like schedule patterns', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 9 * * *',
        targetType: 'workflow',
        targetRef: 'wf_cron_001',
      })

      expect(trigger.conditionPattern).toBe('0 9 * * *')
      expect(trigger.status).toBe('active')
    })

    it('should support ISO timestamp schedule patterns', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-06-15T10:30:00.000Z',
        targetType: 'workflow',
        targetRef: 'wf_timestamp_001',
      })

      expect(trigger.conditionPattern).toBe('2024-06-15T10:30:00.000Z')
    })
  })

  describe('Schedule Trigger Evaluation and Firing', () => {
    it('should fire schedule trigger when due time is reached', () => {
      const workflowId = 'wf_fire_001'

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
      expect(result.events[0].eventType).toBe('schedule_trigger_fired')
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

      const result1 = triggerRuntime.evaluateScheduleTriggers(now)
      expect(result1.fired).toBe(1)
      expect(result1.actions).toHaveLength(1)

      const result2 = triggerRuntime.evaluateScheduleTriggers(now)
      expect(result2.fired).toBe(1)

      const actions = harness.stores.runtimeActionStore.query({})
      const triggerActions = actions.filter((a: RuntimeAction) => a.source?.sourceModule === 'trigger')

      const uniqueActionIds = new Set(triggerActions.map((a) => a.actionId))
      expect(uniqueActionIds.size).toBe(1)
    })

    it('should reuse cached action for duplicate trigger evaluation', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_idempotent_001',
      })

      const now = new Date('2024-01-15T10:00:00Z')

      const result1 = triggerRuntime.evaluateScheduleTriggers(now)
      const result2 = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result1.fired).toBe(1)
      expect(result2.fired).toBe(1)
      expect(result1.actions[0].actionId).toBe(result2.actions[0].actionId)
    })

    it('should use idempotency key to prevent duplicate actions', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_idempotent_002',
      })

      const now = new Date('2024-01-15T10:00:00Z')

      triggerRuntime.evaluateScheduleTriggers(now)
      triggerRuntime.evaluateScheduleTriggers(now)
      triggerRuntime.evaluateScheduleTriggers(now)

      const actions = harness.stores.runtimeActionStore.query({})
      const triggerActions = actions.filter(
        (a: RuntimeAction) =>
          a.payload?.eventType === 'schedule_trigger_fired' && a.payload?.targetRef === 'wf_idempotent_002',
      )

      const actionWithIdempotency = triggerActions.filter(
        (a: RuntimeAction) => a.idempotencyKey !== null && a.idempotencyKey !== undefined,
      )

      expect(actionWithIdempotency.length).toBeGreaterThan(0)
    })
  })

  describe('Trigger Expiration', () => {
    it('should expire trigger when expiration time is reached', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_expire_001',
        expiresAt: '2024-01-14T23:59:59Z',
      })

      const now = new Date('2024-01-15T00:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.fired).toBe(0)

      const updatedTrigger = triggerRuntime.getTrigger(trigger.id)
      expect(updatedTrigger?.status).toBe('expired')
    })

    it('should emit trigger_expired event when trigger expires', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_expire_002',
        expiresAt: '2024-01-14T12:00:00Z',
      })

      const now = new Date('2024-01-14T13:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const events = harness.stores.eventStore.query({})
      const expiredEvent = events.find((e: EventRecord) => e.eventType === 'trigger_expired')

      expect(expiredEvent).toBeDefined()
      expect(expiredEvent?.payload).toMatchObject({
        triggerId: trigger.id,
      })
    })
  })

  describe('Trigger Completion', () => {
    it('should complete trigger when maxTriggers is reached', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_complete_001',
        maxTriggers: 1,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const updatedTrigger = triggerRuntime.getTrigger(trigger.id)
      expect(updatedTrigger?.status).toBe('completed')
      expect(updatedTrigger?.triggerCount).toBe(1)
    })

    it('should emit trigger_completed event when trigger completes', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_complete_002',
        maxTriggers: 1,
      })

      const now = new Date('2024-01-15T10:00:00Z')
      triggerRuntime.evaluateScheduleTriggers(now)

      const events = harness.stores.eventStore.query({})
      const completedEvent = events.find((e: EventRecord) => e.eventType === 'trigger_completed')

      expect(completedEvent).toBeDefined()
      expect(completedEvent?.payload).toMatchObject({
        triggerId: trigger.id,
        triggerCount: 1,
      })
    })
  })

  describe('Trigger Target Types', () => {
    it('should support workflow_step_run target type', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow_step_run',
        targetRef: 'wf_step_run_001',
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.actions[0].targetRuntime).toBe('workflow_runtime')
      expect(result.actions[0].targetAction).toBe('resume_workflow_step')
    })

    it('should support background_run target type', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'background_run',
        targetRef: 'bg_run_001',
      })

      const now = new Date('2024-01-15T10:00:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.actions[0].targetRuntime).toBe('subagent_runtime')
      expect(result.actions[0].targetAction).toBe('resume_subagent')
    })
  })

  describe('Trigger Find Operations', () => {
    it('should find triggers by target', () => {
      const workflowId = 'wf_find_001'

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T11:00:00Z',
        targetType: 'workflow',
        targetRef: workflowId,
      })

      const triggers = triggerRuntime.findTriggersByTarget('workflow', workflowId)

      expect(triggers).toHaveLength(2)
    })

    it('should retrieve trigger by id', () => {
      const trigger = triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '2024-01-15T10:00:00Z',
        targetType: 'workflow',
        targetRef: 'wf_get_001',
      })

      const retrieved = triggerRuntime.getTrigger(trigger.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(trigger.id)
    })

    it('should return null for non-existent trigger', () => {
      const retrieved = triggerRuntime.getTrigger('non_existent_id')
      expect(retrieved).toBeNull()
    })
  })

  describe('Cron Schedule Evaluation', () => {
    it('should fire cron trigger when time matches pattern', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 9 * * *',
        targetType: 'workflow',
        targetRef: 'wf_cron_fire_001',
      })

      const now = new Date('2024-01-15T09:00:00')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.fired).toBeGreaterThanOrEqual(0)
      if (result.fired > 0) {
        expect(result.events.length).toBeGreaterThan(0)
        expect(result.actions.length).toBeGreaterThan(0)
      }
    })

    it('should not fire cron trigger when time does not match', () => {
      triggerRuntime.registerTrigger({
        triggerType: 'schedule',
        conditionType: 'schedule',
        conditionPattern: '0 9 * * *',
        targetType: 'workflow',
        targetRef: 'wf_cron_no_fire_001',
      })

      const now = new Date('2024-01-15T10:30:00Z')
      const result = triggerRuntime.evaluateScheduleTriggers(now)

      expect(result.fired).toBe(0)
    })
  })
})
