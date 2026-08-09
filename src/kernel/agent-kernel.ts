import type { LLMRequest, LLMResponse, LLMMessage, TokenUsage } from '../llm/types.js'
import type { ContextBundle, ContextItem } from '../context/types.js'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelRunState,
  KernelConfig,
  ToolUseRequest,
  ToolUseResult,
  KernelTranscriptEntry,
  CompactTriggerResult,
  CompactExecutorResult,
  InternalToolHandler,
} from './types.js'
import { resolveProviderFamily, type ModelInputBuildInput } from './model-input/model-input-types.js'
import { projectBundleToData } from './model-input/context-bundle-adapter.js'
import { extractToolsForRequest } from './model-input/model-input-builder.js'
import { applyCompactToBundle } from './model-input/compact-summary-rendering.js'
import { isPromptMemoryP0Enabled, isToolLoopV2Enabled } from '../prompt/feature-flags.js'
import { getPromptMemoryP0Phase } from '../prompt/feature-flag-phase.js'
import { ToolResultPairingGuard } from './tool-result-pairing-guard.js'
import {
  buildToolCallEventId,
  buildToolResultEventId,
  formatToolRunningContent,
  formatToolTerminalContent,
} from '../foreground/tools/transcript-redaction-mapper.js'
import {
  createToolDispatchRequest,
  createToolDispatchResult,
  type ToolExecutionMappedResult,
} from '../tools/runtime/tool-dispatch-contract.js'
import type { RuntimeContextDelta } from '../context/types.js'
import type { ToolExecutionResult } from '../tools/types.js'
import type { TokenStreamPayload } from '../api/types.js'
import type { LLMStreamChunk } from '../llm/types.js'
import { StreamResponseAggregator } from '../llm/stream-aggregator.js'
import { supportsStructuredToolStreaming } from '../llm/stream-capabilities.js'
import { validateOutputContractContent } from '../contracts/output-contract-validator.js'
import { buildDecisionTrace } from './decision-trace-builder.js'

function stateSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRuntimeContextDelta(value: unknown): value is RuntimeContextDelta {
  return (
    isRecord(value) && typeof value.runId === 'string' && typeof value.source === 'string' && Array.isArray(value.items)
  )
}

function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
  return isRecord(value) && typeof value.success === 'boolean'
}

/**
 * Per-tool dispatch timeout overrides (milliseconds).
 * Tools not listed here use the dispatcher default (30s).
 * search_subagent performs two serial LLM calls + web search, so it needs more time.
 * foreground_launch_subagent waits on a bounded child execution (60s default
 * budget) — without this entry the dispatcher 30s race would cut off the wait.
 */
export const PER_TOOL_TIMEOUT_MS: Record<string, number> = {
  search_subagent: 90_000,
  foreground_launch_subagent: 90_000,
}

export class AgentKernel {
  /** Early tool_call live map from the latest streaming LLM call (scheme 1). */
  private pendingEarlyToolLive?: Map<number, { eventId: string; provisionalToolCallId: string; name: string }>

  private config: KernelConfig
  private lastBuiltModelInput?: import('./model-input/model-input-types.js').BuiltModelInput

  constructor(config: KernelConfig) {
    this.config = config
  }

