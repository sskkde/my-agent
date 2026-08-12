import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { BackgroundRuntime } from '../../subagents/background-runtime.js'
import type { BackgroundRunStore } from '../../storage/background-run-store.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const CANCEL_PLANNER_TOOL_ID = 'foreground_cancel_planner'

export interface CancelPlannerDeps {
  plannerRuntime: PlannerRuntime
  plannerRunStore: PlannerRunStore
  backgroundRuntime?: BackgroundRuntime
  backgroundRunStore?: BackgroundRunStore
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

    // Cancel the linked background execution so the planner child stops too
    // (instead of failing the run later with a confusing notification). Only
    // non-terminal background runs can be cancelled; failure here is best-effort.
    if (deps.backgroundRuntime && deps.backgroundRunStore && run.backgroundRunId) {
      const linked = deps.backgroundRunStore.getById(run.backgroundRunId)
      if (linked && ['queued', 'running', 'recovering'].includes(linked.status)) {
        try {
          deps.backgroundRuntime.cancelBackgroundRun(linked.backgroundRunId)
        } catch {
          // ignore: the planner run is already cancelled; bg cleanup is best-effort
        }
      }
    }

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
