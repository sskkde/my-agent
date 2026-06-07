/**
 * Planner Resume Tool
 * Handles resuming an existing planner run from the foreground
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const RESUME_PLANNER_TOOL_ID = 'foreground_resume_planner'

export interface ResumePlannerDeps {
  plannerRuntime: PlannerRuntime
  plannerRunStore: PlannerRunStore
  userId: string
  sessionId: string
}

export interface ResumePlannerInput {
  plannerRunId: string
  userMessage: string
  timestamp: string
}

export interface ResumePlannerData {
  plannerRunId: string
  status: 'resumed'
}

/**
 * Handles resuming an existing planner run
 * Performs authorization check before resuming
 */
export async function handleResumePlanner(
  deps: ResumePlannerDeps,
  input: ResumePlannerInput,
): Promise<ForegroundToolResult<ResumePlannerData>> {
  try {
    const run = deps.plannerRunStore.getById(input.plannerRunId)

    if (!run) {
      return createErrorResult<ResumePlannerData>(
        'PLANNER_NOT_FOUND',
        `Planner run not found: ${input.plannerRunId}`,
        false,
        'No existing plan found to resume.',
      )
    }

    if (run.userId !== deps.userId) {
      return createErrorResult<ResumePlannerData>(
        'UNAUTHORIZED_PLANNER_ACCESS',
        `User ${deps.userId} is not authorized to access planner run ${input.plannerRunId}`,
        false,
        'You are not authorized to resume this plan.',
      )
    }

    deps.plannerRuntime.resumePlannerRun(input.plannerRunId, {
      eventType: 'user_resume',
      payload: {
        userMessage: input.userMessage,
        timestamp: input.timestamp,
      },
    })

    return createSuccessResult<ResumePlannerData>(
      {
        plannerRunId: input.plannerRunId,
        status: 'resumed',
      },
      "I've resumed work on your existing plan.",
      {
        plannerRunIds: [input.plannerRunId],
      },
    )
  } catch (error) {
    return createErrorResult<ResumePlannerData>(
      'RESUME_PLANNER_ERROR',
      error instanceof Error ? error.message : 'Failed to resume planner',
      true,
      error instanceof Error ? error.message : 'Failed to resume the existing plan.',
    )
  }
}
