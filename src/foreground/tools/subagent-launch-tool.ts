/**
 * Foreground Tool: Launch Subagent
 * Extracted from foreground-kernel-runner handleDispatchSubagent
 */

import type { RuntimeDispatcher, DispatchResult } from '../../dispatcher/types.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import { buildLaunchSubagentAction, inferSubagentType } from '../../subagents/action-mapper.js'
import { normalizeAgentLabel, isKnownAgentLabel } from '../../taxonomy/agent-label-normalizer.js'
import type { AgentProfileRegistry } from '../../taxonomy/agent-profile-registry.js'

export const LAUNCH_SUBAGENT_TOOL_ID = 'foreground_launch_subagent'

export interface LaunchSubagentDeps {
  runtimeDispatcher: RuntimeDispatcher
  userId: string
  sessionId: string
  turnId: string
  profileRegistry: AgentProfileRegistry
}

export interface LaunchSubagentInput {
  objective: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType?: string
  /** Capability profile identifier. Validated against AgentProfileRegistry. */
  agentProfile?: string
  suggestedTools?: string[]
}

export interface LaunchSubagentData {
  runtimeActionId: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /** Capability profile identifier. */
  agentProfile: string
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
    const rawLabel = input.agentProfile ?? input.agentType

    let agentProfile: string
    let agentType: string

    if (rawLabel && isKnownAgentLabel(rawLabel)) {
      const normalized = normalizeAgentLabel(rawLabel)
      agentProfile = normalized.agentProfile
      agentType = normalized.agentType
    } else if (rawLabel) {
      deps.profileRegistry.assertAllowed(rawLabel)
      agentProfile = rawLabel
      agentType = 'subagent'
    } else {
      const inferred = inferSubagentType({
        message: input.objective,
        suggestedTools: input.suggestedTools,
      })
      agentProfile = inferred.agentProfile
      agentType = inferred.agentType
    }

    const runtimeAction = buildLaunchSubagentAction({
      agentType,
      agentProfile,
      taskSpec: {
        objective: input.objective,
        agentType: agentProfile,
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
        agentProfile,
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
