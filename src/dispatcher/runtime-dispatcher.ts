import type {
  RuntimeAction,
  DispatchRequest,
  DispatchResult,
  DispatchStatus,
  DispatchEvent,
  DispatchEventType,
  RuntimeDispatcherConfig,
  RuntimeDispatcher,
  TargetRuntime,
  SourceModule,
  RuntimeActionType,
} from './types.js'
import type { RuntimeActionState, RuntimeAction as StorageRuntimeAction } from '../storage/runtime-action-store.js'

const WRITE_ACTION_TYPES: ReadonlySet<string> = new Set(['write', 'delete', 'send', 'execute'])

const VALID_TARGET_RUNTIMES: ReadonlySet<string> = new Set([
  'agent_kernel',
  'subagent_runtime',
  'tool_plane',
  'workflow_runtime',
  'event_trigger_runtime',
  'permission_engine',
  'gateway',
  'notification_center',
  'connector_runtime',
  'memory_system',
  'summary_manager',
  'replay_service',
  'foreground_conversation_agent',
  'planner_runtime',
])

export function isWriteActionClass(actionType: string): boolean {
  return WRITE_ACTION_TYPES.has(actionType)
}

export function getWriteActionClass(actionType: string): string | null {
  return isWriteActionClass(actionType) ? actionType : null
}

const IN_FLIGHT_STATES: ReadonlySet<RuntimeActionState> = new Set(['dispatching', 'queued', 'waiting_for_approval'])

const TERMINAL_STATES: ReadonlySet<RuntimeActionState> = new Set([
  'failed',
  'timeout',
  'cancelled',
  'duplicate',
  'denied',
  'completed',
])

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

function validateRuntimeAction(action: RuntimeAction): { valid: boolean; error?: string } {
  if (!action.actionType) {
    return { valid: false, error: 'Missing required field: actionType' }
  }
  if (!action.targetRuntime) {
    return { valid: false, error: 'Missing required field: targetRuntime' }
  }
  if (!VALID_TARGET_RUNTIMES.has(action.targetRuntime)) {
    return { valid: false, error: `Invalid targetRuntime: ${action.targetRuntime}` }
  }
  if (!action.actionId) {
    return { valid: false, error: 'Missing required field: actionId' }
  }
  if (!action.source?.sourceModule) {
    return { valid: false, error: 'Missing required field: source.sourceModule' }
  }
  if (!action.targetAction) {
    return { valid: false, error: 'Missing required field: targetAction' }
  }
  return { valid: true }
}

function mapErrorToDispatchResult(
  requestId: string,
  actionId: string,
  targetRuntime: TargetRuntime,
  code: string,
  message: string,
  recoverable: boolean,
): DispatchResult {
  const now = new Date().toISOString()
  return {
    requestId,
    actionId,
    status: 'failed',
    targetRuntime,
    error: { code, message, recoverable },
    createdAt: now,
    completedAt: now,
  }
}

function createDispatchEvent(
  eventType: DispatchEventType,
  request: DispatchRequest,
  result?: DispatchResult,
): DispatchEvent {
  const now = new Date().toISOString()
  const { action, context, requestId } = request

  return {
    eventId: generateId(),
    eventType,
    actionId: action.actionId || 'unknown_action',
    requestId,
    sourceModule: (action.source?.sourceModule ?? context.callerModule) as SourceModule,
    targetRuntime: (action.targetRuntime || 'gateway') as TargetRuntime,
    actionType: (action.actionType || 'execute_tool') as RuntimeActionType,
    userId: context.userId ?? action.userId,
    sessionId: context.sessionId ?? action.sessionId,
    runId: action.targetRef?.runId,
    relatedRefs: action.targetRef,
    correlationId: action.correlationId,
    causationId: action.causationId,
    idempotencyKey: action.idempotencyKey,
    timestamp: now,
    createdAt: now,
    payload: result ? { status: result.status, error: result.error } : {},
    sensitivity: 'medium',
    retentionClass: 'standard',
  }
}

