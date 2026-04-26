import type { RuntimeError, RuntimeErrorCategory, Recoverability } from './errors';

export type BackoffStrategy = 'none' | 'fixed' | 'linear' | 'exponential';

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: RuntimeErrorCategory[];
  doNotRetryOn?: RuntimeErrorCategory[];
  requireApprovalBeforeRetry?: boolean;
}

export const BACKOFF_STRATEGIES = {
  NONE: 'none',
  FIXED: 'fixed',
  LINEAR: 'linear',
  EXPONENTIAL: 'exponential',
} as const;

export const RECOVERABILITY = {
  RECOVERABLE_AUTO: 'recoverable_auto',
  RECOVERABLE_WITH_USER: 'recoverable_with_user',
  RECOVERABLE_WITH_APPROVAL: 'recoverable_with_approval',
  RETRYABLE_LATER: 'retryable_later',
  NON_RECOVERABLE: 'non_recoverable',
} as const;

const RETRYABLE_LATER_CATEGORIES: RuntimeErrorCategory[] = [
  'connector_rate_limited',
  'timeout',
  'external_event_timeout',
  'model_error',
  'system_internal_error',
  'state_conflict',
  'workflow_step_error',
  'subagent_error',
  'planner_error',
  'dispatcher_error',
];

const RECOVERABLE_AUTO_CATEGORIES: RuntimeErrorCategory[] = [
  'tool_validation_error',
  'context_overflow',
];

const RECOVERABLE_WITH_USER_CATEGORIES: RuntimeErrorCategory[] = [
  'user_input_error',
];

const NON_RECOVERABLE_CATEGORIES: RuntimeErrorCategory[] = [
  'approval_rejected',
  'permission_error',
  'connector_auth_error',
  'tool_execution_error',
  'duplicate_event',
];

export function getRetryClassification(category: RuntimeErrorCategory): Recoverability {
  if (RETRYABLE_LATER_CATEGORIES.includes(category)) {
    return 'retryable_later';
  }

  if (RECOVERABLE_AUTO_CATEGORIES.includes(category)) {
    return 'recoverable_auto';
  }

  if (RECOVERABLE_WITH_USER_CATEGORIES.includes(category)) {
    return 'recoverable_with_user';
  }

  if (NON_RECOVERABLE_CATEGORIES.includes(category)) {
    return 'non_recoverable';
  }

  return 'non_recoverable';
}

export function isRetryable(error: RuntimeError): boolean {
  const retryableRecoverabilities: Recoverability[] = [
    'retryable_later',
    'recoverable_auto',
  ];

  return retryableRecoverabilities.includes(error.recoverability);
}
