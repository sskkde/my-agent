import { describe, it, expect, vi } from 'vitest';
import type { SearchSubagentResult, SearchSubagentSuccessResult, SearchSubagentFailureResult } from '../../../src/search/search-subagent.js';

function assertSuccess(result: SearchSubagentResult): asserts result is SearchSubagentSuccessResult {
  if (!result.success) {
    throw new Error(`Expected success but got error: ${(result as SearchSubagentFailureResult).errorCode}`);
  }
}

function assertFailure(result: SearchSubagentResult): asserts result is SearchSubagentFailureResult {
  if (result.success) {
    throw new Error('Expected failure but got success');
  }
}

describe('SearchSubagent contract tests', () => {
  describe('uses only web.search and dedicated search model', () => {
    it('provides exactly one tool to the search model', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [{
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'web.search',
                arguments: '{"query": "test"}',
              },
            }],
            finishReason: 'tool_calls',
          },
        }),
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      const llmCall = mockLlmAdapter.complete.mock.calls[0];
      const llmRequest = llmCall[0];
      
      expect(llmRequest.tools).toHaveLength(1);
      expect(llmRequest.tools[0].function.name).toBe('web.search');
    });

    it('forces toolChoice to web.search', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [{
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'web.search',
                arguments: '{"query": "test"}',
              },
            }],
            finishReason: 'tool_calls',
          },
        }),
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      const llmCall = mockLlmAdapter.complete.mock.calls[0];
      const llmRequest = llmCall[0];
      
      expect(llmRequest.toolChoice).toEqual({
        type: 'function',
        function: { name: 'web.search' },
      });
    });

    it('uses dedicated search model from config', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [{
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'web.search',
                arguments: '{"query": "test"}',
              },
            }],
            finishReason: 'tool_calls',
          },
        }),
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      const llmCall = mockLlmAdapter.complete.mock.calls[0];
      const llmRequest = llmCall[0];
      
      expect(llmRequest.model).toBe('gpt-4.1-mini');
    });

    it('does not include full session context', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-123',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [{
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'web.search',
                arguments: '{"query": "test"}',
              },
            }],
            finishReason: 'tool_calls',
          },
        }),
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      const llmCall = mockLlmAdapter.complete.mock.calls[0];
      const llmRequest = llmCall[0];
      
      const systemMessage = llmRequest.messages.find(
        (m: { role: string }) => m.role === 'system'
      );
      
      expect(systemMessage?.content).not.toContain('session-456');
      expect(systemMessage?.content).not.toContain('transcript');
      
      const userMessage = llmRequest.messages.find(
        (m: { role: string }) => m.role === 'user'
      );
      expect(userMessage?.content).toBe('test query');
    });
  });

  describe('fails closed when search model cannot call tools', () => {
    it('returns explicit failure when model lacks function calling capability', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
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
      };
      
      const mockWebSearchExecutor = vi.fn();
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(false);
      assertFailure(result);
      expect(result.errorCode).toBe('SEARCH_MODEL_INCAPABLE');
      expect(mockWebSearchExecutor).not.toHaveBeenCalled();
    });

    it('does not fall back to main foreground model', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockRejectedValue(new Error('Model unavailable')),
      };
      
      const mockWebSearchExecutor = vi.fn();
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
        mainLlmProviderId: 'provider-main',
        mainLlmModel: 'gpt-4',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(false);
      expect(mockLlmAdapter.complete).toHaveBeenCalledTimes(1);
      
      const llmCall = mockLlmAdapter.complete.mock.calls[0];
      const llmRequest = llmCall[0];
      expect(llmRequest.model).toBe('gpt-4.1-mini');
    });
  });

  describe('answer/toolResult/metadata contract', () => {
    it('returns user-visible answer string', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [{
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web.search',
                  arguments: '{"query": "test"}',
                },
              }],
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
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(true);
      assertSuccess(result);
      expect(typeof result.answer).toBe('string');
      expect(result.answer).toContain('answer');
    });

    it('returns web.search toolResult for evidence', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [{
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web.search',
                  arguments: '{"query": "test"}',
                },
              }],
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
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(true);
      assertSuccess(result);
      expect(result.toolResult).toBeDefined();
      expect(result.toolResult.provider).toBe('searxng');
      expect(result.toolResult.results).toHaveLength(1);
    });

    it('returns internal metadata with provider/model/querySource/durationMs', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [{
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web.search',
                  arguments: '{"query": "test"}',
                },
              }],
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
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [],
        total: 0,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(true);
      assertSuccess(result);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.providerId).toBe('provider-search');
      expect(result.metadata.model).toBe('gpt-4.1-mini');
      expect(result.metadata.querySource).toBe('search_subagent');
      expect(typeof result.metadata.durationMs).toBe('number');
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns user-visible answer with internal metadata', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn()
          .mockResolvedValueOnce({
            success: true,
            response: {
              id: 'resp-1',
              content: '',
              model: 'gpt-4.1-mini',
              toolCalls: [{
                id: 'tc-1',
                type: 'function',
                function: {
                  name: 'web.search',
                  arguments: '{"query": "test"}',
                },
              }],
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
      };
      
      const mockWebSearchExecutor = vi.fn().mockResolvedValue({
        success: true,
        query: 'test',
        results: [{ title: 'A', url: 'https://a.com', snippet: 's' }],
        total: 1,
        provider: 'searxng',
        endpointHost: 'localhost:8888',
      });
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(true);
      assertSuccess(result);
      expect(typeof result.answer).toBe('string');
      expect(result.answer).toContain('answer');
      expect(result.toolResult).toBeDefined();
      expect(result.toolResult.query).toBe('test');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.providerId).toBe('provider-search');
      expect(result.metadata.model).toBe('gpt-4.1-mini');
      expect(result.metadata.querySource).toBe('search_subagent');
      expect(typeof result.metadata.durationMs).toBe('number');
    });
  });

  describe('tool boundary enforcement', () => {
    it('never calls tools other than web.search', async () => {
      const { createSearchSubagent } = await import('../../../src/search/search-subagent.js');
      
      const mockLlmAdapter = {
        complete: vi.fn().mockResolvedValue({
          success: true,
          response: {
            id: 'resp-1',
            content: '',
            model: 'gpt-4.1-mini',
            toolCalls: [{
              id: 'tc-1',
              type: 'function',
              function: {
                name: 'web.fetch',
                arguments: '{"url": "https://example.com"}',
              },
            }],
            finishReason: 'tool_calls',
          },
        }),
      };
      
      const mockWebSearchExecutor = vi.fn();
      
      const subagent = createSearchSubagent({
        llmAdapter: mockLlmAdapter,
        webSearchExecutor: mockWebSearchExecutor,
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      
      const result = await subagent.execute({
        query: 'test query',
        userId: 'user-123',
        sessionId: 'session-456',
      });
      
      expect(result.success).toBe(false);
      assertFailure(result);
      expect(result.errorCode).toBe('INVALID_TOOL_CALL');
      expect(mockWebSearchExecutor).not.toHaveBeenCalled();
    });
  });
});
