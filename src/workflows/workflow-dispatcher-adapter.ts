/**
 * Workflow Dispatcher Adapter
 *
 * Bridges WorkflowRuntime's simplified dispatcher interface with the real RuntimeDispatcher.
 *
 * DESIGN DECISION: Dual Action Records
 * - workflow-runtime.ts pre-saves a tracking action for workflow-local state
 * - This adapter creates a separate dispatch action for actual execution
 * - The dispatch action is the one that gets executed by the dispatcher
 * - The tracking action serves as workflow-local state for step tracking
 * - This trade-off is acceptable given the constraint to not modify WorkflowRuntime internals
 */

import type { RuntimeDispatcher, DispatchResult, RuntimeActionType, TargetRuntime } from '../dispatcher/types.js'
import type { RuntimeActionState, Source, TargetRef } from '../storage/runtime-action-store.js'

/**
 * Simplified dispatcher interface expected by WorkflowRuntime.
 */
interface WorkflowRuntimeDispatcher {
  dispatch(request: {
    actionType: RuntimeActionType
    targetRuntime: string
    targetAction: string
    payload: Record<string, unknown>
    userId?: string
    sessionId?: string
    correlationId?: string
  }): Promise<{ success: boolean; result?: unknown; error?: string }>
}

/**
 * Generates a unique ID for actions and requests.
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Creates an adapter that bridges WorkflowRuntime's simplified dispatcher interface
 * with the real RuntimeDispatcher.
 *
 * @param runtimeDispatcher - The actual RuntimeDispatcher instance
 * @returns A dispatcher compatible with WorkflowRuntime's interface
 */
export function createWorkflowDispatcherAdapter(runtimeDispatcher: RuntimeDispatcher): WorkflowRuntimeDispatcher {
  return {
    async dispatch(request) {
      const requestId = generateId()
      const actionId = generateId()
      const now = new Date().toISOString()

      const action: {
        actionId: string
        actionType: RuntimeActionType
        idempotencyKey?: string
        source: Source
        targetRuntime: TargetRuntime
        targetAction: string
        payload: Record<string, unknown>
        correlationId?: string
        causationId?: string
        sessionId?: string
        userId?: string
        targetRef: TargetRef
        status: RuntimeActionState
        statusMessage?: string
        result?: Record<string, unknown>
        createdAt: string
        updatedAt: string
      } = {
        actionId,
        actionType: request.actionType,
        targetRuntime: request.targetRuntime as TargetRuntime,
        targetAction: request.targetAction,
        payload: request.payload,
        userId: request.userId,
        sessionId: request.sessionId,
        correlationId: request.correlationId,
        source: {
          sourceModule: 'workflow',
          sourceAction: 'execute_step',
        },
        targetRef: {},
        status: 'created',
        createdAt: now,
        updatedAt: now,
      }

      const context = {
        userId: request.userId,
        sessionId: request.sessionId,
        callerModule: 'workflow',
      }

      const result: DispatchResult = await runtimeDispatcher.dispatch({
        requestId,
        action,
        context,
      })

      return {
        success: result.status === 'completed',
        result: result.result,
        error: result.status === 'failed' ? result.error?.message : undefined,
      }
    },
  }
}
