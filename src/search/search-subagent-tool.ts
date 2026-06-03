/**
 * SearchSubagent Tool - returns structured evidence, NOT final user responses.
 * The Foreground Kernel synthesizes the final response from this evidence.
 */

import type { SearchSubagent, SearchSubagentInput, SearchSubagentResult } from './search-subagent.js';
import type { WebSearchResultItem } from './types.js';
import type {
  SearchQueryPlan,
  SearchIntent,
  ExtractedFact,
  SearchWarning,
  SearchSubagentToolResult,
  SearchSubagentMetadata,
} from './search-subagent-types.js';
import { assertSearchScope } from './search-subagent-types.js';
import {
  createSuccessResult,
  createErrorResult,
  type ForegroundToolResult,
} from '../foreground/tools/foreground-tool-result.js';

export const SEARCH_SUBAGENT_TOOL_ID = 'search_subagent' as const;

const MAX_RESULTS = 10;

export interface SearchSubagentToolInput {
  originalQuestion: string;
  intent?: SearchIntent;
  locale?: string;
  freshnessRequired?: boolean;
}

export interface SearchQueryPlanner {
  plan(input: SearchSubagentToolInput): SearchQueryPlan;
}

export interface SearchResultNormalizer {
  extractFacts(results: WebSearchResultItem[]): ExtractedFact[];
}

export interface SearchSubagentToolDeps {
  searchSubagent: SearchSubagent;
  queryPlanner: SearchQueryPlanner;
  resultNormalizer: SearchResultNormalizer;
  scopeGuard: typeof assertSearchScope;
}

export function deduplicateResults(results: WebSearchResultItem[]): WebSearchResultItem[] {
  const seen = new Set<string>();
  const deduplicated: WebSearchResultItem[] = [];

  for (const result of results) {
    const normalizedUrl = result.url.toLowerCase().trim();
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      deduplicated.push(result);
    }
  }

  return deduplicated;
}

export function cleanSnippets(results: WebSearchResultItem[]): WebSearchResultItem[] {
  return results.map(result => ({
    ...result,
    snippet: result.snippet
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  }));
}

export function extractFacts(results: WebSearchResultItem[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  for (const result of results) {
    const sentences = result.snippet
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);

    for (const sentence of sentences) {
      facts.push({
        fact: sentence,
        sourceUrl: result.url,
        confidence: 0.7,
        relevanceScore: undefined,
      });
    }
  }

  return facts;
}

function checkFreshnessWarning(
  plan: SearchQueryPlan,
  results: WebSearchResultItem[]
): SearchWarning[] {
  const warnings: SearchWarning[] = [];

  if (plan.requiresFreshness) {
    const hasTimestampInfo = results.some(
      r => r.source?.includes('date') || r.snippet.match(/\d{4}-\d{2}-\d{2}/)
    );

    if (!hasTimestampInfo && results.length > 0) {
      warnings.push({
        code: 'FRESHNESS_UNVERIFIABLE',
        message: 'Query requires fresh results but no publication dates were found in the results. Information may be outdated.',
        recoverable: true,
      });
    }
  }

  return warnings;
}

function countUniqueSources(results: WebSearchResultItem[]): number {
  const domains = new Set<string>();
  for (const result of results) {
    try {
      const url = new URL(result.url);
      domains.add(url.hostname);
    } catch {
      domains.add(result.url);
    }
  }
  return domains.size;
}

export async function handleSearchSubagentTool(
  deps: SearchSubagentToolDeps,
  input: SearchSubagentToolInput
): Promise<ForegroundToolResult<SearchSubagentToolResult>> {
  const startTime = Date.now();

  try {
    deps.scopeGuard('web_search');

    const plan = deps.queryPlanner.plan(input);

    const searchInput: SearchSubagentInput = {
      query: plan.searchQuery,
      userId: 'tool-invocation',
      sessionId: 'tool-invocation',
    };

    const searchResult: SearchSubagentResult = await deps.searchSubagent.execute(searchInput);

    if (!searchResult.success) {
      return createErrorResult<SearchSubagentToolResult>(
        searchResult.errorCode,
        searchResult.message,
        true,
        `Search failed: ${searchResult.message}`
      );
    }

    const rawResults = searchResult.toolResult.results;
    const deduplicated = deduplicateResults(rawResults);
    const cleaned = cleanSnippets(deduplicated);
    const sorted = [...cleaned].sort((a, b) => a.title.length - b.title.length);
    const cropped = sorted.slice(0, MAX_RESULTS);

    const extractedFacts = deps.resultNormalizer.extractFacts(cropped);
    const warnings = checkFreshnessWarning(plan, cropped);

    const durationMs = Date.now() - startTime;
    const metadata: SearchSubagentMetadata = {
      durationMs,
      resultCount: cropped.length,
      uniqueSourceCount: countUniqueSources(cropped),
    };

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
    };

    return createSuccessResult<SearchSubagentToolResult>(
      toolResult,
      `Found ${cropped.length} results for "${plan.searchQuery}"`,
      {
        toolCallSummaries: [{
          toolCallId: `search-${Date.now()}`,
          toolName: SEARCH_SUBAGENT_TOOL_ID,
          status: 'completed',
        }],
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'SearchSubagentScopeError') {
      return createErrorResult<SearchSubagentToolResult>(
        'NON_SEARCH_TOOL_NOT_ALLOWED',
        error.message,
        false,
        'Search scope violation: attempted to use non-search tool.'
      );
    }

    return createErrorResult<SearchSubagentToolResult>(
      'SEARCH_SUBAGENT_ERROR',
      error instanceof Error ? error.message : 'Unknown search error',
      true,
      'An error occurred while searching.',
      {
        toolCallSummaries: [{
          toolCallId: `search-error-${Date.now()}`,
          toolName: SEARCH_SUBAGENT_TOOL_ID,
          status: 'failed',
        }],
      }
    );
  }
}
