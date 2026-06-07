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

export const CANCEL_MODIFY_TOOL_ID = 'foreground_cancel_or_modify_task'

export interface CancelModifyDeps {
  runtimeDispatcher: RuntimeDispatcher
  plannerRunStore: PlannerRunStore
  subagentRunStore: SubagentRunStore
  userId: string
  sessionId: string
  turnId: string
}

export interface CancelModifyInput {
  plannerRunId?: string
  runtimeActionId?: string
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
    const targetWorkId = input.plannerRunId ?? input.runtimeActionId

    if (!targetWorkId) {
      return createErrorResult(
        'TASK_NOT_FOUND',
        'No plannerRunId or runtimeActionId provided',
        true,
        'I need more details about what to cancel. There are multiple active tasks.',
      )
    }

    const isPlannerRun = !!input.plannerRunId

    if (isPlannerRun && input.plannerRunId) {
      const run = deps.plannerRunStore.getById(input.plannerRunId)
      if (!run) {
        return createErrorResult('TASK_NOT_FOUND', `Planner run not found: ${input.plannerRunId}`, true)
      }
      if (run.userId !== deps.userId) {
        return createErrorResult('UNAUTHORIZED_CANCEL', `Cannot cancel planner run belonging to another user`, false)
      }
    } else if (input.runtimeActionId) {
      const run = deps.subagentRunStore.getById(input.runtimeActionId)
      if (!run) {
        return createErrorResult('TASK_NOT_FOUND', `Subagent run not found: ${input.runtimeActionId}`, true)
      }
      if (run.userId !== deps.userId) {
        return createErrorResult('UNAUTHORIZED_CANCEL', `Cannot cancel subagent run belonging to another user`, false)
      }
    }

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
  } catch (error) {
    return createErrorResult(
      'CANCEL_MODIFY_ERROR',
      error instanceof Error ? error.message : 'Failed to cancel/modify task',
      false,
      'Failed to complete the task operation.',
    )
  }
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
