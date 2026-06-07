import type { TriggerRegistration, CreateTriggerRegistration, TRIGGER_STATUSES } from '../storage/trigger-store.js'
import type { WaitCondition, CreateWaitCondition, WAIT_CONDITION_STATES } from '../storage/wait-condition-store.js'
import type { EventRecord, SensitivityLevel, RetentionClass } from '../storage/event-store.js'
import type { RuntimeAction, RuntimeActionState } from '../storage/runtime-action-store.js'
import type { TargetRuntime, RuntimeActionType } from '../dispatcher/types.js'
import { generateId } from '../shared/ids.js'
import type { DeadLetterQueue } from '../dead-letter/dead-letter-queue.js'
import type {
  TriggerEventType,
  RuntimeTriggerEvent,
  TriggerScheduler,
  WaitConditionEvaluator,
  EventTriggerRuntimeConfig,
  EventTriggerRuntime,
  RegisterTriggerInput,
  RegisterWaitConditionInput,
  HandleApprovalResolvedInput,
  CreateResumeActionParams,
  ResumeTargetType,
  ScheduleTriggerDefinition,
  WebhookTriggerPayload,
  ConnectorTriggerEvent,
  McpTriggerNotification,
  TriggerActionResult,
} from './types.js'

export type { EventTriggerRuntime }

const TRIGGER_STATUS_ACTIVE: typeof TRIGGER_STATUSES.ACTIVE = 'active'
const TRIGGER_STATUS_COMPLETED: typeof TRIGGER_STATUSES.COMPLETED = 'completed'
const TRIGGER_STATUS_EXPIRED: typeof TRIGGER_STATUSES.EXPIRED = 'expired'

const WAIT_STATE_REGISTERED: typeof WAIT_CONDITION_STATES.REGISTERED = 'registered'
const WAIT_STATE_ACTIVE: typeof WAIT_CONDITION_STATES.ACTIVE = 'active'

const SOURCE_MODULE = 'trigger'
const SENSITIVITY: SensitivityLevel = 'low'
const RETENTION_CLASS: RetentionClass = 'standard'
const WEBHOOK_SIGNATURE_PREFIX = 'sha256='
const MAX_WEBHOOK_FAILURES = 3

class DefaultTriggerScheduler implements TriggerScheduler {
  parseSchedulePattern(pattern: string): { valid: boolean; nextRunAt?: Date; error?: string } {
    try {
      if (this.isISOTimestamp(pattern)) {
        const date = new Date(pattern)
        if (isNaN(date.getTime())) {
          return { valid: false, error: 'Invalid ISO timestamp' }
        }
        return { valid: true, nextRunAt: date }
      }

      if (this.isCronLike(pattern)) {
        return { valid: true }
      }

      return { valid: false, error: 'Invalid schedule pattern. Use ISO timestamp or cron-like format.' }
    } catch {
      return { valid: false, error: 'Failed to parse schedule pattern' }
    }
  }

  isDue(pattern: string, now: Date): boolean {
    if (this.isISOTimestamp(pattern)) {
      const targetTime = new Date(pattern).getTime()
      const nowTime = now.getTime()
      return targetTime <= nowTime
    }

    if (this.isCronLike(pattern)) {
      const parts = pattern.split(' ')
      if (parts.length >= 2) {
        const minute = parseInt(parts[0], 10)
        const hour = parseInt(parts[1], 10)
        if (!isNaN(minute) && !isNaN(hour)) {
          return now.getMinutes() === minute && now.getHours() === hour
        }
      }
    }

    return false
  }

  getNextRunTime(pattern: string, from?: Date): Date | null {
    const baseTime = from ?? new Date()

    if (this.isISOTimestamp(pattern)) {
      const targetTime = new Date(pattern)
      return targetTime.getTime() > baseTime.getTime() ? targetTime : null
    }

    if (this.isCronLike(pattern)) {
      const next = new Date(baseTime)
      next.setHours(next.getHours() + 1)
      next.setMinutes(0)
      next.setSeconds(0)
      next.setMilliseconds(0)
      return next
    }

    return null
  }

