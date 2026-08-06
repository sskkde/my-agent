/**
 * Pure helpers for the multi-round search controller.
 *
 * Plan synthesis from the typed plan hints, replan dynamic-context rendering
 * for the phase-1 Segment D seam, and final result assembly. No I/O, no state.
 */

import type { ContextItemData } from '../kernel/model-input/model-input-types.js'
import type { SearchReplanContext, SearchRoundReplanReason, SearchRoundStopReason } from './search-round-evaluator.js'
import type { SearchSubagentExecutionMetadata, SearchSubagentInput } from './search-subagent.js'
import type { SearchPlanHints, SearchQueryPlan } from './search-subagent-types.js'
import type { WebSearchResult, WebSearchResultItem } from './types.js'

/** Total budget used when the execute input does not carry one (matches the default search child wait). */
export const DEFAULT_SEARCH_TOTAL_BUDGET_MS = 60_000

/** Cap on top-result titles/snippets rendered into a replan phase-1 dynamic context. */
export const REPLAN_RESULT_CAP = 5
/** Snippet length cap for replan dynamic context items. */
export const REPLAN_SNIPPET_MAX_CHARS = 200

/** Mutable per-execute round state shared by the controller and the round loop. */
export interface RoundState {
  startTime: number
  seenQueries: string[]
  mergedResults: WebSearchResultItem[]
  roundCount: number
  replanCount: number
  searchCallCount: number
  llmCallCount: number
  freshnessAttemptsUsed: number
  stopReason: SearchRoundStopReason | undefined
  budgetExhausted: boolean
  cachedSegmentAHash: string | undefined
  replanContext: SearchReplanContext | undefined
  replanReason: SearchRoundReplanReason | undefined
}

export interface ExecutionCounterState {
  seenQueries: readonly string[]
  roundCount: number
  replanCount: number
  searchCallCount: number
  llmCallCount: number
  stopReason: SearchSubagentExecutionMetadata['stopReason']
  budgetExhausted: boolean
}

export type ExecutionCounters = Pick<
  SearchSubagentExecutionMetadata,
  | 'executedQueries'
  | 'roundCount'
  | 'replanCount'
  | 'searchCallCount'
  | 'llmCallCount'
  | 'stopReason'
  | 'budgetExhausted'
>

export function executionMetadata(state: ExecutionCounterState): ExecutionCounters {
  return {
    executedQueries: state.seenQueries,
    roundCount: state.roundCount,
    replanCount: state.replanCount,
    searchCallCount: state.searchCallCount,
    llmCallCount: state.llmCallCount,
    ...(state.stopReason !== undefined ? { stopReason: state.stopReason } : {}),
    ...(state.budgetExhausted ? { budgetExhausted: true } : {}),
  }
}

export function finalToolResult(plan: SearchQueryPlan, mergedResults: readonly WebSearchResultItem[]): WebSearchResult {
  return {
    query: plan.originalQuestion,
    results: [...mergedResults],
    total: mergedResults.length,
    provider: 'search_subagent',
    endpointHost: '',
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...`
}

export function buildControllerPlan(input: SearchSubagentInput, hints: SearchPlanHints | undefined): SearchQueryPlan {
  const originalQuestion = hints && hints.originalQuestion.trim().length > 0 ? hints.originalQuestion : input.query
  return {
    originalQuestion,
    searchQuery: input.query,
    intent: hints?.intent ?? 'general',
    requiresFreshness: hints?.freshness ?? false,
    ...(hints?.locale !== undefined ? { locale: hints.locale } : {}),
    missingCriticalContext: [...(hints?.missingCriticalContext ?? [])],
  }
}

export function buildReplanDynamicContext(
  roundCount: number,
  maxRounds: number,
  replansRemaining: number,
  plan: SearchQueryPlan,
  seenQueries: readonly string[],
  replanContext: SearchReplanContext | undefined,
  mergedResults: readonly WebSearchResultItem[],
): ContextItemData[] {
  const items: ContextItemData[] = [
    {
      itemId: 'search-round-progress',
      content: `Search Round Progress: Round ${roundCount} of ${maxRounds} (max replans remaining: ${replansRemaining})`,
      semanticType: 'search_context',
    },
    {
      itemId: 'original-question',
      content: `Original Question: ${plan.originalQuestion}`,
      semanticType: 'search_context',
    },
    {
      itemId: 'prior-queries',
      content: `Previously Executed Queries (do not repeat):\n${seenQueries.map((query, index) => `${index + 1}. ${query}`).join('\n') || '(none)'}`,
      semanticType: 'search_context',
    },
  ]

  if (replanContext) {
    items.push({
      itemId: 'search-round-feedback',
      content: `Previous Search Feedback: ${replanContext.reasonText}`,
      semanticType: 'search_context',
    })
    if (replanContext.missingCriticalContext.length > 0) {
      items.push({
        itemId: 'missing-context',
        content: `Missing Critical Context: ${replanContext.missingCriticalContext.join(', ')}`,
        semanticType: 'search_context',
      })
    }
  }

  const topResults = mergedResults
    .slice(0, REPLAN_RESULT_CAP)
    .map((result) => `- ${result.title}: ${truncate(result.snippet, REPLAN_SNIPPET_MAX_CHARS)}`)
  items.push({
    itemId: 'top-results',
    content: `Top Results So Far:\n${topResults.join('\n') || '(none)'}`,
    semanticType: 'search_context',
  })

  return items
}
