import type { SearchSubagent, SearchSubagentInput, SearchSubagentResult } from './search-subagent.js'
import type { WebSearchResultItem } from './types.js'
import type {
  SearchQueryPlan,
  SearchIntent,
  ExtractedFact,
  SearchWarning,
  SearchSubagentToolResult,
  SearchSubagentMetadata,
} from './search-subagent-types.js'
import { assertSearchScope } from './search-subagent-types.js'
import { determineEvidenceSufficiency } from './evidence-sufficiency.js'
import { DefaultSearchQueryPlanner } from './search-query-planner.js'
import { SOURCE_QUALITY_SCORING_VERSION } from './source-quality.js'
import {
  checkFreshnessWarning,
  cleanSnippets,
  countUniqueSources,
  deduplicateResults,
  extractFacts,
  rankSearchResults,
  scoreSearchResult,
  selectSearchResults,
} from './search-result-processing.js'
import {
  createSuccessResult,
  createErrorResult,
  type ForegroundToolResult,
} from '../foreground/tools/foreground-tool-result.js'

export const SEARCH_SUBAGENT_TOOL_ID = 'search_subagent' as const
export const SEARCH_RESULT_RANKING_VERSION = 'relevance-source-quality-v1' as const
export { cleanSnippets, deduplicateResults, extractFacts, scoreSearchResult }

export interface SearchSubagentToolInput {
  originalQuestion: string
  intent?: SearchIntent
  locale?: string
  freshnessRequired?: boolean
}

export interface SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan
}

export interface SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[]
}

export interface SearchSubagentToolDeps {
  searchSubagent: SearchSubagent
  queryPlanner: SearchQueryPlanner
  resultNormalizer: SearchResultNormalizer
  scopeGuard: typeof assertSearchScope
}

export async function handleSearchSubagentTool(
  deps: SearchSubagentToolDeps,
  input: SearchSubagentToolInput,
): Promise<ForegroundToolResult<SearchSubagentToolResult>> {
  const startTime = Date.now()

  try {
    deps.scopeGuard('web_search')

    const plan = deps.queryPlanner.plan(input)
    const searchInput: SearchSubagentInput = {
      query: plan.searchQuery,
      userId: 'tool-invocation',
      sessionId: 'tool-invocation',
    }

    const searchResult: SearchSubagentResult = await deps.searchSubagent.execute(searchInput)
    if (!searchResult.success) {
      return createErrorResult<SearchSubagentToolResult>(
        searchResult.errorCode,
        searchResult.message,
        true,
        `Search failed: ${searchResult.message}`,
      )
    }

    const deduplicated = deduplicateResults(searchResult.toolResult.results)
    const cleaned = cleanSnippets(deduplicated)
    const sorted = rankSearchResults(cleaned, plan)
    const cropped = selectSearchResults(sorted)
    const extractedFacts = deps.resultNormalizer.extractFacts(cropped)
    const warnings = checkFreshnessWarning(plan, cropped)
    const metadata = buildSearchMetadata(Date.now() - startTime, cropped, extractedFacts, warnings, plan)

    return createSuccessResult<SearchSubagentToolResult>(
      {
        originalQuestion: plan.originalQuestion,
        searchQuery: plan.searchQuery,
        intent: plan.intent,
        freshness: plan.requiresFreshness,
        locale: plan.locale,
        results: cropped,
        extractedFacts,
        warnings,
        metadata,
        queryPlan: plan,
      },
      `Found ${cropped.length} results for "${plan.searchQuery}"`,
      {
        toolCallSummaries: [
          {
            toolCallId: `search-${Date.now()}`,
            toolName: SEARCH_SUBAGENT_TOOL_ID,
            status: 'completed',
          },
        ],
      },
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'SearchSubagentScopeError') {
      return createErrorResult<SearchSubagentToolResult>(
        'NON_SEARCH_TOOL_NOT_ALLOWED',
        error.message,
        false,
        'Search scope violation: attempted to use non-search tool.',
      )
    }

    return createErrorResult<SearchSubagentToolResult>(
      'SEARCH_SUBAGENT_ERROR',
      error instanceof Error ? error.message : 'Unknown search error',
      true,
      'An error occurred while searching.',
      {
        toolCallSummaries: [
          {
            toolCallId: `search-error-${Date.now()}`,
            toolName: SEARCH_SUBAGENT_TOOL_ID,
            status: 'failed',
          },
        ],
      },
    )
  }
}

function buildSearchMetadata(
  durationMs: number,
  results: readonly WebSearchResultItem[],
  facts: readonly ExtractedFact[],
  warnings: readonly SearchWarning[],
  plan: SearchQueryPlan,
): SearchSubagentMetadata {
  return {
    durationMs,
    resultCount: results.length,
    uniqueSourceCount: countUniqueSources(results),
    rankingVersion: SEARCH_RESULT_RANKING_VERSION,
    sourceQualityVersion: SOURCE_QUALITY_SCORING_VERSION,
    evidenceSufficiency: determineEvidenceSufficiency(results, facts, warnings, plan),
    searchCallCount: 1,
  }
}

export { DefaultSearchQueryPlanner }

export class DefaultSearchResultNormalizer implements SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[] {
    return extractFacts(results)
  }
}
