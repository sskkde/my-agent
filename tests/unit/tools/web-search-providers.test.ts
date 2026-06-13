import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { WebSearchResult } from '../../../src/search/types.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'

const FIXTURES_DIR = join(__dirname, '../../fixtures/web-search')

async function loadFixture(filename: string): Promise<unknown> {
  const content = await readFile(join(FIXTURES_DIR, filename), 'utf-8')
  return JSON.parse(content)
}

function createMockModelInputBuilder(): ModelInputBuilder {
  const mock = {
    build: vi.fn().mockImplementation(async (input: ModelInputBuildInput) => {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = []
      messages.push({ role: 'system', content: 'System prompt' })
      if (input.currentUserMessage) {
        messages.push({ role: 'user', content: input.currentUserMessage })
      }
      const result: BuiltModelInput = {
        messages,
        segments: {
          staticPrefix: 'static',
          tenantProject: '',
          toolPlane: '',
          contextBundle: input.currentUserMessage || '',
        },
        segmentHashes: {
          segmentA: 'a'.repeat(64),
          segmentB: 'b'.repeat(64),
          segmentC: 'c'.repeat(64),
          segmentD: 'd'.repeat(64),
        },
        metadata: {
          mode: input.mode,
          agentKind: input.agentKind,
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      }
      return result
    }),
  }
  return mock as unknown as ModelInputBuilder
}

describe('web-search-providers contract tests', () => {
  describe('SearXNG normalizer', () => {
    it('normalizes SearXNG results from fixture', async () => {
      const fixture = await loadFixture('searxng-success.json')

      const { normalizeSearXNGResponse } = await import('../../../src/search/providers/searxng.js')

      const result = normalizeSearXNGResponse(fixture, 'http://localhost:8888')

      expect(result.provider).toBe('searxng')
      expect(result.endpointHost).toBe('localhost:8888')
      expect(result.query).toBe('lightweight local search')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('SearXNG: A privacy-respecting metasearch engine')
      expect(result.results[0].url).toBe('https://searxng.org/docs/')
      expect(result.results[0].snippet).toContain('metasearch engine')
      expect(result.total).toBe(2)
    })

    it('returns SearXNG results with preserved contract', async () => {
      const fixture = await loadFixture('searxng-success.json')

      const { normalizeSearXNGResponse } = await import('../../../src/search/providers/searxng.js')

      const result = normalizeSearXNGResponse(fixture, 'http://localhost:8888')

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('provider')
      expect(result).toHaveProperty('endpointHost')
      expect(typeof result.query).toBe('string')
      expect(Array.isArray(result.results)).toBe(true)
      expect(typeof result.total).toBe('number')
      expect(typeof result.provider).toBe('string')
      expect(typeof result.endpointHost).toBe('string')
    })

    it('handles empty SearXNG results', async () => {
      const fixture = await loadFixture('empty-results.json')

      const { normalizeSearXNGResponse } = await import('../../../src/search/providers/searxng.js')

      const result = normalizeSearXNGResponse(fixture, 'http://localhost:8888')

      expect(result.results).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('Tavily normalizer', () => {
    it('normalizes Tavily results from fixture', async () => {
      const fixture = await loadFixture('tavily-success.json')

      const { normalizeTavilyResponse } = await import('../../../src/search/providers/tavily.js')

      const result = normalizeTavilyResponse(fixture)

      expect(result.provider).toBe('tavily')
      expect(result.endpointHost).toBe('api.tavily.com')
      expect(result.query).toBe('AI agent frameworks')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('LangChain: Build context-aware reasoning applications')
      expect(result.results[0].url).toBe('https://www.langchain.com/')
      expect(result.results[0].snippet).toContain('framework')
    })

    it('uses custom Tavily endpoint host when configured', async () => {
      const fixture = await loadFixture('tavily-success.json')

      const { normalizeTavilyResponse } = await import('../../../src/search/providers/tavily.js')

      const result = normalizeTavilyResponse(fixture, 'https://custom.tavily.example.com')

      expect(result.endpointHost).toBe('custom.tavily.example.com')
    })
  })

  describe('Legacy remote normalizer', () => {
    it('normalizes legacy remote results from fixture', async () => {
      const fixture = await loadFixture('legacy-remote-success.json')

      const { normalizeLegacyRemoteResponse } = await import('../../../src/search/providers/legacy-remote.js')

      const result = normalizeLegacyRemoteResponse(fixture, 'https://search.example.com/api')

      expect(result.provider).toBe('custom')
      expect(result.endpointHost).toBe('search.example.com')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].title).toBe('Remote Search Result A')
    })
  })

  describe('Provider error handling', () => {
    it('handles malformed provider payload', async () => {
      const fixture = await loadFixture('malformed-provider-payload.json')

      const { normalizeSearXNGResponse } = await import('../../../src/search/providers/searxng.js')

      const result = normalizeSearXNGResponse(fixture, 'http://localhost:8888')

      expect(result.results).toEqual([])
      expect(result.total).toBe(0)
    })

    it('handles provider error response', async () => {
      const fixture = await loadFixture('provider-error.json')

      const { isProviderErrorResponse } = await import('../../../src/search/providers/errors.js')

      expect(isProviderErrorResponse(fixture)).toBe(true)
    })
  })

  describe('Backend selection matrix', () => {
    it('default auto excludes Playwright', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).not.toBe('playwright')
      expect(['searxng', 'tavily', 'remote', 'none']).toContain(result.selectedBackend)
    })

    it('auto-browser falls back to Playwright only after lightweight providers fail', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto-browser',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('playwright')
    })

    it('explicit playwright backend is selected when configured', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'playwright',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('playwright')
    })

    it('searxng backend is selected when configured', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'searxng',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('searxng')
    })

    it('uses Tavily when selected', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'tavily',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('tavily')
    })

    it('remote backend is selected when configured', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'remote',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('remote')
    })

    it('returns PROVIDER_NOT_CONFIGURED when no providers available', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('none')
      expect(result.errorCode).toBe('PROVIDER_NOT_CONFIGURED')
    })
  })

  describe('Provider rate limiter', () => {
    it('applies provider rate limiting with jitter', async () => {
      const { SearchRateLimiter } = await import('../../../src/search/rate-limiter.js')

      let currentTime = 0
      const limiter = new SearchRateLimiter({
        minIntervalMs: 1000,
        maxJitterMs: 200,
        now: () => currentTime,
        sleep: async (ms: number) => {
          currentTime += ms
        },
        random: () => 0.5,
      })

      const start = currentTime
      await limiter.acquire()
      const firstAcquire = currentTime

      expect(firstAcquire - start).toBe(0)

      await limiter.acquire()
      const secondAcquire = currentTime

      expect(secondAcquire - firstAcquire).toBeGreaterThanOrEqual(1000)
      expect(secondAcquire - firstAcquire).toBeLessThanOrEqual(1200)
    })

    it('tracks provider-specific rate limits separately', async () => {
      const { SearchRateLimiter } = await import('../../../src/search/rate-limiter.js')

      let currentTime = 0
      const limiter = new SearchRateLimiter({
        minIntervalMs: 500,
        maxJitterMs: 0,
        now: () => currentTime,
        sleep: async (ms: number) => {
          currentTime += ms
        },
        random: () => 0,
      })

      const searxngStart = currentTime
      await limiter.acquire('searxng')
      await limiter.acquire('searxng')
      const searxngElapsed = currentTime - searxngStart

      const tavilyStart = currentTime
      await limiter.acquire('tavily')
      await limiter.acquire('tavily')
      const tavilyElapsed = currentTime - tavilyStart

      expect(searxngElapsed).toBeGreaterThanOrEqual(500)
      expect(tavilyElapsed).toBeGreaterThanOrEqual(500)
    })

    it('uses async timer-based waiting instead of busy-wait loop', async () => {
      vi.useFakeTimers()
      const { SearchRateLimiter } = await import('../../../src/search/rate-limiter.js')

      const limiter = new SearchRateLimiter({
        minIntervalMs: 100,
        maxJitterMs: 0,
        random: () => 0,
      })

      await limiter.acquire()

      const acquirePromise = limiter.acquire()
      await vi.advanceTimersByTimeAsync(100)
      await acquirePromise

      vi.useRealTimers()
    })
  })

  describe('Public contract preservation', () => {
    it('WebSearchResult preserves query field', () => {
      const result: WebSearchResult = {
        query: 'test query',
        results: [],
        total: 0,
        provider: 'custom',
        endpointHost: 'example.com',
      }

      expect(result.query).toBe('test query')
    })

    it('WebSearchResult preserves results field', () => {
      const result: WebSearchResult = {
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 'snippet' }],
        total: 1,
        provider: 'custom',
        endpointHost: 'example.com',
      }

      expect(result.results).toHaveLength(1)
      expect(result.results[0].title).toBe('A')
    })

    it('WebSearchResult preserves total field', () => {
      const result: WebSearchResult = {
        query: 'test',
        results: [],
        total: 42,
        provider: 'custom',
        endpointHost: 'example.com',
      }

      expect(result.total).toBe(42)
    })

    it('WebSearchResult preserves provider field', () => {
      const result: WebSearchResult = {
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      }

      expect(result.provider).toBe('searxng')
    })

    it('WebSearchResult preserves endpointHost field', () => {
      const result: WebSearchResult = {
        query: 'test',
        results: [],
        total: 0,
        provider: 'tavily',
        endpointHost: 'api.tavily.com',
      }

      expect(result.endpointHost).toBe('api.tavily.com')
    })
  })

  describe('Error path scenarios', () => {
    it('returns PROVIDER_NOT_CONFIGURED when no lightweight provider is configured in auto mode', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('none')
      expect(result.errorCode).toBe('PROVIDER_NOT_CONFIGURED')
    })

    it('selects searxng backend when explicitly requested even without config', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'searxng',
        searxngBaseUrl: undefined,
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('searxng')
    })

    it('selects tavily backend when explicitly requested even without config', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'tavily',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: undefined,
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('tavily')
    })

    it('selects remote backend when explicitly requested even without config', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'remote',
        searxngBaseUrl: 'http://localhost:8888',
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('remote')
    })

    it('selects playwright backend when explicitly requested', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'playwright',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('playwright')
    })

    it('falls back through providers in auto mode', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto',
        searxngBaseUrl: undefined,
        tavilyApiKey: 'tavily-key',
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('tavily')
    })

    it('falls back to remote when SearXNG and Tavily are unavailable', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: 'https://remote.example.com',
      })

      expect(result.selectedBackend).toBe('remote')
    })

    it('auto-browser falls back to playwright when lightweight providers fail', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto-browser',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('playwright')
    })

    it('auto-browser falls back to playwright even when playwrightAvailable is not specified', async () => {
      const { resolveSearchBackend } = await import('../../../src/search/backend-resolver.js')

      const result = resolveSearchBackend({
        backend: 'auto-browser',
        searxngBaseUrl: undefined,
        tavilyApiKey: undefined,
        remoteApiUrl: undefined,
      })

      expect(result.selectedBackend).toBe('playwright')
    })
  })

  describe('SearchSubagent error codes', () => {
    it('SEARCH_MODEL_INCAPABLE is returned when model lacks function calling', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn(),
        getProviderCapabilities: vi.fn().mockReturnValue({
          supportsFunctionCalling: false,
        }),
      }

      const mockWebSearchExecutor = vi.fn()

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errorCode).toBe('SEARCH_MODEL_INCAPABLE')
      }
    })

    it('MODEL_UNAVAILABLE is returned when model request fails', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockRejectedValue(new Error('Model unavailable')),
      }

      const mockWebSearchExecutor = vi.fn()

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errorCode).toBe('MODEL_UNAVAILABLE')
      }
    })

    it('NO_TOOL_CALL is returned when model does not call tools', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-1',
            content: 'I cannot perform web searches.',
            model: 'gpt-4.1-mini',
            toolCalls: undefined,
            finishReason: 'stop',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn()

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errorCode).toBe('NO_TOOL_CALL')
      }
    })

    it('INVALID_TOOL_CALL is returned when model calls wrong tool', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-1',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_fetch',
                  arguments: '{"url": "https://example.com"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn()

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errorCode).toBe('INVALID_TOOL_CALL')
      }
    })
  })
})