  private isISOTimestamp(pattern: string): boolean {
    return /^\d{4}-\d{2}-\d{2}/.test(pattern)
  }

  private isCronLike(pattern: string): boolean {
    return /^[\d*]+ [\d*]+/.test(pattern)
  }
}

class DefaultWaitConditionEvaluator implements WaitConditionEvaluator {
  evaluate(
    condition: WaitCondition,
    context: { now: Date; events?: EventRecord[]; approvals?: Array<{ approvalId: string; status: string }> },
  ): { satisfied: boolean; reason?: string; resultData?: Record<string, unknown> } {
    switch (condition.waitType) {
      case 'timeout':
        return this.evaluateTimeout(condition, context.now)
      case 'operation_completion':
        return this.evaluateOperationCompletion(condition, context)
      case 'event':
        return this.evaluateEventCondition(condition, context.events)
      default:
        return { satisfied: false, reason: 'Unknown wait type' }
    }
  }

  isTimedOut(condition: WaitCondition, now: Date): boolean {
    if (!condition.timeoutAt) {
      return false
    }
    return new Date(condition.timeoutAt).getTime() <= now.getTime()
  }

  matchEvent(pattern: string, event: Record<string, unknown>): boolean {
    try {
      const matcher = JSON.parse(pattern)
      for (const [key, value] of Object.entries(matcher)) {
        if (event[key] !== value) {
          return false
        }
      }
      return true
    } catch {
      return pattern === '*' || pattern === String(event.eventType ?? '')
    }
  }

  private evaluateTimeout(
    condition: WaitCondition,
    now: Date,
  ): { satisfied: boolean; reason?: string; resultData?: Record<string, unknown>; timedOut?: boolean } {
    if (condition.timeoutAt && new Date(condition.timeoutAt).getTime() <= now.getTime()) {
      return { satisfied: false, reason: 'Timeout reached', timedOut: true }
    }
    return { satisfied: false }
  }

  private evaluateOperationCompletion(
    condition: WaitCondition,
    context: { approvals?: Array<{ approvalId: string; status: string }> },
  ): { satisfied: boolean; reason?: string; resultData?: Record<string, unknown> } {
    if (context.approvals) {
      const matching = context.approvals.find((a) => a.approvalId === condition.conditionPattern)
      if (matching) {
        return {
          satisfied: matching.status === 'approved',
          reason: `Operation ${matching.status}`,
          resultData: { approvalStatus: matching.status },
        }
      }
    }
    return { satisfied: false }
  }

  private evaluateEventCondition(
    condition: WaitCondition,
    events?: EventRecord[],
  ): { satisfied: boolean; reason?: string; resultData?: Record<string, unknown> } {
    if (!events) {
      return { satisfied: false }
    }

    for (const event of events) {
      if (this.matchEvent(condition.conditionPattern, event.payload)) {
        return { satisfied: true, reason: 'Matching event found', resultData: { matchedEvent: event } }
      }
    }
    return { satisfied: false }
  }
}

class EventTriggerRuntimeImpl implements EventTriggerRuntime {
  private config: EventTriggerRuntimeConfig
  private scheduler: TriggerScheduler
  private evaluator: WaitConditionEvaluator
  private dlq: DeadLetterQueue | undefined
  private firedTriggerCache: Map<string, { event: RuntimeTriggerEvent; action: RuntimeAction }> = new Map()
  private webhookFailureCount: Map<string, number> = new Map()

  constructor(config: EventTriggerRuntimeConfig) {
    this.config = config
    this.scheduler = config.scheduler ?? new DefaultTriggerScheduler()
    this.evaluator = config.evaluator ?? new DefaultWaitConditionEvaluator()
    this.dlq = config.dlq
  }

