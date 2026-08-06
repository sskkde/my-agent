import { describe, expect, it, vi } from 'vitest'
import type { SearchSubagentToolDeps, SearchSubagentToolInput } from '../../../src/search/search-subagent-tool.js'
import type { SearchSubagentSuccessResult } from '../../../src/search/search-subagent.js'
import type { WebSearchResultItem } from '../../../src/search/types.js'
import { assertSearchScope } from '../../../src/search/search-subagent-types.js'
import { handleSearchSubagentTool } from '../../../src/search/search-subagent-tool.js'

function createDeps(
  results: WebSearchResultItem[],
  missingCriticalContext: readonly string[] = [],
): SearchSubagentToolDeps {
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

  it('reports searchCallCount=1 for a default one-round result and omits optional round fields', async () => {
    // Given: a mocked execution result WITHOUT internal round counters
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: searchCallCount=1 stays true and no optional multi-round fields leak
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.searchCallCount).toBe(1)
      expect(result.data.metadata.roundCount).toBeUndefined()
      expect(result.data.metadata.replanCount).toBeUndefined()
      expect(result.data.metadata.llmCallCount).toBeUndefined()
      expect(result.data.metadata.stopReason).toBeUndefined()
      expect(result.data.metadata.budgetExhausted).toBeUndefined()
    }
  })

  it('never leaks executedQueries into public metadata even when the internal result carries them', async () => {
    // Given: an internal execution result with a fully populated query list
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])
    ;(deps.searchSubagent.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      answer: 'internal answer',
      toolResult: {
        query: 'test query',
        results: [{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      },
      metadata: {
        providerId: 'test-provider',
        model: 'test-model',
        querySource: 'search_subagent',
        durationMs: 1,
        executedQueries: ['secret query one', 'secret query two'],
        roundCount: 2,
        replanCount: 1,
        searchCallCount: 2,
        llmCallCount: 4,
        stopReason: 'max_rounds',
        budgetExhausted: true,
      },
    })

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: the executed query list never reaches public metadata
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata).not.toHaveProperty('executedQueries')
      expect(result.data).not.toHaveProperty('executedQueries')
      expect(result.data).not.toHaveProperty('finalAnswer')
      expect(result.data).not.toHaveProperty('userVisibleResponse')
    }
  })

  it('copies real multi-round counters from internal metadata into public metadata', async () => {
    // Given: a two-round internal execution result carrying all counter fields
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])
    ;(deps.searchSubagent.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      answer: 'internal answer',
      toolResult: {
        query: 'test query',
        results: [{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      },
      metadata: {
        providerId: 'test-provider',
        model: 'test-model',
        querySource: 'search_subagent',
        durationMs: 1,
        executedQueries: ['q1', 'q2'],
        roundCount: 2,
        replanCount: 1,
        searchCallCount: 2,
        llmCallCount: 4,
        stopReason: 'max_rounds',
        budgetExhausted: true,
      },
    })

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: the real counters surface in public metadata without the query list
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.searchCallCount).toBe(2)
      expect(result.data.metadata.roundCount).toBe(2)
      expect(result.data.metadata.replanCount).toBe(1)
      expect(result.data.metadata.llmCallCount).toBe(4)
      expect(result.data.metadata.stopReason).toBe('max_rounds')
      expect(result.data.metadata.budgetExhausted).toBe(true)
      expect(result.data.metadata).not.toHaveProperty('executedQueries')
    }
  })

  it('keeps default one-round public metadata unchanged even when internal one-round counters are present', async () => {
    // Given: an internal result shaped exactly like the real default one-round executor output
    const deps = createDeps([{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }])
    ;(deps.searchSubagent.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      answer: 'internal answer',
      toolResult: {
        query: 'test query',
        results: [{ title: 'Result', url: 'https://example.com', snippet: 'Supported fact.' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      },
      metadata: {
        providerId: 'test-provider',
        model: 'test-model',
        querySource: 'search_subagent',
        durationMs: 1,
        executedQueries: ['test query'],
        roundCount: 1,
        replanCount: 0,
        searchCallCount: 1,
        llmCallCount: 2,
      },
    })

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: searchCallCount stays 1 and the optional multi-round fields stay absent
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.metadata.searchCallCount).toBe(1)
      expect(result.data.metadata.roundCount).toBeUndefined()
      expect(result.data.metadata.replanCount).toBeUndefined()
      expect(result.data.metadata.llmCallCount).toBeUndefined()
      expect(result.data.metadata.stopReason).toBeUndefined()
      expect(result.data.metadata.budgetExhausted).toBeUndefined()
    }
  })

  it('computes final resultCount/uniqueSourceCount/evidenceSufficiency from selected post-processing, not internal counts', async () => {
    // Given: a multi-round internal result whose merged raw results contain a duplicate URL
    const deps = createDeps([
      { title: 'Result A', url: 'https://example.com/page1', snippet: 'Supported fact one.' },
      { title: 'Result A dup', url: 'https://example.com/page1', snippet: 'Duplicate snippet.' },
      { title: 'Result B', url: 'https://example.org/page2', snippet: 'Supported fact two.' },
    ])
    ;(deps.searchSubagent.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      answer: 'internal answer',
      toolResult: {
        query: 'test query',
        results: [
          { title: 'Result A', url: 'https://example.com/page1', snippet: 'Supported fact one.' },
          { title: 'Result A dup', url: 'https://example.com/page1', snippet: 'Duplicate snippet.' },
          { title: 'Result B', url: 'https://example.org/page2', snippet: 'Supported fact two.' },
        ],
        total: 3,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      },
      metadata: {
        providerId: 'test-provider',
        model: 'test-model',
        querySource: 'search_subagent',
        durationMs: 1,
        executedQueries: ['q1', 'q2'],
        roundCount: 2,
        replanCount: 1,
        searchCallCount: 2,
        llmCallCount: 4,
        stopReason: 'sufficient_evidence',
      },
    })

    // When: the search evidence tool runs
    const result = await handleSearchSubagentTool(deps, { originalQuestion: 'test query' })

    // Then: evidence counts reflect the parent post-processing over the FINAL selected data
    expect(result.success).toBe(true)
    if (result.success && result.data) {
      expect(result.data.results).toHaveLength(2)
      expect(result.data.metadata.resultCount).toBe(2)
      expect(result.data.metadata.uniqueSourceCount).toBe(2)
      expect(result.data.metadata.evidenceSufficiency).toBe('sufficient')
      // The real execution counters are still reported alongside the evidence counts.
      expect(result.data.metadata.searchCallCount).toBe(2)
      expect(result.data.metadata.roundCount).toBe(2)
    }
  })

  it('exposes optional round counters on a fully populated internal success result', async () => {
    // Given: an internal success result typed against the execution metadata contract
    const internal: SearchSubagentSuccessResult = {
      success: true,
      answer: 'internal answer',
      toolResult: {
        query: 'test query',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      },
      metadata: {
        providerId: 'test-provider',
        model: 'test-model',
        querySource: 'search_subagent',
        durationMs: 1,
        executedQueries: ['q1', 'q2', 'q3'],
        roundCount: 3,
        replanCount: 2,
        searchCallCount: 3,
        llmCallCount: 7,
        stopReason: 'max_rounds',
        budgetExhausted: true,
      },
    }

    // Then: every optional round counter is typed and present on the internal metadata
    expect(internal.metadata.roundCount).toBe(3)
    expect(internal.metadata.replanCount).toBe(2)
    expect(internal.metadata.searchCallCount).toBe(3)
    expect(internal.metadata.llmCallCount).toBe(7)
    expect(internal.metadata.stopReason).toBe('max_rounds')
    expect(internal.metadata.budgetExhausted).toBe(true)
    expect(internal.metadata.executedQueries).toEqual(['q1', 'q2', 'q3'])
  })
})
