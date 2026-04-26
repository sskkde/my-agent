export type CancellationTargetType =
  | 'planner_run'
  | 'kernel_run'
  | 'tool_execution'
  | 'subagent_run'
  | 'background_run'
  | 'workflow_run'
  | 'workflow_step_run'
  | 'runtime_action'
  | 'wait_condition';

export const CANCELLATION_TARGET_TYPES = {
  PLANNER_RUN: 'planner_run',
  KERNEL_RUN: 'kernel_run',
  TOOL_EXECUTION: 'tool_execution',
  SUBAGENT_RUN: 'subagent_run',
  BACKGROUND_RUN: 'background_run',
  WORKFLOW_RUN: 'workflow_run',
  WORKFLOW_STEP_RUN: 'workflow_step_run',
  RUNTIME_ACTION: 'runtime_action',
  WAIT_CONDITION: 'wait_condition',
} as const;

export interface CascadePolicy {
  cancelChildren: boolean;
  cancelActiveTools: boolean;
  cancelBackgroundRuns: boolean;
  cancelWaitConditions: boolean;
  notifyUser: boolean;
}

export interface CancellationRequest {
  cancellationId: string;
  requestedBy: 'user' | 'system' | 'timeout' | 'policy';
  reason: string;
  target: {
    targetType: CancellationTargetType;
    targetId: string;
  };
  cascadePolicy: CascadePolicy;
  createdAt: string;
}

export type CancellationStatus =
  | 'completed'
  | 'partial'
  | 'not_cancellable'
  | 'already_terminal'
  | 'failed';

export const CANCELLATION_STATUSES = {
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  NOT_CANCELLABLE: 'not_cancellable',
  ALREADY_TERMINAL: 'already_terminal',
  FAILED: 'failed',
} as const;

export interface SideEffectNotice {
  externalSideEffectsMayHaveOccurred: boolean;
  summary?: string;
}

export interface CancellationResult {
  cancellationId: string;
  status: CancellationStatus;
  cancelledRefs?: string[];
  stillRunningRefs?: string[];
  sideEffectNotice?: SideEffectNotice;
  userVisibleSummary?: string;
}
