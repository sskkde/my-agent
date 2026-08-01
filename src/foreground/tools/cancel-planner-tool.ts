import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const CANCEL_PLANNER_TOOL_ID = 'foreground_cancel_planner'

export interface CancelPlannerDeps {
  plannerRuntime: PlannerRuntime
  plannerRunStore: PlannerRunStore
  userId: string
  sessionId: string
}

export interface CancelPlannerInput {
  plannerRunId: string
  reason?: string
}

export interface CancelPlannerData {
  plannerRunId: string
  status: 'cancelled'
}

export async function handleCancelPlanner(
  deps: CancelPlannerDeps,
  input: CancelPlannerInput,
): Promise<ForegroundToolResult<CancelPlannerData>> {
  try {
    const run = deps.plannerRunStore.getById(input.plannerRunId)

    if (!run) {
      return createErrorResult<CancelPlannerData>(
        'PLANNER_NOT_FOUND',
        `Planner run not found: ${input.plannerRunId}`,
        false,
        'No existing plan found to cancel.',
      )
    }

    if (run.userId !== deps.userId) {
      return createErrorResult<CancelPlannerData>(
        'UNAUTHORIZED',
        'Cannot cancel planner run belonging to another user',
        false,
        'You do not have permission to cancel this plan.',
      )
    }

    deps.plannerRuntime.cancelPlannerRun(input.plannerRunId)

    return createSuccessResult<CancelPlannerData>(
      {
        plannerRunId: input.plannerRunId,
        status: 'cancelled',
      },
      `Planner run ${input.plannerRunId} has been cancelled.`,
    )
  } catch (error) {
    return createErrorResult<CancelPlannerData>(
      'CANCEL_PLANNER_ERROR',
      error instanceof Error ? error.message : 'Failed to cancel planner run',
      false,
      'Failed to cancel the planner run.',
    )
  }
}
