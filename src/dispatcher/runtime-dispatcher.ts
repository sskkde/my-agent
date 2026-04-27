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
  RuntimeActionType
} from './types.js';
import type { RuntimeActionState } from '../storage/runtime-action-store.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function validateRuntimeAction(action: RuntimeAction): { valid: boolean; error?: string } {
  if (!action.actionType) {
    return { valid: false, error: 'Missing required field: actionType' };
  }
  if (!action.targetRuntime) {
    return { valid: false, error: 'Missing required field: targetRuntime' };
  }
  if (!action.actionId) {
    return { valid: false, error: 'Missing required field: actionId' };
  }
  if (!action.source?.sourceModule) {
    return { valid: false, error: 'Missing required field: source.sourceModule' };
  }
  if (!action.targetAction) {
    return { valid: false, error: 'Missing required field: targetAction' };
  }
  return { valid: true };
}

function mapErrorToDispatchResult(
  requestId: string,
  actionId: string,
  targetRuntime: TargetRuntime,
  code: string,
  message: string,
  recoverable: boolean
): DispatchResult {
  const now = new Date().toISOString();
  return {
    requestId,
    actionId,
    status: 'failed',
    targetRuntime,
    error: { code, message, recoverable },
    createdAt: now,
    completedAt: now
  };
}

function createDispatchEvent(
  eventType: DispatchEventType,
  request: DispatchRequest,
  result?: DispatchResult
): DispatchEvent {
  const now = new Date().toISOString();
  const { action, context, requestId } = request;

  return {
    eventId: generateId(),
    eventType,
    actionId: action.actionId,
    requestId,
    sourceModule: action.source.sourceModule as SourceModule,
    targetRuntime: action.targetRuntime as TargetRuntime,
    actionType: action.actionType as RuntimeActionType,
    userId: context.userId ?? action.userId,
    sessionId: context.sessionId ?? action.sessionId,
    runId: action.targetRef?.runId,
    relatedRefs: action.targetRef,
    correlationId: action.correlationId,
    causationId: action.causationId,
    idempotencyKey: action.idempotencyKey,
    timestamp: now,
    createdAt: now,
    payload: result
      ? { status: result.status, error: result.error }
      : undefined,
    sensitivity: 'medium',
    retentionClass: 'standard'
  };
}

class RuntimeDispatcherImpl implements RuntimeDispatcher {
  private actionStore: RuntimeDispatcherConfig['actionStore'];
  private eventStore: RuntimeDispatcherConfig['eventStore'];
  private adapterRegistry: RuntimeDispatcherConfig['adapterRegistry'];
  private permissionHook?: RuntimeDispatcherConfig['permissionHook'];

  constructor(config: RuntimeDispatcherConfig) {
    this.actionStore = config.actionStore;
    this.eventStore = config.eventStore;
    this.adapterRegistry = config.adapterRegistry;
    this.permissionHook = config.permissionHook;
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const { action, requestId } = request;
    const startTime = Date.now();

    this.actionStore.save(action);

    this.emitEvent('dispatch_requested', request);

    const validation = validateRuntimeAction(action);
    if (!validation.valid) {
      const result = mapErrorToDispatchResult(
        requestId,
        action.actionId,
        action.targetRuntime as TargetRuntime,
        'invalid_action',
        validation.error ?? 'Invalid action',
        false
      );
      this.updateActionStatus(action.actionId, 'failed', validation.error);
      this.emitEvent('dispatch_failed', request, result);
      return result;
    }

    this.emitEvent('dispatch_accepted', request);

    if (action.idempotencyKey) {
      const existing = this.actionStore.findByIdempotencyKey(action.idempotencyKey);
      if (existing && existing.actionId !== action.actionId && existing.status === 'completed') {
        const result: DispatchResult = {
          requestId,
          actionId: action.actionId,
          status: 'duplicate',
          targetRuntime: action.targetRuntime as TargetRuntime,
          result: existing.result,
          idempotency: {
            key: action.idempotencyKey,
            duplicateOfActionId: existing.actionId
          },
          createdAt: new Date().toISOString()
        };
        this.emitEvent('dispatch_duplicate', request, result);
        return result;
      }
    }

    if (this.permissionHook) {
      const permissionResult = await this.permissionHook(action);
      if (!permissionResult.allowed) {
        const result: DispatchResult = {
          requestId,
          actionId: action.actionId,
          status: 'denied',
          targetRuntime: action.targetRuntime as TargetRuntime,
          error: {
            code: 'permission_denied',
            message: permissionResult.reason ?? 'Permission denied',
            recoverable: false
          },
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        };
        this.updateActionStatus(action.actionId, 'denied', permissionResult.reason);
        this.emitEvent('dispatch_denied', request, result);
        return result;
      }
    }

    const adapter = this.adapterRegistry.getAdapter(action.targetRuntime as TargetRuntime);
    if (!adapter) {
      const result = mapErrorToDispatchResult(
        requestId,
        action.actionId,
        action.targetRuntime as TargetRuntime,
        'target_runtime_unavailable',
        `No adapter registered for runtime: ${action.targetRuntime}`,
        false
      );
      this.updateActionStatus(
        action.actionId,
        'failed',
        `No adapter for runtime: ${action.targetRuntime}`
      );
      this.emitEvent('dispatch_failed', request, result);
      return result;
    }

    this.updateActionStatus(action.actionId, 'dispatching');
    this.emitEvent('dispatch_started', request);

    try {
      const timeoutMs = action.policy?.timeoutMs ?? 30000;
      const targetResult = await this.executeWithTimeout(
        () => adapter.execute(action),
        timeoutMs
      );

      const completedAt = new Date().toISOString();

      const result: DispatchResult = {
        requestId,
        actionId: action.actionId,
        status: 'completed',
        targetRuntime: action.targetRuntime as TargetRuntime,
        result: targetResult,
        createdAt: new Date(startTime).toISOString(),
        completedAt,
        trace: {
          traceId: request.context.traceId ?? generateId(),
          spanId: generateId()
        }
      };

      this.updateActionStatus(action.actionId, 'completed', undefined, targetResult as Record<string, unknown>);
      this.emitEvent('dispatch_completed', request, result);
      return result;
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'Timeout';
      const status: DispatchStatus = isTimeout ? 'timeout' : 'failed';
      const errorCode = isTimeout ? 'timeout' : 'target_runtime_error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      const result: DispatchResult = {
        requestId,
        actionId: action.actionId,
        status,
        targetRuntime: action.targetRuntime as TargetRuntime,
        error: {
          code: errorCode,
          message: errorMessage,
          recoverable: false
        },
        createdAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString()
      };

      const actionStatus: RuntimeActionState = isTimeout ? 'timeout' : 'failed';
      this.updateActionStatus(action.actionId, actionStatus, errorMessage);
      this.emitEvent('dispatch_failed', request, result);
      return result;
    }
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout'));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private updateActionStatus(
    actionId: string,
    status: RuntimeActionState,
    statusMessage?: string,
    result?: Record<string, unknown>
  ): void {
    this.actionStore.updateStatus(actionId, status, statusMessage, result);
  }

  private emitEvent(
    eventType: DispatchEventType,
    request: DispatchRequest,
    result?: DispatchResult
  ): void {
    const event = createDispatchEvent(eventType, request, result);
    this.eventStore.append(event);
  }
}

export function createRuntimeDispatcher(
  config: RuntimeDispatcherConfig
): RuntimeDispatcher {
  return new RuntimeDispatcherImpl(config);
}
