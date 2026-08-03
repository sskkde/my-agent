/**
 * Foreground Tool: Cancel or Modify Task
 * Extracted from foreground-kernel-runner handleCancelOrModifyTask
 */

import type { RuntimeDispatcher, RuntimeAction } from '../../dispatcher/types.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { SubagentRunStore } from '../../storage/subagent-run-store.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import { generateId, ACTION_ID_PREFIX } from '../../shared/ids.js'
import type { ChildSessionTaskRuntime } from '../../subagents/child-session-task-runtime.js'

export const CANCEL_MODIFY_TOOL_ID = 'foreground_cancel_or_modify_task'

export interface CancelModifyDeps {
  runtimeDispatcher: RuntimeDispatcher
  plannerRunStore: PlannerRunStore
  subagentRunStore: SubagentRunStore
  userId: string
  sessionId: string
  turnId: string
  /**
   * Unified child-session runtime. When wired, cancel/modify operations on
   * child-task runs resolve through it (cancelRun aborts the live child
   * kernel); the legacy dispatcher path stays the fallback.
   */
  childSessionTaskRuntime?: ChildSessionTaskRuntime
}

export interface CancelModifyInput {
  plannerRunId?: string
  runtimeActionId?: string
  /** Child-session task id (identity rule: taskId === childSessionId). */
  taskId?: string
  /** Child-session id (equivalent to taskId). */
  childSessionId?: string
  reason: string
  interruptType: 'cancel' | 'pause' | 'resume' | 'modify'
}

export interface CancelModifyData {
  runtimeActionId: string
  actionType:
    | 'cancel_planner_run'
    | 'cancel_background_subagent'
    | 'pause_planner_run'
    | 'resume_planner_run'
    | 'pause_background_subagent'
    | 'resume_background_subagent'
  targetRef: { runId: string }
}

export type InterruptActionType =
  | 'cancel_planner_run'
  | 'cancel_background_subagent'
  | 'pause_planner_run'
  | 'resume_planner_run'
  | 'pause_background_subagent'
  | 'resume_background_subagent'

/**
 * Handle canceling or modifying a task (planner run or subagent run).
 * Enforces user authorization - users can only cancel/modify their own tasks.
 */
export async function handleCancelOrModifyTask(
  deps: CancelModifyDeps,
  input: CancelModifyInput,
): Promise<ForegroundToolResult<CancelModifyData>> {
  try {
    if (input.plannerRunId) {
      const run = deps.plannerRunStore.getById(input.plannerRunId)
      if (!run) {
        return createErrorResult('TASK_NOT_FOUND', `Planner run not found: ${input.plannerRunId}`, true)
      }
      if (run.userId !== deps.userId) {
        return createErrorResult('UNAUTHORIZED_CANCEL', `Cannot cancel planner run belonging to another user`, false)
      }
      return await runCancelModifyDispatch(deps, input, { targetWorkId: input.plannerRunId, isPlannerRun: true })
    }

    // New child-task ids: taskId / childSessionId (identity rule: equal).
    if (input.taskId !== undefined || input.childSessionId !== undefined) {
      return await cancelChildTask(deps, input, input.taskId ?? input.childSessionId!)
    }

    if (input.runtimeActionId) {
      const run = deps.subagentRunStore.getById(input.runtimeActionId)
      if (!run) {
        return createErrorResult('TASK_NOT_FOUND', `Subagent run not found: ${input.runtimeActionId}`, true)
      }
      if (run.userId !== deps.userId) {
        return createErrorResult('UNAUTHORIZED_CANCEL', `Cannot cancel subagent run belonging to another user`, false)
      }
      // Child-task run: cancel through the unified runtime (aborts the live
      // child kernel). Legacy runs keep the dispatcher path.
      if (run.childSessionId && deps.childSessionTaskRuntime) {
        return await cancelChildRun(deps, input, run.subagentRunId)
      }
      return await runCancelModifyDispatch(deps, input, { targetWorkId: input.runtimeActionId, isPlannerRun: false })
    }

    return createErrorResult(
      'TASK_NOT_FOUND',
      'No plannerRunId, taskId or runtimeActionId provided',
      true,
      'I need more details about what to cancel. There are multiple active tasks.',
    )
  } catch (error) {
    return createErrorResult(
      'CANCEL_MODIFY_ERROR',
      error instanceof Error ? error.message : 'Failed to cancel/modify task',
      false,
      'Failed to complete the task operation.',
    )
  }
}

/**
 * Resolve a child task by its taskId/childSessionId and cancel its newest run
 * attempt through the unified runtime. Unknown or foreign taskIds fail with a
 * typed code BEFORE any mutation.
 */
