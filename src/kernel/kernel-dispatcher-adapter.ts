/**
 * Kernel Dispatcher Adapter
 *
 * Bridges AgentKernel's dispatcher interface with the real RuntimeDispatcher.
 */

import type { RuntimeDispatcher as DispatcherRuntimeDispatcher, DispatchResult, RuntimeActionType, TargetRuntime } from '../dispatcher/types.js';
import type { RuntimeDispatcher as KernelRuntimeDispatcher } from '../kernel/types.js';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

export function createKernelDispatcherAdapter(
  runtimeDispatcher: DispatcherRuntimeDispatcher
): KernelRuntimeDispatcher {
  return {
    async dispatch(request) {
      const requestId = request.requestId ?? generateId();
      const actionId = request.action.actionId ?? generateId();
      const now = new Date().toISOString();

      const action = {
        actionId,
        actionType: request.action.actionType as RuntimeActionType,
        targetRuntime: request.action.targetRuntime as TargetRuntime,
        targetAction: request.action.targetAction?.toolName ?? 'execute',
        payload: {
          ...((request.action.targetAction?.params as Record<string, unknown>) ?? {}),
          toolCallId: request.action.targetAction?.toolCallId,
          toolName: request.action.targetAction?.toolName,
        },
        userId: request.action.userId,
        sessionId: request.context.sessionId,
        source: request.action.source,
        targetRef: {},
        status: 'created' as const,
        createdAt: now,
        updatedAt: now,
      };

      const context = {
        userId: request.context.userId ?? request.action.userId,
        sessionId: request.context.sessionId,
        callerModule: request.context.callerModule,
      };

      const result: DispatchResult = await runtimeDispatcher.dispatch({
        requestId,
        action,
        context,
      });

      return {
        requestId: result.requestId,
        actionId: result.actionId,
        status: result.status,
        targetRuntime: result.targetRuntime,
        result: result.result,
        error: result.error,
        createdAt: result.createdAt,
        completedAt: result.completedAt,
      };
    },
  };
}