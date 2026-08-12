/**
 * Planner Resume Tool
 * Handles resuming an existing planner run from the foreground
 */

import type { PlannerRuntime } from '../../planner/planner-runtime.js'
import type { PlannerRunRecord, PlannerRunStore } from '../../storage/planner-run-store.js'
import type { BackgroundRuntime } from '../../subagents/background-runtime.js'
import type { BackgroundRunStore } from '../../storage/background-run-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import { CHILD_TASK_LAUNCH_SOURCE } from '../../subagents/child-task-policy.js'
import type { Checkpoint } from '../../planner/types.js'
import { PLANNER_CHILD_PROFILE_ID } from './planner-spawn-tool.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const RESUME_PLANNER_TOOL_ID = 'foreground_resume_planner'

export interface ResumePlannerDeps {
  plannerRuntime: PlannerRuntime
  plannerRunStore: PlannerRunStore
  backgroundRuntime?: BackgroundRuntime
  backgroundRunStore?: BackgroundRunStore
  sessionStore?: SessionStore
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
  backgroundRunId?: string
}

/**
 * Resolve the child session id of the previous background execution of this
 * planner run so the resumed child reuses the same conversation shell. Reuse
 * is skipped when the link is missing or the child session is no longer
 * resumable (archived/closed) — the resumed run then starts a fresh session.
 */
function resolveResumeTaskId(
  run: PlannerRunRecord,
  deps: Pick<ResumePlannerDeps, 'backgroundRunStore' | 'sessionStore'>,
): string | undefined {
  if (!run.backgroundRunId || !deps.backgroundRunStore || !deps.sessionStore) {
    return undefined
  }
  const priorRun = deps.backgroundRunStore.getById(run.backgroundRunId)
  if (!priorRun?.taskId) {
    return undefined
  }
  const childSession = deps.sessionStore.getChildSessionById(priorRun.taskId)
  if (!childSession || childSession.status === 'archived' || childSession.status === 'closed') {
    return undefined
  }
  return priorRun.taskId
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

    const resumeResult = deps.plannerRuntime.resumePlannerRun(input.plannerRunId, {
      eventType: 'user_resume',
      payload: {
        userMessage: input.userMessage,
        timestamp: input.timestamp,
      },
    })

    let backgroundRunId: string | undefined
    if (deps.backgroundRuntime) {
      const checkpoint = (run.checkpoint ?? null) as Checkpoint | null
      const objective =
        resumeResult.context?.objective ?? checkpoint?.objective ?? `Resume planner run ${input.plannerRunId}`
      const taskId = resolveResumeTaskId(run, deps)
      backgroundRunId = deps.backgroundRuntime.enqueueBackgroundRun({
        userId: deps.userId,
        sessionId: deps.sessionId,
        agentType: PLANNER_CHILD_PROFILE_ID,
        agentProfile: PLANNER_CHILD_PROFILE_ID,
        taskSpec: {
          objective,
          profileId: PLANNER_CHILD_PROFILE_ID,
          plannerRunId: input.plannerRunId,
          planId: run.planId,
          parentSessionId: deps.sessionId,
          launchMode: 'background',
          maxIterations: 12,
          timeoutMs: 180_000,
        },
        launchSource: CHILD_TASK_LAUNCH_SOURCE,
        ...(taskId ? { taskId } : {}),
      })
    }

    const data: ResumePlannerData = {
      plannerRunId: input.plannerRunId,
      status: 'resumed',
    }
    if (backgroundRunId) {
      data.backgroundRunId = backgroundRunId
    }

    return createSuccessResult<ResumePlannerData>(
      data,
      backgroundRunId
        ? `I've resumed work on your existing plan and re-queued it for background execution (bg ${backgroundRunId}).`
        : "I've resumed work on your existing plan.",
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
