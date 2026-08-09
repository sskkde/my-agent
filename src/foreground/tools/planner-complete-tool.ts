/**
 * Planner Complete Tool
 * Handles completing a planner run from the foreground
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunResult } from '../../planner/types.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const COMPLETE_PLANNER_TOOL_ID = 'foreground_complete_planner'

export interface CompletePlannerDeps {
  plannerRuntime: PlannerRuntime
  userId: string
  sessionId: string
}

export interface CompletePlannerInput {
  plannerRunId: string
  summary?: string
}

export interface CompletePlannerData {
  plannerRunId: string
  planId: string
  status: 'completed'
}

/**
 * Handles completing a planner run
 */
export async function handleCompletePlanner(
  deps: CompletePlannerDeps,
  input: CompletePlannerInput,
): Promise<ForegroundToolResult<CompletePlannerData>> {
  try {
    const result: PlannerRunResult = deps.plannerRuntime.completePlannerRun(input.plannerRunId, input.summary)

    return createSuccessResult<CompletePlannerData>(
      {
        plannerRunId: result.plannerRunId,
        planId: result.planId,
        status: 'completed',
      },
      '计划已标记完成',
      {
        plannerRunIds: [result.plannerRunId],
      },
    )
  } catch (error) {
    return createErrorResult<CompletePlannerData>(
      'COMPLETE_PLANNER_ERROR',
      error instanceof Error ? error.message : 'Failed to complete planner run',
      true,
      '标记计划完成失败',
    )
  }
}
