import { describe, it, expect, vi } from 'vitest'
import type { SearchSubagentToolResult } from '../../../src/search/search-subagent-types.js'
import type { SearchSubagentToolInput, SearchSubagentToolDeps } from '../../../src/search/search-subagent-tool.js'
import { assertSearchScope, SearchSubagentScopeError } from '../../../src/search/search-subagent-types.js'

function createMockDeps(overrides: Partial<SearchSubagentToolDeps> = {}): SearchSubagentToolDeps {
  return {
    searchSubagent: {
      execute: vi.fn().mockResolvedValue({
        success: true,
        answer: 'Test answer',
        toolResult: {
          query: 'weather in Tokyo today',
          results: [
            {
              title: 'Tokyo Weather',
              url: 'https://weather.com/tokyo',
              snippet: 'Current temperature is 22°C',
              source: 'weather.com',
            },
            {
              title: 'Tokyo Forecast',
              url: 'https://forecast.io/tokyo',
              snippet: 'Sunny with highs of 25°C',
              source: 'forecast.io',
            },
          ],
          total: 2,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        },
        metadata: {
          providerId: 'test-provider',
          model: 'test-model',
          querySource: 'search_subagent',
          durationMs: 150,
        },
      }),
    },
    queryPlanner: {
      plan: vi.fn().mockImplementation((input: SearchSubagentToolInput) => ({
        originalQuestion: input.originalQuestion,
        searchQuery: input.originalQuestion,
        intent: input.intent || 'general',
        requiresFreshness: input.freshnessRequired || false,
        locale: input.locale,
        missingCriticalContext: [],
      })),
    },
    resultNormalizer: {
      extractFacts: vi.fn().mockImplementation((results: Array<{ snippet: string; url: string }>) =>
        results.flatMap((r) =>
          r.snippet
            .split(/[.!?]+/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 10)
            .map((fact: string) => ({
              fact,
              sourceUrl: r.url,
              confidence: 0.7,
              relevanceScore: undefined,
            })),
        ),
      ),
    },
    scopeGuard: assertSearchScope,
    ...overrides,
  }
}