class RuntimeDispatcherImpl implements RuntimeDispatcher {
  private actionStore: RuntimeDispatcherConfig['actionStore']
  private eventStore: RuntimeDispatcherConfig['eventStore']
  private adapterRegistry: RuntimeDispatcherConfig['adapterRegistry']
  private permissionHook?: RuntimeDispatcherConfig['permissionHook']
  private traceStore?: RuntimeDispatcherConfig['traceStore']
  private auditRecorder?: RuntimeDispatcherConfig['auditRecorder']

  constructor(config: RuntimeDispatcherConfig) {
    this.actionStore = config.actionStore
    this.eventStore = config.eventStore
    this.adapterRegistry = config.adapterRegistry
    this.permissionHook = config.permissionHook
    this.traceStore = config.traceStore
    this.auditRecorder = config.auditRecorder
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const { action, requestId } = request
    const startTime = Date.now()
    const traceId = request.context.traceId ?? action.correlationId ?? generateId()
    const spanId = generateId()

    this.traceStore?.createSpan({
      spanId,
      traceId,
      parentSpanId: request.context.parentSpanId,
      spanType: 'dispatch',
      module: 'dispatcher',
      operation: action.targetAction,
      status: 'started',
      startTime: new Date(startTime).toISOString(),
      metadata: {
        actionId: action.actionId || 'unknown_action',
        targetRuntime: action.targetRuntime,
        actionType: action.actionType,
      },
    })

    this.emitEvent('dispatch_requested', request)

    const validation = validateRuntimeAction(action)
    if (!validation.valid) {
      const result = mapErrorToDispatchResult(
        requestId,
        action.actionId || 'unknown_action',
        (action.targetRuntime || 'gateway') as TargetRuntime,
        'invalid_action',
        validation.error ?? 'Invalid action',
        false,
      )
      this.recordDispatchAudit(action, result.status, `validation failure: ${validation.error}`)
      this.endDispatchSpan(spanId, 'failed', `validation failure: ${validation.error}`)
      this.emitEvent('dispatch_validation_failed', request, result)
      return result
    }

    this.actionStore.save(action)

    this.emitEvent('dispatch_accepted', request)

    if (action.idempotencyKey) {
      const existing = this.actionStore.findByIdempotencyKey(action.idempotencyKey)
      if (existing && existing.actionId !== action.actionId) {
        const behavior = action.policy?.idempotency?.duplicateBehavior ?? 'return_previous'
        const writeActionClass = getWriteActionClass(action.targetAction)

        const idempotencyResult = this.resolveIdempotencyDuplicate(
          requestId,
          action,
          existing,
          behavior,
          writeActionClass,
          spanId,
        )

        if (idempotencyResult) {
          this.emitEvent('dispatch_duplicate', request, idempotencyResult)
          this.recordDispatchAudit(action, idempotencyResult.status, idempotencyResult.error?.message)
          this.endDispatchSpan(spanId, idempotencyResult.status === 'failed' ? 'failed' : 'completed')
          return idempotencyResult
        }
      }
    }

    if (this.permissionHook) {
      const permissionResult = await this.permissionHook(action)
      if (!permissionResult.allowed) {
        const result: DispatchResult = {
          requestId,
          actionId: action.actionId || 'unknown_action',
          status: 'denied',
          targetRuntime: action.targetRuntime as TargetRuntime,
          error: {
            code: 'permission_denied',
            message: permissionResult.reason ?? 'Permission denied',
            recoverable: false,
          },
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }
        this.updateActionStatus(action.actionId, 'denied', permissionResult.reason)
        this.recordDispatchAudit(action, result.status, permissionResult.reason)
        this.endDispatchSpan(spanId, 'failed', permissionResult.reason)
        this.emitEvent('dispatch_denied', request, result)
        return result
      }
    }

    const adapter = this.adapterRegistry.getAdapter(action.targetRuntime as TargetRuntime)
    if (!adapter) {
      const result = mapErrorToDispatchResult(
        requestId,
        action.actionId,
        action.targetRuntime as TargetRuntime,
        'target_runtime_unavailable',
        `No adapter registered for runtime: ${action.targetRuntime}`,
        false,
      )
      this.updateActionStatus(action.actionId, 'failed', `No adapter for runtime: ${action.targetRuntime}`)
      this.recordDispatchAudit(action, result.status, result.error?.message)
      this.endDispatchSpan(spanId, 'failed', result.error?.message)
      this.emitEvent('dispatch_failed', request, result)
      return result
    }

    this.updateActionStatus(action.actionId, 'dispatching')
    this.emitEvent('dispatch_started', request)

    try {
      const timeoutMs = action.policy?.timeoutMs ?? 30000
      const targetResult = await this.executeWithTimeout(
        (executionContext) => adapter.execute(action, executionContext),
        timeoutMs,
      )

      const completedAt = new Date().toISOString()

      const result: DispatchResult = {
        requestId,
        actionId: action.actionId || 'unknown_action',
        status: 'completed',
        targetRuntime: action.targetRuntime as TargetRuntime,
        result: targetResult,
        createdAt: new Date(startTime).toISOString(),
        completedAt,
        trace: {
          traceId: request.context.traceId ?? generateId(),
          spanId: generateId(),
        },
      }

      this.updateActionStatus(action.actionId, 'completed', undefined, targetResult as Record<string, unknown>)
      this.recordDispatchAudit(action, result.status)
      this.endDispatchSpan(spanId, 'completed')
      this.emitEvent('dispatch_completed', request, result)
      return result
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'Timeout'
      const status: DispatchStatus = isTimeout ? 'timeout' : 'failed'
      const errorCode = isTimeout ? 'timeout' : 'target_runtime_error'
      const errorMessage = error instanceof Error ? error.message : String(error)

      const result: DispatchResult = {
        requestId,
        actionId: action.actionId || 'unknown_action',
        status,
        targetRuntime: action.targetRuntime as TargetRuntime,
        error: {
          code: errorCode,
          message: errorMessage,
          recoverable: false,
        },
        createdAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      }

      const actionStatus: RuntimeActionState = isTimeout ? 'timeout' : 'failed'
      this.updateActionStatus(action.actionId, actionStatus, errorMessage)
      this.recordDispatchAudit(
        action,
        result.status,
        adapter.cancelUnsupported && isTimeout ? `${errorMessage}; cancelUnsupported: true` : errorMessage,
      )
      this.endDispatchSpan(spanId, 'failed', errorMessage)
      this.emitEvent('dispatch_failed', request, result)
      return result
    }
  }

