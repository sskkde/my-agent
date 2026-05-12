export type ReplanReason =
  | 'tool_failed'
  | 'approval_rejected'
  | 'user_modified_goal'
  | 'dependency_missing'
  | 'timeout'
  | 'context_changed';

export type ReplanAction = 'replan' | 'terminate' | 'wait_for_user';

export interface ReplanDecision {
  action: ReplanAction;
  reason: ReplanReason;
  userVisibleMessage: string;
  preserveCompletedSteps: boolean;
  excludedStepIds?: string[];
}

export interface ReplanOptions {
  hasAlternativePaths: boolean;
  isRetryable: boolean;
  completedStepIds: string[];
}

function buildReplan(reason: ReplanReason, message: string, preserveCompletedSteps: boolean, excludedStepIds?: string[]): ReplanDecision {
  const decision: ReplanDecision = {
    action: 'replan',
    reason,
    userVisibleMessage: message,
    preserveCompletedSteps,
  };
  if (excludedStepIds !== undefined) {
    decision.excludedStepIds = excludedStepIds;
  }
  return decision;
}

function buildTerminate(reason: ReplanReason, message: string): ReplanDecision {
  return {
    action: 'terminate',
    reason,
    userVisibleMessage: message,
    preserveCompletedSteps: false,
  };
}

function buildWaitForUser(reason: ReplanReason, message: string): ReplanDecision {
  return {
    action: 'wait_for_user',
    reason,
    userVisibleMessage: message,
    preserveCompletedSteps: false,
  };
}

export class ReplanPolicy {
  decide(reason: ReplanReason, options: ReplanOptions): ReplanDecision {
    switch (reason) {
      case 'approval_rejected':
        if (options.hasAlternativePaths) {
          return buildReplan(
            'approval_rejected',
            'Approval was rejected. Replanning with alternative paths.',
            true,
          );
        }
        return buildTerminate(
          'approval_rejected',
          'Approval was rejected and no alternative paths exist. Terminating plan execution.',
        );

      case 'user_modified_goal':
        return buildReplan(
          'user_modified_goal',
          'User modified the goal. Replanning to accommodate updated goal.',
          true,
        );

      case 'tool_failed':
        if (options.isRetryable) {
          return buildReplan(
            'tool_failed',
            'Tool execution failed but is retryable. Replanning with retry.',
            true,
          );
        }
        return buildTerminate(
          'tool_failed',
          'Tool execution failed and is not retryable. Terminating plan execution.',
        );

      case 'dependency_missing':
        return buildReplan(
          'dependency_missing',
          'A required dependency is missing. Replanning with excluded dependency steps.',
          true,
          options.completedStepIds,
        );

      case 'timeout':
        return buildWaitForUser(
          'timeout',
          'Plan execution timed out. Waiting for user input on how to proceed.',
        );

      case 'context_changed':
        return buildReplan(
          'context_changed',
          'Execution context has changed. Replanning to adapt to new context.',
          true,
        );

      default:
        return buildTerminate('context_changed', 'Unknown replan reason. Terminating.');
    }
  }
}
