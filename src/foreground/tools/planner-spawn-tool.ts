/**
 * Planner Spawn Tool
 * Handles spawning a new planner run from the foreground
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunResult } from '../../planner/types.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const SPAWN_PLANNER_TOOL_ID = 'foreground_spawn_planner'

export interface SpawnPlannerDeps {
  plannerRuntime: PlannerRuntime
  userId: string
  sessionId: string
}

export interface SpawnPlannerInput {
  objective: string
  estimatedSteps?: number
  complexity?: string
  reason?: string
}

export interface SpawnPlannerData {
  plannerRunId: string
  planId: string
  estimatedSteps?: number
}

/**
 * Handles spawning a new planner run
 */
export async function handleSpawnPlanner(
  deps: SpawnPlannerDeps,
  input: SpawnPlannerInput,
): Promise<ForegroundToolResult<SpawnPlannerData>> {
  try {
    const result: PlannerRunResult = deps.plannerRuntime.createPlannerRun({
      objective: input.objective,
      userId: deps.userId,
      sessionId: deps.sessionId,
      contextBundle: {
        estimatedSteps: input.estimatedSteps,
        complexity: input.complexity,
        reason: input.reason,
      },
    })

    return createSuccessResult<SpawnPlannerData>(
      {
        plannerRunId: result.plannerRunId,
        planId: result.planId,
        estimatedSteps: input.estimatedSteps,
      },
      `I've created a plan to ${input.objective.toLowerCase().replace(/^i've created a plan to /i, '')}. You can check back for updates. (Plan ID: ${result.planId})`,
      {
        plannerRunIds: [result.plannerRunId],
      },
    )
  } catch (error) {
    return createErrorResult<SpawnPlannerData>(
      'SPAWN_PLANNER_ERROR',
      error instanceof Error ? error.message : 'Failed to spawn planner',
      true,
      'Failed to create a plan for your request.',
    )
  }
}
