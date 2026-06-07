/**
 * Status Query Tool
 * Foreground tool for querying active work status
 */

import type { RuntimeDispatcher, DispatchResult } from '../../dispatcher/types.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'

export const STATUS_QUERY_TOOL_ID = 'foreground_status_query'

/**
 * Status query response data
 */
export interface StatusQueryData {
  runtimeActionId: string
  statusText: string
}

/**
 * Dependencies for status query tool
 */
export interface StatusQueryDeps {
  runtimeDispatcher: RuntimeDispatcher
  userId: string
  sessionId: string
  turnId: string
}

/**
 * Handle status query - queries active work status via runtime dispatcher
 */
export async function handleStatusQuery(
  deps: StatusQueryDeps,
  userMessage?: string,
): Promise<ForegroundToolResult<StatusQueryData>> {
  const { runtimeDispatcher, userId, sessionId, turnId } = deps

  try {
    // Create runtime action server-side
    const now = new Date().toISOString()
    const runtimeAction = {
      actionId: `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      actionType: 'query_active_work' as const,
      targetRuntime: 'gateway' as const,
      targetAction: 'query',
      source: {
        sourceModule: 'foreground_status_query_tool' as const,
        sourceAction: 'status_query',
      },
      userId,
      sessionId,
      targetRef: {},
      payload: {
        queryType: 'active_work_status',
        includeDetails: true,
      },
      createdAt: now,
      updatedAt: now,
      status: 'created' as const,
    }

    // Dispatch via runtime dispatcher
    const dispatchResult: DispatchResult = await runtimeDispatcher.dispatch({
      requestId: turnId,
      action: runtimeAction,
      context: {
        callerModule: 'foreground_status_query_tool',
        userId,
        sessionId,
      },
    })

    // Extract status text from dispatch result
    const statusText =
      dispatchResult.status === 'completed'
        ? dispatchResult.result
          ? `Status: ${typeof dispatchResult.result === 'string' ? dispatchResult.result : JSON.stringify(dispatchResult.result)}`
          : 'Status check completed.'
        : dispatchResult.status === 'failed'
          ? `Status check failed: ${dispatchResult.error?.message || 'Unknown error'}`
          : 'Status check is pending.'

    return createSuccessResult<StatusQueryData>(
      {
        runtimeActionId: runtimeAction.actionId,
        statusText,
      },
      userMessage || statusText,
      {
        runtimeActionIds: [runtimeAction.actionId],
      },
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return createErrorResult<StatusQueryData>(
      'STATUS_QUERY_FAILED',
      errorMessage,
      false,
      'Status check failed due to an error.',
    )
  }
}
