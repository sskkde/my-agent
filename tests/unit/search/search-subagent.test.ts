import { describe, it, expect, vi } from 'vitest'
import type {
  SearchSubagentResult,
  SearchSubagentSuccessResult,
  SearchSubagentFailureResult,
} from '../../../src/search/search-subagent.js'
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
          mode: input.mode as 'routing_json' | 'structured_json' | 'function_calling',
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

      expect(llmRequest.toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      })
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
        mainLlmProviderId: 'provider-main',
        mainLlmModel: 'gpt-4',
      })

      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      })

      expect(result.success).toBe(false)
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(1)

      const llmCall = mockLlmAdapter.complete.mock.calls[0]
      const llmRequest = llmCall[0]
      expect(llmRequest.model).toBe('gpt-4.1-mini')
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
          agentKind: 'search',
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
        agentKind: 'search',
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
      const { handleSearchSubagentTool } = await import(
        '../../../src/search/search-subagent-tool.js'
      )
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

      // Forced toolChoice - model has no freedom to choose
      expect(llmRequest.toolChoice).toEqual({
        type: 'function',
        function: { name: 'web_search' },
      })
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
})
