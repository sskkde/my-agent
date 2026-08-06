import { describe, it, expect, vi } from 'vitest'
import type {
  SearchPhaseObservation,
  SearchSubagentResult,
  SearchSubagentSuccessResult,
  SearchSubagentFailureResult,
} from '../../../src/search/search-subagent.js'
import { createSearchSubagent } from '../../../src/search/search-subagent.js'
import { MULTI_ROUND_SEARCH_POLICY } from '../../../src/search/search-round-budget.js'
import type { SearchRoundPolicy } from '../../../src/search/search-round-budget.js'
import type { SearchPlanHints } from '../../../src/search/search-subagent-types.js'
import type { WebSearchResult, WebSearchResultItem } from '../../../src/search/types.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'

function assertSuccess(result: SearchSubagentResult): asserts result is SearchSubagentSuccessResult {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${(result as SearchSubagentFailureResult).errorCode}`)
  }
}

function assertFailure(result: SearchSubagentResult): asserts result is SearchSubagentFailureResult {
  if (result.success) {
    throw new Error('Expected failure but got success')
  }
}

function createMockModelInputBuilder(): ModelInputBuilder {
  const mock = {
    build: vi.fn().mockImplementation(async (input: ModelInputBuildInput) => {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = []

      if (input.mode === 'function_calling') {
        messages.push({
          role: 'system',
          content: 'You are a search assistant. Use the web_search tool to find information.',
        })
        if (input.currentUserMessage) {
          messages.push({
            role: 'user',
            content: input.currentUserMessage,
          })
        }
      } else if (input.mode === 'structured_json') {
        messages.push({
          role: 'system',
          content: 'You are a search assistant. Provide a helpful answer based on the search results.',
        })
        if (input.contextBundle?.orderedItems) {
          const contextContent = input.contextBundle.orderedItems
            .map((item: unknown) => (item as { content: string }).content)
            .join('\n')
          messages.push({
            role: 'user',
            content: `Context:\n${contextContent}\n\nQuery: ${input.currentUserMessage || ''}`,
          })
        } else if (input.currentUserMessage) {
          messages.push({
            role: 'user',
            content: input.currentUserMessage,
          })
        }
      }

      const result: BuiltModelInput = {
        messages,
        segments: {
          staticPrefix: 'platform-base',
          tenantProject: '',
          toolPlane: input.toolProjection ? `Tools: ${input.toolProjection.toolIds.join(', ')}` : '',
          contextBundle: input.currentUserMessage || '',
        },
        segmentHashes: {
          segmentA: 'a'.repeat(64),
          segmentB: 'b'.repeat(64),
          segmentC: 'c'.repeat(64),
          segmentD: 'd'.repeat(64),
        },
        metadata: {
          mode: input.mode as 'structured_json' | 'function_calling',
          agentKind: input.agentKind ?? 'kernel',
          agentType: input.agentType ?? 'main',
          agentProfile: input.agentProfile ?? input.agentKind ?? 'default',
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      }

      return result
    }),
  }
  return mock as unknown as ModelInputBuilder
}

describe('SearchSubagent contract tests', () => {
  describe('uses only web_search and dedicated search model', () => {
    it('provides exactly one tool to the search model', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]

      expect(llmRequest.tools).toHaveLength(1)
      expect(llmRequest.tools[0].function.name).toBe('web_search')
    })

    it('forces toolChoice to web_search', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]

      expect(llmRequest.toolChoice).toEqual({ type: 'function', function: { name: 'web_search' } })
    })

    it('uses dedicated search model from config', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]

      expect(llmRequest.model).toBe('gpt-4.1-mini')
    })

    it('does not include full session context', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]

      const systemMessage = llmRequest.messages.find((m: { role: string }) => m.role === 'system')

      expect(systemMessage?.content).not.toContain('session-456')
      expect(systemMessage?.content).not.toContain('transcript')

      const userMessage = llmRequest.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage?.content).toBe('test query')
    })
  })

  describe('fails closed when search model cannot call tools', () => {
    it('returns explicit failure when model lacks function calling capability', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: 'I cannot perform web searches.',
            model: 'gpt-4.1-mini',
            toolCalls: undefined,
            finishReason: 'stop',
          },
        }),
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
      assertFailure(result)
      expect(result.errorCode).toBe('SEARCH_MODEL_INCAPABLE')
      expect(mockWebSearchExecutor).not.toHaveBeenCalled()
    })

    it('does not fall back to main foreground model', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        // Phase1 forced + auto both fail; phase2 answer generation may still be attempted after
        // input-query web-search fallback. Never switches model id to mainLlmModel.
        complete: vi.fn().mockRejectedValue(new Error('Model unavailable')),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test query',
        results: [{ title: 'T', url: 'https://example.com', snippet: 'S' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
        mainLlmProviderId: 'provider-main',
        mainLlmModel: 'gpt-4',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      // Resilient path: still executes web search with the dedicated search query/model config.
      expect(mockWebSearchExecutor).toHaveBeenCalledWith({ query: 'test query' })
      expect(mockLlmAdapter.complete.mock.calls.length).toBeGreaterThanOrEqual(1)
      for (const call of mockLlmAdapter.complete.mock.calls) {
        expect(call[0].model).toBe('gpt-4.1-mini')
        expect(call[0].model).not.toBe('gpt-4')
      }
      // Answer generation also fails, so success payload may degrade but must not use main model.
      if (result.success) {
        expect(result.metadata.model).toBe('gpt-4.1-mini')
        expect(result.metadata.providerId).toBe('provider-search')
      }
    })
  })

  describe('answer/toolResult/metadata contract', () => {
    it('returns user-visible answer string', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Based on the search results, here is the answer.',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

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

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(typeof result.answer).toBe('string')
      expect(result.answer).toContain('answer')
    })

    it('returns web_search toolResult for evidence', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

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

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.toolResult).toBeDefined()
      expect(result.toolResult.provider).toBe('searxng')
      expect(result.toolResult.results).toHaveLength(1)
    })

    it('returns internal metadata with provider/model/querySource/durationMs', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

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

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.metadata).toBeDefined()
      expect(result.metadata.providerId).toBe('provider-search')
      expect(result.metadata.model).toBe('gpt-4.1-mini')
      expect(result.metadata.querySource).toBe('search_subagent')
      expect(typeof result.metadata.durationMs).toBe('number')
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns user-visible answer with internal metadata', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Based on the search results, here is the answer.',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

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

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(typeof result.answer).toBe('string')
      expect(result.answer).toContain('answer')
      expect(result.toolResult).toBeDefined()
      expect(result.toolResult.query).toBe('test')
      expect(result.metadata).toBeDefined()
      expect(result.metadata.providerId).toBe('provider-search')
      expect(result.metadata.model).toBe('gpt-4.1-mini')
      expect(result.metadata.querySource).toBe('search_subagent')
      expect(typeof result.metadata.durationMs).toBe('number')
    })
  })

  describe('tool boundary enforcement', () => {
    it('never calls tools other than web_search', async () => {
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
      assertFailure(result)
      expect(result.errorCode).toBe('INVALID_TOOL_CALL')
      expect(mockWebSearchExecutor).not.toHaveBeenCalled()
    })
  })

  describe('ModelInputBuilder integration', () => {
    it('uses ModelInputBuilder for Phase 1 (function_calling mode)', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockModelInputBuilder = createMockModelInputBuilder()

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(mockModelInputBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'function_calling',
          agentProfile: 'search',
          agentType: 'subagent',
          providerFamily: 'openai',
        }),
      )
    })

    it('uses ModelInputBuilder for Phase 2 (structured_json mode)', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockModelInputBuilder = createMockModelInputBuilder()

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const buildMock = mockModelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      const calls = buildMock.mock.calls
      const phase2Call = calls[1]

      expect(phase2Call[0]).toMatchObject({
        mode: 'structured_json',
        agentProfile: 'search',
        agentType: 'subagent',
        providerFamily: 'openai',
      })
      expect(phase2Call[0].contextBundle).toBeDefined()
      expect(phase2Call[0].contextBundle.orderedItems).toBeDefined()
    })

    it('both phases share the same Segment A hash', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const segmentAHash = 'test-segment-a-hash-12345678901234567890123456789012345678901234567890'
      const mockModelInputBuilder = {
        build: vi.fn().mockImplementation(async () => ({
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'User message' },
          ],
          segments: {
            staticPrefix: 'static-prefix',
            tenantProject: '',
            toolPlane: '',
            contextBundle: 'context',
          },
          segmentHashes: {
            segmentA: segmentAHash,
            segmentB: 'b'.repeat(64),
            segmentC: 'c'.repeat(64),
            segmentD: 'd'.repeat(64),
          },
          metadata: {
            mode: 'function_calling',
            agentKind: 'search',
            providerFamily: 'openai',
            messageCount: 2,
          },
        })),
      }

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder as unknown as ModelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.metadata.segmentAHash).toBe(segmentAHash)

      expect(mockModelInputBuilder.build).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * ─── Boundary Validation Tests ─────────────────────────────────────────────────
   *
   * These tests document the boundary between SearchSubagent.execute() and
   * handleSearchSubagentTool(). They confirm the synchronous search path has:
   * - MAX_RESULTS = 10 (result cropping limit)
   * - Forced web_search tool choice (no tool selection freedom)
   * - No subagent_runtime dependency (direct execution, not delegated)
   *
   * Architecture:
   *
   * SearchSubagent.execute() responsibilities:
   *   - Phase 1: Build function_calling request with forced web_search toolChoice
   *   - Phase 2: Build structured_json request for answer generation
   *   - Execute LLM calls directly via llmAdapter.complete()
   *   - Execute web search via webSearchExecutor()
   *   - Return raw SearchSubagentResult with answer, toolResult, metadata
   *   - NO result cropping, deduplication, or post-processing
   *
   * handleSearchSubagentTool() responsibilities:
   *   - Scope guard check (assertSearchScope)
   *   - Query planning (queryPlanner.plan)
   *   - Delegate to SearchSubagent.execute()
   *   - Post-process results: deduplicate → clean → sort → crop to MAX_RESULTS
   *   - Extract facts and check freshness warnings
   *   - Return ForegroundToolResult with structured evidence
   */
  describe('boundary validation: execute() vs handleSearchSubagentTool()', () => {
    it('execute() performs raw search without result cropping', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      // Create 20 results - more than MAX_RESULTS
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        snippet: `Snippet ${i}`,
      }))

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: manyResults,
        total: 20,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

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

      expect(result.success).toBe(true)
      assertSuccess(result)
      // execute() returns ALL 20 results - no cropping
      expect(result.toolResult.results).toHaveLength(20)
    })

    it('handleSearchSubagentTool() crops results to MAX_RESULTS = 10', async () => {
      const { handleSearchSubagentTool } = await import('../../../src/search/search-subagent-tool.js')
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      // Create 20 results - more than MAX_RESULTS
      const manyResults = Array.from({ length: 20 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        snippet: `Snippet ${i}`,
      }))

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: manyResults,
        total: 20,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const mockQueryPlanner = {
        plan: vi.fn().mockReturnValue({
          originalQuestion: 'test query',
          searchQuery: 'test',
          intent: 'informational',
          requiresFreshness: false,
          locale: undefined,
        }),
      }

      const mockResultNormalizer = {
        extractFacts: vi.fn().mockReturnValue([]),
      }

      const mockScopeGuard = vi.fn()

      const result = await handleSearchSubagentTool(
        {
          searchSubagent: subagent,
          queryPlanner: mockQueryPlanner,
          resultNormalizer: mockResultNormalizer,
          scopeGuard: mockScopeGuard,
        },
        {
          originalQuestion: 'test query',
        },
      )

      expect(result.success).toBe(true)
      if (result.success && result.data) {
        // handleSearchSubagentTool() crops to MAX_RESULTS = 10
        expect(result.data.results).toHaveLength(10)
        expect(result.data.metadata.resultCount).toBe(10)
      }
    })

    it('execute() forces toolChoice to web_search (no freedom)', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"query": "test"}',
                },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]

      // toolChoice forces web_search so models cannot skip tool emission (DeepSeek flash regression)
      expect(llmRequest.toolChoice).toEqual({ type: 'function', function: { name: 'web_search' } })
    })

    it('execute() uses direct llmAdapter.complete() - no subagent_runtime', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
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
                    name: 'web_search',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: 'Answer',
              model: 'gpt-4.1-mini',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      // Direct execution via llmAdapter.complete() - 2 calls (Phase 1 + Phase 2)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(2)
      // No subagent_runtime.launchSubagent() or similar delegation
    })
  })

  describe('NO_TOOL_CALL resilient fallback', () => {
    it('falls back to input query when model omits toolCalls', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-no-tool',
              content: 'I will search for you without calling a tool.',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-answer',
              content: 'Beijing is sunny.',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'today Beijing weather',
        results: [{ title: 'Weather', url: 'https://example.com', snippet: '27C' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'deepseek',
        searchLlmProviderId: 'provider-deepseek',
        searchLlmModel: 'deepseek-v4-flash',
      })

      const result = await subagent.execute({
        query: 'today Beijing weather',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(true)
      expect(mockWebSearchExecutor).toHaveBeenCalledTimes(1)
      expect(mockWebSearchExecutor).toHaveBeenCalledWith({ query: 'today Beijing weather' })
      // forced phase1 + phase2 answer (no auto retry because forced succeeded without tools)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(2)
      if (result.success) {
        expect(result.answer).toBe('Beijing is sunny.')
      }
    })

    it('retries with auto then falls back when forced toolChoice request fails', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          // forced fails
          .mockResolvedValueOnce({
            success: false,
            error: { code: 'ALL_PROVIDERS_FAILED', message: 'All providers failed after 1 attempts' },
          })
          // auto also no tools
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-auto',
              content: 'no tools',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          })
          // answer generation
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-answer',
              content: 'Recovered answer',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'beijing weather',
        results: [{ title: 'W', url: 'https://x.com', snippet: 'ok' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'deepseek',
        searchLlmProviderId: 'provider-deepseek',
        searchLlmModel: 'deepseek-v4-flash',
      })

      const result = await subagent.execute({
        query: 'beijing weather',
        userId: 'u',
        sessionId: 's',
      })

      expect(result.success).toBe(true)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(mockLlmAdapter.complete.mock.calls[0][0].toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      })
      expect(mockLlmAdapter.complete.mock.calls[1][0].toolChoice).toEqual('auto')
      expect(mockWebSearchExecutor).toHaveBeenCalledWith({ query: 'beijing weather' })
      if (result.success) {
        expect(result.answer).toBe('Recovered answer')
      }
    })

    it('forces toolChoice to the web_search function on first attempt', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'deepseek-v4-flash',
            toolCalls: [
              {
                id: 'tc-1',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"q"}' },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'q',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'deepseek',
        searchLlmProviderId: 'provider-deepseek',
        searchLlmModel: 'deepseek-v4-flash',
      })

      await subagent.execute({ query: 'q', userId: 'u', sessionId: 's' })
      const llmRequest = mockLlmAdapter.complete.mock.calls[0][0]
      expect(llmRequest.toolChoice).toEqual({ type: 'function', function: { name: 'web_search' } })
    })
  })

  /**
   * ─── Default one-round contract (locked regression for the phase split) ──────
   *
   * These tests pin the CURRENT exact behavior of createSearchSubagent.execute()
   * so the phase extraction (search-query-phase / search-answer-phase) can prove
   * byte compatibility: one backend call, phase1 + phase2 exactly once, forced
   * web_search tool_choice -> auto retry -> input fallback, fallback messages,
   * dedicated model, output shape and Segment A hash stability.
   */
  describe('default one-round request sequence (locked regression)', () => {
    it('pins exact default sequence: forced phase1 → one backend → one phase2 with two LLM builds', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockModelInputBuilder = createMockModelInputBuilder()
      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-2', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })

      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(2)
      expect(mockLlmAdapter.complete.mock.calls[0][0].toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      })
      expect(mockLlmAdapter.complete.mock.calls[1][0].toolChoice).toBeUndefined()
      for (const call of mockLlmAdapter.complete.mock.calls) {
        expect(call[0].model).toBe('gpt-4.1-mini')
      }
      expect(mockWebSearchExecutor).toHaveBeenCalledTimes(1)
      expect(mockWebSearchExecutor).toHaveBeenCalledWith({ query: 'test' })
      const buildMock = mockModelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      expect(buildMock).toHaveBeenCalledTimes(2)
      expect(buildMock.mock.calls[0][0].mode).toBe('function_calling')
      expect(buildMock.mock.calls[1][0].mode).toBe('structured_json')
      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.answer).toBe('Answer')
      expect(result.toolResult.query).toBe('test')
      expect(result.metadata.providerId).toBe('provider-search')
      expect(result.metadata.model).toBe('gpt-4.1-mini')
      expect(result.metadata.querySource).toBe('search_subagent')
      expect(typeof result.metadata.durationMs).toBe('number')
    })

    it('pins forced→auto retry on forced failure: three completions, one backend, two builds', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockModelInputBuilder = createMockModelInputBuilder()
      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: false,
            error: { code: 'ALL_PROVIDERS_FAILED', message: 'All providers failed after 1 attempts' },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-auto',
              content: '',
              model: 'deepseek-v4-flash',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "beijing weather"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-answer',
              content: 'Recovered answer',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'beijing weather',
        results: [{ title: 'W', url: 'https://x.com', snippet: 'ok' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder,
        providerFamily: 'deepseek',
        searchLlmProviderId: 'provider-deepseek',
        searchLlmModel: 'deepseek-v4-flash',
      })

      const result = await subagent.execute({ query: 'beijing weather', userId: 'u', sessionId: 's' })

      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(mockLlmAdapter.complete.mock.calls[0][0].toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      })
      expect(mockLlmAdapter.complete.mock.calls[1][0].toolChoice).toEqual('auto')
      expect(mockLlmAdapter.complete.mock.calls[2][0].toolChoice).toBeUndefined()
      expect(mockWebSearchExecutor).toHaveBeenCalledTimes(1)
      expect(mockWebSearchExecutor).toHaveBeenCalledWith({ query: 'beijing weather' })
      const buildMock = mockModelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      expect(buildMock).toHaveBeenCalledTimes(2)
      expect(buildMock.mock.calls[0][0].mode).toBe('function_calling')
      expect(buildMock.mock.calls[1][0].mode).toBe('structured_json')
      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.answer).toBe('Recovered answer')
    })

    it('pins phase observer order: phase1 → backend_search → phase2', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const observations: Array<{ phase: string; query?: string; querySource?: string }> = []
      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-2', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
        phaseObserver: (observation) => observations.push(observation),
      })

      await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })

      expect(observations.map((o) => o.phase)).toEqual(['phase1', 'backend_search', 'phase2'])
      expect(observations[0]).toMatchObject({ phase: 'phase1', query: 'test', querySource: 'llm_tool_call' })
    })

    it('pins default one-round internal counters: roundCount=1, replanCount=0, searchCallCount=1, llmCallCount=2', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-2', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.replanCount).toBe(0)
      expect(result.metadata.searchCallCount).toBe(1)
      expect(result.metadata.llmCallCount).toBe(2)
      expect(result.metadata.executedQueries).toEqual(['test'])
      expect(result.metadata.stopReason).toBeUndefined()
      expect(result.metadata.budgetExhausted).toBeUndefined()
    })

    it('counts forced→auto LLM attempts: llmCallCount=3 when the forced toolChoice fails', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: false,
            error: { code: 'ALL_PROVIDERS_FAILED', message: 'All providers failed after 1 attempts' },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-auto',
              content: '',
              model: 'deepseek-v4-flash',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "beijing weather"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-answer',
              content: 'Recovered answer',
              model: 'deepseek-v4-flash',
              finishReason: 'stop',
            },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'beijing weather',
        results: [{ title: 'W', url: 'https://x.com', snippet: 'ok' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'deepseek',
        searchLlmProviderId: 'provider-deepseek',
        searchLlmModel: 'deepseek-v4-flash',
      })

      const result = await subagent.execute({ query: 'beijing weather', userId: 'u', sessionId: 's' })

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(result.metadata.llmCallCount).toBe(3)
      expect(result.metadata.searchCallCount).toBe(1)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.executedQueries).toEqual(['beijing weather'])
    })

    it('pins fallback messages: degraded phase2 success and typed invalid-JSON failure', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockRejectedValue(new Error('answer generation boom')),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const degraded = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })
      expect(degraded.success).toBe(true)
      assertSuccess(degraded)
      expect(degraded.answer).toBe('Search completed but answer generation failed.')
      expect(degraded.toolResult.results).toHaveLength(1)
      expect(degraded.metadata.segmentAHash).toBeDefined()

      const invalidJsonAdapter = {
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
                function: { name: 'web_search', arguments: '{not valid json' },
              },
            ],
            finishReason: 'tool_calls',
          },
        }),
      }
      const invalidJsonSubagent = createSearchSubagent({
        llmAdapter: invalidJsonAdapter,
        webSearchExecutor: vi.fn(),
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })
      const invalidResult = await invalidJsonSubagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })
      expect(invalidResult.success).toBe(false)
      assertFailure(invalidResult)
      expect(invalidResult.errorCode).toBe('INVALID_TOOL_CALL')
      expect(invalidResult.message).toBe('Invalid web_search arguments: failed to parse JSON')
    })

    it('pins Segment A hash stability across both builds and in output metadata', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')

      const segmentAHash = 'a'.repeat(64)
      const mockModelInputBuilder = {
        build: vi.fn().mockImplementation(async () => ({
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'User message' },
          ],
          segments: {
            staticPrefix: 'static-prefix',
            tenantProject: '',
            toolPlane: '',
            contextBundle: 'context',
          },
          segmentHashes: {
            segmentA: segmentAHash,
            segmentB: 'b'.repeat(64),
            segmentC: 'c'.repeat(64),
            segmentD: 'd'.repeat(64),
          },
          metadata: {
            mode: 'function_calling',
            agentKind: 'search',
            providerFamily: 'openai',
            messageCount: 2,
          },
        })),
      }

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-2', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: mockModelInputBuilder as unknown as ModelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      const result = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })

      expect(result.success).toBe(true)
      assertSuccess(result)
      expect(result.metadata.segmentAHash).toBe(segmentAHash)
      expect(mockModelInputBuilder.build).toHaveBeenCalledTimes(2)
    })

    it('pins facade exports: createSearchSubagent remains the module factory entry', async () => {
      const mod = await import('../../../src/search/search-subagent.js')
      expect(typeof mod.createSearchSubagent).toBe('function')
      expect(mod.createSearchSubagent.name).toBe('createSearchSubagent')
    })
  })

  describe('round policy config acceptance (default one round)', () => {
    it('defaults to ONE_ROUND_SEARCH_POLICY when roundPolicy is absent', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js')
      const { ONE_ROUND_SEARCH_POLICY } = await import('../../../src/search/search-round-budget.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "test"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-2', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      })

      expect(subagent.roundPolicy).toEqual(ONE_ROUND_SEARCH_POLICY)

      const result = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })
      expect(mockWebSearchExecutor).toHaveBeenCalledTimes(1)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(2)
      expect(result.success).toBe(true)
    })

    it('wires an explicit multi-round policy into execution', async () => {
      const { MULTI_ROUND_SEARCH_POLICY } = await import('../../../src/search/search-round-budget.js')

      const mockLlmAdapter = {
        complete: vi
          .fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-1',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "q1"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-2',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [
                {
                  id: 'tc-2',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query": "q2"}' },
                },
              ],
              finishReason: 'tool_calls',
            },
          })
          .mockResolvedValueOnce({
            success: true,
            response: { id: 'resp-3', content: 'Answer', model: 'gpt-4.1-mini', finishReason: 'stop' },
          }),
      }

      const mockWebSearchExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          query: 'q1',
          results: [],
          total: 0,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        })
        .mockResolvedValueOnce({
          success: true,
          query: 'q2',
          results: [
            {
              title: 'Alpha',
              url: 'https://alpha.example.com/a',
              snippet: 'Alpha provides comprehensive factual detail about the topic under investigation here.',
            },
            {
              title: 'Beta',
              url: 'https://beta.example.com/b',
              snippet: 'Beta confirms the facts with independent reporting and additional context.',
            },
          ],
          total: 2,
          provider: 'searxng',
          endpointHost: 'localhost:8888',
        })

      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        modelInputBuilder: createMockModelInputBuilder(),
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
        roundPolicy: MULTI_ROUND_SEARCH_POLICY,
      })

      expect(subagent.roundPolicy).toEqual(MULTI_ROUND_SEARCH_POLICY)

      const result = await subagent.execute({ query: 'test query', userId: 'u', sessionId: 's' })
      assertSuccess(result)
      expect(mockWebSearchExecutor).toHaveBeenCalledTimes(2)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(result.metadata.roundCount).toBe(2)
      expect(result.metadata.searchCallCount).toBe(2)
      expect(result.metadata.replanCount).toBe(1)
    })
  })

  /**
   * ─── Multi-round execution (todo 8) ───────────────────────────────────────────
   *
   * Drives the controlled multi-round controller: at most roundPolicy.maxRounds
   * sequential one-query rounds, deterministic duplicate rejection, pure
   * evaluator decisions, and exactly ONE final phase2 synthesis over the
   * merged/cropped evidence. The default one-round path is covered by the
   * suites above and stays byte-identical.
   */
  describe('multi-round execution', () => {
    type LlmCompletion = {
      success: boolean
      response?: {
        id: string
        content: string
        model: string
        toolCalls?: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }>
        finishReason: string
      }
      error?: { code: string; message: string }
    }

    type BackendResult = WebSearchResult & { success: boolean }

    /** Marker for a scripted completion/backend that never settles (deadline tests). */
    const PENDING = Symbol('pending')

    function phase1Completion(query: string): LlmCompletion {
      return {
        success: true,
        response: {
          id: 'resp-p1',
          content: '',
          model: 'gpt-4.1-mini',
          toolCalls: [
            { id: 'tc-1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query }) } },
          ],
          finishReason: 'tool_calls',
        },
      }
    }

    function phase2Completion(answer: string): LlmCompletion {
      return {
        success: true,
        response: { id: 'resp-p2', content: answer, model: 'gpt-4.1-mini', finishReason: 'stop' },
      }
    }

    function backendResponse(query: string, results: WebSearchResultItem[] = []): BackendResult {
      return {
        success: true,
        query,
        results,
        total: results.length,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      }
    }

    const alpha: WebSearchResultItem = {
      title: 'Alpha coverage',
      url: 'https://alpha.example.com/a',
      snippet: 'Alpha provides comprehensive factual detail about the topic under investigation here.',
    }
    const beta: WebSearchResultItem = {
      title: 'Beta coverage',
      url: 'https://beta.example.com/b',
      snippet: 'Beta confirms the facts with independent reporting and additional context.',
    }
    const terse: WebSearchResultItem = {
      title: 'Terse result',
      url: 'https://terse.example.com/c',
      snippet: 'Terse.',
    }

    function createMultiRoundSubagent(opts: {
      completions: Array<LlmCompletion | typeof PENDING>
      backends: Array<BackendResult | typeof PENDING>
      roundPolicy?: SearchRoundPolicy
      hints?: SearchPlanHints
      phaseObserver?: (observation: SearchPhaseObservation) => void
      modelInputBuilder?: ModelInputBuilder
    }) {
      let completionIndex = 0
      let backendIndex = 0
      const llmAdapter = {
        complete: vi.fn(async (): Promise<LlmCompletion> => {
          const next = opts.completions[completionIndex]
          completionIndex += 1
          if (next === undefined || next === PENDING) return new Promise<LlmCompletion>(() => {})
          return next
        }),
      }
      const webSearchExecutor = vi.fn(async (): Promise<BackendResult> => {
        const next = opts.backends[backendIndex]
        backendIndex += 1
        if (next === undefined || next === PENDING) return new Promise<BackendResult>(() => {})
        return next
      })
      const modelInputBuilder = opts.modelInputBuilder ?? createMockModelInputBuilder()
      const subagent = createSearchSubagent({
        llmAdapter,
        webSearchExecutor,
        modelInputBuilder,
        providerFamily: 'openai',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
        roundPolicy: opts.roundPolicy ?? MULTI_ROUND_SEARCH_POLICY,
        ...(opts.phaseObserver !== undefined ? { phaseObserver: opts.phaseObserver } : {}),
      })
      return { subagent, llmAdapter, webSearchExecutor, modelInputBuilder }
    }

    function executeMultiRound(
      harness: ReturnType<typeof createMultiRoundSubagent>,
      opts: { hints?: SearchPlanHints; timeoutMs?: number; query?: string } = {},
    ) {
      return harness.subagent.execute({
        query: opts.query ?? 'original question',
        userId: 'user-123',
        sessionId: 'session-456',
        ...(opts.hints !== undefined ? { searchPlanHints: opts.hints } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      })
    }

    it('sufficient round 1 performs one search and two LLM calls and stops', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('weather beijing'), phase2Completion('Final answer')],
        backends: [backendResponse('weather beijing', [alpha, beta])],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      expect(result.answer).toBe('Final answer')
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(1)
      expect(harness.llmAdapter.complete).toHaveBeenCalledTimes(2)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.replanCount).toBe(0)
      expect(result.metadata.searchCallCount).toBe(1)
      expect(result.metadata.llmCallCount).toBe(2)
      expect(result.metadata.stopReason).toBe('sufficient_evidence')
      expect(result.metadata.budgetExhausted).toBeUndefined()
    })

    it('empty round 1 + unique round 2 yields merged evidence and one final phase2', async () => {
      const harness = createMultiRoundSubagent({
        completions: [
          phase1Completion('weather beijing'),
          phase1Completion('ai models 2026'),
          phase2Completion('Synthesis'),
        ],
        backends: [backendResponse('weather beijing'), backendResponse('ai models 2026', [alpha, beta])],
      })

      const result = await executeMultiRound(harness, {
        hints: { originalQuestion: 'original question', intent: 'general', missingCriticalContext: ['location'] },
      })

      assertSuccess(result)
      expect(result.answer).toBe('Synthesis')
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(2)
      expect(harness.llmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(result.metadata.roundCount).toBe(2)
      expect(result.metadata.replanCount).toBe(1)
      expect(result.metadata.searchCallCount).toBe(2)
      expect(result.metadata.stopReason).toBe('sufficient_evidence')

      // Exactly one final phase2: the last build is structured_json.
      const buildMock = harness.modelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      const calls = buildMock.mock.calls
      expect(
        calls.filter((call: unknown[]) => (call[0] as ModelInputBuildInput).mode === 'structured_json'),
      ).toHaveLength(1)

      // The replan phase-1 build carries the missing-context hint in Segment D only.
      const replanBuild = calls[1][0] as ModelInputBuildInput
      const replanItems = replanBuild.contextBundle?.orderedItems?.map((item) => item.content) ?? []
      expect(replanItems.some((content) => content.includes('location'))).toBe(true)
      expect(replanItems.some((content) => content.includes('weather beijing'))).toBe(true)
    })

    it('low source diversity replans once then stops with sufficient evidence', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase1Completion('q2'), phase2Completion('Final')],
        backends: [backendResponse('q1', [alpha]), backendResponse('q2', [beta])],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(2)
      expect(result.metadata.roundCount).toBe(2)
      expect(result.metadata.replanCount).toBe(1)
      expect(result.metadata.stopReason).toBe('sufficient_evidence')
      // Merged evidence spans both rounds.
      expect(result.toolResult.results).toHaveLength(2)
    })

    it('no extractable facts replans and then succeeds', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase1Completion('q2'), phase2Completion('Final')],
        backends: [backendResponse('q1', [terse]), backendResponse('q2', [alpha, beta])],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(2)
      expect(result.metadata.roundCount).toBe(2)
      expect(result.metadata.replanCount).toBe(1)
      expect(result.metadata.stopReason).toBe('sufficient_evidence')
    })

    it('freshness retries at most once even when dates stay unverifiable', async () => {
      const harness = createMultiRoundSubagent({
        completions: [
          phase1Completion('latest weather report'),
          phase1Completion('weather forecast details'),
          phase2Completion('Final'),
        ],
        backends: [
          backendResponse('latest weather report', [alpha, beta]),
          backendResponse('weather forecast details', [alpha, beta]),
        ],
      })

      const result = await executeMultiRound(harness, {
        hints: { originalQuestion: 'original question', intent: 'general', freshness: true },
      })

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(2)
      expect(result.metadata.roundCount).toBe(2)
      expect(result.metadata.replanCount).toBe(1)
      // No second freshness replan: after the one retry the evaluator accepts the evidence.
      expect(result.metadata.stopReason).toBe('sufficient_evidence')
    })

    it('missing critical context alone does not loop', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase2Completion('Final')],
        backends: [backendResponse('q1', [alpha, beta])],
      })

      const result = await executeMultiRound(harness, {
        hints: { originalQuestion: 'original question', intent: 'general', missingCriticalContext: ['location'] },
      })

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(1)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.replanCount).toBe(0)
      expect(result.metadata.stopReason).toBe('sufficient_evidence')
    })

    it('a duplicate query stops before a second backend call', async () => {
      const harness = createMultiRoundSubagent({
        completions: [
          phase1Completion('weather beijing today'),
          phase1Completion('beijing today weather'),
          phase2Completion('Final'),
        ],
        backends: [backendResponse('weather beijing today')],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(1)
      expect(harness.llmAdapter.complete).toHaveBeenCalledTimes(3)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.searchCallCount).toBe(1)
      expect(result.metadata.stopReason).toBe('duplicate_query')
    })

    it('never exceeds the maximum number of rounds', async () => {
      const harness = createMultiRoundSubagent({
        completions: [
          phase1Completion('q1'),
          phase1Completion('q2'),
          phase1Completion('q3'),
          phase2Completion('Final'),
        ],
        backends: [backendResponse('q1'), backendResponse('q2'), backendResponse('q3')],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(3)
      expect(harness.llmAdapter.complete).toHaveBeenCalledTimes(4)
      expect(result.metadata.roundCount).toBe(3)
      expect(result.metadata.searchCallCount).toBe(3)
      expect(result.metadata.replanCount).toBe(2)
      expect(result.metadata.stopReason).toBe('max_rounds')
    })

    it('merges canonical duplicate URLs and crops the phase2 evidence', async () => {
      const alphaTracking: WebSearchResultItem = {
        title: 'Alpha duplicate',
        url: 'https://www.alpha.example.com/a?utm_source=news',
        snippet: 'Alpha duplicate provides the same factual detail under a tracking variant.',
      }
      const betaOne: WebSearchResultItem = {
        title: 'Beta one',
        url: 'https://beta.example.com/b?id=1',
        snippet: 'Beta one reports independent factual detail with a distinct source.',
      }
      const betaTwo: WebSearchResultItem = {
        title: 'Beta two',
        url: 'https://beta.example.com/b?id=2',
        snippet: 'Beta two adds a second distinct factual detail from the same domain.',
      }
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase1Completion('q2'), phase2Completion('Final')],
        backends: [backendResponse('q1', [alpha, alphaTracking]), backendResponse('q2', [betaOne, betaTwo])],
      })

      const result = await executeMultiRound(harness)

      assertSuccess(result)
      // The tracking variant is a canonical duplicate of alpha -> dropped in the merged tool result.
      expect(result.toolResult.results.map((item) => item.url)).toEqual([
        'https://alpha.example.com/a',
        'https://beta.example.com/b?id=1',
        'https://beta.example.com/b?id=2',
      ])

      // The single final phase2 receives the prepared/cropped evidence (no duplicates, no tracking params).
      const buildMock = harness.modelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      const calls = buildMock.mock.calls
      const phase2Build = calls[calls.length - 1][0] as ModelInputBuildInput
      const resultsContent = phase2Build.contextBundle?.orderedItems?.find(
        (item) => item.itemId === 'search-results',
      )?.content
      expect(resultsContent).toBeDefined()
      const payload = JSON.parse((resultsContent as string).replace(/^Search Results:\n/, '')) as {
        results: Array<{ url: string }>
      }
      expect(payload.results.map((item) => item.url)).toEqual([
        'https://alpha.example.com/a',
        'https://beta.example.com/b?id=1',
        'https://beta.example.com/b?id=2',
      ])
      expect(resultsContent).not.toContain('utm_source')
      expect(resultsContent).not.toContain('www.alpha.example.com')
    })

    it('keeps Segment A stable across round builds and renders feedback only in dynamic context', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase1Completion('q2'), phase2Completion('Final')],
        backends: [backendResponse('q1'), backendResponse('q2', [alpha, beta])],
      })

      await executeMultiRound(harness)

      const buildMock = harness.modelInputBuilder.build as unknown as ReturnType<typeof vi.fn>
      const calls = buildMock.mock.calls
      const round1Build = calls[0][0] as ModelInputBuildInput
      const round2Build = calls[1][0] as ModelInputBuildInput

      expect(round1Build.mode).toBe('function_calling')
      expect(round2Build.mode).toBe('function_calling')
      // Segment A derives solely from these static fields, so identical fields mean identical hash.
      expect(round1Build.agentType).toBe(round2Build.agentType)
      expect(round1Build.agentProfile).toBe(round2Build.agentProfile)
      expect(round1Build.providerFamily).toBe(round2Build.providerFamily)
      expect(round1Build.outputContract).toBe(round2Build.outputContract)
      // Round 1 has no dynamic feedback; round 2 renders it in Segment D only.
      expect(round1Build.contextBundle).toBeUndefined()
      const replanItems = round2Build.contextBundle?.orderedItems?.map((item) => item.itemId) ?? []
      expect(replanItems).toEqual([
        'search-round-progress',
        'original-question',
        'prior-queries',
        'search-round-feedback',
        'top-results',
      ])
    })

    it('a backend success:false is terminal and never blindly retries', async () => {
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1')],
        backends: [{ ...backendResponse('q1'), success: false }],
      })

      const result = await executeMultiRound(harness)

      // The failed tool result is preserved so the child runner maps it to SEARCH_BACKEND_ERROR.
      assertSuccess(result)
      expect((result.toolResult as BackendResult).success).toBe(false)
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(1)
      expect(harness.llmAdapter.complete).toHaveBeenCalledTimes(1)
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.stopReason).toBe('backend_failure')
    })

    it('returns partial success with degraded answer when the completion deadline expires', async () => {
      vi.useFakeTimers()
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), PENDING],
        backends: [backendResponse('q1', [alpha]), PENDING],
      })

      const promise = executeMultiRound(harness, { timeoutMs: 120 })
      await vi.advanceTimersByTimeAsync(95)
      await vi.advanceTimersByTimeAsync(30)
      const result = await promise
      vi.useRealTimers()

      assertSuccess(result)
      expect(result.answer).toBe('Search completed but answer generation failed.')
      expect(result.metadata.budgetExhausted).toBe(true)
      expect(result.metadata.stopReason).toBe('budget_boundary')
      expect(result.metadata.roundCount).toBe(1)
      expect(result.metadata.searchCallCount).toBe(1)
      // Partial evidence from round 1 is still returned to the parent.
      expect(result.toolResult.results.map((item) => item.url)).toEqual(['https://alpha.example.com/a'])
    })

    it('returns a typed SEARCH_TIMEOUT failure when the round deadline expires with zero evidence', async () => {
      vi.useFakeTimers()
      const harness = createMultiRoundSubagent({
        completions: [PENDING],
        backends: [],
      })

      const promise = executeMultiRound(harness, { timeoutMs: 120 })
      await vi.advanceTimersByTimeAsync(100)
      const result = await promise
      vi.useRealTimers()

      assertFailure(result)
      expect(result.errorCode).toBe('SEARCH_TIMEOUT')
      expect(harness.webSearchExecutor).toHaveBeenCalledTimes(0)
    })

    it('emits ordered evaluation/replan observations with typed reasons', async () => {
      const observations: SearchPhaseObservation[] = []
      const harness = createMultiRoundSubagent({
        completions: [phase1Completion('q1'), phase1Completion('q2'), phase2Completion('Final')],
        backends: [backendResponse('q1'), backendResponse('q2', [alpha, beta])],
        phaseObserver: (observation) => {
          observations.push(observation)
        },
      })

      await executeMultiRound(harness)

      expect(observations.map((observation) => observation.phase)).toEqual([
        'phase1',
        'backend_search',
        'evaluation',
        'replan',
        'phase1',
        'backend_search',
        'evaluation',
        'phase2',
      ])
      const continueEvaluation = observations[2]
      expect(continueEvaluation.replanReason).toBe('no_results')
      expect(continueEvaluation.stopReason).toBeUndefined()
      expect(continueEvaluation.round).toBe(1)
      const stopEvaluation = observations[6]
      expect(stopEvaluation.stopReason).toBe('sufficient_evidence')
      expect(stopEvaluation.replanReason).toBeUndefined()
      expect(stopEvaluation.round).toBe(2)
      expect(stopEvaluation.roundCount).toBe(2)
      expect(stopEvaluation.searchCallCount).toBe(2)
    })
  })
})