function cancelChildTask(
  deps: CancelModifyDeps,
  input: CancelModifyInput,
  childId: string,
): Promise<ForegroundToolResult<CancelModifyData>> {
  const child = deps.childSessionTaskRuntime?.getChildSession(childId)
  if (!child) {
    return Promise.resolve(
      createErrorResult('TASK_NOT_FOUND', `Subagent task not found: ${childId}`, true, 'Unknown task.'),
    )
  }
  if (child.userId !== deps.userId) {
    return Promise.resolve(
      createErrorResult(
        'UNAUTHORIZED_CANCEL',
        `Cannot cancel task belonging to another user`,
        false,
        'Cannot cancel a task owned by another user.',
      ),
    )
  }
  const run = deps.subagentRunStore.query({ childSessionId: childId, userId: deps.userId })[0]
  if (!run) {
    return Promise.resolve(
      createErrorResult('TASK_NOT_FOUND', `No subagent run found for task: ${childId}`, true, 'Unknown task.'),
    )
  }
  return cancelChildRun(deps, input, run.subagentRunId)
}

/**
 * Cancel a child-task run through the unified runtime (aborts the live child
 * kernel — no orphan) and return the audit result with a server-side runtime
 * action id. No dispatcher round-trip: the legacy subagent adapter does not
 * know child-task runs.
 */
function cancelChildRun(
  deps: CancelModifyDeps,
  input: CancelModifyInput,
  subagentRunId: string,
): Promise<ForegroundToolResult<CancelModifyData>> {
  try {
    deps.childSessionTaskRuntime!.cancelRun(subagentRunId)
    const runtimeAction = createCancelOrModifyRuntimeAction({
      targetWorkId: subagentRunId,
      isPlannerRun: false,
      interruptType: input.interruptType,
      reason: input.reason,
      userId: deps.userId,
      sessionId: deps.sessionId,
    })
    return Promise.resolve(
      createSuccessResult(
        {
          runtimeActionId: runtimeAction.actionId,
          actionType: 'cancel_background_subagent',
          targetRef: { runId: subagentRunId },
        },
        'Task operation completed successfully.',
        {
          runtimeActionIds: [runtimeAction.actionId],
        },
      ),
    )
  } catch (error) {
    return Promise.resolve(
      createErrorResult(
        'CANCEL_MODIFY_ERROR',
        error instanceof Error ? error.message : 'Failed to cancel/modify task',
        false,
        'Failed to complete the task operation.',
      ),
    )
  }
}

async function runCancelModifyDispatch(
  deps: CancelModifyDeps,
  input: CancelModifyInput,
  target: { targetWorkId: string; isPlannerRun: boolean },
): Promise<ForegroundToolResult<CancelModifyData>> {
  const { targetWorkId, isPlannerRun } = target

  const runtimeAction = createCancelOrModifyRuntimeAction({
    targetWorkId,
    isPlannerRun,
    interruptType: input.interruptType,
    reason: input.reason,
    userId: deps.userId,
    sessionId: deps.sessionId,
  })

  await deps.runtimeDispatcher.dispatch({
    requestId: deps.turnId,
    action: runtimeAction,
    context: {
      callerModule: 'foreground_cancel_modify_tool',
      userId: deps.userId,
      sessionId: deps.sessionId,
    },
  })

  return createSuccessResult(
    {
      runtimeActionId: runtimeAction.actionId,
      actionType: runtimeAction.targetAction as CancelModifyData['actionType'],
      targetRef: { runId: targetWorkId },
    },
    'Task operation completed successfully.',
    {
      runtimeActionIds: [runtimeAction.actionId],
    },
  )
}

function createCancelOrModifyRuntimeAction(params: {
  targetWorkId: string
  isPlannerRun: boolean
  interruptType: 'cancel' | 'pause' | 'resume' | 'modify'
  reason: string
  userId: string
  sessionId: string
}): RuntimeAction {
  const { targetWorkId, isPlannerRun, interruptType, reason, userId, sessionId } = params
  const now = new Date().toISOString()

  let actionType: InterruptActionType
  let targetRuntime: 'planner_runtime' | 'subagent_runtime'

  if (isPlannerRun) {
    targetRuntime = 'planner_runtime'
    switch (interruptType) {
      case 'cancel':
        actionType = 'cancel_planner_run'
        break
      case 'pause':
        actionType = 'pause_planner_run'
        break
      case 'resume':
        actionType = 'resume_planner_run'
        break
      case 'modify':
        actionType = 'cancel_planner_run'
        break
    }
  } else {
    targetRuntime = 'subagent_runtime'
    switch (interruptType) {
      case 'cancel':
        actionType = 'cancel_background_subagent'
        break
      case 'pause':
        actionType = 'pause_background_subagent'
        break
      case 'resume':
        actionType = 'resume_background_subagent'
        break
      case 'modify':
        actionType = 'cancel_background_subagent'
        break
    }
  }

  return {
    actionId: generateId(ACTION_ID_PREFIX),
    actionType: actionType as RuntimeAction['actionType'],
    targetRuntime,
    targetAction: actionType,
    source: {
      sourceModule: 'foreground_cancel_modify_tool',
      sourceAction: 'cancel_or_modify_task',
    },
    userId,
    sessionId,
    targetRef: { runId: targetWorkId },
    payload: { reason },
    createdAt: now,
    updatedAt: now,
    status: 'created',
  }
}
