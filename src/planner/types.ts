import type { ExecutionPlanState } from '../shared/states.js';

export type PlannerRunState =
  | 'initializing'
  | 'planning'
  | 'waiting_for_user'
  | 'waiting_for_approval'
  | 'waiting_for_execution_result'
  | 'waiting_for_external_event'
  | 'replanning'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

export interface ActiveExecutionRef {
  refId: string;
  refType: 'background_run' | 'workflow_run' | 'subagent_run' | 'kernel_run' | 'tool_execution';
  status: string;
  cancellationRequested: boolean;
}

export interface Checkpoint {
  step: string;
  objective?: string;
  planningStep?: string;
  iterations?: number;
  pendingActions?: string[];
  stateVersion?: number;
  lastSuccessfulStep?: string;
  contextSnapshot?: Record<string, unknown>;
  recoveryPoint?: string;
  activeExecutionRefs?: ActiveExecutionRef[];
  [key: string]: unknown;
}

export interface PlannerRun {
  plannerRunId: string;
  planId: string;
  userId: string;
  sessionId?: string;
  status: PlannerRunState;
  objective: string;
  checkpoint: Checkpoint | null;
  activeExecutionRefs: ActiveExecutionRef[];
  createdAt: string;
  updatedAt: string;
}

export interface PlannerRunInput {
  objective: string;
  userId: string;
  sessionId?: string;
  contextBundle?: Record<string, unknown>;
}

export interface PlannerRunResult {
  plannerRunId: string;
  planId: string;
  status: PlannerRunState;
  actions: PlannerRuntimeAction[];
  error?: string;
}

export interface PlannerRuntimeAction {
  actionId: string;
  targetRuntime: string;
  targetAction: string;
  payload: Record<string, unknown>;
  status: string;
}

export interface ExecutionPlanRef {
  planId: string;
  plannerRunId: string;
  status: ExecutionPlanState;
}

/**
 * Structured patch data for PlannerStatePatch.
 * Each patchType has a specific shape to replace the old Record<string, unknown>.
 * Defined here (in planner/types.ts) so memory/ can import from planner/
 * without creating a circular dependency.
 */
export type PlannerStatePatchData =
  | {
      patchType: 'state_transition';
      from: PlannerRunState | null;
      to: PlannerRunState;
      reason?: string;
    }
  | {
      patchType: 'plan_update';
      planId: string;
      fromVersion: number;
      toVersion: number;
      planSummary?: string;
    }
  | {
      patchType: 'execution_ref_update';
      refId: string;
      refType: string;
      status: string;
    }
  | {
      patchType: 'checkpoint_update';
      checkpointKeys: string[];
    };

export interface PlannerStatePatch {
  plannerRunId: string;
  patchType: 'state_transition' | 'checkpoint_update' | 'plan_update' | 'execution_ref_update';
  patchData: PlannerStatePatchData;
  createdAt: string;
}

export interface PlannerAgentTemplate {
  systemPrompt: string;
  allowedTools: string[];
  maxIterations: number;
}

export interface PlannerResumeEvent {
  eventType: string;
  payload: Record<string, unknown>;
}
