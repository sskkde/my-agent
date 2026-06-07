// ForegroundConversationRun lifecycle states
export const FOREGROUND_STATES = {
  RECEIVED: 'received',
  HYDRATING: 'hydrating',
  CLASSIFYING: 'classifying',
  DECIDING: 'deciding',
  RESPONDING: 'responding',
  DIRECT_DELEGATING: 'direct_delegating',
  SPAWNING_PLANNER: 'spawning_planner',
  QUERYING_STATUS: 'querying_status',
  HANDLING_APPROVAL: 'handling_approval',
  HANDLING_INTERRUPT: 'handling_interrupt',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type ForegroundState = (typeof FOREGROUND_STATES)[keyof typeof FOREGROUND_STATES]

// PlannerRun lifecycle states
export const PLANNER_STATES = {
  INITIALIZING: 'initializing',
  PLANNING: 'planning',
  WAITING_FOR_USER: 'waiting_for_user',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  WAITING_FOR_EXECUTION_RESULT: 'waiting_for_execution_result',
  WAITING_FOR_EXTERNAL_EVENT: 'waiting_for_external_event',
  REPLANNING: 'replanning',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ARCHIVED: 'archived',
} as const

export type PlannerState = (typeof PLANNER_STATES)[keyof typeof PLANNER_STATES]

// ExecutionPlan lifecycle states
export const EXECUTION_PLAN_STATES = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  IN_EXECUTION: 'in_execution',
  BLOCKED: 'blocked',
  WAITING_FOR_USER: 'waiting_for_user',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  REPLANNING: 'replanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABANDONED: 'abandoned',
} as const

export type ExecutionPlanState = (typeof EXECUTION_PLAN_STATES)[keyof typeof EXECUTION_PLAN_STATES]

// RuntimeAction lifecycle states
export const RUNTIME_ACTION_STATES = {
  CREATED: 'created',
  VALIDATED: 'validated',
  DUPLICATE: 'duplicate',
  DENIED: 'denied',
  ACCEPTED: 'accepted',
  QUEUED: 'queued',
  DISPATCHING: 'dispatching',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  WAITING_FOR_TARGET: 'waiting_for_target',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const

export type RuntimeActionState = (typeof RUNTIME_ACTION_STATES)[keyof typeof RUNTIME_ACTION_STATES]

// KernelRun lifecycle states
export const KERNEL_RUN_STATES = {
  INITIALIZING: 'initializing',
  BUILDING_CONTEXT: 'building_context',
  BUILDING_MODEL_INPUT: 'building_model_input',
  SAMPLING_MODEL: 'sampling_model',
  PARSING_MODEL_OUTPUT: 'parsing_model_output',
  DISPATCHING_TOOLS: 'dispatching_tools',
  LAUNCHING_SUBAGENT: 'launching_subagent',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  WAITING_FOR_USER: 'waiting_for_user',
  CHECKING_COMPACT: 'checking_compact',
  COMPACTING: 'compacting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
  PARTIAL_SUCCESS: 'partial_success',
  MAX_ITERATIONS_REACHED: 'max_iterations_reached',
} as const

export type KernelRunState = (typeof KERNEL_RUN_STATES)[keyof typeof KERNEL_RUN_STATES]

// ToolExecution lifecycle states
export const TOOL_EXECUTION_STATES = {
  RECEIVED: 'received',
  SCHEMA_VALIDATING: 'schema_validating',
  PERMISSION_CHECKING: 'permission_checking',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  DENIED: 'denied',
  EXECUTING: 'executing',
  MAPPING_RESULT: 'mapping_result',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
  ABORTED: 'aborted',
  DISCARDED: 'discarded',
} as const

export type ToolExecutionState = (typeof TOOL_EXECUTION_STATES)[keyof typeof TOOL_EXECUTION_STATES]

// BackgroundSubagentRun lifecycle states
export const BACKGROUND_SUBAGENT_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_FOR_USER: 'waiting_for_user',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  WAITING_FOR_EXTERNAL_EVENT: 'waiting_for_external_event',
  SLEEPING: 'sleeping',
  RECOVERING: 'recovering',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const

export type BackgroundSubagentState = (typeof BACKGROUND_SUBAGENT_STATES)[keyof typeof BACKGROUND_SUBAGENT_STATES]

// WorkflowRun lifecycle states
export const WORKFLOW_RUN_STATES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_FOR_USER: 'waiting_for_user',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  WAITING_FOR_EXTERNAL_EVENT: 'waiting_for_external_event',
  SLEEPING: 'sleeping',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
} as const

export type WorkflowRunState = (typeof WORKFLOW_RUN_STATES)[keyof typeof WORKFLOW_RUN_STATES]

// ApprovalRequest lifecycle states
export const APPROVAL_STATES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const

export type ApprovalState = (typeof APPROVAL_STATES)[keyof typeof APPROVAL_STATES]

// WaitCondition lifecycle states
export const WAIT_CONDITION_STATES = {
  REGISTERED: 'registered',
  ACTIVE: 'active',
  SATISFIED: 'satisfied',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const

export type WaitConditionState = (typeof WAIT_CONDITION_STATES)[keyof typeof WAIT_CONDITION_STATES]

// RuntimeTriggerEvent lifecycle states
export const TRIGGER_EVENT_STATES = {
  CREATED: 'created',
  MATCHED: 'matched',
  ACTION_CREATED: 'action_created',
  DISPATCHED: 'dispatched',
  HANDLED: 'handled',
  FAILED: 'failed',
  DUPLICATE: 'duplicate',
} as const

export type TriggerEventState = (typeof TRIGGER_EVENT_STATES)[keyof typeof TRIGGER_EVENT_STATES]

// Summary lifecycle states
export const SUMMARY_STATES = {
  CANDIDATE: 'candidate',
  VALIDATED: 'validated',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived',
  EXPIRED: 'expired',
} as const

export type SummaryState = (typeof SUMMARY_STATES)[keyof typeof SUMMARY_STATES]

// Long-term Memory lifecycle states
export const MEMORY_STATES = {
  CANDIDATE: 'candidate',
  VALIDATED: 'validated',
  ACTIVE: 'active',
  LOW_PRIORITY: 'low_priority',
  COMPRESSED: 'compressed',
  ARCHIVED: 'archived',
  EXPIRED: 'expired',
  DELETED: 'deleted',
} as const

export type MemoryState = (typeof MEMORY_STATES)[keyof typeof MEMORY_STATES]

// Global state classifications
// Active states - objects that are actively progressing
export const ACTIVE_STATES = [
  'queued',
  'initializing',
  'planning',
  'running',
  'executing',
  'replanning',
  'recovering',
] as const

// Waiting states - objects that are not done but temporarily blocked
export const WAITING_STATES = [
  'waiting_for_user',
  'waiting_for_approval',
  'waiting_for_execution_result',
  'waiting_for_external_event',
  'sleeping',
  'paused',
] as const

// Terminal states - objects that have reached end of lifecycle
export const TERMINAL_STATES = [
  'completed',
  'partial_success',
  'failed',
  'cancelled',
  'timeout',
  'expired',
  'archived',
] as const

export type ActiveState = (typeof ACTIVE_STATES)[number]
export type WaitingState = (typeof WAITING_STATES)[number]
export type TerminalState = (typeof TERMINAL_STATES)[number]
export type GlobalState = ActiveState | WaitingState | TerminalState
