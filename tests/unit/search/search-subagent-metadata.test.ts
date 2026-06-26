import { describe, expect, it, vi } from 'vitest'
import type { SearchSubagentToolDeps, SearchSubagentToolInput } from '../../../src/search/search-subagent-tool.js'
import type { WebSearchResultItem } from '../../../src/search/types.js'
import { assertSearchScope } from '../../../src/search/search-subagent-types.js'
import { handleSearchSubagentTool } from '../../../src/search/search-subagent-tool.js'

function createDeps(results: WebSearchResultItem[], missingCriticalContext: readonly string[] = []): SearchSubagentToolDeps {
  return {
    searchSubagent: {
      execute: vi.fn().mockResolvedValue({
        success: true,
        answer: 'internal answer',
        toolResult: {
          query: 'test query',
          results,
          total: results.length,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: {
          providerId: 'test-provider',
          model: 'test-model',
          querySource: 'search_subagent',
          durationMs: 1,
        },
      }),
    },
    queryPlanner: {
      plan: vi.fn().mockImplementation((input: SearchSubagentToolInput) => ({
        originalQuestion: input.originalQuestion,
        searchQuery: 'test query',
        intent: input.intent ?? 'general',
        requiresFreshness: input.freshnessRequired ?? false,
        locale: input.locale,
        missingCriticalContext: [...missingCriticalContext],
      })),
    },
    resultNormalizer: {
      extractFacts: vi.fn().mockImplementation((items: readonly WebSearchResultItem[]) =>
        items.map((item) => ({
          fact: item.snippet,
          sourceUrl: item.url,
          confidence: 0.7,
          sourceTitle: item.title,
        })),
      ),
    },
    scopeGuard: assertSearchScope,
  }
}

describe('search subagent evidence metadata', () => {
  it('records one search call for a normal evidence request', async () => {
    // Given: a search tool dependency with one result
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: evidence metadata states that one search call was made
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.searchCallCount).toBe(1)
      expect(deps.searchSubagent.execute).toHaveBeenCalledTimes(1)
    }
  })

  it('marks evidence insufficient when no results are returned', async () => {
    // Given: a search tool dependency with no results
    const deps = createDeps([])

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: evidence sufficiency is explicit
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.evidenceSufficiency).toBe('insufficient')
    }
  })

  it('marks evidence partial when critical context is missing', async () => {
    // Given: a search plan with missing location context
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }], ['location'])

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'weather today', intent: 'weather' })

    // Then: evidence sufficiency is downgraded to partial
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.evidenceSufficiency).toBe('partial')
    }
  })

  it('marks evidence sufficient when results and facts are present', async () => {
    // Given: a search plan with supported facts and no missing context
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: evidence sufficiency is sufficient
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.evidenceSufficiency).toBe('sufficient')
    }
  })
})
