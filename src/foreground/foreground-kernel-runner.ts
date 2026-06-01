import type { ForegroundTurnInput, ForegroundTurnResult, ForegroundExecutionResult, RedactedKernelResult } from './foreground-runner-types.js';
import type { ForegroundAgent } from './foreground-agent.js';
import type { ForegroundDecision } from './types.js';
import type { AgentKernel } from '../kernel/agent-kernel.js';
import type { KernelRunInput, KernelRunResult } from '../kernel/types.js';
import type { RuntimeDispatcher } from '../dispatcher/types.js';
import type { PlannerRuntime } from '../planner/planner-runtime.js';
import type { LLMAdapter } from '../llm/adapter.js';
import type { LLMMessage } from '../llm/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import type { TurnTranscript } from '../storage/transcript-store.js';
import type { EventStore } from '../storage/event-store.js';
import type { SearchSubagent, SearchSubagentInput } from '../search/search-subagent.js';
import { buildContextBundleFromForegroundState } from './context-bundle-builder.js';
import { buildKernelConfigFromDeps, isForegroundContextManager } from './kernel-config-builder.js';
import { mapSuggestedToolsToProjection } from './tool-projection-mapper.js';
import { getToolCatalog, getToolDefinitions } from '../api/tool-catalog.js';
import { buildLaunchSubagentAction, inferSubagentType } from '../subagents/action-mapper.js';
import type { SubagentResult } from '../subagents/types.js';

export interface ForegroundKernelRunnerDeps {
  foregroundAgent: ForegroundAgent;
  agentKernel: AgentKernel;
  runtimeDispatcher: RuntimeDispatcher;
  plannerRuntime: PlannerRuntime;
  llmAdapter: LLMAdapter;
  searchSubagent?: SearchSubagent;
  agentConfig?: AgentConfig;
  eventStore?: EventStore;
}

export interface ForegroundKernelRunner {
  runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult>;
}

export class ForegroundKernelRunnerImpl implements ForegroundKernelRunner {
  private deps: ForegroundKernelRunnerDeps;

  constructor(deps: ForegroundKernelRunnerDeps) {
    this.deps = deps;
  }

