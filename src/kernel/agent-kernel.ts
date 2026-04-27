import type { LLMRequest, LLMResponse, LLMMessage } from '../llm/types.js';
import type { ContextBundle, ContextItem } from '../context/types.js';
import type {
  KernelRunInput,
  KernelRunResult,
  KernelRunState,
  KernelConfig,
  ToolUseRequest,
  ToolUseResult,
  KernelTranscriptEntry,
  CompactTriggerResult,
} from './types.js';

export class AgentKernel {
  private config: KernelConfig;

  constructor(config: KernelConfig) {
    this.config = config;
  }

  async run(input: KernelRunInput): Promise<KernelRunResult> {
    const state = this.initializeState(input);
    const maxIterations = input.maxIterations ?? this.config.maxIterations;
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs;

    if (timeoutMs <= 0) {
      state.status = 'failed';
      return this.buildResult(state, 'timeout');
    }

    const startTime = Date.now();

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        state.currentIteration = iteration + 1;

        if (Date.now() - startTime > timeoutMs) {
          state.status = 'failed';
          return this.buildResult(state, 'timeout');
        }

        const llmRequest = this.buildLLMRequest(input.contextBundle, state);
        this.commitTranscript(state, 'llm_request', {
          model: llmRequest.model,
          messages: llmRequest.messages,
        });

        const llmResult = await this.config.llmAdapter.complete(llmRequest);

        if (!llmResult.success) {
          state.status = 'failed';
          this.commitTranscript(state, 'error', {
            code: llmResult.error.code,
            message: llmResult.error.message,
          });
          return this.buildResult(state, 'failed', {
            code: llmResult.error.code,
            message: llmResult.error.message,
          });
        }

        const llmResponse = llmResult.response;
        this.commitTranscript(state, 'llm_response', {
          id: llmResponse.id,
          content: llmResponse.content,
          toolCalls: llmResponse.toolCalls,
          finishReason: llmResponse.finishReason,
        });

        if (this.hasToolCalls(llmResponse)) {
          const toolUseRequests = this.parseToolUseRequests(llmResponse);
          state.toolCalls.push(...toolUseRequests);

          for (const toolRequest of toolUseRequests) {
            this.commitTranscript(state, 'tool_call', toolRequest);
            const toolResult = await this.dispatchTool(toolRequest, input.contextBundle);
            this.commitTranscript(state, 'tool_result', toolResult);
            this.mergeToolResult(state, toolRequest, toolResult);
          }

          const compactResult = this.checkCompactTrigger(input.contextBundle, state);
          if (compactResult.shouldCompact) {
            this.commitTranscript(state, 'compact', compactResult);
          }

          continue;
        }

        if (llmResponse.content) {
          state.status = 'completed';
          return this.buildResult(state, 'completed', undefined, llmResponse.content);
        }
      }

