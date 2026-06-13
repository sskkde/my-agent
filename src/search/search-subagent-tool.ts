/**
 * SearchSubagent Tool - returns structured evidence, NOT final user responses.
 * The Foreground Kernel synthesizes the final response from this evidence.
 */

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
import {
  createSuccessResult,
  createErrorResult,
  type ForegroundToolResult,
} from '../foreground/tools/foreground-tool-result.js'

export const SEARCH_SUBAGENT_TOOL_ID = 'search_subagent' as const

const MAX_RESULTS = 10
const MAX_RESULTS_PER_DOMAIN = 3
export const SEARCH_RESULT_RANKING_VERSION = 'relevance-v1' as const

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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return url.toLowerCase().trim()
  }
}

function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'for',
    'from',
    'how',
    'in',
    'is',
    'latest',
    'of',
    'on',
    'or',
    'the',
    'to',
    'today',
    'what',
    'when',
    'where',
    'with',
  ])

  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  )
}

function countKeywordMatches(text: string, keywords: string[]): number {
  const normalizedText = text.toLowerCase()
  return keywords.filter((keyword) => normalizedText.includes(keyword)).length
}

function hasTimeSignal(result: WebSearchResultItem): boolean {
  const text = `${result.title} ${result.snippet} ${result.source ?? ''}`
  return (
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text) ||
    /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i.test(text) ||
    /\b(?:published|updated|posted|last updated|date|today|yesterday|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i.test(
      text,
    )
  )
}

function getProviderRank(result: WebSearchResultItem): number | undefined {
  const ranked = result as WebSearchResultItem & {
    rank?: unknown
    position?: unknown
    providerRank?: unknown
    originalRank?: unknown
  }
  const candidates = [ranked.rank, ranked.position, ranked.providerRank, ranked.originalRank]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate
    }
  }
  return undefined
}

export function scoreSearchResult(result: WebSearchResultItem, plan: SearchQueryPlan): number {
  const keywords = tokenizeQuery(plan.searchQuery || plan.originalQuestion)
  const titleMatches = countKeywordMatches(result.title, keywords)
  const snippetMatches = countKeywordMatches(result.snippet, keywords)
  const timeSignal = hasTimeSignal(result)
  const providerRank = getProviderRank(result)

  let score = 0
  score += titleMatches * 12
  score += snippetMatches * 5
  score += Math.min(keywords.length, titleMatches + snippetMatches) * 2

  if (timeSignal) {
    score += plan.requiresFreshness ? 18 : 4
  } else if (plan.requiresFreshness) {
    score -= 8
  }

  if (providerRank !== undefined) {
    score += Math.max(0, 10 - providerRank)
  }

  if (extractDomain(result.url)) {
    score += 1
  }

  return score
}

function rankSearchResults(results: WebSearchResultItem[], plan: SearchQueryPlan): WebSearchResultItem[] {
  return results
    .map((result, index) => ({
      result,
      index,
      score: scoreSearchResult({ ...result, providerRank: index + 1 } as WebSearchResultItem, plan),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ result }) => result)
}

function limitResultsPerDomain(
  results: WebSearchResultItem[],
  maxPerDomain = MAX_RESULTS_PER_DOMAIN,
): WebSearchResultItem[] {
  const domainCounts = new Map<string, number>()
  const limited: WebSearchResultItem[] = []

  for (const result of results) {
    const domain = extractDomain(result.url)
    const count = domainCounts.get(domain) ?? 0
    if (count >= maxPerDomain) {
      continue
    }
    domainCounts.set(domain, count + 1)
    limited.push(result)
  }

  return limited
}

export function deduplicateResults(results: WebSearchResultItem[]): WebSearchResultItem[] {
  const seen = new Set<string>()
  const deduplicated: WebSearchResultItem[] = []

  for (const result of results) {
    const normalizedUrl = result.url.toLowerCase().trim()
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl)
      deduplicated.push(result)
    }
  }

  return deduplicated
}

export function cleanSnippets(results: WebSearchResultItem[]): WebSearchResultItem[] {
  return results.map((result) => ({
    ...result,
    snippet: result.snippet
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  }))
}

export function extractFacts(results: WebSearchResultItem[]): ExtractedFact[] {
  const facts: ExtractedFact[] = []

  for (const result of results) {
    const sentences = result.snippet
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10)

    for (const sentence of sentences) {
      facts.push({
        fact: sentence,
        sourceUrl: result.url,
        confidence: 0.7,
        relevanceScore: undefined,
      })
    }
  }

  return facts
}

function checkFreshnessWarning(plan: SearchQueryPlan, results: WebSearchResultItem[]): SearchWarning[] {
  const warnings: SearchWarning[] = []

  if (plan.requiresFreshness) {
    const hasTimestampInfo = results.some((r) => r.source?.includes('date') || r.snippet.match(/\d{4}-\d{2}-\d{2}/))

    if (!hasTimestampInfo && results.length > 0) {
      warnings.push({
        code: 'FRESHNESS_UNVERIFIABLE',
        message:
          'Query requires fresh results but no publication dates were found in the results. Information may be outdated.',
        recoverable: true,
      })
    }
  }

  return warnings
}

function countUniqueSources(results: WebSearchResultItem[]): number {
  const domains = new Set<string>()
  for (const result of results) {
    try {
      const url = new URL(result.url)
      domains.add(url.hostname)
    } catch {
      domains.add(result.url)
    }
  }
  return domains.size
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

    const rawResults = searchResult.toolResult.results
    const deduplicated = deduplicateResults(rawResults)
    const cleaned = cleanSnippets(deduplicated)
    const sorted = rankSearchResults(cleaned, plan)
    const domainLimited = limitResultsPerDomain(sorted)
    const cropped = domainLimited.slice(0, MAX_RESULTS)

    const extractedFacts = deps.resultNormalizer.extractFacts(cropped)
    const warnings = checkFreshnessWarning(plan, cropped)

    const durationMs = Date.now() - startTime
    const metadata: SearchSubagentMetadata = {
      durationMs,
      resultCount: cropped.length,
      uniqueSourceCount: countUniqueSources(cropped),
      rankingVersion: SEARCH_RESULT_RANKING_VERSION,
    }

    const toolResult: SearchSubagentToolResult = {
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
    }

    return createSuccessResult<SearchSubagentToolResult>(
      toolResult,
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

/**
 * Default implementation of SearchQueryPlanner.
 * Transforms tool input into a search query plan.
 */
export class DefaultSearchQueryPlanner implements SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan {
    const intent = input.intent ?? 'general'
    let searchQuery = input.originalQuestion

    if (intent === 'weather') {
      searchQuery = `weather ${input.originalQuestion}`
    } else if (intent === 'news') {
      searchQuery = `news ${input.originalQuestion}`
    } else if (intent === 'technical') {
      searchQuery = `${input.originalQuestion} documentation tutorial`
    }

    return {
      originalQuestion: input.originalQuestion,
      searchQuery,
      intent,
      requiresFreshness: input.freshnessRequired ?? false,
      locale: input.locale,
      missingCriticalContext: [],
    }
  }
}

/**
 * Default implementation of SearchResultNormalizer.
 * Extracts facts from search results using sentence splitting.
 */
export class DefaultSearchResultNormalizer implements SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[] {
    return extractFacts(results)
  }
}
