/**
 * Error Categories
 * Based on failure_recovery_interrupt_cancellation_policy_v1.md
 */
export type RuntimeErrorCategory =
  | 'user_input_error'
  | 'permission_error'
  | 'approval_rejected'
  | 'connector_auth_error'
  | 'connector_rate_limited'
  | 'tool_validation_error'
  | 'tool_execution_error'
  | 'model_error'
  | 'context_overflow'
  | 'timeout'
  | 'external_event_timeout'
  | 'workflow_step_error'
  | 'subagent_error'
  | 'planner_error'
  | 'dispatcher_error'
  | 'duplicate_event'
  | 'state_conflict'
  | 'system_internal_error';

/**
 * Error Recoverability
 * Determines how an error can be recovered
 */
export type Recoverability =
  | 'recoverable_auto'
  | 'recoverable_with_user'
  | 'recoverable_with_approval'
  | 'retryable_later'
  | 'non_recoverable';

/**
 * Error Source Information
 * Tracks where the error originated
 */
export interface ErrorSource {
  module: string;
  runId?: string;
  plannerRunId?: string;
  workflowRunId?: string;
  workflowStepRunId?: string;
  backgroundRunId?: string;
  toolCallId?: string;
  actionId?: string;
  connectorId?: string;
}

/**
 * User-Visible Error Information
 * Information shown to the user about the error
 */
export interface UserVisibleError {
  title: string;
  summary: string;
  suggestedActions?: string[];
}

/**
 * Technical Error Details
 * Technical information for debugging and retry handling
 */
export interface TechnicalErrorDetails {
  stackRef?: string;
  rawErrorRef?: string;
  retryAfterMs?: number;
}

/**
 * RuntimeError
 * Unified error object for all runtime errors
 */
export interface RuntimeError {
  errorId: string;
  category: RuntimeErrorCategory;
  code: string;
  message: string;
  recoverability: Recoverability;
  source: ErrorSource;
  userVisible?: UserVisibleError;
  technical?: TechnicalErrorDetails;
  createdAt: string;
  attempts?: Array<{ providerId: string; error: RuntimeError }>;
}