  async run(input: KernelRunInput): Promise<KernelRunResult> {
    const state = this.initializeState(input)
    const maxIterations = input.maxIterations ?? this.config.maxIterations
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs
    const pairingGuard = new ToolResultPairingGuard()
    const aggregatedUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    if (timeoutMs <= 0) {
      state.status = 'failed'
      return this.buildResult(state, 'timeout', undefined, undefined, undefined, input)
    }

    const startTime = Date.now()

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // SIGNAL CHECK 1: iteration start (before increment so pre-aborted returns 0 iterations)
        if (input.signal?.aborted) {
          this.flushPairingGuard(pairingGuard, state, 'cancelled', input)
          state.status = 'cancelled'
          return this.buildResult(state, 'cancelled', undefined, undefined, undefined, input, aggregatedUsage)
        }

        state.currentIteration = iteration + 1

        if (Date.now() - startTime > timeoutMs) {
          this.flushPairingGuard(pairingGuard, state, 'timeout', input)
          state.status = 'failed'
          return this.buildResult(state, 'timeout', undefined, undefined, undefined, input, aggregatedUsage)
        }

        const llmRequest = await this.buildLLMRequest(input, state)
        this.commitTranscript(state, 'llm_request', {
          model: llmRequest.model,
          messages: llmRequest.messages,
        })

        const remainingTimeout = timeoutMs - (Date.now() - startTime)
        const useStreaming = this.shouldUseStreaming(llmRequest)

        // SIGNAL CHECK 2: before LLM call
        if (input.signal?.aborted) {
          this.flushPairingGuard(pairingGuard, state, 'cancelled', input)
          state.status = 'cancelled'
          return this.buildResult(state, 'cancelled', undefined, undefined, undefined, input, aggregatedUsage)
        }

        let llmResult: Awaited<ReturnType<typeof this.callLLMWithTimeout>>

        if (useStreaming) {
          let streamSuccess = false
          let streamResponse: { response: LLMResponse; providerId: string } | undefined
          let streamTimedOut = false
          try {
            const streamResult = await this.callLLMWithStreaming(llmRequest, remainingTimeout, input)
            if (streamResult.success) {
              streamSuccess = true
              streamResponse = { response: streamResult.response, providerId: streamResult.providerId }
              this.pendingEarlyToolLive = streamResult.earlyToolLive
            } else {
              this.pendingEarlyToolLive = undefined
            }
          } catch (streamError) {
            this.pendingEarlyToolLive = undefined
            const errMsg = streamError instanceof Error ? streamError.message : String(streamError)
            if (errMsg.includes('timeout')) {
              streamTimedOut = true
            } else if (errMsg.startsWith('ABORTED:')) {
              throw streamError
            }
            // Non-timeout streaming failures fall through to non-streaming complete().
          }
          if (streamSuccess && streamResponse) {
            llmResult = { success: true, response: streamResponse.response, providerId: streamResponse.providerId }
          } else if (streamTimedOut) {
            this.flushPairingGuard(pairingGuard, state, 'timeout', input)
            state.status = 'failed'
            return this.buildResult(
              state,
              'failed',
              { code: 'KERNEL_ERROR', message: 'LLM stream timeout' },
              undefined,
              undefined,
              input,
              aggregatedUsage,
            )
          } else {
            const fallbackResult = await this.callLLMWithTimeout(llmRequest, remainingTimeout, input.signal)
            if (
              fallbackResult.success &&
              !fallbackResult.response.content &&
              !this.hasToolCalls(fallbackResult.response)
            ) {
              state.status = 'completed'
              return this.buildResult(state, 'completed', undefined, '', undefined, input, aggregatedUsage)
            }
            llmResult = fallbackResult
          }
        } else {
          llmResult = await this.callLLMWithTimeout(llmRequest, remainingTimeout, input.signal)
        }

        if (!llmResult.success) {
          this.flushPairingGuard(pairingGuard, state, 'llm_error', input)
          state.status = 'failed'
          this.commitTranscript(state, 'error', {
            code: llmResult.error.code,
            message: llmResult.error.message,
          })
          return this.buildResult(
            state,
            'failed',
            {
              code: llmResult.error.code,
              message: llmResult.error.message,
            },
            undefined,
            undefined,
            input,
            aggregatedUsage,
          )
        }

        this.config.modelInputSnapshotStore?.record({
          agentKind: this.lastBuiltModelInput!.metadata.agentKind,
          agentType: this.lastBuiltModelInput!.metadata.agentType,
          agentProfile: this.lastBuiltModelInput!.metadata.agentProfile,
          mode: this.lastBuiltModelInput!.metadata.mode,
          builtInput: this.lastBuiltModelInput!,
          response: { content: llmResult.response.content, toolCalls: llmResult.response.toolCalls },
          tokenUsage: llmResult.response.usage,
          provider: this.lastBuiltModelInput!.metadata.providerFamily,
          model: llmRequest.model,
          outputContract: this.lastBuiltModelInput!.metadata.outputContract,
          launchSource: this.lastBuiltModelInput!.metadata.launchSource,
        })

        if (llmResult.response.usage) {
          aggregatedUsage.promptTokens += llmResult.response.usage.promptTokens
          aggregatedUsage.completionTokens += llmResult.response.usage.completionTokens
          aggregatedUsage.totalTokens += llmResult.response.usage.totalTokens
        }

        const llmResponse = llmResult.response
        this.commitTranscript(state, 'llm_response', {
          id: llmResponse.id,
          content: llmResponse.content,
          toolCalls: llmResponse.toolCalls,
          finishReason: llmResponse.finishReason,
        })

        // SIGNAL CHECK 3: after LLM response, before tool dispatch
        if (input.signal?.aborted) {
          this.flushPairingGuard(pairingGuard, state, 'cancelled', input)
          state.status = 'cancelled'
          return this.buildResult(state, 'cancelled', undefined, undefined, undefined, input, aggregatedUsage)
        }

        if (this.hasToolCalls(llmResponse)) {
          const { requests: toolUseRequests, invalidArgs } = this.parseToolUseRequests(llmResponse)
          state.toolCalls.push(...toolUseRequests)
          pairingGuard.trackAssistantToolCalls(toolUseRequests)

          // TRUNCATION GUARD: when finishReason is 'length', the model response hit
          // its token length limit. Synthesize error results for every tool call
          // instead of executing potentially truncated/incomplete arguments.
          if (llmResponse.finishReason === 'length') {
            for (const [toolCallIndex, toolRequest] of toolUseRequests.entries()) {
              this.commitTranscript(state, 'tool_call', toolRequest)
              this.broadcastToolCallRunning(input, toolRequest, toolCallIndex)
              const toolResult: ToolUseResult = {
                toolCallId: toolRequest.toolCallId,
                result: null,
                error: {
                  code: 'TRUNCATED_TOOL_CALL',
                  message: `Tool call '${toolRequest.toolName}' arguments may be truncated because the model response reached the token length limit. Please re-issue the tool call with complete arguments.`,
                  recoverable: true,
                },
              }
              pairingGuard.acceptToolResult(toolResult)
              this.commitTranscript(state, 'tool_result', toolResult)
              this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
              this.mergeToolResult(state, toolRequest, toolResult)
            }
            this.flushPairingGuard(pairingGuard, state, 'iteration_end', input)
            continue
          }

          let shouldStop = false
          let stopStructuredResult: unknown
          const externalBatch: Array<{ toolRequest: ToolUseRequest; toolCallIndex: number }> = []

          for (const [toolCallIndex, toolRequest] of toolUseRequests.entries()) {
            this.commitTranscript(state, 'tool_call', toolRequest)
            this.broadcastToolCallRunning(input, toolRequest, toolCallIndex)

            // INVALID TOOL ARGUMENTS GUARD: if safeParseParams could not parse the
            // tool call's arguments JSON string, synthesize an error result instead
            // of dispatching. Schema validation (SCHEMA_VALIDATION_FAILED) remains
            // in tool-executor and is NOT done here — this catches only JSON syntax
            // failures (unparseable strings, not schema violations).
            const parseError = invalidArgs.get(toolRequest.toolCallId)
            if (parseError !== undefined) {
              const toolResult: ToolUseResult = {
                toolCallId: toolRequest.toolCallId,
                result: null,
                error: {
                  code: 'INVALID_TOOL_ARGUMENTS',
                  message: `Tool call '${toolRequest.toolName}' has invalid JSON arguments: ${parseError}`,
                  recoverable: true,
                },
              }
              pairingGuard.acceptToolResult(toolResult)
              this.commitTranscript(state, 'tool_result', toolResult)
              this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
              this.mergeToolResult(state, toolRequest, toolResult)
              continue
            }

            // INTERNAL HANDLER: flush accumulated external batch first, then handle inline
            const internalHandler = this.resolveInternalToolHandler(toolRequest.toolName, input)
            if (internalHandler) {
              // Flush buffered external tools BEFORE running internal handler
              // to preserve ordering and pairing in transcript
              if (externalBatch.length > 0) {
                await this.dispatchExternalBatch(externalBatch, state, pairingGuard, input)
                externalBatch.length = 0
              }

              try {
                const handlerResult = await internalHandler(toolRequest)
                const toolResult = handlerResult.toolResult
                if (handlerResult.stop) {
                  shouldStop = true
                  stopStructuredResult = handlerResult.structuredResult
                }
                pairingGuard.acceptToolResult(toolResult)
                this.commitTranscript(state, 'tool_result', toolResult)
                this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
                this.mergeToolResult(state, toolRequest, toolResult)

                if (shouldStop) {
                  this.flushPairingGuard(pairingGuard, state, 'internal_handler_stop', input)
                  state.status = 'completed'
                  return this.buildResult(
                    state,
                    'completed',
                    undefined,
                    undefined,
                    stopStructuredResult,
                    input,
                    aggregatedUsage,
                  )
                }
              } catch (handlerError) {
                const toolResult: ToolUseResult = {
                  toolCallId: toolRequest.toolCallId,
                  result: null,
                  error: {
                    code: 'INTERNAL_HANDLER_ERROR',
                    message: handlerError instanceof Error ? handlerError.message : String(handlerError),
                    recoverable: true,
                  },
                }
                pairingGuard.acceptToolResult(toolResult)
                this.commitTranscript(state, 'tool_result', toolResult)
                this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
                this.mergeToolResult(state, toolRequest, toolResult)
              }

              // SIGNAL CHECK 4: after each internal tool handler
              if (input.signal?.aborted) {
                this.flushPairingGuard(pairingGuard, state, 'cancelled', input)
                state.status = 'cancelled'
                return this.buildResult(state, 'cancelled', undefined, undefined, undefined, input, aggregatedUsage)
              }
            } else {
              // UNPROJECTED TOOL GUARD: tool not in projection → synth error, skip dispatch
              if (!this.isCallableProjectedTool(toolRequest.toolName, input)) {
                const toolResult: ToolUseResult = {
                  toolCallId: toolRequest.toolCallId,
                  result: null,
                  error: {
                    code: 'UNPROJECTED_TOOL_CALL',
                    message: `Tool ${toolRequest.toolName} was not projected as callable for this kernel run`,
                    recoverable: false,
                  },
                }
                pairingGuard.acceptToolResult(toolResult)
                this.commitTranscript(state, 'tool_result', toolResult)
                this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
                this.mergeToolResult(state, toolRequest, toolResult)
                continue
              }

              // EXTERNAL PROJECTED TOOL: buffer for batch dispatch
              externalBatch.push({ toolRequest, toolCallIndex })
            }
          }

          // After for loop: flush remaining external tools as ONE batch
          let allTerminated = false
          if (externalBatch.length > 0) {
            allTerminated = await this.dispatchExternalBatch(externalBatch, state, pairingGuard, input)
          }

          this.flushPairingGuard(pairingGuard, state, 'iteration_end', input)

          // TERMINATE CHECK: if ALL external tools returned terminate=true,
          // stop the loop without another LLM call (similar to internal handler stop).
          // Mixed terminate (some true, some false) continues normally.
          if (allTerminated) {
            state.status = 'completed'
            return this.buildResult(state, 'completed', undefined, undefined, undefined, input, aggregatedUsage)
          }

          const compactResult = this.checkCompactTrigger(input.contextBundle, state)
          let executionResult: CompactExecutorResult | undefined
          if (compactResult.shouldCompact && this.config.compactExecutor) {
            executionResult = await this.executeCompact(
              compactResult.candidateItemIds ?? [],
              compactResult.mustKeepItemIds ?? [],
              state,
              input,
            )
          }
          if (compactResult.shouldCompact) {
            const transcriptResult = executionResult
              ? executionResult.status === 'applied'
                ? { status: executionResult.status, compactedItemIds: executionResult.compactedItemIds }
                : executionResult
              : undefined
            this.commitTranscript(state, 'compact', {
              ...compactResult,
              ...(transcriptResult ? { executionResult: transcriptResult } : {}),
            })
          }

          continue
        }

        if (llmResponse.content) {
          const finalContentValidation = this.validateFinalContentIfNeeded(llmResponse.content)
          if (!finalContentValidation.ok) {
            state.status = 'failed'
            this.commitTranscript(state, 'error', {
              code: finalContentValidation.code,
              message: finalContentValidation.message,
              details: finalContentValidation.details,
            })
            return this.buildResult(
              state,
              'failed',
              {
                code: finalContentValidation.code,
                message: finalContentValidation.message,
              },
              undefined,
              undefined,
              input,
              aggregatedUsage,
            )
          }

          state.status = 'completed'
          const completedResult = this.buildResult(
            state,
            'completed',
            undefined,
            llmResponse.content,
            finalContentValidation.structuredResult,
            input,
            aggregatedUsage,
          )
          if (llmResponse.reasoningContent) {
            completedResult.reasoningContent = llmResponse.reasoningContent
          }
          return completedResult
        }
      }

