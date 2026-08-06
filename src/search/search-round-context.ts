/**
 * Round execution context factory for the multi-round search controller.
 *
 * Builds the per-execute context object: the mutable round state, the counting
 * LLM adapter, the remaining-deadline helpers, and the phase-observation
 * emitters. The round loop (`search-round-execution.ts`) and the final phase2
 * (`search-multi-round-controller.ts`) both read from this context.
 */

import type { LLMRequest } from '../llm/types.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { SearchRoundPolicy } from './search-round-budget.js'
import type { SearchRoundDecision } from './search-round-evaluator.js'
import type { RoundState } from './search-multi-round-helpers.js'
import type { SearchPhaseObservation, SearchSubagentConfig } from './search-subagent.js'

export interface RoundExecutionDeps {
  llmAdapter: SearchSubagentConfig['llmAdapter']
  webSearchExecutor: SearchSubagentConfig['webSearchExecutor']
  modelInputBuilder: ModelInputBuilder
  searchLlmProviderId: string
  searchLlmModel: string
  providerFamily: string
  roundPolicy: SearchRoundPolicy
  phaseObserver?: (observation: SearchPhaseObservation) => void
}

export interface RoundExecution {
  deps: RoundExecutionDeps
  state: RoundState
  countingLlmAdapter: SearchSubagentConfig['llmAdapter']
  remainingRoundMs: () => number
  remainingCompletionMs: () => number
  emitPhase1: (round: number, query: string, querySource: 'llm_tool_call' | 'input_fallback') => void
  emitBackendSearch: (round: number) => void
  emitEvaluation: (round: number, decision: SearchRoundDecision) => void
  emitReplan: (round: number) => void
}

export function createRoundExecution(
  deps: RoundExecutionDeps,
  startTime: number,
  roundDeadlineMs: number,
  completionDeadlineMs: number,
): RoundExecution {
  const state: RoundState = {
    startTime,
    seenQueries: [],
    mergedResults: [],
    roundCount: 0,
    replanCount: 0,
    searchCallCount: 0,
    llmCallCount: 0,
    freshnessAttemptsUsed: 0,
    stopReason: undefined,
    budgetExhausted: false,
    cachedSegmentAHash: undefined,
    replanContext: undefined,
    replanReason: undefined,
  }

  const countingLlmAdapter = {
    ...deps.llmAdapter,
    complete: async (request: LLMRequest) => {
      state.llmCallCount += 1
      return deps.llmAdapter.complete(request)
    },
  }

  const remainingRoundMs = (): number => Math.max(0, roundDeadlineMs - (Date.now() - startTime))
  const remainingCompletionMs = (): number => Math.max(0, completionDeadlineMs - (Date.now() - startTime))

  const emitPhase1 = (round: number, query: string, querySource: 'llm_tool_call' | 'input_fallback'): void => {
    deps.phaseObserver?.({
      phase: 'phase1',
      query,
      querySource,
      round,
      roundCount: state.roundCount,
      searchCallCount: state.searchCallCount,
      llmCallCount: state.llmCallCount,
    })
  }

  const emitBackendSearch = (round: number): void => {
    deps.phaseObserver?.({
      phase: 'backend_search',
      round,
      roundCount: state.roundCount,
      searchCallCount: state.searchCallCount,
      llmCallCount: state.llmCallCount,
    })
  }

  const emitEvaluation = (round: number, decision: SearchRoundDecision): void => {
    deps.phaseObserver?.({
      phase: 'evaluation',
      round,
      ...(decision.kind === 'stop' ? { stopReason: decision.reason } : { replanReason: decision.reason }),
      roundCount: state.roundCount,
      searchCallCount: state.searchCallCount,
      llmCallCount: state.llmCallCount,
    })
  }

  const emitReplan = (round: number): void => {
    deps.phaseObserver?.({
      phase: 'replan',
      round,
      replanReason: state.replanReason,
      roundCount: state.roundCount,
      searchCallCount: state.searchCallCount,
      llmCallCount: state.llmCallCount,
    })
  }

  return {
    deps,
    state,
    countingLlmAdapter,
    remainingRoundMs,
    remainingCompletionMs,
    emitPhase1,
    emitBackendSearch,
    emitEvaluation,
    emitReplan,
  }
}