  registerTrigger(input: RegisterTriggerInput): TriggerRegistration {
    const id = generateId('trig_')

    const createInput: CreateTriggerRegistration = {
      id,
      triggerType: input.triggerType,
      conditionType: input.conditionType,
      conditionPattern: input.conditionPattern,
      targetType: input.targetType,
      targetRef: input.targetRef,
      status: TRIGGER_STATUS_ACTIVE,
      priority: input.priority ?? 0,
      maxTriggers: input.maxTriggers,
      expiresAt: input.expiresAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    }

    const registration = this.config.triggerStore.create(createInput)

    this.emitEvent({
      eventType: 'trigger_registered',
      relatedRefs: { triggerRegistrationId: id, targetRef: input.targetRef },
      payload: {
        triggerId: id,
        triggerType: input.triggerType,
        conditionType: input.conditionType,
        conditionPattern: input.conditionPattern,
        targetType: input.targetType,
        targetRef: input.targetRef,
      },
    })

    return registration
  }

  registerSchedule(definition: ScheduleTriggerDefinition): TriggerRegistration {
    if (definition.intervalMs <= 0 || !Number.isFinite(definition.intervalMs)) {
      throw new Error('Schedule intervalMs must be a positive finite number')
    }

    const nextRunAt = new Date(definition.nextRunAt)
    if (isNaN(nextRunAt.getTime())) {
      throw new Error('Schedule nextRunAt must be a valid timestamp')
    }

    return this.registerTrigger({
      triggerType: 'schedule',
      conditionType: 'schedule',
      conditionPattern: `interval:${definition.intervalMs}`,
      targetType: definition.targetType,
      targetRef: definition.targetRef,
      priority: definition.priority,
      maxTriggers: definition.maxTriggers,
      expiresAt: definition.expiresAt,
      metadata: {
        ...definition.metadata,
        scheduleKind: 'recurring_interval',
        intervalMs: definition.intervalMs,
        nextRunAt: nextRunAt.toISOString(),
      },
    })
  }

  registerWaitCondition(input: RegisterWaitConditionInput): WaitCondition {
    const id = generateId('wait_')

    const createInput: CreateWaitCondition = {
      id,
      waitType: input.waitType,
      conditionPattern: input.conditionPattern,
      targetType: input.targetType,
      targetRef: input.targetRef,
      status: input.timeoutAt ? WAIT_STATE_ACTIVE : WAIT_STATE_REGISTERED,
      priority: input.priority ?? 0,
      timeoutAt: input.timeoutAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    }

    return this.config.waitConditionStore.create(createInput)
  }

  evaluateScheduleTriggers(now: Date): {
    fired: number
    events: RuntimeTriggerEvent[]
    actions: RuntimeAction[]
  } {
    const activeTriggers = this.config.triggerStore.findByStatus(TRIGGER_STATUS_ACTIVE)
    const scheduleTriggers = activeTriggers.filter((t) => t.conditionType === 'schedule')

    const firedEvents: RuntimeTriggerEvent[] = []
    const firedActions: RuntimeAction[] = []
    let fired = 0

    for (const trigger of scheduleTriggers) {
      if (this.isTriggerExpired(trigger, now)) {
        this.config.triggerStore.updateStatus(trigger.id, TRIGGER_STATUS_EXPIRED)
        this.emitEvent({
          eventType: 'trigger_expired',
          relatedRefs: { triggerRegistrationId: trigger.id },
          payload: { triggerId: trigger.id, reason: 'Trigger expired' },
        })
        continue
      }

      const metadata = this.parseMetadata(trigger.metadata)
      const dueInfo = this.getScheduleDueInfo(trigger, metadata, now)

      if (dueInfo.due) {
        const cacheKey = `${trigger.id}:${dueInfo.dueAt}`
        const cached = this.firedTriggerCache.get(cacheKey)

        if (cached) {
          // Return cached result for idempotent evaluation
          // The event/action were already stored; returning them from cache
          // allows callers to verify the SAME actionId is reused
          firedEvents.push(cached.event)
          firedActions.push(cached.action)
          fired++
          continue
        }

        const event = this.createTriggerEvent(trigger, 'schedule_trigger_fired')
        firedEvents.push(event)
        this.config.eventStore.append(event)

        const action = this.createResumeAction({
          targetType: this.mapTargetType(trigger.targetType),
          targetRef: trigger.targetRef,
          eventType: 'schedule_trigger_fired',
          triggerEventId: event.eventId,
          correlationId: event.correlationId,
          payload: {
            triggerId: trigger.id,
            schedulePattern: trigger.conditionPattern,
            dueAt: dueInfo.dueAt,
            firedAt: now.toISOString(),
          },
        })
        firedActions.push(action)

        this.firedTriggerCache.set(cacheKey, { event, action })

        this.config.triggerStore.incrementTriggerCount(trigger.id)
        fired++

        const updated = this.config.triggerStore.getById(trigger.id)
        if (updated && updated.maxTriggers && updated.triggerCount >= updated.maxTriggers) {
          this.config.triggerStore.updateStatus(trigger.id, TRIGGER_STATUS_COMPLETED)
          this.emitEvent({
            eventType: 'trigger_completed',
            relatedRefs: { triggerRegistrationId: trigger.id },
            payload: { triggerId: trigger.id, triggerCount: updated.triggerCount },
          })
        } else if (dueInfo.nextRunAt) {
          this.persistTriggerMetadata(trigger, {
            ...metadata,
            nextRunAt: dueInfo.nextRunAt,
          })
        }
      }
    }

    return { fired, events: firedEvents, actions: firedActions }
  }