      this.flushPairingGuard(pairingGuard, state, 'max_iterations', input)
      state.status = 'failed'
      return this.buildResult(state, 'max_iterations_reached', undefined, undefined, undefined, input, aggregatedUsage)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Abort detection: when LLM call was cancelled via signal, return cancelled
      if (errorMessage.startsWith('ABORTED:')) {
        this.flushPairingGuard(pairingGuard, state, 'cancelled', input)
        state.status = 'cancelled'
        return this.buildResult(state, 'cancelled', undefined, undefined, undefined, input, aggregatedUsage)
      }

      this.flushPairingGuard(pairingGuard, state, 'kernel_error', input)
      state.status = 'failed'
      const streamingErrorMatch = errorMessage.match(/^STREAMING_ERROR: (.+)$/)
      this.commitTranscript(state, 'error', { message: errorMessage })
      return this.buildResult(
        state,
        'failed',
        {
          code: streamingErrorMatch ? 'STREAMING_ERROR' : 'KERNEL_ERROR',
          message: streamingErrorMatch ? streamingErrorMatch[1] : errorMessage,
        },
        undefined,
        undefined,
        input,
        aggregatedUsage,
      )
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
      compactedItemIds: new Set(),
      compactedToolCallIds: new Set(),
      lastCompactSummaryItem: undefined,
    }
  }

  private async buildLLMRequest(input: KernelRunInput, state: KernelRunState): Promise<LLMRequest> {
    let contextBundleData = projectBundleToData(input.contextBundle)

    if (state.compactedItemIds.size > 0 && state.lastCompactSummaryItem) {
      contextBundleData = applyCompactToBundle(
        contextBundleData,
        [...state.compactedItemIds],
        state.lastCompactSummaryItem,
      ).bundle
    }

    const transcriptMessages = this.buildTranscriptMessages(state)

    let toolSelectionPolicy = input.toolSelectionPolicy
    let personaProjection: import('./model-input/model-input-types.js').PersonaProjection | undefined
    let memoryPolicyProjection: import('./model-input/model-input-types.js').MemoryPolicyProjection | undefined

    if (isPromptMemoryP0Enabled() && this.config.promptProjectionResolver) {
      const projectionResult = await this.config.promptProjectionResolver.resolve({
        agentType: input.agentType,
        providerFamily: resolveProviderFamily(this.config.providerFamily, input.model),
      })
      if (toolSelectionPolicy === undefined) {
        toolSelectionPolicy = projectionResult.toolSelectionPolicy
      }
      personaProjection = projectionResult.personaProjection
      memoryPolicyProjection = projectionResult.memoryPolicyProjection
    }

    const effectiveSkillProjection = input.skillProjection ?? this.config.skillProjection

    const buildInput: ModelInputBuildInput = input.modelInputOverride
      ? {
          ...input.modelInputOverride,
          ...(transcriptMessages.length > 0
            ? { transcript: [...(input.modelInputOverride.transcript ?? []), ...transcriptMessages] }
            : {}),
          ...(input.toolProjection ? { toolProjection: input.toolProjection } : {}),
          ...(effectiveSkillProjection ? { skillProjection: effectiveSkillProjection } : {}),
          ...(isPromptMemoryP0Enabled() && toolSelectionPolicy ? { toolSelectionPolicy } : {}),
          ...(isPromptMemoryP0Enabled() && personaProjection ? { personaProjection } : {}),
          ...(isPromptMemoryP0Enabled() && memoryPolicyProjection ? { memoryPolicyProjection } : {}),
          segmentDBudget: this.config.segmentDBudget,
        }
      : {
          mode: 'function_calling',
          agentType: input.agentType,
          agentProfile: 'default_main',
          providerFamily: resolveProviderFamily(this.config.providerFamily, input.model) ?? 'openai',
          contextBundle: contextBundleData,
          transcript: transcriptMessages,
          currentDate: new Date().toISOString(),
          sessionId: input.sessionId,
          runId: input.runId ?? input.contextBundle.runId,
          toolProjection: input.toolProjection ?? this.config.toolProjection ?? { toolIds: [], tools: [] },
          ...(effectiveSkillProjection ? { skillProjection: effectiveSkillProjection } : {}),
          outputContract: 'output:default-chat.schema',
          ...(isPromptMemoryP0Enabled()
            ? {
                toolSelectionPolicy,
                personaProjection,
                memoryPolicyProjection,
              }
            : {}),
          segmentDBudget: this.config.segmentDBudget,
        }

    const builtInput = await this.config.modelInputBuilder.build(buildInput)
    this.lastBuiltModelInput = builtInput

    const flagPhase = getPromptMemoryP0Phase() ?? null
    const flagName = flagPhase !== null ? 'PROMPT_MEMORY_P0_PHASE' : null

    if (this.config.contextMetricsStore) {
      this.config.contextMetricsStore.record({
        runId: input.runId ?? input.contextBundle.runId,
        agentId: input.agentId,
        sessionId: input.sessionId ?? null,
        timestamp: new Date().toISOString(),
        segmentDTokenEstimate: input.contextBundle.tokenEstimate,
        segmentDTokenActual: Math.ceil(builtInput.segments.contextBundle.length / 4),
        memoryInjectedCount: 0,
        memoryTokenEstimate: 0,
        summaryHitCount: 0,
        summaryTokenEstimate: 0,
        transcriptTokenEstimate: 0,
        pinnedItemCount: input.contextBundle.pinnedItems.length,
        orderedItemCount: input.contextBundle.orderedItems.length,
        droppedContextReasons: builtInput.segments.droppedContextReasons ?? null,
        flagPhase,
        flagName,
      })
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[AgentKernel] buildLLMRequest via ModelInputBuilder:', {
        messageCount: builtInput.messages.length,
        mode: builtInput.metadata.mode,
        agentKind: builtInput.metadata.agentKind,
        providerFamily: builtInput.metadata.providerFamily,
        transcriptEntries: state.transcript.length,
        bundleTokenEstimate: input.contextBundle.tokenEstimate,
        shouldCompactSoon: input.contextBundle.compactHints?.shouldCompactSoon ?? false,
      })
    }

    const tools = extractToolsForRequest(buildInput)

    const llmRequest: LLMRequest = {
      model: input.model ?? this.config.defaultModel ?? 'default-model',
      messages: builtInput.messages,
      temperature: input.temperature ?? 0.7,
      tools,
    }

    if (input.maxTokens !== undefined) {
      llmRequest.maxTokens = input.maxTokens
    }
    if (input.toolChoice !== undefined) {
      llmRequest.toolChoice = input.toolChoice
    }
    if (input.reasoningDepth !== undefined) {
      llmRequest.reasoningDepth = input.reasoningDepth
    }

    return llmRequest
  }

  private buildTranscriptMessages(state: KernelRunState): LLMMessage[] {
    const messages: LLMMessage[] = []

    // Pre-collect toolCallIds from tool_results to ensure tool-result pairing consistency
    const resultToolCallIds = new Set<string>()
    for (const entry of state.transcript) {
      if (entry.type === 'tool_result') {
        const toolResult = entry.content as ToolUseResult
        resultToolCallIds.add(toolResult.toolCallId)
      }
    }

    // Exclude tool results that were compacted away
    const activeResultToolCallIds = new Set([...resultToolCallIds].filter((id) => !state.compactedToolCallIds.has(id)))

    for (const entry of state.transcript) {
      if (entry.type === 'llm_response') {
        const llmContent = entry.content as {
          content?: string
          toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
        }

        const activeToolCalls = llmContent.toolCalls?.filter((tc) => !state.compactedToolCallIds.has(tc.id))
        const hasToolCallsWithResults = activeToolCalls?.some((tc) => activeResultToolCallIds.has(tc.id))
        const hasToolCallsWithoutResults = activeToolCalls?.some((tc) => !activeResultToolCallIds.has(tc.id))

        if (hasToolCallsWithResults) {
          messages.push({
            role: 'assistant',
            content: llmContent.content ?? '',
            toolCalls: activeToolCalls,
          })
        } else if (isToolLoopV2Enabled() && hasToolCallsWithoutResults) {
          messages.push({
            role: 'assistant',
            content: llmContent.content ?? '',
            toolCalls: activeToolCalls,
          })
        } else if (llmContent.content) {
          messages.push({
            role: 'assistant',
            content: llmContent.content,
          })
        }
      } else if (entry.type === 'tool_result') {
        const toolResult = entry.content as ToolUseResult
        if (state.compactedToolCallIds.has(toolResult.toolCallId)) {
          continue
        }
        messages.push({
          role: 'tool',
          content: toolResult.error ? `Error: ${toolResult.error.message}` : JSON.stringify(toolResult.result),
          toolCallId: toolResult.toolCallId,
        })
      }
    }

    return messages
  }

  private hasToolCalls(response: LLMResponse): boolean {
    return response.toolCalls !== undefined && response.toolCalls.length > 0
  }

  private async callLLMWithTimeout(request: LLMRequest, timeoutMs: number, signal?: AbortSignal) {
    if (timeoutMs <= 0) {
      throw new Error('LLM request timeout before dispatch')
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`LLM request timeout after ${timeoutMs}ms`)), timeoutMs)
    })

    if (!signal) {
      return Promise.race([this.config.llmAdapter.complete(request), timeoutPromise])
    }

    let abortListener: (() => void) | undefined
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error('ABORTED: LLM call aborted'))
        return
      }
      abortListener = () => reject(new Error('ABORTED: LLM call aborted'))
      signal.addEventListener('abort', abortListener, { once: true })
    })

    try {
      return await Promise.race([this.config.llmAdapter.complete(request), timeoutPromise, abortPromise])
    } finally {
      if (abortListener) {
        signal.removeEventListener('abort', abortListener)
      }
    }
  }

  private shouldUseStreaming(request: LLMRequest): boolean {
    // Structured stream supports text + tool_calls for trusted provider families.
    // P1: fall back to complete() when tools are projected but the family cannot
    // reliably emit streaming tool_calls (e.g. ollama/anthropic/gemini/bedrock).
    if (request.tools !== undefined && request.tools.length > 0) {
      if (!supportsStructuredToolStreaming(this.config.providerFamily)) {
        return false
      }
    }
    return true
  }

  private async callLLMWithStreaming(
    request: LLMRequest,
    timeoutMs: number,
    input: KernelRunInput,
  ): Promise<
    | {
        success: true
        response: LLMResponse
        providerId: string
        earlyToolLive: Map<number, { eventId: string; provisionalToolCallId: string; name: string }>
      }
    | { success: false }
  > {
    if (timeoutMs <= 0) {
      throw new Error('LLM request timeout before dispatch')
    }

    const broadcaster = this.config.timelineBroadcaster
    const sessionId = input.sessionId
    const attemptId = input.runId
    const aggregator = new StreamResponseAggregator()
    let sequence = 0
    let providerId = 'unknown'
    // P2: emit early tool_call when name is first known (args may still be streaming).
    // Scheme 1: reuse a stable eventId for early + formal broadcasts so the UI upserts
    // one card instead of appending a second tool_call.
    const earlyToolPartial = new Map<number, { id?: string; name?: string }>()
    const earlyToolLive = new Map<number, { eventId: string; provisionalToolCallId: string; name: string }>()

    const broadcastTextDelta = (delta: string, isFinal: boolean): void => {
      if (!broadcaster || !sessionId || delta.length === 0) return
      const payload: TokenStreamPayload = {
        sessionId,
        attemptId,
        sequence,
        delta,
        // SAFETY: assistant text channel is explicit. Missing channel is treated
        // as 'assistant' by consumers (back-compat); setting it explicitly here
        // keeps the assistant/reasoning split unambiguous at the source.
        channel: 'assistant',
        accumulated: aggregator.content,
        isFinal,
        timestamp: new Date().toISOString(),
      }
      broadcaster.broadcastTokenStream(sessionId, payload)
      sequence++
    }

    // SAFETY: reasoning is broadcast on a SEPARATE channel ('reasoning') and MUST
    // never merge into assistant `content` / `channel: 'assistant'` payloads.
    // `accumulated` reflects reasoning-so-far (aggregator.reasoningContent), not
    // assistant content. Only non-empty deltas are broadcast so no empty reasoning
    // UI blocks are emitted when no reasoning existed.
    const broadcastReasoningDelta = (delta: string): void => {
      if (!broadcaster || !sessionId || delta.length === 0) return
      const payload: TokenStreamPayload = {
        sessionId,
        attemptId,
        sequence,
        delta,
        channel: 'reasoning',
        accumulated: aggregator.reasoningContent ?? '',
        isFinal: false,
        timestamp: new Date().toISOString(),
      }
      broadcaster.broadcastTokenStream(sessionId, payload)
      sequence++
      broadcastThinkingSummaryDelta()
    }

    // SAFETY: reasoning is ALSO projected as a server-owned `thinking_summary`
    // timeline event so the UI renders a single source of truth (single-source
    // streaming). The live block uses a stable per-turn eventId that the client
    // upserts in place; the persisted terminal event (turn-<turnId>-thinking-<index>,
    // console-timeline.ts) atomically replaces it when the turn finalizes.
    const broadcastThinkingSummaryDelta = (): void => {
      if (!broadcaster?.broadcast || !sessionId) return
      broadcaster.broadcast(sessionId, {
        eventId: `turn-${attemptId}-thinking-live`,
        eventType: 'thinking_summary',
        sessionId,
        timestamp: new Date().toISOString(),
        content: aggregator.reasoningContent ?? '',
        metadata: {
          turnId: attemptId,
          attemptId,
          live: true,
        },
        actor: 'assistant',
      })
    }

    const broadcastEarlyTool = (
      toolCallIndex: number,
      name: string,
      toolCallId: string,
      eventId: string,
      early: boolean,
    ): void => {
      if (!broadcaster?.broadcast || !sessionId) return
      broadcaster.broadcast(sessionId, {
        eventId,
        eventType: 'tool_call',
        sessionId,
        timestamp: new Date().toISOString(),
        content: formatToolRunningContent(name),
        metadata: {
          turnId: attemptId,
          toolCallId,
          toolName: name,
          status: 'running',
          ...(early ? { early: true } : {}),
          toolCallIndex,
        },
        actor: 'system',
      })
    }

    const maybeAnnounceEarlyTool = (chunk: Extract<LLMStreamChunk, { kind: 'tool_call_delta' }>): void => {
      if (!broadcaster?.broadcast || !sessionId) return
      const prev = earlyToolPartial.get(chunk.index) ?? {}
      if (chunk.id) prev.id = chunk.id
      if (chunk.name) prev.name = chunk.name
      earlyToolPartial.set(chunk.index, prev)
      if (!prev.name) return

      const provisionalToolCallId = prev.id ?? `pending-tool-${attemptId}-${chunk.index}`
      const existing = earlyToolLive.get(chunk.index)

      if (!existing) {
        // First announcement: eventId derived from best-known toolCallId.
        const eventId = buildToolCallEventId(attemptId, provisionalToolCallId)
        earlyToolLive.set(chunk.index, {
          eventId,
          provisionalToolCallId,
          name: prev.name,
        })
        broadcastEarlyTool(chunk.index, prev.name, provisionalToolCallId, eventId, true)
        return
      }

      // Already announced: if stream later reveals a real toolCallId, re-key to the formal
      // eventId and mark the previous provisional event as replaced (client upsert).
      if (prev.id && existing.provisionalToolCallId !== prev.id) {
        const eventId = buildToolCallEventId(attemptId, prev.id)
        earlyToolLive.set(chunk.index, {
          eventId,
          provisionalToolCallId: prev.id,
          name: prev.name,
        })
        if (!broadcaster?.broadcast || !sessionId) return
        broadcaster.broadcast(sessionId, {
          eventId,
          eventType: 'tool_call',
          sessionId,
          timestamp: new Date().toISOString(),
          content: formatToolRunningContent(prev.name),
          metadata: {
            turnId: attemptId,
            toolCallId: prev.id,
            toolName: prev.name,
            status: 'running',
            early: true,
            toolCallIndex: chunk.index,
            replacesEarlyEventId: existing.eventId,
          },
          actor: 'system',
        })
      }
    }

    try {
      const streamGenerator = this.config.llmAdapter.stream(request)
      const signal = input.signal

      const streamLoop = async (): Promise<void> => {
        for await (const chunk of streamGenerator) {
          // Check signal during active streaming for responsive abort
          if (signal?.aborted) {
            throw new Error('ABORTED: LLM stream aborted')
          }
          providerId = chunk.providerId
          aggregator.apply(chunk)

          if (chunk.kind === 'text') {
            broadcastTextDelta(chunk.delta, false)
          } else if (chunk.kind === 'reasoning') {
            // SAFETY: route reasoning to its own channel; never the assistant path.
            broadcastReasoningDelta(chunk.delta)
          } else if (chunk.kind === 'tool_call_delta') {
            maybeAnnounceEarlyTool(chunk)
          }
        }
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`LLM stream timeout after ${timeoutMs}ms`)), timeoutMs)
      })

      if (signal) {
        let abortListener: (() => void) | undefined
        const abortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new Error('ABORTED: LLM stream aborted'))
            return
          }
          abortListener = () => reject(new Error('ABORTED: LLM stream aborted'))
          signal.addEventListener('abort', abortListener, { once: true })
        })
        try {
          await Promise.race([streamLoop(), timeoutPromise, abortPromise])
        } finally {
          if (abortListener) {
            signal.removeEventListener('abort', abortListener)
          }
        }
      } else {
        await Promise.race([streamLoop(), timeoutPromise])
      }

      if (aggregator.isEmpty) {
        return { success: false }
      }

      // Mark stream complete for UI (empty final marker when last text already sent)
      if (broadcaster && sessionId && aggregator.hasContent) {
        const payload: TokenStreamPayload = {
          sessionId,
          attemptId,
          sequence,
          delta: '',
          accumulated: aggregator.content,
          isFinal: true,
          timestamp: new Date().toISOString(),
        }
        broadcaster.broadcastTokenStream(sessionId, payload)
      }

      const response = aggregator.toResponse(request.model)
      return {
        success: true,
        response,
        providerId: aggregator.lastProviderId || providerId,
        earlyToolLive,
      }
    } catch (error) {
      // Best-effort flush of partial text already accumulated
      if (broadcaster && sessionId && aggregator.hasContent) {
        const payload: TokenStreamPayload = {
          sessionId,
          attemptId,
          sequence,
          delta: '',
          accumulated: aggregator.content,
          isFinal: false,
          timestamp: new Date().toISOString(),
        }
        broadcaster.broadcastTokenStream(sessionId, payload)
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      const isTimeout = errorMessage.includes('timeout')
      if (isTimeout) {
        throw error
      }
      // Abort re-raises as-is for the caller to detect
      if (errorMessage.startsWith('ABORTED:')) {
        throw error
      }
      throw new Error(`STREAMING_ERROR: ${errorMessage}`)
    }
  }

  private parseToolUseRequests(response: LLMResponse): {
    requests: ToolUseRequest[]
    invalidArgs: Map<string, string>
  } {
    if (!response.toolCalls) {
      return { requests: [], invalidArgs: new Map() }
    }

    const requests: ToolUseRequest[] = []
    const invalidArgs = new Map<string, string>()

    for (const toolCall of response.toolCalls) {
      const parseResult = this.safeParseParams(toolCall.function.arguments)
      if (parseResult.success) {
        requests.push({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          params: parseResult.value,
        })
      } else {
        invalidArgs.set(toolCall.id, parseResult.error)
        // Still push a placeholder request so it gets tracked in state.toolCalls
        // and pairingGuard. The dispatch loop will detect the invalid arg via
        // the invalidArgs map and synthesize an error result.
        requests.push({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          params: {},
        })
      }
    }

    return { requests, invalidArgs }
  }

  private safeParseParams(
    args: string,
  ): { success: true; value: Record<string, unknown> } | { success: false; error: string } {
    try {
      const parsed = JSON.parse(args)
      return { success: true, value: parsed as Record<string, unknown> }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  private resolveInternalToolHandler(toolName: string, input: KernelRunInput): InternalToolHandler | undefined {
    return input.internalToolHandlers?.[toolName]
  }

  private async dispatchTool(toolRequest: ToolUseRequest, input: KernelRunInput): Promise<ToolUseResult> {
    if (!this.isCallableProjectedTool(toolRequest.toolName, input)) {
      return {
        toolCallId: toolRequest.toolCallId,
        result: null,
        error: {
          code: 'UNPROJECTED_TOOL_CALL',
          message: `Tool ${toolRequest.toolName} was not projected as callable for this kernel run`,
          recoverable: false,
        },
      }
    }

    const effectiveRunId = input.runId ?? input.contextBundle.runId
    const toolTimeoutMs = PER_TOOL_TIMEOUT_MS[toolRequest.toolName]
    const toolDispatchRequest = createToolDispatchRequest({
      runId: effectiveRunId,
      userId: input.userId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      agentId: input.agentId,
      agentType: input.agentType,
      assistantMessageId: `assistant-${stateSafeId(toolRequest.toolCallId)}`,
      toolUses: [
        {
          toolCallId: toolRequest.toolCallId,
          toolName: toolRequest.toolName,
          input: toolRequest.params,
        },
      ],
      permissionContext: {
        userId: input.userId,
        sessionId: input.sessionId ?? '',
        mode: 'ask_on_write',
        grants: [],
      },
      ...(toolTimeoutMs ? { executionPolicy: { timeoutMs: toolTimeoutMs } } : {}),
      ...(input.workDirRoot ? { workDirRoot: input.workDirRoot } : {}),
      ...(input.workDirId ? { workDirId: input.workDirId } : {}),
    })
    const dispatchResult = await this.config.dispatcher.dispatch({
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      action: {
        actionId: `action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        actionType: 'execute_tool',
        targetRuntime: 'tool_plane',
        targetAction: {
          toolName: toolRequest.toolName,
          params: toolRequest.params,
          toolCallId: toolRequest.toolCallId,
          toolDispatchRequest,
        },
        source: {
          sourceModule: 'agent_kernel',
          sourceAction: 'run',
        },
        userId: input.userId,
        createdAt: new Date().toISOString(),
        status: 'pending',
      },
      context: {
        callerModule: 'agent_kernel',
        userId: input.userId,
        sessionId: input.sessionId,
        kernelRunId: effectiveRunId,
        agentId: input.agentId,
        agentType: input.agentType,
        signal: input.signal,
      },
    })

    const toolDispatchResult = createToolDispatchResult({
      runId: toolDispatchRequest.runId,
      userId: toolDispatchRequest.userId,
      ...(toolDispatchRequest.sessionId ? { sessionId: toolDispatchRequest.sessionId } : {}),
      agentId: toolDispatchRequest.agentId,
      results: [this.toMappedToolResult(toolRequest, dispatchResult)],
      contextDeltas: this.extractContextDeltas(dispatchResult.result),
    })

    if (toolDispatchResult.contextDeltas) {
      for (const delta of toolDispatchResult.contextDeltas) {
        this.config.contextManager.applyDelta(delta)
      }
    }

    const executionResult = this.extractFirstToolExecutionResult(dispatchResult.result)

    if (executionResult) {
      return {
        toolCallId: toolRequest.toolCallId,
        result: executionResult.success ? executionResult.data : null,
        ...(executionResult.error ? { error: executionResult.error } : {}),
      }
    }

    if (dispatchResult.status === 'completed') {
      return {
        toolCallId: toolRequest.toolCallId,
        result: dispatchResult.result,
      }
    } else {
      return {
        toolCallId: toolRequest.toolCallId,
        result: null,
        error: dispatchResult.error || {
          code: 'DISPATCH_FAILED',
          message: 'Tool dispatch failed',
          recoverable: false,
        },
      }
    }
  }

  private async dispatchExternalBatch(
    batch: Array<{ toolRequest: ToolUseRequest; toolCallIndex: number }>,
    state: KernelRunState,
    pairingGuard: ToolResultPairingGuard,
    input: KernelRunInput,
  ): Promise<boolean> {
    if (batch.length === 0) return false

    const effectiveRunId = input.runId ?? input.contextBundle.runId
    const firstTool = batch[0].toolRequest

    const toolUses: import('../tools/runtime/tool-dispatch-contract.js').ToolUseDispatchInput[] = batch.map(
      ({ toolRequest }) => ({
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        input: toolRequest.params,
      }),
    )

    const toolDispatchRequest = createToolDispatchRequest({
      runId: effectiveRunId,
      userId: input.userId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      agentId: input.agentId,
      agentType: input.agentType,
      assistantMessageId: `assistant-${stateSafeId(firstTool.toolCallId)}`,
      toolUses,
      permissionContext: {
        userId: input.userId,
        sessionId: input.sessionId ?? '',
        mode: 'ask_on_write',
        grants: [],
      },
      executionPolicy: {
        maxConcurrency: 5,
        allowParallelReadOnly: true,
      },
      ...(input.workDirRoot ? { workDirRoot: input.workDirRoot } : {}),
      ...(input.workDirId ? { workDirId: input.workDirId } : {}),
    })

    let dispatchResult: Awaited<ReturnType<KernelConfig['dispatcher']['dispatch']>>
    try {
      dispatchResult = await this.config.dispatcher.dispatch({
        requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        action: {
          actionId: `action-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          actionType: 'execute_tool',
          targetRuntime: 'tool_plane',
          targetAction: {
            toolName: firstTool.toolName,
            params: firstTool.params,
            toolCallId: firstTool.toolCallId,
            toolDispatchRequest,
          },
          source: {
            sourceModule: 'agent_kernel',
            sourceAction: 'run',
          },
          userId: input.userId,
          createdAt: new Date().toISOString(),
          status: 'pending',
        },
        context: {
          callerModule: 'agent_kernel',
          userId: input.userId,
          sessionId: input.sessionId,
          kernelRunId: effectiveRunId,
          agentId: input.agentId,
          agentType: input.agentType,
          signal: input.signal,
        },
      })
    } catch (dispatchError) {
      // Dispatch threw before producing any result — mark all batch tools as DISPATCH_ERROR
      for (const { toolRequest, toolCallIndex } of batch) {
        const toolResult: ToolUseResult = {
          toolCallId: toolRequest.toolCallId,
          result: null,
          error: {
            code: 'DISPATCH_ERROR',
            message: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
            recoverable: true,
          },
        }
        pairingGuard.acceptToolResult(toolResult)
        this.commitTranscript(state, 'tool_result', toolResult)
        this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
        this.mergeToolResult(state, toolRequest, toolResult)
      }
      return false
    }

    // Extract contextDeltas from the aggregate dispatch result
    const contextDeltas = this.extractContextDeltas(dispatchResult.result)
    if (contextDeltas) {
      for (const delta of contextDeltas) {
        this.config.contextManager.applyDelta(delta)
      }
    }

    // Normalize results to array and build Map<toolCallId, ToolExecutionResult>
    const rawResults = Array.isArray(dispatchResult.result) ? dispatchResult.result : [dispatchResult.result]
    const execResultMap = new Map<string, ToolExecutionResult>()
    for (let i = 0; i < batch.length; i++) {
      const raw = rawResults[i]
      if (raw && isToolExecutionResult(raw)) {
        // Extract toolCallId from result data for robust mapping (handles out-of-order results).
        // Fall back to positional mapping when data doesn't carry toolCallId.
        const resultPayload = raw.data as Record<string, unknown> | undefined
        const resultToolCallId =
          typeof resultPayload?.toolCallId === 'string'
            ? (resultPayload.toolCallId as string)
            : batch[i].toolRequest.toolCallId
        execResultMap.set(resultToolCallId, raw)
      }
    }

    // For each tool in original order: build ToolUseResult, pair, broadcast, merge.
    // Track whether ALL tools in this batch requested termination.
    let allTerminated = batch.length > 0

    for (const { toolRequest, toolCallIndex } of batch) {
      const execResult = execResultMap.get(toolRequest.toolCallId)

      let toolResult: ToolUseResult
      if (execResult) {
        toolResult = {
          toolCallId: toolRequest.toolCallId,
          result: execResult.success ? execResult.data : null,
          ...(execResult.error ? { error: execResult.error } : {}),
        }
        // Extract terminate flag from execution result data.
        // Tools can signal terminal completion by including terminate: true in their data.
        const execData = execResult.data as Record<string, unknown> | undefined
        if (execData?.terminate === true) {
          toolResult.terminate = true
        }
      } else if (dispatchResult.status === 'completed' && !dispatchResult.error) {
        toolResult = {
          toolCallId: toolRequest.toolCallId,
          result: dispatchResult.result,
        }
      } else {
        toolResult = {
          toolCallId: toolRequest.toolCallId,
          result: null,
          error: dispatchResult.error || {
            code: 'DISPATCH_FAILED',
            message: 'Tool dispatch failed',
            recoverable: false,
          },
        }
      }

      if (!toolResult.terminate) {
        allTerminated = false
      }

      pairingGuard.acceptToolResult(toolResult)
      this.commitTranscript(state, 'tool_result', toolResult)
      this.broadcastToolResultTerminal(input, toolRequest, toolResult, toolCallIndex)
      this.mergeToolResult(state, toolRequest, toolResult)
    }

    // dispatchTool retained for backward compatibility
    void this.dispatchTool

    return allTerminated
  }

  private isCallableProjectedTool(toolName: string, input: KernelRunInput): boolean {
    const projection = input.toolProjection ?? this.config.toolProjection
    if (!projection?.tools) return false
    const isInProjection = projection.tools.some((tool) => tool.function.name === toolName)
    if (!isInProjection) return false

    // Defense-in-depth: remote agent type is hard-deny
    if (input.agentType === 'remote') {
      return false
    }

    return true
  }

  private toMappedToolResult(
    toolRequest: ToolUseRequest,
    dispatchResult: Awaited<ReturnType<KernelConfig['dispatcher']['dispatch']>>,
  ): ToolExecutionMappedResult {
    const isCompleted = dispatchResult.status === 'completed' && !dispatchResult.error
    const contextDeltas = this.extractContextDeltas(dispatchResult.result)
    const firstContextDelta = contextDeltas?.[0]
    return {
      toolCallId: toolRequest.toolCallId,
      toolName: toolRequest.toolName,
      status: isCompleted ? 'completed' : 'failed',
      ...(isCompleted ? { output: dispatchResult.result } : {}),
      ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
      resultMessage: {
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        isError: !isCompleted,
        modelFacingContent: isCompleted ? JSON.stringify(dispatchResult.result) : { error: dispatchResult.error },
        transcriptSummary: isCompleted
          ? `Tool ${toolRequest.toolName} completed`
          : `Tool ${toolRequest.toolName} failed`,
      },
      ...(firstContextDelta ? { contextDelta: firstContextDelta } : {}),
    }
  }

  private extractContextDeltas(result: unknown): RuntimeContextDelta[] | undefined {
    if (Array.isArray(result)) {
      const deltas = result
        .map((item) => (isToolExecutionResult(item) ? item.contextDelta : undefined))
        .filter((delta): delta is RuntimeContextDelta => isRuntimeContextDelta(delta))
      return deltas.length > 0 ? deltas : undefined
    }

    if (!isRecord(result)) return undefined
    const contextDelta = result.contextDelta
    if (!isRuntimeContextDelta(contextDelta)) return undefined
    return [contextDelta]
  }

  private extractFirstToolExecutionResult(result: unknown): ToolExecutionResult | undefined {
    if (Array.isArray(result)) {
      const first = result[0]
      return isToolExecutionResult(first) ? first : undefined
    }

    return isToolExecutionResult(result) ? result : undefined
  }

  private mergeToolResult(state: KernelRunState, toolRequest: ToolUseRequest, toolResult: ToolUseResult): void {
    const content = toolResult.error
      ? `Tool ${toolRequest.toolName} failed: ${toolResult.error.message}`
      : `Tool ${toolRequest.toolName} result: ${JSON.stringify(toolResult.result)}`

    const item: ContextItem = {
      itemId: `tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sourceType: 'tool_result',
      semanticType: 'tool_output',
      content,
      structuredPayload: { toolCallId: toolRequest.toolCallId },
      estimatedTokens: Math.ceil(content.length / 4),
      freshnessTs: new Date().toISOString(),
    }

    state.contextItems.push(item)
  }

  private flushPairingGuard(
    guard: ToolResultPairingGuard,
    state: KernelRunState,
    reason: string,
    input?: KernelRunInput,
  ): void {
    if (!guard.hasPendingCalls()) return

    const missingResults = guard.flushMissingResults(reason)
    for (const syntheticResult of missingResults) {
      this.commitTranscript(state, 'tool_result', syntheticResult)
      const known = state.toolCalls.find((tc) => tc.toolCallId === syntheticResult.toolCallId)
      const syntheticRequest: ToolUseRequest = {
        toolCallId: syntheticResult.toolCallId,
        toolName: known?.toolName ?? 'unknown',
        params: {},
      }
      if (input) {
        this.broadcastToolResultTerminal(input, syntheticRequest, syntheticResult)
      }
      this.mergeToolResult(state, syntheticRequest, syntheticResult)
    }
  }

  private checkCompactTrigger(contextBundle: ContextBundle, state: KernelRunState): CompactTriggerResult {
    const threshold = this.config.compactThreshold ?? 0.8
    const tokenEstimate = contextBundle.tokenEstimate
    const usedTokens = state.contextItems.reduce((sum, item) => sum + (item.estimatedTokens || 0), 0)

    const utilizationRatio = usedTokens / (tokenEstimate || 1)

    if (utilizationRatio > threshold && contextBundle.compactHints?.shouldCompactSoon) {
      return {
        shouldCompact: true,
        candidateItemIds: contextBundle.compactHints.candidateItemIds,
        mustKeepItemIds: contextBundle.compactHints.mustKeepItemIds,
      }
    }

    return { shouldCompact: false }
  }

  private async executeCompact(
    candidateItemIds: readonly string[],
    mustKeepItemIds: readonly string[],
    state: KernelRunState,
    input: KernelRunInput,
  ): Promise<CompactExecutorResult> {
    try {
      const result = await this.config.compactExecutor!({
        candidateItemIds,
        mustKeepItemIds,
        contextItems: state.contextItems,
      })

      if (result.status === 'applied') {
        // Defense-in-depth: verify executor did not return protected IDs
        const protectedIds = new Set([
          ...mustKeepItemIds,
          ...state.contextItems.filter((i) => i.isPinned === true || i.isCompressible === false).map((i) => i.itemId),
        ])
        const compactedSet = new Set(result.compactedItemIds)
        const hasProtected = [...compactedSet].some((id) => protectedIds.has(id))
        if (hasProtected) {
          return { status: 'skipped', reason: 'protected items in compacted set' }
        }

        for (const item of state.contextItems) {
          if (compactedSet.has(item.itemId) && item.structuredPayload?.toolCallId) {
            state.compactedToolCallIds.add(item.structuredPayload.toolCallId as string)
          }
        }
        state.contextItems = [
          ...state.contextItems.filter((item) => !compactedSet.has(item.itemId)),
          result.summaryItem,
        ]
        for (const id of result.compactedItemIds) {
          state.compactedItemIds.add(id)
        }
        state.lastCompactSummaryItem = result.summaryItem
        this.config.contextManager.applyDelta({
          runId: input.runId,
          source: 'runtime_note',
          items: [result.summaryItem],
          replaceKeys: [...result.compactedItemIds],
        })
      }

      return result
    } catch {
      return { status: 'skipped', reason: 'executor error' }
    }
  }

  private broadcastToolCallRunning(input: KernelRunInput, toolRequest: ToolUseRequest, toolCallIndex?: number): void {
    const broadcaster = this.config.timelineBroadcaster
    const sessionId = input.sessionId
    if (!broadcaster?.broadcast || !sessionId) return
    const turnId = input.runId
    // Scheme 1: prefer reusing the early announcement eventId when it already locked the
    // real toolCallId (or any provisional id). Clients upsert by eventId; when early used a
    // provisional id, frontend also merges by (turnId, toolCallIndex).
    const early = toolCallIndex !== undefined ? this.pendingEarlyToolLive?.get(toolCallIndex) : undefined
    const formalEventId = buildToolCallEventId(turnId, toolRequest.toolCallId)
    // Reuse early eventId only when it already equals formal (real id known during stream).
    // Otherwise broadcast formal id and let the client replace the early card by toolCallIndex.
    const eventId = early && early.provisionalToolCallId === toolRequest.toolCallId ? early.eventId : formalEventId
    broadcaster.broadcast(sessionId, {
      eventId,
      eventType: 'tool_call',
      sessionId,
      timestamp: new Date().toISOString(),
      content: formatToolRunningContent(toolRequest.toolName),
      metadata: {
        turnId,
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        status: 'running',
        ...(toolCallIndex !== undefined ? { toolCallIndex } : {}),
        ...(early && early.provisionalToolCallId !== toolRequest.toolCallId
          ? { replacesEarlyEventId: early.eventId }
          : {}),
      },
      actor: 'system',
    })
  }

  private broadcastToolResultTerminal(
    input: KernelRunInput,
    toolRequest: ToolUseRequest,
    toolResult: ToolUseResult,
    toolCallIndex?: number,
  ): void {
    const broadcaster = this.config.timelineBroadcaster
    const sessionId = input.sessionId
    if (!broadcaster?.broadcast || !sessionId) return
    const turnId = input.runId
    const failed = Boolean(toolResult.error)
    broadcaster.broadcast(sessionId, {
      eventId: buildToolResultEventId(turnId, toolRequest.toolCallId),
      eventType: 'tool_result',
      sessionId,
      timestamp: new Date().toISOString(),
      content: formatToolTerminalContent(toolRequest.toolName, failed),
      metadata: {
        turnId,
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        status: failed ? 'failed' : 'completed',
        result: formatToolTerminalContent(toolRequest.toolName, failed),
        ...(toolCallIndex !== undefined ? { toolCallIndex } : {}),
      },
      actor: 'system',
    })
  }

  private commitTranscript(state: KernelRunState, type: KernelTranscriptEntry['type'], content: unknown): void {
    const entry: KernelTranscriptEntry = {
      iteration: state.currentIteration,
      timestamp: new Date().toISOString(),
      type,
      content,
    }
    state.transcript.push(entry)
  }

  private validateFinalContentIfNeeded(
    content: string,
  ):
    | { ok: true; structuredResult?: unknown }
    | { ok: false; code: string; message: string; details: readonly string[] } {
    const validation = validateOutputContractContent({
      contractId: this.lastBuiltModelInput?.metadata.outputContract,
      mode: this.lastBuiltModelInput?.metadata.mode ?? 'function_calling',
      content,
    })

    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        details: validation.details,
      }
    }

    return validation.parsed === undefined ? { ok: true } : { ok: true, structuredResult: validation.parsed }
  }

  private buildResult(
    state: KernelRunState,
    finalStatus: KernelRunResult['finalStatus'],
    error?: { code: string; message: string },
    finalResponse?: string,
    structuredResult?: unknown,
    input?: KernelRunInput,
    tokenUsage?: TokenUsage,
  ): KernelRunResult {
    const result: KernelRunResult = {
      finalStatus,
      finalResponse,
      iterationsUsed: state.currentIteration,
      toolCalls: state.toolCalls,
      transcript: state.transcript,
      error,
      ...(structuredResult !== undefined ? { structuredResult } : {}),
      ...(tokenUsage && tokenUsage.totalTokens > 0 ? { tokenUsage } : {}),
    }

    if (input) {
      result.structuredTrace = buildDecisionTrace(state, input, result.finalResponse)
    }

    return result
  }
}
