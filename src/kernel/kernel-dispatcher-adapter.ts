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

      const toolDispatchRequest = request.action.targetAction?.toolDispatchRequest;
      const firstToolUse = toolDispatchRequest?.toolUses[0];

      const action = {
        actionId,
        actionType: request.action.actionType as RuntimeActionType,
        targetRuntime: request.action.targetRuntime as TargetRuntime,
        targetAction: request.action.targetAction?.toolName ?? 'execute',
        payload: {
          toolCallId: request.action.targetAction?.toolCallId,
          toolName: request.action.targetAction?.toolName,
          params: request.action.targetAction?.params,
          toolDispatchRequest,
          ...(toolDispatchRequest ? {
            toolUses: toolDispatchRequest.toolUses.map(toolUse => ({
              toolCallId: toolUse.toolCallId,
              toolName: toolUse.toolName,
              params: toolUse.input,
              kernelRunId: toolDispatchRequest.runId,
              timeoutMs: toolDispatchRequest.executionPolicy.timeoutMs,
            })),
            toolCallId: firstToolUse?.toolCallId,
            toolName: firstToolUse?.toolName,
            params: firstToolUse?.input,
          } : {}),
          runId: request.context.kernelRunId,
          userId: request.context.userId ?? request.action.userId,
          sessionId: request.context.sessionId,
          kernelRunId: request.context.kernelRunId,
          agentId: request.context.agentId,
          agentType: request.context.agentType,
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