  evaluateWaitConditions(now: Date): {
    processed: number
    events: RuntimeTriggerEvent[]
    actions: RuntimeAction[]
  } {
    const activeConditions = this.config.waitConditionStore.findByStatus(WAIT_STATE_ACTIVE)
    const registeredConditions = this.config.waitConditionStore.findByStatus(WAIT_STATE_REGISTERED)
    const allConditions = [...activeConditions, ...registeredConditions]

    const processedEvents: RuntimeTriggerEvent[] = []
    const processedActions: RuntimeAction[] = []
    let processed = 0

    const expiredConditions = this.config.waitConditionStore.findExpired(now.toISOString())
    for (const condition of expiredConditions) {
      if (condition.status === WAIT_STATE_ACTIVE || condition.status === WAIT_STATE_REGISTERED) {
        this.config.waitConditionStore.markTimeout(condition.id)

        const event = this.createWaitConditionEvent(condition, 'wait_condition_timeout')
        processedEvents.push(event)
        this.config.eventStore.append(event)

        const action = this.createResumeAction({
          targetType: this.mapTargetType(condition.targetType),
          targetRef: condition.targetRef,
          eventType: 'wait_condition_timeout',
          triggerEventId: event.eventId,
          correlationId: event.correlationId,
          payload: {
            waitConditionId: condition.id,
            waitType: condition.waitType,
            timedOutAt: now.toISOString(),
          },
        })
        processedActions.push(action)

        processed++
      }
    }

    for (const condition of allConditions) {
      if (condition.status !== WAIT_STATE_ACTIVE && condition.status !== WAIT_STATE_REGISTERED) {
        continue
      }

      const evaluation = this.evaluator.evaluate(condition, { now })

      if (this.evaluator.isTimedOut(condition, now)) {
        continue
      }

      if (evaluation.satisfied) {
        this.config.waitConditionStore.markSatisfied(condition.id, 'evaluator', evaluation.resultData)

        const event = this.createWaitConditionEvent(condition, 'wait_condition_satisfied')
        processedEvents.push(event)
        this.config.eventStore.append(event)

        const action = this.createResumeAction({
          targetType: this.mapTargetType(condition.targetType),
          targetRef: condition.targetRef,
          eventType: 'wait_condition_satisfied',
          triggerEventId: event.eventId,
          correlationId: event.correlationId,
          payload: {
            waitConditionId: condition.id,
            waitType: condition.waitType,
            satisfiedAt: now.toISOString(),
            resultData: evaluation.resultData,
          },
        })
        processedActions.push(action)

        processed++
      }
    }

    return { processed, events: processedEvents, actions: processedActions }
  }