  async runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult> {
    try {
      const fgMessageInput = {
        message: input.message,
        userId: input.userId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        timestamp: input.timestamp,
      };

      const decision = await this.deps.foregroundAgent.processMessage(
        fgMessageInput,
        input.foregroundState
      );

      const decisionTrace: ForegroundDecision = {
        route: decision.route,
        requiresPlanner: decision.requiresPlanner,
        reason: decision.reason,
        userVisibleResponse: decision.userVisibleResponse,
        targetRef: decision.targetRef,
        runtimeAction: decision.runtimeAction,
        estimatedSteps: decision.estimatedSteps,
        suggestedTools: decision.suggestedTools,
        complexity: decision.complexity,
      };

      let executionResult: ForegroundExecutionResult;

      switch (decision.route) {
        case 'answer_directly':
          executionResult = await this.handleAnswerDirectly(decision, input);
          break;
        case 'status_query':
          executionResult = await this.handleStatusQuery(decision, input);
          break;
        case 'dispatch_tool':
          executionResult = await this.handleDispatchTool(decision, input);
          break;
        case 'spawn_planner':
          executionResult = await this.handleSpawnPlanner(decision, input);
          break;
        case 'cancel_or_modify_task':
          executionResult = await this.handleCancelOrModifyTask(decision, input);
          break;
        case 'resume_existing_planner':
          executionResult = await this.handleResumeExistingPlanner(decision, input);
          break;
        case 'approval_handler':
          executionResult = { route: 'approval_handler', finalResponse: decision.userVisibleResponse || 'Processing approval...' };
          break;
        case 'dispatch_subagent':
          executionResult = await this.handleDispatchSubagent(decision, input);
          break;
        default:
          executionResult = await this.handleAnswerDirectly(decision, input);
          break;
      }

      return {
        status: executionResult.error ? 'failed' : 'completed',
        finalResponse: executionResult.finalResponse,
        decisionTrace,
        kernelResult: buildRedactedKernelResult(executionResult.kernelResult),
        runtimeSummary: executionResult.runtimeSummary,
        error: executionResult.error,
      };
    } catch (error) {
      const fallbackDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Unhandled exception in runTurn',
      };

      return {
        status: 'failed',
        finalResponse: '',
        decisionTrace: fallbackDecision,
        error: {
          code: 'UNHANDLED_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error in foreground kernel runner',
        },
      };
    }
  }

  private emitFailureEvent(
    input: ForegroundTurnInput,
    eventType: string,
    errorCode: string,
    errorMessage: string,
    fallbackBehavior: string,
    sourceModule: import('../storage/event-store.js').SourceModule = 'foreground_agent',
  ): void {
    if (!this.deps.eventStore) return;

    const eventId = `evt-${eventType}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    try {
      this.deps.eventStore.append({
        eventId,
        eventType,
        sourceModule,
        userId: input.userId,
        sessionId: input.sessionId,
        correlationId: input.turnId,
        payload: {
          errorCode,
          errorMessage,
          fallbackBehavior,
          turnId: input.turnId,
        },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Event emission should never block the foreground response path.
      // Swallow silently — the error is already surfaced via ForegroundExecutionResult.error.
    }
  }

  private async handleAnswerDirectly(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const messages = this.buildDirectAnswerMessages(input);
      const model = input.agentConfig?.model ?? this.deps.agentConfig?.model ?? '';
      const llmResult = await this.deps.llmAdapter.complete({
        model,
        messages,
      });

      if (llmResult.success && llmResult.response.content) {
        return {
          route: 'answer_directly',
          finalResponse: llmResult.response.content,
        };
      }
    } catch {
      console.warn('[ForegroundKernelRunner] LLM call in answer_directly failed, falling back to userVisibleResponse');
    }

    return {
      route: 'answer_directly',
      finalResponse: decision.userVisibleResponse || 'I understand.',
    };
  }

  private buildDirectAnswerMessages(input: ForegroundTurnInput): LLMMessage[] {
    const messages: LLMMessage[] = [];
    const history = input.foregroundState.conversationHistory;
    if (history && history.length > 0) {
      for (const entry of history) {
        messages.push({ role: entry.role, content: entry.message });
      }
    }
    messages.push({ role: 'user', content: input.message });
    return messages;
  }

  private async buildFailureAwareResponse(
    decision: ForegroundDecision,
    input: ForegroundTurnInput,
    errorCode: string,
    errorMessage: string,
  ): Promise<string> {
    const model = input.foregroundState.resolvedModel ?? input.agentConfig?.model ?? this.deps.agentConfig?.model ?? '';
    const suggestedTools = decision.suggestedTools?.length ? decision.suggestedTools.join(', ') : 'none';
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: [
          'You are handling a failed tool-use turn.',
          'The assistant had already decided that a tool/action was needed, but the tool loop failed before a usable tool result was produced.',
          'Explain the failure to the user in natural language, do not pretend the tool succeeded, and suggest a concrete next step.',
          'Keep the response concise and avoid exposing secrets or raw stack traces.',
        ].join(' '),
      },
      { role: 'user', content: input.message },
      {
        role: 'assistant',
        content: `I intended to handle this via route ${decision.route} using suggested tools: ${suggestedTools}.`,
      },
      {
        role: 'user',
        content: `Tool/action failure context: ${errorCode}: ${errorMessage}`,
      },
    ];

    try {
      const llmResult = await this.deps.llmAdapter.complete({ model, messages });
      if (llmResult.success && llmResult.response.content) {
        return llmResult.response.content;
      }
    } catch {
      // Fall through to explicit deterministic error text.
    }

    return `抱歉，工具调用没有成功完成（${errorCode}）：${errorMessage}。请检查模型/工具配置后重试。`;
  }

  private async handleDispatchTool(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const suggestedTools = decision.suggestedTools ?? [];

      if (
        this.deps.searchSubagent &&
        suggestedTools.length === 1 &&
        suggestedTools[0] === 'web_search'
      ) {
        try {
          const searchInput: SearchSubagentInput = {
            query: input.message,
            userId: input.userId,
            sessionId: input.sessionId,
          };
          const searchResult = await this.deps.searchSubagent.execute(searchInput);

          if (searchResult.success) {
            return {
              route: 'dispatch_tool',
              finalResponse: searchResult.answer,
              runtimeSummary: {
                toolCallSummaries: [{
                  toolCallId: `search-${input.turnId}`,
                  toolName: 'web_search',
                  status: 'completed',
                }],
              },
            };
          }

          this.emitFailureEvent(
            input,
            'search_subagent_failure',
            searchResult.errorCode,
            searchResult.message,
            'kernel_execution',
          );
        } catch (searchError) {
          console.warn('[ForegroundKernelRunner] searchSubagent execution failed, falling back to AgentKernel');
          this.emitFailureEvent(
            input,
            'search_subagent_failure',
            'SEARCH_SUBAGENT_EXCEPTION',
            searchError instanceof Error ? searchError.message : 'searchSubagent execution threw',
            'kernel_execution',
          );
        }
      }

      // Full AgentKernel path
      const toolCatalog = getToolCatalog().map(t => t.name);
      const toolDefinitions = getToolDefinitions();
      const toolProjection = mapSuggestedToolsToProjection(suggestedTools, toolCatalog);
      toolProjection.tools = toolDefinitions.filter(t => toolProjection.toolIds.includes(t.function.name));
      const contextBundle = buildContextBundleFromForegroundState(input.foregroundState, input);
      const agentConfig = input.agentConfig ?? input.foregroundState.agentConfig ?? this.deps.agentConfig;
      const kernelConfig = buildKernelConfigFromDeps(this.deps as unknown as import('../processing/processor-orchestration.js').ProcessorOrchestrationDeps, agentConfig);

      if (isForegroundContextManager(kernelConfig.contextManager)) {
        kernelConfig.contextManager.setForegroundContext(input.foregroundState, input);
      }

      const kernelInput: KernelRunInput = {
        contextBundle,
        runId: input.turnId,
        agentId: 'foreground',
        agentType: 'main',
        userId: input.userId,
        sessionId: input.sessionId,
        toolProjection,
        maxIterations: 5,
        timeoutMs: agentConfig?.routingTimeoutMs ?? this.deps.agentConfig?.routingTimeoutMs ?? 60000,
        model: input.foregroundState.resolvedModel ?? agentConfig?.model ?? undefined,
      };

      const kernelResult = await this.deps.agentKernel.run(kernelInput);

      // SECURITY: Treat all non-completed statuses as failure (timeout, max_iterations_reached, failed)
      if (kernelResult.finalStatus !== 'completed') {
        const errorCode = kernelResult.error?.code ?? 
          (kernelResult.finalStatus === 'timeout' ? 'KERNEL_TIMEOUT' : 
           kernelResult.finalStatus === 'max_iterations_reached' ? 'KERNEL_MAX_ITERATIONS' : 'KERNEL_RUN_FAILED');
        const errorMessage = kernelResult.error?.message ?? 
          (kernelResult.finalStatus === 'timeout' ? 'Kernel execution timed out' :
           kernelResult.finalStatus === 'max_iterations_reached' ? 'Kernel reached maximum iterations' : 'Kernel execution failed');
        
        this.emitFailureEvent(
          input,
          'kernel_dispatch_failure',
          errorCode,
          errorMessage,
          'llm_error_context',
        );

        const failureAwareResponse = await this.buildFailureAwareResponse(
          decision,
          input,
          errorCode,
          errorMessage,
        );

        return {
          route: 'dispatch_tool',
          finalResponse: failureAwareResponse,
          runtimeSummary: buildRuntimeSummary(kernelResult),
          error: {
            code: errorCode,
            message: errorMessage,
          },
        };
      }

      return {
        route: 'dispatch_tool',
        finalResponse: kernelResult.finalResponse || decision.userVisibleResponse || 'Tool execution completed.',
        runtimeSummary: buildRuntimeSummary(kernelResult),
        kernelResult,
      };
    } catch (error) {
      const errorCode = 'DISPATCH_TOOL_ERROR';
      const errorMessage = error instanceof Error ? error.message : 'Failed to dispatch tool';

      this.emitFailureEvent(
        input,
        'dispatch_tool_failure',
        errorCode,
        errorMessage,
        'llm_error_context',
      );

      const failureAwareResponse = await this.buildFailureAwareResponse(
        decision,
        input,
        errorCode,
        errorMessage,
      );

      return {
        route: 'dispatch_tool',
        finalResponse: failureAwareResponse,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      };
    }
  }

  private async handleStatusQuery(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const runtimeAction = decision.runtimeAction ?? this.createServerStatusQueryAction(input);

      const dispatchResult = await this.deps.runtimeDispatcher.dispatch({
        requestId: input.turnId,
        action: runtimeAction,
        context: {
          callerModule: 'foreground_kernel_runner',
          userId: input.userId,
          sessionId: input.sessionId,
        },
      });

      const statusText = dispatchResult.status === 'completed'
        ? dispatchResult.result
          ? `Status: ${typeof dispatchResult.result === 'string' ? dispatchResult.result : JSON.stringify(dispatchResult.result)}`
          : 'Status check completed.'
        : dispatchResult.status === 'failed'
          ? `Status check failed: ${dispatchResult.error?.message || 'Unknown error'}`
          : 'Status check is pending.';

      return {
        route: 'status_query',
        finalResponse: decision.userVisibleResponse || statusText,
        runtimeSummary: {
          runtimeActionIds: [runtimeAction.actionId],
        },
      };
    } catch {
      console.warn('[ForegroundKernelRunner] status_query dispatch failed, returning fallback response');
      return {
        route: 'status_query',
        finalResponse: decision.userVisibleResponse || 'Status check failed due to an error.',
      };
    }
  }

  private createServerStatusQueryAction(input: ForegroundTurnInput) {
    const now = new Date().toISOString();
    return {
      actionId: `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      actionType: 'query_active_work' as const,
      targetRuntime: 'gateway' as const,
      targetAction: 'query',
      source: {
        sourceModule: 'foreground_kernel_runner' as const,
        sourceAction: 'status_query',
      },
      userId: input.userId,
      sessionId: input.sessionId,
      targetRef: {},
      payload: {
        queryType: 'active_work_status',
        includeDetails: true,
      },
      createdAt: now,
      updatedAt: now,
      status: 'created' as const,
    };
  }

  private async handleSpawnPlanner(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const objective = decision.userVisibleResponse || input.message;

      const plannerResult = this.deps.plannerRuntime.createPlannerRun({
        objective,
        userId: input.userId,
        sessionId: input.sessionId,
        contextBundle: {
          estimatedSteps: decision.estimatedSteps,
          complexity: decision.complexity,
          reason: decision.reason,
        },
      });

      return {
        route: 'spawn_planner',
        finalResponse: `I've created a plan to ${objective.toLowerCase().replace(/^i've created a plan to /i, '')}. You can check back for updates. (Plan ID: ${plannerResult.planId})`,
        runtimeSummary: {
          plannerRunIds: [plannerResult.plannerRunId],
        },
      };
    } catch (error) {
      return {
        route: 'spawn_planner',
        finalResponse: decision.userVisibleResponse || 'Failed to create a plan for your request.',
        error: {
          code: 'SPAWN_PLANNER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to spawn planner',
        },
      };
    }
  }

  private async handleCancelOrModifyTask(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const runtimeAction = decision.runtimeAction ?? this.createCancelRuntimeAction(decision, input);

      if (!runtimeAction) {
        return {
          route: 'cancel_or_modify_task',
          finalResponse: decision.userVisibleResponse || 'I need more details about what to cancel. There are multiple active tasks.',
        };
      }

      await this.deps.runtimeDispatcher.dispatch({
        requestId: input.turnId,
        action: runtimeAction,
        context: {
          callerModule: 'foreground_kernel_runner',
          userId: input.userId,
          sessionId: input.sessionId,
        },
      });

      return {
        route: 'cancel_or_modify_task',
        finalResponse: decision.userVisibleResponse || 'The task has been cancelled.',
      };
    } catch (error) {
      return {
        route: 'cancel_or_modify_task',
        finalResponse: decision.userVisibleResponse || 'Failed to cancel the task.',
        error: {
          code: 'CANCEL_MODIFY_ERROR',
          message: error instanceof Error ? error.message : 'Failed to cancel/modify task',
        },
      };
    }
  }

  private createCancelRuntimeAction(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): import('../dispatcher/types.js').RuntimeAction | undefined {
    if (!decision.targetRef) return undefined;
    const now = new Date().toISOString();
    const targetWorkId = decision.targetRef.plannerRunId ?? decision.targetRef.runtimeActionId;
    if (!targetWorkId) return undefined;

    const isPlannerRun = !!decision.targetRef.plannerRunId;
    const actionType: 'cancel_planner_run' | 'cancel_background_subagent' = isPlannerRun ? 'cancel_planner_run' : 'cancel_background_subagent';
    return {
      actionId: `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      actionType,
      targetRuntime: isPlannerRun ? 'planner_runtime' : 'subagent_runtime',
      targetAction: actionType,
      source: { sourceModule: 'foreground_kernel_runner', sourceAction: 'cancel_or_modify_task' },
      userId: input.userId,
      sessionId: input.sessionId,
      targetRef: { runId: targetWorkId },
      payload: { reason: decision.reason },
      createdAt: now,
      updatedAt: now,
      status: 'created',
    };
  }

  private async handleResumeExistingPlanner(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const plannerRunId = decision.targetRef?.plannerRunId;

      if (!plannerRunId) {
        return {
          route: 'resume_existing_planner',
          finalResponse: decision.userVisibleResponse || 'No existing plan found to resume.',
        };
      }

      this.deps.plannerRuntime.resumePlannerRun(plannerRunId, {
        eventType: 'user_resume',
        payload: {
          userMessage: input.message,
          timestamp: input.timestamp,
        },
      });

      return {
        route: 'resume_existing_planner',
        finalResponse: "I've resumed work on your existing plan.",
        runtimeSummary: {
          plannerRunIds: [plannerRunId],
        },
      };
    } catch (error) {
      return {
        route: 'resume_existing_planner',
        finalResponse: error instanceof Error ? error.message : 'Failed to resume the existing plan.',
        error: {
          code: 'RESUME_PLANNER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to resume planner',
        },
      };
    }
  }

  private async handleDispatchSubagent(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): Promise<ForegroundExecutionResult> {
    try {
      const runtimeAction = decision.runtimeAction ?? this.createServerSubagentAction(decision, input);

      const dispatchResult = await this.deps.runtimeDispatcher.dispatch({
        requestId: input.turnId,
        action: runtimeAction,
        context: {
          callerModule: 'foreground_kernel_runner',
          userId: input.userId,
          sessionId: input.sessionId,
        },
      });

      if (dispatchResult.status === 'completed' && dispatchResult.result) {
        const subagentResult = dispatchResult.result as SubagentResult;
        return {
          route: 'dispatch_subagent',
          finalResponse: subagentResult.response || decision.userVisibleResponse || 'Subagent completed.',
          runtimeSummary: {
            runtimeActionIds: [runtimeAction.actionId],
          },
        };
      }

      return {
        route: 'dispatch_subagent',
        finalResponse: decision.userVisibleResponse || 'Subagent dispatch completed.',
        runtimeSummary: {
          runtimeActionIds: [runtimeAction.actionId],
        },
      };
    } catch (error) {
      return {
        route: 'dispatch_subagent',
        finalResponse: decision.userVisibleResponse || 'Failed to dispatch subagent.',
        error: {
          code: 'DISPATCH_SUBAGENT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to dispatch subagent',
        },
      };
    }
  }

  private createServerSubagentAction(
    decision: ForegroundDecision,
    input: ForegroundTurnInput
  ): import('../dispatcher/types.js').RuntimeAction {
    const agentType = inferSubagentType({
      message: input.message,
      suggestedTools: decision.suggestedTools,
    });

    return buildLaunchSubagentAction({
      agentType,
      taskSpec: {
        objective: input.message,
        agentType,
        tools: decision.suggestedTools,
      },
      userId: input.userId,
      sessionId: input.sessionId,
      sourceRef: {
        sourceType: 'foreground_turn',
        turnId: input.turnId,
      },
    });
  }
}

export function buildRuntimeSummary(
  kernelResult?: KernelRunResult
): TurnTranscript['runtimeSummary'] | undefined {
  if (kernelResult?.toolCalls && kernelResult.toolCalls.length > 0) {
    const status: 'completed' | 'failed' = 
      kernelResult.finalStatus === 'failed' || kernelResult.finalStatus === 'timeout'
        ? 'failed'
        : 'completed';
    
    return {
      toolCallSummaries: kernelResult.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status,
      })),
    };
  }
  return undefined;
}

export function buildRedactedKernelResult(
  kernelResult?: KernelRunResult
): RedactedKernelResult | undefined {
  if (!kernelResult) return undefined;
  return {
    finalStatus: kernelResult.finalStatus,
    finalResponse: kernelResult.finalResponse,
    iterationsUsed: kernelResult.iterationsUsed,
    toolCallCount: kernelResult.toolCalls.length,
  };
}

export function createForegroundKernelRunner(deps: ForegroundKernelRunnerDeps): ForegroundKernelRunner {
  return new ForegroundKernelRunnerImpl(deps);
}