describe('SearchSubagentTool', () => {
  describe('Weather query returns structured evidence', () => {
    it('returns originalQuestion, searchQuery, results, extractedFacts, metadata.durationMs', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps()
      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo today',
        intent: 'weather',
        freshnessRequired: true,
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()

      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.originalQuestion).toBe('weather in Tokyo today')
      expect(toolResult.searchQuery).toBe('weather in Tokyo today')
      expect(toolResult.results).toBeDefined()
      expect(toolResult.results.length).toBeGreaterThan(0)
      expect(toolResult.extractedFacts).toBeDefined()
      expect(toolResult.extractedFacts.length).toBeGreaterThan(0)
      expect(toolResult.metadata.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('does NOT include finalAnswer or userVisibleResponse fields', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps()
      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo today',
        intent: 'weather',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult).not.toHaveProperty('finalAnswer')
      expect(toolResult).not.toHaveProperty('userVisibleResponse')
    })

    it('includes queryPlan in the result', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps()
      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo today',
        intent: 'weather',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.queryPlan).toBeDefined()
      expect(toolResult.queryPlan.originalQuestion).toBe('weather in Tokyo today')
      expect(toolResult.queryPlan.intent).toBe('weather')
    })

    it('extractedFacts include sourceUrls', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps()
      const input: SearchSubagentToolInput = {
        originalQuestion: 'weather in Tokyo today',
        intent: 'weather',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      for (const fact of toolResult.extractedFacts) {
        expect(fact.sourceUrl).toBeDefined()
        expect(typeof fact.sourceUrl).toBe('string')
        expect(fact.sourceUrl.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Duplicate URLs are deduplicated', () => {
    it('resultCount matches unique URLs', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'test query',
              results: [
                { title: 'Result 1', url: 'https://example.com/page1', snippet: 'Snippet 1' },
                { title: 'Result 2', url: 'https://example.com/page1', snippet: 'Duplicate snippet' },
                { title: 'Result 3', url: 'https://example.com/page2', snippet: 'Snippet 2' },
                { title: 'Result 4', url: 'https://example.com/page1', snippet: 'Another duplicate' },
                { title: 'Result 5', url: 'https://example.com/page3', snippet: 'Snippet 3' },
              ],
              total: 5,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.results).toHaveLength(3)
      expect(toolResult.metadata.resultCount).toBe(3)

      const urls = toolResult.results.map((r) => r.url)
      const uniqueUrls = new Set(urls)
      expect(uniqueUrls.size).toBe(3)
    })

    it('deduplicates case-insensitive URLs', async () => {
      const { deduplicateResults } = await import('../../../src/search/search-subagent-tool.js')

      const results = [
        { title: 'A', url: 'https://Example.COM/page', snippet: 's1' },
        { title: 'B', url: 'https://example.com/page', snippet: 's2' },
        { title: 'C', url: 'https://example.com/other', snippet: 's3' },
      ]

      const deduplicated = deduplicateResults(results)
      expect(deduplicated).toHaveLength(2)
    })
  })

  describe('Freshness warning added when time-sensitive query has no publishedAt', () => {
    it('adds FRESHNESS_UNVERIFIABLE warning when freshness required but no dates found', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'latest news today',
              results: [
                { title: 'Breaking News', url: 'https://news.com/latest', snippet: 'Something happened recently' },
              ],
              total: 1,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'what is the latest news today',
            searchQuery: 'latest news today',
            intent: 'news',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'what is the latest news today',
        intent: 'news',
        freshnessRequired: true,
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.warnings).toBeDefined()
      expect(toolResult.warnings.length).toBeGreaterThan(0)
      expect(toolResult.warnings[0].code).toBe('FRESHNESS_UNVERIFIABLE')
      expect(toolResult.warnings[0].message).toContain('outdated')
    })

    it('does NOT add freshness warning when dates are present in snippets', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'latest news today',
              results: [
                {
                  title: 'Breaking News',
                  url: 'https://news.com/latest',
                  snippet: 'Published on 2026-06-03, something happened',
                },
              ],
              total: 1,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'what is the latest news today',
            searchQuery: 'latest news today',
            intent: 'news',
            requiresFreshness: true,
            missingCriticalContext: [],
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'what is the latest news today',
        intent: 'news',
        freshnessRequired: true,
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.warnings).toHaveLength(0)
    })

    it('does NOT add freshness warning when freshness not required', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        queryPlanner: {
          plan: vi.fn().mockReturnValue({
            originalQuestion: 'how does photosynthesis work',
            searchQuery: 'how does photosynthesis work',
            intent: 'technical',
            requiresFreshness: false,
            missingCriticalContext: [],
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'how does photosynthesis work',
        intent: 'technical',
        freshnessRequired: false,
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.warnings).toHaveLength(0)
    })
  })

  describe('Non-search tool ID rejected by scope guard', () => {
    it('rejects non-search tool IDs via scope guard', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        scopeGuard: (toolId: string) => {
          if (toolId !== 'web_search' && toolId !== 'docs_search') {
            throw new SearchSubagentScopeError(toolId)
          }
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
    })

    it('scope guard throws SearchSubagentScopeError for invalid tools', () => {
      expect(() => assertSearchScope('foreground_spawn_planner')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('file_read')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('memory_retrieve')).toThrow(SearchSubagentScopeError)
    })

    it('scope guard allows valid search tools', () => {
      expect(() => assertSearchScope('web_search')).not.toThrow()
      expect(() => assertSearchScope('docs_search')).not.toThrow()
    })

    it('returns error result when scope guard throws', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        scopeGuard: (_toolId: string) => {
          throw new SearchSubagentScopeError('bad_tool')
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('NON_SEARCH_TOOL_NOT_ALLOWED')
    })
  })

  describe('Helper functions', () => {
    it('cleanSnippets strips HTML tags', async () => {
      const { cleanSnippets } = await import('../../../src/search/search-subagent-tool.js')

      const results = [{ title: 'Test', url: 'https://example.com', snippet: '<p>Hello <b>world</b></p>' }]

      const cleaned = cleanSnippets(results)
      expect(cleaned[0].snippet).toBe('Hello world')
    })

    it('cleanSnippets normalizes whitespace', async () => {
      const { cleanSnippets } = await import('../../../src/search/search-subagent-tool.js')

      const results = [{ title: 'Test', url: 'https://example.com', snippet: '  Hello   world  ' }]

      const cleaned = cleanSnippets(results)
      expect(cleaned[0].snippet).toBe('Hello world')
    })

    it('extractFacts creates facts from snippets', async () => {
      const { extractFacts } = await import('../../../src/search/search-subagent-tool.js')

      const results = [{ title: 'Test', url: 'https://example.com', snippet: 'This is a fact. This is another fact.' }]

      const facts = extractFacts(results)
      expect(facts.length).toBeGreaterThan(0)
      expect(facts[0].sourceUrl).toBe('https://example.com')
      expect(facts[0].confidence).toBe(0.7)
    })
  })

  describe('Relevance ranking', () => {
    it('does not rank a short but irrelevant title first', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'typescript module resolution',
              results: [
                { title: 'A', url: 'https://short.example/a', snippet: 'An unrelated homepage about gardening.' },
                {
                  title: 'TypeScript module resolution guide',
                  url: 'https://docs.example/typescript-module-resolution',
                  snippet: 'TypeScript module resolution explains how imports are found by the compiler.',
                },
              ],
              total: 2,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      })

      const result = await handleSearchSubagentTool(deps, {
        originalQuestion: 'typescript module resolution',
        intent: 'technical',
      })

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.results[0].title).toBe('TypeScript module resolution guide')
      expect(toolResult.metadata.rankingVersion).toBe('relevance-v1')
    })

    it('prioritizes dated results when freshness is required', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'latest node release',
              results: [
                {
                  title: 'Node release overview',
                  url: 'https://example.com/node-release-overview',
                  snippet: 'Node release information and version overview.',
                },
                {
                  title: 'Node release notes',
                  url: 'https://nodejs.org/en/blog/release',
                  snippet: 'Published on 2026-06-12 with the latest Node release notes.',
                },
              ],
              total: 2,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      })

      const result = await handleSearchSubagentTool(deps, {
        originalQuestion: 'latest node release',
        intent: 'news',
        freshnessRequired: true,
      })

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.results[0].url).toBe('https://nodejs.org/en/blog/release')
    })

    it('limits excessive results from the same domain', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const sameDomainResults = Array.from({ length: 5 }, (_, index) => ({
        title: `TypeScript module resolution deep dive ${index}`,
        url: `https://docs.example/typescript/module-resolution/${index}`,
        snippet: 'TypeScript module resolution imports compiler configuration documentation.',
      }))

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'Test answer',
            toolResult: {
              query: 'typescript module resolution',
              results: [
                ...sameDomainResults,
                {
                  title: 'TypeScript module resolution alternate source',
                  url: 'https://alt.example/typescript-module-resolution',
                  snippet: 'Alternate TypeScript module resolution documentation.',
                },
              ],
              total: 6,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 100,
            },
          }),
        },
      })

      const result = await handleSearchSubagentTool(deps, {
        originalQuestion: 'typescript module resolution',
        intent: 'technical',
      })

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult
      const docsExampleCount = toolResult.results.filter((r) => r.url.includes('docs.example')).length
      expect(docsExampleCount).toBe(3)
      expect(toolResult.results.some((r) => r.url.includes('alt.example'))).toBe(true)
    })
  })

  describe('Search subagent failure handling', () => {
    it('returns error result when search subagent fails', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: false,
            errorCode: 'MODEL_UNAVAILABLE',
            message: 'Search model is unavailable',
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('MODEL_UNAVAILABLE')
      expect(result.error!.recoverable).toBe(true)
      expect(result.error!.message).toBe('Search model is unavailable')
    })
  })

  describe('Empty results contract', () => {
    it('returns success with empty results array when search returns no results', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'No results found',
            toolResult: {
              query: 'nonexistent query xyz123',
              results: [],
              total: 0,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 50,
            },
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'nonexistent query xyz123',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()

      const toolResult = result.data as SearchSubagentToolResult
      expect(toolResult.results).toBeDefined()
      expect(toolResult.results).toEqual([])
      expect(toolResult.results).toHaveLength(0)
      expect(toolResult.metadata.resultCount).toBe(0)
      expect(toolResult.extractedFacts).toEqual([])
      expect(toolResult.warnings).toEqual([])
    })

    it('empty results do NOT crash or throw', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'No results',
            toolResult: {
              query: 'test',
              results: [],
              total: 0,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 10,
            },
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test',
      }

      await expect(handleSearchSubagentTool(deps, input)).resolves.toBeDefined()
      const result = await handleSearchSubagentTool(deps, input)
      expect(result.success).toBe(true)
    })

    it('empty results include all required evidence fields', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')

      const deps = createMockDeps({
        searchSubagent: {
          execute: vi.fn().mockResolvedValue({
            success: true,
            answer: 'No results',
            toolResult: {
              query: 'test',
              results: [],
              total: 0,
              provider: 'searxng',
              endpointHost: 'localhost:8888',
            },
            metadata: {
              providerId: 'test-provider',
              model: 'test-model',
              querySource: 'search_subagent',
              durationMs: 10,
            },
          }),
        },
      })

      const input: SearchSubagentToolInput = {
        originalQuestion: 'test query',
        intent: 'general',
      }

      const result = await handleSearchSubagentTool(deps, input)

      expect(result.success).toBe(true)
      const toolResult = result.data as SearchSubagentToolResult

      expect(toolResult.originalQuestion).toBe('test query')
      expect(toolResult.searchQuery).toBeDefined()
      expect(toolResult.intent).toBe('general')
      expect(toolResult.freshness).toBeDefined()
      expect(toolResult.results).toEqual([])
      expect(toolResult.extractedFacts).toEqual([])
      expect(toolResult.warnings).toEqual([])
      expect(toolResult.metadata).toBeDefined()
      expect(toolResult.metadata.resultCount).toBe(0)
      expect(toolResult.metadata.uniqueSourceCount).toBe(0)
      expect(toolResult.queryPlan).toBeDefined()
    })
  })
})