  handleApprovalResolved(input: HandleApprovalResolvedInput): {
    matched: number
    events: RuntimeTriggerEvent[]
    actions: RuntimeAction[]
  } {
    const activeTriggers = this.config.triggerStore.findByStatus(TRIGGER_STATUS_ACTIVE)
    const approvalTriggers = activeTriggers.filter(
      (t) =>
        t.conditionType === 'approval_resolved' &&
        (t.conditionPattern === input.approvalId || t.conditionPattern === '*'),
    )

    const eventKey = `approval:${input.approvalId}`
    const matchedEvents: RuntimeTriggerEvent[] = []
    const matchedActions: RuntimeAction[] = []

    for (const trigger of approvalTriggers) {
      const event = this.createTriggerEvent(trigger, 'approval_resolved_trigger', {
        approvalId: input.approvalId,
        correlationId: input.approvalId,
        eventId: `${eventKey}:${trigger.id}`,
      })
      matchedEvents.push(event)
      this.config.eventStore.append(event)

      const action = this.createResumeAction({
        targetType: this.mapTargetType(trigger.targetType),
        targetRef: trigger.targetRef,
        eventType: 'approval_resolved_trigger',
        triggerEventId: event.eventId,
        correlationId: input.approvalId,
        payload: {
          triggerId: trigger.id,
          approvalId: input.approvalId,
          status: input.status,
          result: input.result,
          resolvedAt: input.resolvedAt ?? new Date().toISOString(),
        },
      })
      matchedActions.push(action)

      this.config.triggerStore.incrementTriggerCount(trigger.id)

      const updated = this.config.triggerStore.getById(trigger.id)
      if (updated && updated.maxTriggers && updated.triggerCount >= updated.maxTriggers) {
        this.config.triggerStore.updateStatus(trigger.id, TRIGGER_STATUS_COMPLETED)
      }
    }

    return { matched: approvalTriggers.length, events: matchedEvents, actions: matchedActions }
  }

  handleWebhook(webhookPayload: WebhookTriggerPayload, signature: string): TriggerActionResult {
    if (!this.verifyWebhookSignature(webhookPayload, signature)) {
      this.trackWebhookFailure(webhookPayload, 'Invalid signature')
      return { matched: 0, events: [], actions: [] }
    }

    const eventId = this.eventIdFor('webhook', webhookPayload)
    return this.fireEventTriggers({
      eventType: 'webhook_trigger_fired',
      conditionType: 'webhook',
      eventId,
      eventPayload: {
        eventType: webhookPayload.eventType ?? 'webhook',
        payload: webhookPayload.payload ?? webhookPayload,
        webhookPayload,
      },
      userId: webhookPayload.userId,
      sessionId: webhookPayload.sessionId,
    })
  }

  private trackWebhookFailure(webhookPayload: WebhookTriggerPayload, reason: string): void {
    if (!this.dlq) {
      return
    }

    const key = String(webhookPayload.eventId ?? webhookPayload.idempotencyKey ?? 'unknown')
    const count = (this.webhookFailureCount.get(key) ?? 0) + 1
    this.webhookFailureCount.set(key, count)

    if (count >= MAX_WEBHOOK_FAILURES) {
      this.webhookFailureCount.delete(key)
      this.dlq.enqueue('trigger.webhook', key, reason, {
        ...webhookPayload,
        failureCount: count,
      })
    }
  }

  handleConnectorEvent(event: ConnectorTriggerEvent): TriggerActionResult {
    const eventId = this.eventIdFor('connector', event)
    return this.fireEventTriggers({
      eventType: 'connector_event_trigger_fired',
      conditionType: 'connector_event',
      eventId,
      eventPayload: {
        ...event,
        eventType: event.eventType,
        payload: event.payload ?? {},
      },
      correlationId: event.operationId ?? event.eventId ?? event.idempotencyKey,
      userId: event.userId,
      sessionId: event.sessionId,
    })
  }

  handleMcpNotification(notification: McpTriggerNotification): TriggerActionResult {
    const eventId = this.eventIdFor('mcp', notification)
    return this.fireEventTriggers({
      eventType: 'mcp_notification',
      conditionType: 'mcp_notification',
      eventId,
      eventPayload: {
        eventType: 'mcp_notification',
        method: notification.method,
        serverId: notification.serverId,
        sessionId: notification.sessionId,
        notification,
        payload: notification.payload ?? notification.params ?? {},
      },
      correlationId: notification.id ?? notification.idempotencyKey,
      sessionId: notification.sessionId,
    })
  }

