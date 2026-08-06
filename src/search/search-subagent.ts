/**
 * Search Subagent
 * Dedicated synchronous service for web search with forced tool choice.
 * Uses ModelInputBuilder for both LLM calls with shared Segment A cache.
 *
 * This module is the named-export facade: it keeps the public contracts, the
 * `createSearchSubagent` factory, and delegates the two phases to the extracted
 * `search-query-phase.ts` (phase 1: forced web_search tool_choice -> auto retry
 * -> input fallback) and `search-answer-phase.ts` (phase 2: evidence-context +
 * structured_json answer).
 */

import type { LLMRequest } from '../llm/types.js'
import type { WebSearchResult } from './types.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { SearchRoundPolicy } from './search-round-budget.js'
import type { SearchRoundReplanReason, SearchRoundStopReason } from './search-round-evaluator.js'
import { ONE_ROUND_SEARCH_POLICY } from './search-round-budget.js'
import type { SearchPlanHints } from './search-subagent-types.js'
import { runQueryPhase } from './search-query-phase.js'
import { runAnswerPhase } from './search-answer-phase.js'
import { runMultiRoundSearch } from './search-multi-round-controller.js'

/**
 * Search subagent configuration
 */
export interface SearchSubagentConfig {
  /** LLM adapter for executing requests */
  llmAdapter: {
    complete: (request: LLMRequest) => Promise<{
      success: boolean
      response?: {
        id: string
        model: string
        content: string
        toolCalls?: Array<{
          id: string
          type: 'function'
          function: {
            name: string
            arguments: string
          }
        }>
        finishReason: string
      }
      error?: {
        code: string
        message: string
      }
    }>
    getProviderCapabilities?: () => {
      supportsFunctionCalling: boolean
    }
  }

  /** Web search executor function */
  webSearchExecutor: (params: { query: string }) => Promise<WebSearchResult & { success: boolean }>

  /** ModelInputBuilder for constructing LLM messages */
  modelInputBuilder: ModelInputBuilder

  /** Provider family for template resolution (static string or dynamic resolver for live config) */
  providerFamily: string | (() => string)

  /** Search model provider ID (static string or dynamic resolver for live config) */
  searchLlmProviderId: string | (() => string)

  /** Search model name (static string or dynamic resolver for live config) */
  searchLlmModel: string | (() => string)

  /** Optional main model provider ID (for reference only, not used) */
  mainLlmProviderId?: string

  /** Optional main model name (for reference only, not used) */
  mainLlmModel?: string

  /**
   * Optional round budget policy. Defaults to `ONE_ROUND_SEARCH_POLICY`; the
   * multi-round policy is accepted here and only wired into execution by the
   * multi-round controller.
   */
  roundPolicy?: SearchRoundPolicy

  /**
   * Optional phase observer for observability (e.g. the Todo 16 search child
   * runner records the phases on the child timeline). Fires at the three
   * two-phase milestones; never alters the execution flow or result.
   */
  phaseObserver?: (observation: SearchPhaseObservation) => void
}

/**
 * Observable milestone of the two-phase search execution. Consumed by the
 * specialized search child runner to persist a child-timeline phase record.
 * `phase1` is observed only after a usable search query was determined;
 * `backend_search` fires right after the direct search backend execution;
 * `phase2` fires once the structured_json answer build succeeded. The
 * multi-round controller emits `evaluation` (round decision) and `replan`
 * (next phase-1 round build) phases additively with round/reason/count fields;
 * the default one-round path never emits them.
 */
export interface SearchPhaseObservation {
  phase: 'phase1' | 'backend_search' | 'phase2' | 'evaluation' | 'replan'
  query?: string
  querySource?: 'llm_tool_call' | 'input_fallback'
  /** 1-based round index this observation belongs to (multi-round executions only). */
  round?: number
  /** Why the search loop stopped; present on `evaluation` observations with a stop decision. */
  stopReason?: SearchRoundStopReason
  /** Why the next round was replanned; present on `evaluation` observations with a continue decision. */
  replanReason?: SearchRoundReplanReason
  /** Completed rounds at observation time (additive counters). */
  roundCount?: number
  /** Backend invocations scheduled at observation time (additive counters). */
  searchCallCount?: number
  /** LLM complete() invocations scheduled at observation time (additive counters). */
  llmCallCount?: number
}

/**
 * Search subagent input
 */
export interface SearchSubagentInput {
  /** Search query */
  query: string

  /** User ID */
  userId: string

  /** Session ID */
  sessionId: string

  /**
   * Typed plan hints propagated from the parent `SearchQueryPlan` (multi-round
   * replan context: original question, intent, freshness, locale, missing
   * context). Absent for legacy/direct invocations.
   */
  searchPlanHints?: SearchPlanHints

  /**
   * Optional total budget in ms for this execution. The search child runner
   * passes its timeout; the multi-round controller derives the round/completion
   * deadlines from it. Defaults to the search child wait budget.
   */
  timeoutMs?: number

  /** Optional external cancellation signal honored before/after every await. */
  signal?: AbortSignal
}

/**
 * Base metadata every successful search execution reports.
 */
export interface SearchSubagentSuccessMetadata {
  providerId: string
  model: string
  querySource: 'search_subagent'
  durationMs: number
  segmentAHash?: string
}

/**
 * Internal execution metadata produced by `SearchSubagent.execute()`. Additive
 * and fully optional so the default one-round path stays byte-compatible:
 * `stopReason`/`budgetExhausted` are only set by multi-round executions that
 * hit a stop decision or budget event. `executedQueries` is internal-only and
 * must never be copied into the public `SearchSubagentMetadata`.
 */
