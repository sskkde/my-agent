/**
 * Planner Mark Step Tool
 * Handles marking a planner run step's status from the foreground
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const MARK_PLANNER_STEP_TOOL_ID = 'foreground_mark_planner_step'

export interface MarkPlannerStepDeps {
  plannerRuntime: PlannerRuntime
  userId: string
  sessionId: string
}

export interface MarkPlannerStepInput {
  plannerRunId: string
  stepId: string
  status: 'completed' | 'failed' | 'in_progress'
  result?: string
}

export interface MarkPlannerStepData {
  plannerRunId: string
  stepId: string
  status: 'completed' | 'failed' | 'in_progress'
}

/**
 * Handles marking a planner run step's status
 */
export async function handleMarkPlannerStep(
  deps: MarkPlannerStepDeps,
  input: MarkPlannerStepInput,
): Promise<ForegroundToolResult<MarkPlannerStepData>> {
  try {
    deps.plannerRuntime.markStep(input.plannerRunId, input.stepId, input.status, input.result)

    return createSuccessResult<MarkPlannerStepData>(
      {
        plannerRunId: input.plannerRunId,
        stepId: input.stepId,
        status: input.status,
      },
      '步骤状态已更新',
      {
        plannerRunIds: [input.plannerRunId],
      },
    )
  } catch (error) {
    return createErrorResult<MarkPlannerStepData>(
      'MARK_STEP_ERROR',
      error instanceof Error ? error.message : 'Failed to mark planner step',
      true,
      '更新步骤状态失败',
    )
  }
}