  getTrigger(id: string): TriggerRegistration | null {
    return this.config.triggerStore.getById(id)
  }

  getWaitCondition(id: string): WaitCondition | null {
    return this.config.waitConditionStore.getById(id)
  }

  findTriggersByTarget(targetType: string, targetRef: string): TriggerRegistration[] {
    return this.config.triggerStore.findByTarget(targetType, targetRef)
  }

  findWaitConditionsByTarget(targetType: string, targetRef: string): WaitCondition[] {
    return this.config.waitConditionStore.findByTarget(targetType, targetRef)
  }

  private isTriggerExpired(trigger: TriggerRegistration, now: Date): boolean {
    if (!trigger.expiresAt) {
      return false
    }
    return new Date(trigger.expiresAt).getTime() <= now.getTime()
  }

  private createTriggerEvent(
    trigger: TriggerRegistration,
    eventType: TriggerEventType,
    options?: {
      approvalId?: string
      correlationId?: string
      eventId?: string
      payload?: Record<string, unknown>
      userId?: string
      sessionId?: string
    },
  ): RuntimeTriggerEvent {
    const now = new Date().toISOString()
    const eventId = options?.eventId ?? generateId('evt_')

    const relatedRefs: { triggerRegistrationId?: string; approvalId?: string; targetRef?: string } = {
      triggerRegistrationId: trigger.id,
      targetRef: trigger.targetRef,
    }

    if (options?.approvalId) {
      relatedRefs.approvalId = options.approvalId
    }

    return {
      eventId,
      eventType,
      sourceModule: SOURCE_MODULE,
      correlationId: options?.correlationId ?? eventId,
      userId: options?.userId,
      sessionId: options?.sessionId,
      idempotencyKey: eventId,
      relatedRefs,
      payload: {
        triggerId: trigger.id,
        triggerType: trigger.triggerType,
        conditionType: trigger.conditionType,
        conditionPattern: trigger.conditionPattern,
        targetType: trigger.targetType,
        targetRef: trigger.targetRef,
        ...options?.payload,
      },
      sensitivity: SENSITIVITY,
      retentionClass: RETENTION_CLASS,
      createdAt: now,
    }
  }

  private createWaitConditionEvent(condition: WaitCondition, eventType: TriggerEventType): RuntimeTriggerEvent {
    const now = new Date().toISOString()
    const eventId = generateId('evt_')

    return {
      eventId,
      eventType,
      sourceModule: SOURCE_MODULE,
      correlationId: eventId,
      relatedRefs: {
        waitConditionId: condition.id,
        targetRef: condition.targetRef,
      },
      payload: {
        waitConditionId: condition.id,
        waitType: condition.waitType,
        conditionPattern: condition.conditionPattern,
        targetType: condition.targetType,
        targetRef: condition.targetRef,
      },
      sensitivity: SENSITIVITY,
      retentionClass: RETENTION_CLASS,
      createdAt: now,
    }
  }

  private createResumeAction(params: CreateResumeActionParams): RuntimeAction {
    const actionId = generateId('act_')
    const now = new Date().toISOString()
    const idempotencyKey = `${params.triggerEventId}:${params.targetRef}`

    const existing = this.config.runtimeActionStore.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      return existing
    }

    const targetAction = this.getTargetAction(params.targetType, params.eventType)
    const actionType = this.getActionType(params.targetType)

    const action: RuntimeAction = {
      actionId,
      actionType,
      idempotencyKey,
      source: {
        sourceModule: 'trigger',
        sourceAction: 'fire_trigger',
      },
      targetRuntime: this.getTargetRuntime(params.targetType),
      targetAction,
      payload: {
        ...params.payload,
        targetRef: params.targetRef,
        eventType: params.eventType,
        triggerEventId: params.triggerEventId,
      },
      correlationId: params.correlationId,
      userId: params.userId,
      sessionId: params.sessionId,
      targetRef: { [this.getTargetRefKey(params.targetType)]: params.targetRef },
      status: 'created' as RuntimeActionState,
      createdAt: now,
      updatedAt: now,
    }