      state.status = 'failed';
      return this.buildResult(state, 'max_iterations_reached');
    } catch (error) {
      state.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.commitTranscript(state, 'error', { message: errorMessage });
      return this.buildResult(state, 'failed', {
        code: 'KERNEL_ERROR',
        message: errorMessage,
      });
    }
  }

  private initializeState(input: KernelRunInput): KernelRunState {
    return {
      currentIteration: 0,
      status: 'running',
      contextItems: [...input.contextBundle.orderedItems, ...input.contextBundle.pinnedItems],
      startTime: Date.now(),
      toolCalls: [],
      transcript: [],
    };
  }

  private buildLLMRequest(contextBundle: ContextBundle, state: KernelRunState): LLMRequest {
    const messages: LLMMessage[] = [];

    for (const item of contextBundle.pinnedItems) {
      messages.push(this.contextItemToMessage(item));
    }

    for (const item of contextBundle.orderedItems) {
      messages.push(this.contextItemToMessage(item));
    }

    for (const entry of state.transcript) {
      if (entry.type === 'llm_response' && (entry.content as { content?: string }).content) {
        messages.push({
          role: 'assistant',
          content: (entry.content as { content: string }).content,
        });
      } else if (entry.type === 'tool_result') {
        const toolResult = entry.content as ToolUseResult;
        messages.push({
          role: 'tool',
          content: toolResult.error
            ? `Error: ${toolResult.error.message}`
            : JSON.stringify(toolResult.result),
          toolCallId: toolResult.toolCallId,
        });
      }
    }

    return {
      model: 'default-model',
      messages,
      temperature: 0.7,
    };
  }

  private contextItemToMessage(item: ContextItem): LLMMessage {
    const roleMap: Record<string, 'system' | 'user' | 'assistant' | 'tool'> = {
      instruction: 'system',
      fact: 'user',
      tool_output: 'tool',
    };

    return {
      role: roleMap[item.semanticType] || 'user',
      content: item.content,
    };
  }

  private hasToolCalls(response: LLMResponse): boolean {
    return response.toolCalls !== undefined && response.toolCalls.length > 0;
  }

  private parseToolUseRequests(response: LLMResponse): ToolUseRequest[] {
    if (!response.toolCalls) {
      return [];
    }

    return response.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      params: this.safeParseParams(toolCall.function.arguments),
    }));
  }

  private safeParseParams(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async dispatchTool(
    toolRequest: ToolUseRequest,
    contextBundle: ContextBundle
  ): Promise<ToolUseResult> {
    const dispatchResult = await this.config.dispatcher.dispatch({
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      action: {
        actionId: `action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        actionType: 'execute_tool',
        targetRuntime: 'tool_plane',
        targetAction: {
          toolName: toolRequest.toolName,
          params: toolRequest.params,
        },
        source: {
          sourceModule: 'agent_kernel',
          sourceAction: 'run',
        },
        userId: contextBundle.runId,
        createdAt: new Date().toISOString(),
        status: 'pending',
      },
      context: {
        callerModule: 'agent_kernel',
        userId: contextBundle.runId,
      },
    });

    if (dispatchResult.status === 'completed') {
      return {
        toolCallId: toolRequest.toolCallId,
        result: dispatchResult.result,
      };
    } else {
      return {
        toolCallId: toolRequest.toolCallId,
        result: null,
        error: dispatchResult.error || {
          code: 'DISPATCH_FAILED',
          message: 'Tool dispatch failed',
          recoverable: false,
        },
      };
    }
  }

  private mergeToolResult(
    state: KernelRunState,
    toolRequest: ToolUseRequest,
    toolResult: ToolUseResult
  ): void {
    const content = toolResult.error
      ? `Tool ${toolRequest.toolName} failed: ${toolResult.error.message}`
      : `Tool ${toolRequest.toolName} result: ${JSON.stringify(toolResult.result)}`;

    const item: ContextItem = {
      itemId: `tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sourceType: 'tool_result',
      semanticType: 'tool_output',
      content,
      estimatedTokens: Math.ceil(content.length / 4),
      freshnessTs: new Date().toISOString(),
    };

    state.contextItems.push(item);
  }

  private checkCompactTrigger(
    contextBundle: ContextBundle,
    state: KernelRunState
  ): CompactTriggerResult {
    const threshold = this.config.compactThreshold ?? 0.8;
    const tokenEstimate = contextBundle.tokenEstimate;
    const usedTokens = state.contextItems.reduce(
      (sum, item) => sum + (item.estimatedTokens || 0),
      0
    );

    const utilizationRatio = usedTokens / (tokenEstimate || 1);

    if (utilizationRatio > threshold && contextBundle.compactHints?.shouldCompactSoon) {
      return {
        shouldCompact: true,
        candidateItemIds: contextBundle.compactHints.candidateItemIds,
        mustKeepItemIds: contextBundle.compactHints.mustKeepItemIds,
      };
    }

    return { shouldCompact: false };
  }

  private commitTranscript(
    state: KernelRunState,
    type: KernelTranscriptEntry['type'],
    content: unknown
  ): void {
    const entry: KernelTranscriptEntry = {
      iteration: state.currentIteration,
      timestamp: new Date().toISOString(),
      type,
      content,
    };
    state.transcript.push(entry);
  }

  private buildResult(
    state: KernelRunState,
    finalStatus: KernelRunResult['finalStatus'],
    error?: { code: string; message: string },
    finalResponse?: string
  ): KernelRunResult {
    return {
      finalStatus,
      finalResponse,
      iterationsUsed: state.currentIteration,
      toolCalls: state.toolCalls,
      transcript: state.transcript,
      error,
    };
  }
}
