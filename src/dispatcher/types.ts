import type {
  RuntimeActionState,
  Source,
  TargetRef,
  RuntimeAction as StorageRuntimeAction,
} from '../storage/runtime-action-store.js'
import type { SourceModule, SensitivityLevel, RetentionClass, RelatedRefs } from '../storage/event-store.js'
import type { TraceStore } from '../observability/types.js'
import type { AuditRecorder } from '../observability/audit-types.js'

export { RuntimeActionState, Source, TargetRef, SourceModule, SensitivityLevel, RetentionClass, RelatedRefs }

export type RuntimeActionType =
  | 'start_agent_run'
  | 'resume_agent_run'
  | 'launch_subagent'
  | 'resume_subagent'
  | 'cancel_subagent'
  | 'launch_background_subagent'
  | 'resume_background_subagent'
  | 'cancel_background_subagent'
  | 'execute_tool'
  | 'start_workflow_run'
  | 'resume_workflow_step'
  | 'register_trigger'
  | 'register_wait_condition'
  | 'send_notification'
  | 'request_approval'
  | 'update_plan_state'
  | 'write_summary'
  | 'extract_memory'
  | 'connector_health_check'
  | 'connector_auth_refresh'
  | 'connector_register_subscription'
  | 'connector_receive_event'
  | 'replay_run'
  | 'start_foreground_turn'
  | 'complete_foreground_turn'
  | 'spawn_planner_run'
  | 'resume_planner_run'
  | 'cancel_planner_run'
  | 'archive_planner_run'
  | 'query_active_work'
  | 'pause_planner_run'
  | 'pause_background_run'
  | 'resume_background_run'

export type TargetRuntime =
  | 'agent_kernel'
  | 'subagent_runtime'
  | 'tool_plane'
  | 'workflow_runtime'
  | 'event_trigger_runtime'
  | 'permission_engine'
  | 'gateway'
  | 'notification_center'
  | 'connector_runtime'
  | 'memory_system'
  | 'summary_manager'
  | 'replay_service'
  | 'foreground_conversation_agent'
  | 'planner_runtime'

export interface DispatchPolicy {
  mode: 'sync' | 'async' | 'queued' | 'fire_and_forget'
  priority: 'low' | 'normal' | 'high' | 'critical'
  timeoutMs?: number
  retryPolicy?: {
    maxAttempts: number
    backoff: 'none' | 'fixed' | 'exponential'
    initialDelayMs?: number
    maxDelayMs?: number
  }
  permissionPolicy?: {
    requirePrecheck: boolean
    allowAskUser: boolean
    permissionMode?: string
  }
  idempotency?: {
    enabled: boolean
    key: string
    duplicateBehavior: 'return_previous' | 'drop' | 'fail'
  }
  concurrency?: {
    groupKey?: string
    maxConcurrent?: number
  }
  audit?: {
    required: boolean
    auditType?: string
  }
}

export interface RuntimeAction extends StorageRuntimeAction {
  actionType: RuntimeActionType
  policy?: DispatchPolicy
}

export type DispatchStatus =
  | 'accepted'
  | 'completed'
  | 'queued'
  | 'waiting_for_approval'
  | 'denied'
  | 'duplicate'
  | 'failed'
  | 'timeout'
  | 'cancelled'

export interface WaitingState {
  waitingFor: 'approval' | 'external_event' | 'target_runtime' | 'queue'
  approvalId?: string
  waitConditionId?: string
}

export interface IdempotencyInfo {
  key: string
  duplicateOfActionId?: string
}

export interface DispatchError {
  code: string
  message: string
  recoverable: boolean
}

export interface TraceInfo {
  traceId: string
  spanId: string
}

export interface DispatchResult {
  requestId: string
  actionId: string
  status: DispatchStatus
  targetRuntime: TargetRuntime
  targetResultRef?: string
  result?: unknown
  waitingState?: WaitingState
  idempotency?: IdempotencyInfo
  error?: DispatchError
  trace?: TraceInfo
  createdAt: string
  completedAt?: string
}

export interface DispatchContext {
  userId?: string
  sessionId?: string
  traceId?: string
  parentSpanId?: string
  permissionContext?: PermissionContext
  callerModule: string
}

export interface PermissionContext {
  userId: string
  permissions: string[]
  roles?: string[]
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
}

export interface DispatchRequest {
  requestId: string
  action: RuntimeAction
  context: DispatchContext
  expectedResult?: {
    resultType: string
    waitForCompletion?: boolean
  }
}

export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
  approvalId?: string
}

export type PermissionHook = (action: RuntimeAction) => Promise<PermissionCheckResult>

export interface RuntimeAdapterExecutionContext {
  signal: AbortSignal
  timeoutMs: number
}

export interface RuntimeAdapter {
  /**
   * Execute a runtime action. Adapters that cannot cooperatively stop on context.signal
   * should set cancelUnsupported so timeout/cancellation audit trails are explicit.
   */
  execute(action: RuntimeAction, context: RuntimeAdapterExecutionContext): Promise<unknown>
  cancelUnsupported?: boolean
}

export interface AdapterRegistry {
  register(runtimeType: TargetRuntime, adapter: RuntimeAdapter): void
  getAdapter(runtimeType: TargetRuntime): RuntimeAdapter | null
  unregister(runtimeType: TargetRuntime): void
  listAdapters(): TargetRuntime[]
}

export interface RuntimeDispatcherConfig {
  actionStore: {
    save(action: StorageRuntimeAction): void
    findById(actionId: string): StorageRuntimeAction | null
    findByIdempotencyKey(idempotencyKey: string): StorageRuntimeAction | null
    updateStatus(
      actionId: string,
      status: RuntimeActionState,
      statusMessage?: string,
      result?: Record<string, unknown>,
    ): void
  }
  eventStore: {
    append(event: unknown | unknown[]): void
  }
  adapterRegistry: AdapterRegistry
  permissionHook?: PermissionHook
  traceStore?: TraceStore
  auditRecorder?: AuditRecorder
}

export type DispatchEventType =
  | 'dispatch_requested'
  | 'dispatch_accepted'
  | 'dispatch_queued'
  | 'dispatch_started'
  | 'dispatch_completed'
  | 'dispatch_failed'
  | 'dispatch_validation_failed'
  | 'dispatch_denied'
  | 'dispatch_waiting_approval'
  | 'dispatch_duplicate'
  | 'dispatch_cancelled'

export interface DispatchEvent {
  eventId: string
  eventType: DispatchEventType
  actionId: string
  requestId: string
  sourceModule: SourceModule
  targetRuntime: TargetRuntime
  actionType: RuntimeActionType
  userId?: string
  sessionId?: string
  runId?: string
  relatedRefs?: RelatedRefs
  correlationId?: string
  causationId?: string
  idempotencyKey?: string
  timestamp: string
  createdAt: string
  payload?: Record<string, unknown>
  sensitivity: SensitivityLevel
  retentionClass: RetentionClass
}

export type DispatchFailureCode =
  | 'invalid_action'
  | 'target_runtime_unavailable'
  | 'target_state_invalid'
  | 'permission_denied'
  | 'approval_required'
  | 'idempotency_duplicate'
  | 'duplicate_rejected'
  | 'timeout'
  | 'queue_full'
  | 'concurrency_limited'
  | 'target_runtime_error'
  | 'policy_violation'
  | 'cancelled'

export interface RuntimeDispatcher {
  dispatch(request: DispatchRequest): Promise<DispatchResult>
}