    this.config.runtimeActionStore.save(action)
    return action
  }

  private emitEvent(params: {
    eventType: TriggerEventType
    relatedRefs?: { triggerRegistrationId?: string; waitConditionId?: string; targetRef?: string }
    payload: Record<string, unknown>
    correlationId?: string
    causationId?: string
    userId?: string
    sessionId?: string
  }): void {
    const now = new Date().toISOString()
    const eventId = generateId('evt_')

    const event: RuntimeTriggerEvent = {
      eventId,
      eventType: params.eventType,
      sourceModule: SOURCE_MODULE,
      correlationId: params.correlationId ?? eventId,
      causationId: params.causationId,
      userId: params.userId,
      sessionId: params.sessionId,
      relatedRefs: {
        triggerRegistrationId: params.relatedRefs?.triggerRegistrationId,
        waitConditionId: params.relatedRefs?.waitConditionId,
        targetRef: params.relatedRefs?.targetRef,
      },
      payload: params.payload,
      sensitivity: SENSITIVITY,
      retentionClass: RETENTION_CLASS,
      createdAt: now,
    }

    this.config.eventStore.append(event)
  }

  private mapTargetType(targetType: string): ResumeTargetType {
    switch (targetType) {
      case 'workflow_run':
      case 'workflow_start':
        return 'workflow_run'
      case 'workflow_step_run':
        return 'workflow_step_run'
      case 'background_run':
        return 'background_run'
      case 'planner_run':
        return 'planner_run'
      case 'kernel_run':
        return 'kernel_run'
      case 'notification':
        return 'notification'
      default:
        return 'workflow_step_run'
    }
  }

  private getTargetRuntime(targetType: ResumeTargetType): TargetRuntime {
    switch (targetType) {
      case 'workflow_step_run':
        return 'workflow_runtime'
      case 'workflow_run':
        return 'workflow_runtime'
      case 'background_run':
        return 'subagent_runtime'
      case 'planner_run':
        return 'planner_runtime'
      case 'kernel_run':
        return 'agent_kernel'
      case 'notification':
        return 'notification_center'
      default:
        return 'workflow_runtime'
    }
  }

  private getTargetAction(targetType: ResumeTargetType, _eventType: TriggerEventType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'resume_workflow_step'
      case 'workflow_run':
        return 'start_workflow_run'
      case 'background_run':
        return 'resume_subagent'
      case 'planner_run':
        return 'resume_planner_run'
      case 'kernel_run':
        return 'resume_agent_run'
      case 'notification':
        return 'send_notification'
      default:
        return 'resume_workflow_step'
    }
  }

  private getActionType(targetType: ResumeTargetType): RuntimeActionType {
    switch (targetType) {
      case 'workflow_step_run':
        return 'resume_workflow_step'
      case 'workflow_run':
        return 'start_workflow_run'
      case 'background_run':
        return 'resume_subagent'
      case 'planner_run':
        return 'resume_planner_run'
      case 'kernel_run':
        return 'resume_agent_run'
      case 'notification':
        return 'send_notification'
      default:
        return 'resume_workflow_step'
    }
  }

  private getTargetRefKey(targetType: ResumeTargetType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'workflowStepRunId'
      case 'workflow_run':
        return 'workflowRunId'
      case 'background_run':
        return 'backgroundRunId'
      case 'planner_run':
        return 'plannerRunId'
      case 'kernel_run':
        return 'runId'
      case 'notification':
        return 'toolCallId'
      default:
        return 'targetRef'
    }
  }

  private fireEventTriggers(params: {
    eventType: TriggerEventType
    conditionType: string
    eventId: string
    eventPayload: Record<string, unknown>
    correlationId?: string
    userId?: string
    sessionId?: string
  }): TriggerActionResult {
    const activeTriggers = this.config.triggerStore.findByStatus(TRIGGER_STATUS_ACTIVE)
    const matchingTriggers = activeTriggers.filter(
      (trigger) =>
        trigger.conditionType === params.conditionType &&
        this.evaluator.matchEvent(trigger.conditionPattern, params.eventPayload),
    )

    const events: RuntimeTriggerEvent[] = []
    const actions: RuntimeAction[] = []

    for (const trigger of matchingTriggers) {
      const triggerEventId = `${params.eventId}:${trigger.id}`
      const existingAction = this.config.runtimeActionStore.findByIdempotencyKey(
        `${triggerEventId}:${trigger.targetRef}`,
      )
      if (existingAction) {
        continue
      }

      const event = this.createTriggerEvent(trigger, params.eventType, {
        eventId: triggerEventId,
        correlationId: params.correlationId ?? params.eventId,
        payload: params.eventPayload,
        userId: params.userId,
        sessionId: params.sessionId,
      })
      this.config.eventStore.append(event)
      events.push(event)

      const action = this.createResumeAction({
        targetType: this.mapTargetType(trigger.targetType),
        targetRef: trigger.targetRef,
        eventType: params.eventType,
        triggerEventId: event.eventId,
        correlationId: event.correlationId,
        userId: params.userId,
        sessionId: params.sessionId,
        payload: {
          triggerId: trigger.id,
          ...params.eventPayload,
        },
      })
      actions.push(action)
      this.config.triggerStore.incrementTriggerCount(trigger.id)

      const updated = this.config.triggerStore.getById(trigger.id)
      if (updated && updated.maxTriggers && updated.triggerCount >= updated.maxTriggers) {
        this.config.triggerStore.updateStatus(trigger.id, TRIGGER_STATUS_COMPLETED)
      }
    }

    return { matched: actions.length, events, actions }
  }

  private getScheduleDueInfo(
    trigger: TriggerRegistration,
    metadata: Record<string, unknown>,
    now: Date,
  ): { due: boolean; dueAt?: string; nextRunAt?: string } {
    const intervalMs = typeof metadata.intervalMs === 'number' ? metadata.intervalMs : undefined
    const nextRunAt = typeof metadata.nextRunAt === 'string' ? metadata.nextRunAt : undefined

    if (intervalMs && nextRunAt) {
      const nextRunTime = new Date(nextRunAt).getTime()
      if (isNaN(nextRunTime) || nextRunTime > now.getTime()) {
        return { due: false }
      }

      return {
        due: true,
        dueAt: new Date(nextRunTime).toISOString(),
        nextRunAt: new Date(nextRunTime + intervalMs).toISOString(),
      }
    }

    return this.scheduler.isDue(trigger.conditionPattern, now)
      ? { due: true, dueAt: trigger.conditionPattern }
      : { due: false }
  }

  private parseMetadata(metadata?: string | null): Record<string, unknown> {
    if (!metadata) {
      return {}
    }
    try {
      return JSON.parse(metadata) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private persistTriggerMetadata(trigger: TriggerRegistration, metadata: Record<string, unknown>): void {
    this.config.triggerStore.updateMetadata?.(trigger.id, JSON.stringify(metadata))
  }

  private verifyWebhookSignature(payload: WebhookTriggerPayload, signature: string): boolean {
    const secret = typeof payload.secret === 'string' ? payload.secret : undefined
    if (!secret) {
      return signature.length > 0
    }

    const expected = `${WEBHOOK_SIGNATURE_PREFIX}${secret}`
    return signature === expected || signature === secret
  }

  private eventIdFor(prefix: string, event: { eventId?: string; idempotencyKey?: string; id?: string }): string {
    const explicit = event.eventId ?? event.idempotencyKey ?? event.id
    if (explicit) {
      return `${prefix}:${explicit}`
    }
    return `${prefix}:${JSON.stringify(event)}`
  }
}

export function createEventTriggerRuntime(config: EventTriggerRuntimeConfig): EventTriggerRuntime {
  return new EventTriggerRuntimeImpl(config)
}
