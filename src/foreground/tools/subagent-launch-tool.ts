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
import type { ContextBundle } from '../../context/types.js'

export const LAUNCH_SUBAGENT_TOOL_ID = 'foreground_launch_subagent'

export interface LaunchSubagentDeps {
  runtimeDispatcher: RuntimeDispatcher
  userId: string
  sessionId: string
  turnId: string
  profileRegistry: AgentProfileRegistry
  /** Parent dispatch AbortSignal — cascades cancellation into the child subagent kernel. */
  signal?: AbortSignal
}

export interface LaunchSubagentInput {
  objective: string
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType?: string
  /** Capability profile identifier. Validated against AgentProfileRegistry. */
  agentProfile?: string
  suggestedTools?: string[]
  /**
   * Optional child-session task ID. When provided, the launch resumes the
   * existing child session instead of creating a fresh one (additive; wired
   * by the child-session runtime, not by this facade).
   */
  taskId?: string
  /**
   * Optional launch mode override. true = background (return immediately,
   * persist an exactly-once completion notification); false/default =
   * foreground (wait for the bounded terminal result).
   */
  background?: boolean
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
      agentType = normalized.agentProfile
    } else if (rawLabel) {
      deps.profileRegistry.assertAllowed(rawLabel)
      agentProfile = rawLabel
      agentType = rawLabel
    } else {
      const inferred = inferSubagentType({
        message: input.objective,
        suggestedTools: input.suggestedTools,
      })
      agentProfile = inferred.agentProfile
      agentType = inferred.agentProfile
    }

    const parentContext: ContextBundle = {
      bundleId: `bundle-${deps.turnId}`,
      runId: deps.turnId,
      agentId: 'foreground',
      agentType: 'main',
      userId: deps.userId,
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 0,
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
      parentContext,
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
        ...(deps.signal ? { signal: deps.signal } : {}),
      },
    })

    if (dispatchResult.status !== 'completed') {
      const errorMsg = dispatchResult.error?.message || 'Dispatch failed'
      return createErrorResult(
        dispatchResult.error?.code || 'DISPATCH_SUBAGENT_FAILED',
        errorMsg,
        true,
        `Subagent dispatch failed: ${errorMsg}`,
        { runtimeActionIds: [runtimeAction.actionId] },
      )
    }

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