export interface SearchSubagentExecutionMetadata extends SearchSubagentSuccessMetadata {
  /** Query strings actually executed against the backend, in order (internal only). */
  executedQueries?: readonly string[]
  /** Number of completed search rounds (single-round default: 1). */
  roundCount?: number
  /** Number of replan (round >= 2) phase-1 calls (single-round default: 0). */
  replanCount?: number
  /** Number of backend invocations scheduled (single-round default: 1). */
  searchCallCount?: number
  /** Number of LLM complete() invocations scheduled, including forced->auto attempts and late-abandoned calls. */
  llmCallCount?: number
  /** Why the search loop stopped; absent for a default one-round run without a budget event. */
  stopReason?: SearchRoundStopReason
  /** True when the round/completion budget was exhausted. */
  budgetExhausted?: boolean
}

/**
 * Search subagent success result
 */
export interface SearchSubagentSuccessResult {
  success: true
  answer: string
  toolResult: WebSearchResult
  metadata: SearchSubagentExecutionMetadata
}

/**
 * Search subagent failure result. `SEARCH_TIMEOUT` is returned by the
 * multi-round controller when the round deadline settles with zero evidence; it
 * is recoverable and mapped by the search child runner without string guessing.
 */
export interface SearchSubagentFailureResult {
  success: false
  errorCode: 'SEARCH_MODEL_INCAPABLE' | 'INVALID_TOOL_CALL' | 'MODEL_UNAVAILABLE' | 'NO_TOOL_CALL' | 'SEARCH_TIMEOUT'
  message: string
}

/**
 * Search subagent result
 */
export type SearchSubagentResult = SearchSubagentSuccessResult | SearchSubagentFailureResult

/**
 * Search subagent interface
 */
export interface SearchSubagent {
  execute: (input: SearchSubagentInput) => Promise<SearchSubagentResult>
  /** Effective round budget policy for this subagent (factory always sets it; defaults to one round). */
  readonly roundPolicy?: SearchRoundPolicy
}

/**
 * Create a search subagent
 */
export function createSearchSubagent(config: SearchSubagentConfig): SearchSubagent {
  const { llmAdapter, webSearchExecutor, modelInputBuilder } = config
  const roundPolicy = config.roundPolicy ?? ONE_ROUND_SEARCH_POLICY

  let cachedSegmentAHash: string | undefined

  async function execute(input: SearchSubagentInput): Promise<SearchSubagentResult> {
    const startTime = Date.now()
    const searchLlmProviderId =
      typeof config.searchLlmProviderId === 'function' ? config.searchLlmProviderId() : config.searchLlmProviderId
    const searchLlmModel = typeof config.searchLlmModel === 'function' ? config.searchLlmModel() : config.searchLlmModel
    const providerFamily = typeof config.providerFamily === 'function' ? config.providerFamily() : config.providerFamily

    if (llmAdapter.getProviderCapabilities) {
      const capabilities = llmAdapter.getProviderCapabilities()
      if (!capabilities.supportsFunctionCalling) {
        return {
          success: false,
          errorCode: 'SEARCH_MODEL_INCAPABLE',
          message: 'Search model does not support function calling',
        }
      }
    }

    // Multi-round executions (roundPolicy.maxRounds > 1) run the controlled
    // controller; the default one-round path below stays byte-identical.
    if (roundPolicy.maxRounds > 1) {
      return runMultiRoundSearch(
        {
          llmAdapter,
          webSearchExecutor,
          modelInputBuilder,
          searchLlmProviderId,
          searchLlmModel,
          providerFamily,
          roundPolicy,
          phaseObserver: config.phaseObserver,
        },
        input,
      )
    }

    // Count every LLM complete() invocation scheduled (forced->auto attempts and
    // late-abandoned calls included — provider work was launched before the await).
    let llmCallCount = 0
    const countingLlmAdapter = {
      ...llmAdapter,
      complete: async (request: LLMRequest) => {
        llmCallCount += 1
        return llmAdapter.complete(request)
      },
    }

    // ─── Phase 1: Tool Call (function_calling mode) ──────────────────────────────
    const queryPhase = await runQueryPhase(
      { llmAdapter: countingLlmAdapter, modelInputBuilder, searchLlmModel },
      { input, providerFamily },
    )
    if (!queryPhase.ok) {
      return {
        success: false,
        errorCode: queryPhase.errorCode,
        message: queryPhase.message,
      }
    }

    cachedSegmentAHash = queryPhase.segmentAHash

    config.phaseObserver?.({ phase: 'phase1', query: queryPhase.searchQuery, querySource: queryPhase.querySource })

    const toolResult = await webSearchExecutor({ query: queryPhase.searchQuery })

    config.phaseObserver?.({ phase: 'backend_search' })

    // ─── Phase 2: Answer Generation (structured_json mode) ────────────────────────
    const answerResult = await runAnswerPhase(
      { llmAdapter: countingLlmAdapter, modelInputBuilder, searchLlmModel, phaseObserver: config.phaseObserver },
      {
        input,
        providerFamily,
        searchLlmProviderId,
        toolResult,
        searchQuery: queryPhase.searchQuery,
        cachedSegmentAHash,
        startTime,
      },
    )

    // Default single-round execution counters. stopReason/budgetExhausted stay
    // absent here — they are only emitted by multi-round executions (todo 8).
    return {
      ...answerResult,
      metadata: {
        ...answerResult.metadata,
        executedQueries: [queryPhase.searchQuery],
        roundCount: 1,
        replanCount: 0,
        searchCallCount: 1,
        llmCallCount,
      },
    }
  }

  return {
    execute,
    roundPolicy,
  }
}
