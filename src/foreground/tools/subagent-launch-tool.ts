/**
 * Foreground Tool: Launch Subagent
 * Extracted from foreground-kernel-runner handleDispatchSubagent
 */

import type { RuntimeDispatcher, DispatchResult } from '../../dispatcher/types.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import { buildLaunchSubagentAction, inferSubagentType } from '../../subagents/action-mapper.js'

export const LAUNCH_SUBAGENT_TOOL_ID = 'foreground_launch_subagent'

export interface LaunchSubagentDeps {
  runtimeDispatcher: RuntimeDispatcher
  userId: string
  sessionId: string
  turnId: string
}

export interface LaunchSubagentInput {
  objective: string
  agentType: string
  suggestedTools?: string[]
}

export interface LaunchSubagentData {
  runtimeActionId: string
  agentType: string
  dispatchResult: DispatchResult
}

/**
 * Handle launching a subagent from the foreground.
 * Creates a server-side RuntimeAction and dispatches it to the subagent runtime.
 */
export async function handleLaunchSubagent(
  deps: LaunchSubagentDeps,
  input: LaunchSubagentInput,
): Promise<ForegroundToolResult<LaunchSubagentData>> {
  try {
    const agentType =
      input.agentType ||
      inferSubagentType({
        message: input.objective,
        suggestedTools: input.suggestedTools,
      })

    const runtimeAction = buildLaunchSubagentAction({
      agentType,
      taskSpec: {
        objective: input.objective,
        agentType,
        tools: input.suggestedTools,
      },
      userId: deps.userId,
      sessionId: deps.sessionId,
      sourceRef: {
        sourceType: 'foreground_turn',
        turnId: deps.turnId,
      },
    })

    const dispatchResult = await deps.runtimeDispatcher.dispatch({
      requestId: deps.turnId,
      action: runtimeAction,
      context: {
        callerModule: 'foreground_subagent_launch_tool',
        userId: deps.userId,
        sessionId: deps.sessionId,
      },
    })

    return createSuccessResult(
      {
        runtimeActionId: runtimeAction.actionId,
        agentType,
        dispatchResult,
      },
      'Subagent launched successfully.',
      {
        runtimeActionIds: [runtimeAction.actionId],
      },
    )
  } catch (error) {
    return createErrorResult(
      'DISPATCH_SUBAGENT_ERROR',
      error instanceof Error ? error.message : 'Failed to dispatch subagent',
      false,
      'Failed to launch subagent.',
    )
  }
}
