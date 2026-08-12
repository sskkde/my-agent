/**
 * Planner Spawn Tool
 * Spawns a planner run and enqueues a background planner child that generates
 * the plan, executes it and writes progress back (auto-closing loop).
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunResult } from '../../planner/types.js'
import type { PlanStep } from '../../storage/plan-store.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { BackgroundRuntime } from '../../subagents/background-runtime.js'
import { CHILD_TASK_LAUNCH_SOURCE } from '../../subagents/child-task-policy.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const SPAWN_PLANNER_TOOL_ID = 'foreground_spawn_planner'

export const PLANNER_CHILD_PROFILE_ID = 'planner'

export interface SpawnPlannerDeps {
  plannerRuntime: PlannerRuntime
  plannerRunStore?: PlannerRunStore
  backgroundRuntime?: BackgroundRuntime
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
  steps: PlanStep[]
  backgroundRunId?: string
  status: 'queued' | 'planning'
}

/**
 * Spawn a planner run and enqueue its auto-execution as a background planner
 * child. The child generates the plan (LLM with deterministic fallback),
 * persists it into plan_store, executes it and writes progress back; the
 * parent receives a completion notification via the background runtime.
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

    let backgroundRunId: string | undefined
    if (deps.backgroundRuntime) {
      backgroundRunId = deps.backgroundRuntime.enqueueBackgroundRun({
        userId: deps.userId,
        sessionId: deps.sessionId,
        agentType: PLANNER_CHILD_PROFILE_ID,
        agentProfile: PLANNER_CHILD_PROFILE_ID,
        taskSpec: {
          objective: input.objective,
          profileId: PLANNER_CHILD_PROFILE_ID,
          plannerRunId: result.plannerRunId,
          planId: result.planId,
          parentSessionId: deps.sessionId,
          launchMode: 'background',
          maxIterations: 12,
          timeoutMs: 180_000,
        },
        launchSource: CHILD_TASK_LAUNCH_SOURCE,
      })

      // Best-effort link so a later resume can find this background run and
      // reuse its child session. A write-back failure must not fail the spawn.
      if (deps.plannerRunStore) {
        try {
          deps.plannerRunStore.updateBackgroundRunId(result.plannerRunId, backgroundRunId)
        } catch {
          // ignore: linkage is an optimization, not a spawn contract
        }
      }
    }

    return createSuccessResult<SpawnPlannerData>(
      {
        plannerRunId: result.plannerRunId,
        planId: result.planId,
        estimatedSteps: input.estimatedSteps,
        steps: result.steps,
        backgroundRunId,
        status: backgroundRunId ? 'queued' : 'planning',
      },
      backgroundRunId
        ? `Planner run ${result.plannerRunId} created (plan ${result.planId}) and enqueued for background execution (bg ${backgroundRunId}). It will generate a plan, execute it step by step and write progress back; you will be notified when it completes.`
        : `Planner run ${result.plannerRunId} created (plan ${result.planId}). Background execution is not available in this environment.`,
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
