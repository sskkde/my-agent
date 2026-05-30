/**
 * Kernel Config Builder for Foreground Runner
 * Builds KernelConfig from ProcessorOrchestrationDeps.
 *
 * @module foreground/kernel-config-builder
 */

import type { KernelConfig, ToolExecutor, ContextManager } from '../kernel/types.js';
import type { ProcessorOrchestrationDeps } from '../processing/processor-orchestration.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import type { ForegroundTurnInput } from './foreground-runner-types.js';
import type { ContextBundle, ContextItem, RuntimeContextDelta } from '../context/types.js';
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js';
import { createKernelDispatcherAdapter } from '../kernel/kernel-dispatcher-adapter.js';
import { buildContextBundleFromForegroundState } from './context-bundle-builder.js';

/**
 * ForegroundContextManager - ContextManager implementation for foreground runner.
 * Stores ForegroundSessionState and ForegroundTurnInput to build ContextBundle on demand.
 */
export class ForegroundContextManager implements ContextManager {
  private state: {
    foregroundState?: import('./types.js').ForegroundSessionState;
    turnInput?: ForegroundTurnInput;
    items: ContextItem[];
  } = { items: [] };

  /**
   * Set the foreground context for bundle building.
   * Must be called before assembleBundle() to have meaningful context.
   */
  setForegroundContext(
    foregroundState: import('./types.js').ForegroundSessionState,
    turnInput: ForegroundTurnInput
  ): void {
    this.state.foregroundState = foregroundState;
    this.state.turnInput = turnInput;
  }

  assembleBundle(): ContextBundle {
    if (this.state.foregroundState && this.state.turnInput) {
      return buildContextBundleFromForegroundState(
        this.state.foregroundState,
        this.state.turnInput
      );
    }


    return {
      bundleId: `cb-${Date.now()}`,
      runId: 'pending',
      agentId: 'foreground',
      agentType: 'main',
      userId: 'unknown',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      summaryBlocks: [],
      tokenEstimate: 100,
    };
  }

  getItems(): ContextItem[] {
    return this.state.items;
  }

  addItem(item: ContextItem): void {
    this.state.items.push(item);
  }

  applyDelta(delta: RuntimeContextDelta): void {
    for (const item of delta.items) {
      this.state.items.push(item);
    }
  }
}

/**
 * Creates a ToolExecutor adapter that delegates to the runtime dispatcher.
 */
function createToolExecutorAdapter(deps: ProcessorOrchestrationDeps): ToolExecutor {
  return {
    async execute(request) {
      const requestId = `te-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const actionId = `action-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date().toISOString();


      const dispatchRequest = {
        requestId,
        action: {
          actionId,
          actionType: 'execute_tool' as const,
          targetRuntime: 'tool_plane' as const,
          targetAction: 'execute',
          payload: {
            toolName: request.toolName,
            params: request.params,
            toolCallId: request.toolCallId,
            userId: request.userId,
            sessionId: request.sessionId,
            kernelRunId: request.kernelRunId,
            permissionContext: request.permissionContext,
          },
          source: {
            sourceModule: 'foreground_kernel_runner',
            sourceAction: 'tool_executor_execute',
          },
          userId: request.userId,
          sessionId: request.sessionId,
          createdAt: now,
          updatedAt: now,
          status: 'created' as const,
        },
        context: {
          callerModule: 'foreground_kernel_runner',
          userId: request.userId,
          sessionId: request.sessionId,
        },
      };

      try {
        const result = await deps.runtimeDispatcher.dispatch(dispatchRequest);

        if (result.status === 'completed') {
          return {
            success: true,
            data: result.result,
            resultPreview: typeof result.result === 'string' ? result.result.slice(0, 200) : undefined,
          };
        } else {
          return {
            success: false,
            error: result.error ?? {
              code: 'tool_execution_failed',
              message: 'Tool execution failed',
              recoverable: true,
            },
          };
        }
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'tool_execution_error',
            message: error instanceof Error ? error.message : 'Unknown error',
            recoverable: true,
          },
        };
      }
    },
  };
}

/**
 * Creates a minimal ModelInputBuilder.
 * Note: This is a stub implementation. A full implementation would require
 * templateRegistry and templateLoader from deps.
 */
function createMinimalModelInputBuilder(): ModelInputBuilder {
  // Stub: PromptTemplateRegistry and TemplateLoader not available in ProcessorOrchestrationDeps
  return {
    async build(input) {
      const messages: import('../llm/types.js').LLMMessage[] = [];

      if (input.systemPrompt) {
        messages.push({ role: 'system', content: input.systemPrompt });
      }

      if (input.currentUserMessage) {
        messages.push({ role: 'user', content: input.currentUserMessage });
      }

      if (input.transcript && input.transcript.length > 0) {
        for (const msg of input.transcript) {
          messages.push(msg);
        }
      }

      return {
        messages,
        segments: {
          staticPrefix: '',
          tenantProject: input.systemPrompt ?? '',
          toolPlane: '',
          contextBundle: input.currentUserMessage ?? '',
        },
        segmentHashes: {
          segmentA: '',
          segmentB: '',
          segmentC: '',
          segmentD: '',
        },
        metadata: {
          mode: input.mode,
          agentKind: input.agentKind,
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      };
    },
  } as ModelInputBuilder;
}

/**
 * Builds a KernelConfig from ProcessorOrchestrationDeps.
 *
 * This function creates all necessary adapters to convert the foreground
 * runner's dependencies into a KernelConfig suitable for AgentKernel execution.
 *
 * @param deps - The processor orchestration dependencies
 * @param agentConfig - Optional agent configuration for model/timeout settings
 * @returns A KernelConfig ready for AgentKernel instantiation
 */
export function buildKernelConfigFromDeps(
  deps: ProcessorOrchestrationDeps,
  agentConfig?: AgentConfig
): KernelConfig {
  const toolExecutor = createToolExecutorAdapter(deps);
  const contextManager = new ForegroundContextManager();
  const dispatcher = createKernelDispatcherAdapter(deps.runtimeDispatcher);
  const modelInputBuilder = createMinimalModelInputBuilder();

  return {
    llmAdapter: deps.llmAdapter,
    toolExecutor,
    contextManager,
    dispatcher,
    modelInputBuilder,
    maxIterations: 5,
    timeoutMs: agentConfig?.routingTimeoutMs ?? 60000,
    defaultModel: agentConfig?.model ?? undefined,
  };
}

/**
 * Type guard to check if a ContextManager is a ForegroundContextManager.
 * Useful for ForegroundKernelRunner to access setForegroundContext method.
 */
export function isForegroundContextManager(
  manager: ContextManager
): manager is ForegroundContextManager {
  return manager instanceof ForegroundContextManager;
}