  private async executeWithTimeout<T>(
    fn: (context: { signal: AbortSignal; timeoutMs: number }) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController()

    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        callback()
      }

      const timeoutId = setTimeout(() => {
        controller.abort()
        settle(() => reject(new Error('Timeout')))
      }, timeoutMs)

      Promise.resolve()
        .then(() => fn({ signal: controller.signal, timeoutMs }))
        .then((result) => {
          settle(() => resolve(result))
        })
        .catch((error) => {
          settle(() => reject(error))
        })
    })
  }

  private resolveIdempotencyDuplicate(
    requestId: string,
    action: RuntimeAction,
    existing: StorageRuntimeAction,
    behavior: 'return_previous' | 'drop' | 'fail',
    writeActionClass: string | null,
    spanId: string,
  ): DispatchResult | null {
    const effectiveBehavior = writeActionClass && behavior === 'return_previous' ? 'fail' : behavior

    switch (effectiveBehavior) {
      case 'return_previous':
        return this.buildReturnPreviousResult(requestId, action, existing, spanId)
      case 'drop':
        return this.buildDropResult(requestId, action, existing, spanId)
      case 'fail':
        return this.buildFailResult(requestId, action, existing, spanId)
    }
  }

  private buildReturnPreviousResult(
    requestId: string,
    action: RuntimeAction,
    existing: StorageRuntimeAction,
    _spanId: string,
  ): DispatchResult {
    const isInFlight = IN_FLIGHT_STATES.has(existing.status)
    const base: DispatchResult = {
      requestId,
      actionId: action.actionId || 'unknown_action',
      status: 'duplicate',
      targetRuntime: action.targetRuntime as TargetRuntime,
      result: existing.result,
      idempotency: {
        key: action.idempotencyKey!,
        duplicateOfActionId: existing.actionId,
      },
      createdAt: new Date().toISOString(),
    }

    if (isInFlight) {
      base.waitingState = {
        waitingFor: existing.status === 'waiting_for_approval' ? 'approval' : 'target_runtime',
      }
    }

    return base
  }

  private buildDropResult(
    requestId: string,
    action: RuntimeAction,
    existing: StorageRuntimeAction,
    _spanId: string,
  ): DispatchResult {
    this.updateActionStatus(action.actionId, 'duplicate', `Dropped duplicate of ${existing.actionId}`)

    return {
      requestId,
      actionId: action.actionId || 'unknown_action',
      status: 'duplicate',
      targetRuntime: action.targetRuntime as TargetRuntime,
      idempotency: {
        key: action.idempotencyKey!,
        duplicateOfActionId: existing.actionId,
      },
      createdAt: new Date().toISOString(),
    }
  }

  private buildFailResult(
    requestId: string,
    action: RuntimeAction,
    existing: StorageRuntimeAction,
    _spanId: string,
  ): DispatchResult {
    const isInFlight = IN_FLIGHT_STATES.has(existing.status)
    const isTerminal = TERMINAL_STATES.has(existing.status)

    const reason = isInFlight
      ? `Duplicate action rejected: original action ${existing.actionId} is still in-flight (${existing.status})`
      : isTerminal
        ? `Duplicate action rejected: original action ${existing.actionId} already reached terminal state (${existing.status})`
        : `Duplicate action rejected: original action ${existing.actionId} exists with status ${existing.status}`

    this.updateActionStatus(action.actionId, 'failed', reason)

    return {
      requestId,
      actionId: action.actionId || 'unknown_action',
      status: 'failed',
      targetRuntime: action.targetRuntime as TargetRuntime,
      error: {
        code: 'duplicate_rejected',
        message: reason,
        recoverable: false,
      },
      idempotency: {
        key: action.idempotencyKey!,
        duplicateOfActionId: existing.actionId,
      },
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
  }

  private updateActionStatus(
    actionId: string,
    status: RuntimeActionState,
    statusMessage?: string,
    result?: Record<string, unknown>,
  ): void {
    this.actionStore.updateStatus(actionId, status, statusMessage, result)
  }

  private emitEvent(eventType: DispatchEventType, request: DispatchRequest, result?: DispatchResult): void {
    const event = createDispatchEvent(eventType, request, result)
    this.eventStore.append(event)
  }

  private endDispatchSpan(spanId: string, status: 'completed' | 'failed', error?: string): void {
    this.traceStore?.endSpan(spanId, status, error)
  }

  private recordDispatchAudit(action: RuntimeAction, status: DispatchStatus, error?: string): void {
    this.auditRecorder?.recordDispatch({
      actionId: action.actionId || 'unknown_action',
      userId: action.userId ?? 'system',
      sessionId: action.sessionId,
      targetRuntime: action.targetRuntime,
      targetAction: action.targetAction,
      status:
        status === 'completed' || status === 'duplicate' ? 'completed' : status === 'denied' ? 'blocked' : 'failed',
      payloadSummary: error ?? action.actionType,
      correlationId: action.correlationId,
      causationId: action.causationId,
    })
  }
}

export function createRuntimeDispatcher(config: RuntimeDispatcherConfig): RuntimeDispatcher {
  return new RuntimeDispatcherImpl(config)
}
