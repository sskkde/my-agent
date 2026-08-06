import type { ExtractedFact, SearchIntent } from './search-subagent-types.js'
import type { WebSearchResultItem } from './types.js'

/**
 * Deterministic round decision matrix for the multi-round search controller.
 *
 * Unlike the public `EvidenceSufficiency` gate, this evaluator only answers
 * "should the controller start another search round?" from actionable,
 * intent-specific evidence signals. It never calls an LLM and never uses the
 * uncalibrated absolute source-quality score as a gate.
 */

export const SEARCH_ROUND_STOP_REASONS = [
  'sufficient_evidence',
  'max_rounds',
  'duplicate_query',
  'budget_boundary',
  'backend_failure',
] as const

export type SearchRoundStopReason = (typeof SEARCH_ROUND_STOP_REASONS)[number]

export const SEARCH_ROUND_REPLAN_REASONS = [
  'no_results',
  'no_facts',
  'low_diversity',
  'freshness_unverifiable',
] as const

export type SearchRoundReplanReason = (typeof SEARCH_ROUND_REPLAN_REASONS)[number]

/** Minimum unique source count required before accumulated evidence is sufficient. */
const MIN_UNIQUE_SOURCES_BY_INTENT: Record<SearchIntent, number> = {
  weather: 1,
  local: 1,
  news: 2,
  technical: 2,
  product: 2,
  general: 2,
}

export function minUniqueSourcesForIntent(intent: SearchIntent): number {
  return MIN_UNIQUE_SOURCES_BY_INTENT[intent]
}

/** Prompt context carried into the next phase-1 query build when a replan is requested. */
export interface SearchReplanContext {
  /** Human-readable reason rendered in the dynamic/user context of the next phase-1 call. */
  reasonText: string
  /** Missing critical context carried as prompt context only; never an independent trigger. */
  missingCriticalContext: readonly string[]
}

export type SearchRoundDecision =
  | { kind: 'stop'; reason: SearchRoundStopReason }
  | { kind: 'continue'; reason: SearchRoundReplanReason; replanContext: SearchReplanContext }

export interface SearchRoundEvaluatorInput {
  /** Accumulated cleaned results across completed rounds (first-result-wins merge). */
  results: readonly WebSearchResultItem[]
  /** Extracted facts for the accumulated results; only presence matters. */
  facts: readonly ExtractedFact[]
  /** Number of unique source domains represented in `results`. */
  uniqueDomainCount: number
  /** Search intent controlling the minimum source diversity. */
  intent: SearchIntent
  /** Whether the query plan requires fresh results (time-sensitive intent or explicit flag). */
  requiresFreshness: boolean
  /** 1-based index of the round that just completed. */
  roundIndex: number
  /** Maximum rounds allowed for this execution (>= 1). */
  maxRounds: number
  /** True when the next candidate query duplicates a query already executed. */
  hasDuplicateCandidate: boolean
  /** True when no budget remains to start another backend round. */
  budgetExhausted: boolean
  /** True when the last backend call failed terminally. */
  backendFailed: boolean
  /** Number of freshness-unverifiable replans already consumed (0 or 1). */
  freshnessAttemptsUsed: number
  /** True when result dates could not verify the required freshness. */
  freshnessUnverifiable: boolean
  /** Missing critical context carried into replan prompts, never a trigger. */
  missingCriticalContext: readonly string[]
}

export function evaluateSearchRound(input: SearchRoundEvaluatorInput): SearchRoundDecision {
  // Terminal stops — no next round is possible or useful. Fixed priority order
  // keeps the decision fully deterministic for the multi-round controller.
  if (input.backendFailed) {
    return { kind: 'stop', reason: 'backend_failure' }
  }
  if (input.hasDuplicateCandidate) {
    return { kind: 'stop', reason: 'duplicate_query' }
  }
  if (input.budgetExhausted) {
    return { kind: 'stop', reason: 'budget_boundary' }
  }
  if (input.roundIndex >= input.maxRounds) {
    return { kind: 'stop', reason: 'max_rounds' }
  }

  // Evidence gates — continue only when an actionable replan exists.
  if (input.results.length === 0) {
    return continueRound('no_results', input)
  }
  if (input.facts.length === 0) {
    return continueRound('no_facts', input)
  }
  if (input.uniqueDomainCount < minUniqueSourcesForIntent(input.intent)) {
    return continueRound('low_diversity', input)
  }
  if (input.requiresFreshness && input.freshnessUnverifiable && input.freshnessAttemptsUsed < 1) {
    return continueRound('freshness_unverifiable', input)
  }

  return { kind: 'stop', reason: 'sufficient_evidence' }
}

function continueRound(reason: SearchRoundReplanReason, input: SearchRoundEvaluatorInput): SearchRoundDecision {
  return {
    kind: 'continue',
    reason,
    replanContext: {
      reasonText: replanReasonText(reason, minUniqueSourcesForIntent(input.intent)),
      missingCriticalContext: input.missingCriticalContext,
    },
  }
}

function replanReasonText(reason: SearchRoundReplanReason, minUniqueSources: number): string {
  switch (reason) {
    case 'no_results':
      return 'The previous search returned no results; rephrase the query to target a broader, more direct phrasing.'
    case 'no_facts':
      return 'The previous search returned results without extractable facts; rephrase the query to find sources with concrete factual content.'
    case 'low_diversity':
      return `The previous search covered fewer than ${minUniqueSources} unique sources; run a query that adds distinct sources.`
    case 'freshness_unverifiable':
      return 'The query requires fresh information but result dates could not be verified; run a query that surfaces recent, dated sources.'
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}
