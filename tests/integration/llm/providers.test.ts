import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  LLMRequest,
  ProviderConfig,
  ProviderCapabilities,
} from '../../../src/llm';
import type { RuntimeError } from '../../../src/shared/errors';
import {
  OpenAIAdapter,
  OpenRouterAdapter,
  OllamaAdapter,
  MultiProviderLLMAdapter,
} from '../../../src/llm/providers';

function createTestProviderConfig(
  id: string,
  priority: number = 1,
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: false,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['gpt-4', 'gpt-3.5-turbo'],
  };

  return {
    id,
    name: `${id} Provider`,
    enabled: true,
    priority,
    timeoutMs: 5000,
    retries: 2,
    capabilities,
    ...overrides,
  };
}

function createTestRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello, world!' }],
    temperature: 0.7,
    maxTokens: 100,
    ...overrides,
  };
}

function createMockFetch(
  response: object,
  status: number = 200,
  delayMs: number = 0
): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response;
  });
}

function createTimeoutMockFetch(): typeof fetch {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    return new Promise((_, reject) => {
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
      setTimeout(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      }, 50);
    });
  });
}

function createErrorMockFetch(
  status: number = 500,
  errorMessage: string = 'Internal Server Error'
): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: false,
      status,
      statusText: errorMessage,
      json: async () => ({ error: { message: errorMessage } }),
      text: async () => errorMessage,
    } as Response;
  });
}

describe('Multi-Provider LLM Adapter Integration', () => {
  describe('OpenAI Adapter', () => {
    let mockFetch: ReturnType<typeof createMockFetch>;

    beforeEach(() => {
      vi.restoreAllMocks();
      mockFetch = createMockFetch({
        id: 'resp_123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello from OpenAI!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });
      global.fetch = mockFetch;
    });

    it('should make successful request to OpenAI-compatible API', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
        baseUrl: 'https://api.openai.com/v1',
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.content).toBe('Hello from OpenAI!');
        expect(result.response.model).toBe('gpt-4');
        expect(result.response.role).toBe('assistant');
        expect(result.providerId).toBe('openai');
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          }),
          body: expect.any(String),
        })
      );
    });

    it('should map OpenAI response format correctly', async () => {
      mockFetch = createMockFetch({
        id: 'resp_456',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"Paris"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 15,
          total_tokens: 35,
        },
      });
      global.fetch = mockFetch;

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
      };

      const result = await adapter.complete(request);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.toolCalls).toHaveLength(1);
        expect(result.response.toolCalls![0].function.name).toBe('get_weather');
        expect(result.response.finishReason).toBe('tool_calls');
      }
    });

    it('should handle OpenAI API errors correctly', async () => {
      mockFetch = createErrorMockFetch(429, 'Rate limit exceeded');
      global.fetch = mockFetch;

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.category).toBe('connector_rate_limited');
        expect(result.error.code).toBe('RATE_LIMIT_ERROR');
        expect(result.error.recoverability).toBe('retryable_later');
      }
    });

    it('should handle timeout scenarios', async () => {
      mockFetch = createTimeoutMockFetch();
      global.fetch = mockFetch;

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
        timeoutMs: 50,
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.category).toBe('timeout');
        expect(result.error.code).toBe('PROVIDER_TIMEOUT');
      }
    });

    it('should load API key from environment variable', async () => {
      process.env.OPENAI_API_KEY = 'env-api-key';

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer env-api-key',
          }),
        })
      );

      delete process.env.OPENAI_API_KEY;
    });

    it('should use redacted logging for API keys', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'sk-secret12345',
        enableLogging: true,
      });

      await adapter.complete(createTestRequest());

      const logs = consoleSpy.mock.calls.flat().join(' ');
      expect(logs).not.toContain('sk-secret12345');
      expect(logs).toContain('***');

      consoleSpy.mockRestore();
    });

    it('should normalize base URL by trimming trailing slashes', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
        baseUrl: 'https://api.siliconflow.cn/v1/',
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.siliconflow.cn/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should normalize base URL with multiple trailing slashes', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
        baseUrl: 'https://api.siliconflow.cn/v1///',
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.siliconflow.cn/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should serialize assistant message toolCalls as tool_calls in request body', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What is the weather in Paris?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Paris"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: '{"temperature": 20, "condition": "sunny"}',
            toolCallId: 'call_abc123',
          },
        ],
      };

      await adapter.complete(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.any(String),
        })
      );

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.messages[1]).toHaveProperty('tool_calls');
      expect(requestBody.messages[1].tool_calls).toHaveLength(1);
      expect(requestBody.messages[1].tool_calls[0]).toEqual({
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Paris"}',
        },
      });

      expect(requestBody.messages[2]).toHaveProperty('tool_call_id');
      expect(requestBody.messages[2].tool_call_id).toBe('call_abc123');
    });

    it('should handle multiple tool calls in assistant message', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Get weather for Paris and London' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Paris"}',
                },
              },
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"London"}',
                },
              },
            ],
          },
        ],
      };

      await adapter.complete(request);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.messages[1].tool_calls).toHaveLength(2);
      expect(requestBody.messages[1].tool_calls[0].id).toBe('call_1');
      expect(requestBody.messages[1].tool_calls[1].id).toBe('call_2');
    });

    it('should omit tool_calls when assistant message has no toolCalls', async () => {
      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'test-api-key',
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      };

      await adapter.complete(request);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.messages[1]).not.toHaveProperty('tool_calls');
    });
  });

  describe('OpenRouter Adapter', () => {
    let mockFetch: ReturnType<typeof createMockFetch>;

    beforeEach(() => {
      vi.restoreAllMocks();
      mockFetch = createMockFetch({
        id: 'resp_openrouter',
        model: 'anthropic/claude-3-opus',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from OpenRouter!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });
      global.fetch = mockFetch;
    });

    it('should use OpenRouter-specific base URL', async () => {
      const adapter = new OpenRouterAdapter({
        ...createTestProviderConfig('openrouter', 1),
        apiKey: 'test-router-key',
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.any(Object)
      );
    });

    it('should include OpenRouter-specific headers', async () => {
      const adapter = new OpenRouterAdapter({
        ...createTestProviderConfig('openrouter', 1),
        apiKey: 'test-router-key',
        siteUrl: 'https://mysite.com',
        appName: 'MyApp',
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-router-key',
            'HTTP-Referer': 'https://mysite.com',
            'X-Title': 'MyApp',
          }),
        })
      );
    });

    it('should load API key from OPENROUTER_API_KEY environment variable', async () => {
      process.env.OPENROUTER_API_KEY = 'router-env-key';

      const adapter = new OpenRouterAdapter({
        ...createTestProviderConfig('openrouter', 1),
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer router-env-key',
          }),
        })
      );

      delete process.env.OPENROUTER_API_KEY;
    });

    it('should normalize base URL by trimming trailing slashes', async () => {
      const adapter = new OpenRouterAdapter({
        ...createTestProviderConfig('openrouter', 1),
        apiKey: 'test-router-key',
        baseUrl: 'https://custom-openrouter.com/api/v1/',
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom-openrouter.com/api/v1/chat/completions',
        expect.any(Object)
      );
    });

    it('should serialize assistant message toolCalls as tool_calls in request body', async () => {
      const adapter = new OpenRouterAdapter({
        ...createTestProviderConfig('openrouter', 1),
        apiKey: 'test-router-key',
      });

      const request: LLMRequest = {
        model: 'anthropic/claude-3-opus',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_xyz789',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Tokyo"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            content: '{"temperature": 25}',
            toolCallId: 'call_xyz789',
          },
        ],
      };

      await adapter.complete(request);

      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.messages[1]).toHaveProperty('tool_calls');
      expect(requestBody.messages[1].tool_calls).toHaveLength(1);
      expect(requestBody.messages[1].tool_calls[0]).toEqual({
        id: 'call_xyz789',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}',
        },
      });

      expect(requestBody.messages[2]).toHaveProperty('tool_call_id');
      expect(requestBody.messages[2].tool_call_id).toBe('call_xyz789');
    });
  });

  describe('Ollama Adapter', () => {
    let mockFetch: ReturnType<typeof createMockFetch>;

    beforeEach(() => {
      vi.restoreAllMocks();
      mockFetch = createMockFetch({
        model: 'llama2',
        created_at: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: 'Hello from Ollama!',
        },
        done: true,
        total_duration: 1234567890,
        load_duration: 123456789,
        prompt_eval_count: 10,
        eval_count: 5,
        eval_duration: 500000000,
      });
      global.fetch = mockFetch;
    });

    it('should use Ollama-specific endpoint and request format', async () => {
      const adapter = new OllamaAdapter({
        ...createTestProviderConfig('ollama', 1),
        baseUrl: 'http://localhost:11434',
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      );
    });

    it('should map Ollama response format correctly', async () => {
      const adapter = new OllamaAdapter({
        ...createTestProviderConfig('ollama', 1),
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.content).toBe('Hello from Ollama!');
        expect(result.response.model).toBe('llama2');
        expect(result.providerId).toBe('ollama');
      }
    });

    it('should load base URL from OLLAMA_BASE_URL environment variable', async () => {
      process.env.OLLAMA_BASE_URL = 'http://custom-ollama:11434';

      const adapter = new OllamaAdapter({
        ...createTestProviderConfig('ollama', 1),
      });

      await adapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom-ollama:11434/api/chat',
        expect.any(Object)
      );

      delete process.env.OLLAMA_BASE_URL;
    });

    it('should handle Ollama not running', async () => {
      mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      global.fetch = mockFetch;

      const adapter = new OllamaAdapter({
        ...createTestProviderConfig('ollama', 1),
        baseUrl: 'http://localhost:11434',
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.category).toBe('model_error');
        expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
      }
    });
  });

  describe('Multi-Provider Adapter Fallback', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should try providers in priority order until one succeeds', async () => {
      const failingFetch = createErrorMockFetch(500, 'Server Error');
      const succeedingFetch = createMockFetch({
        id: 'resp_2',
        choices: [{ message: { role: 'assistant', content: 'Success!' }, finish_reason: 'stop' }],
      });

      let fetchCallCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return failingFetch('url', {} as any);
        }
        return succeedingFetch('url', {} as any);
      });

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: true,
      });

      const primary = new OpenAIAdapter({
        ...createTestProviderConfig('primary', 1),
        apiKey: 'key1',
      });

      const secondary = new OpenAIAdapter({
        ...createTestProviderConfig('secondary', 2),
        apiKey: 'key2',
      });

      multiAdapter.addProvider(primary);
      multiAdapter.addProvider(secondary);

      const result = await multiAdapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.providerId).toBe('secondary');
        expect(result.response.content).toBe('Success!');
      }
      expect(fetchCallCount).toBe(2);
    });

    it('should fallback when primary times out', async () => {
      const timeoutFetch = createTimeoutMockFetch();
      const succeedingFetch = createMockFetch({
        id: 'resp_2',
        choices: [{ message: { role: 'assistant', content: 'Fallback success!' }, finish_reason: 'stop' }],
      });

      let fetchCallCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return timeoutFetch('url', {} as any);
        }
        return succeedingFetch('url', {} as any);
      });

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 1000,
        enableCircuitBreaker: true,
      });

      const primary = new OpenAIAdapter({
        ...createTestProviderConfig('primary', 1),
        apiKey: 'key1',
        timeoutMs: 100,
      });

      const secondary = new OpenAIAdapter({
        ...createTestProviderConfig('secondary', 2),
        apiKey: 'key2',
      });

      multiAdapter.addProvider(primary);
      multiAdapter.addProvider(secondary);

      const result = await multiAdapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.providerId).toBe('secondary');
        expect(result.response.content).toBe('Fallback success!');
      }
    });

    it('should skip providers with open circuit breaker', async () => {
      const succeedingFetch = createMockFetch({
        id: 'resp_2',
        choices: [{ message: { role: 'assistant', content: 'Healthy response!' }, finish_reason: 'stop' }],
      });
      global.fetch = succeedingFetch;

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: true,
      });

      const primary = new OpenAIAdapter({
        ...createTestProviderConfig('primary', 1),
        apiKey: 'key1',
      });

      const secondary = new OpenAIAdapter({
        ...createTestProviderConfig('secondary', 2),
        apiKey: 'key2',
      });

      primary.circuitBreaker.forceOpen();

      multiAdapter.addProvider(primary);
      multiAdapter.addProvider(secondary);

      const result = await multiAdapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.providerId).toBe('secondary');
      }
      expect(succeedingFetch).toHaveBeenCalledTimes(1);
    });

    it('should open circuit breaker after repeated failures', async () => {
      const errorFetch = createErrorMockFetch(500, 'Server Error');
      global.fetch = errorFetch;

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: true,
      });

      const primary = new OpenAIAdapter({
        ...createTestProviderConfig('primary', 1),
        apiKey: 'key1',
        circuitBreakerConfig: {
          failureThreshold: 3,
          resetTimeoutMs: 60000,
          successThreshold: 1,
        },
      });

      multiAdapter.addProvider(primary);

      await multiAdapter.complete(createTestRequest());
      await multiAdapter.complete(createTestRequest());
      await multiAdapter.complete(createTestRequest());

      expect(primary.circuitBreaker.state).toBe('OPEN');

      const result = await multiAdapter.complete(createTestRequest());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ALL_PROVIDERS_FAILED');
        const allFailedError = result.error as { attempts: Array<{ providerId: string; error: RuntimeError }> };
        expect(allFailedError.attempts).toHaveLength(1);
        expect(allFailedError.attempts[0].error.code).toBe('CIRCUIT_BREAKER_OPEN');
      }
    });

    it('should return AllProvidersFailedError when all providers fail', async () => {
      const errorFetch = createErrorMockFetch(500, 'Server Error');
      global.fetch = errorFetch;

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: false,
      });

      const primary = new OpenAIAdapter({
        ...createTestProviderConfig('primary', 1),
        apiKey: 'key1',
      });

      const secondary = new OpenAIAdapter({
        ...createTestProviderConfig('secondary', 2),
        apiKey: 'key2',
      });

      multiAdapter.addProvider(primary);
      multiAdapter.addProvider(secondary);

      const result = await multiAdapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      expect(result.providerId).toBe('none');

      if (!result.success) {
        expect(result.error.category).toBe('model_error');
        expect(result.error.code).toBe('ALL_PROVIDERS_FAILED');
        expect('attempts' in result.error).toBe(true);
        const allFailedError = result.error as { attempts: Array<{ providerId: string; error: RuntimeError }> };
        expect(allFailedError.attempts).toHaveLength(2);
        expect(allFailedError.attempts[0].providerId).toBe('primary');
        expect(allFailedError.attempts[1].providerId).toBe('secondary');
      }
    });

    it('should support configuration from environment variables', async () => {
      process.env.OPENAI_API_KEY = 'openai-env-key';
      process.env.OPENROUTER_API_KEY = 'openrouter-env-key';
      process.env.OLLAMA_BASE_URL = 'http://ollama-env:11434';

      const mockFetch = createMockFetch({
        id: 'resp_test',
        choices: [{ message: { role: 'assistant', content: 'Test' }, finish_reason: 'stop' }],
      });
      global.fetch = mockFetch;

      const openaiAdapter = new OpenAIAdapter(createTestProviderConfig('openai', 1));

      await openaiAdapter.complete(createTestRequest());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer openai-env-key',
          }),
        })
      );

      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
    });

    it('should not expose provider-specific API shape in responses', async () => {
      const openaiFetch = createMockFetch({
        id: 'resp_openai',
        choices: [{ message: { role: 'assistant', content: 'OpenAI' }, finish_reason: 'stop' }],
      });
      global.fetch = openaiFetch;

      const multiAdapter = new MultiProviderLLMAdapter({
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: true,
      });

      const openaiProvider = new OpenAIAdapter({
        ...createTestProviderConfig('openai', 1),
        apiKey: 'key',
      });

      multiAdapter.addProvider(openaiProvider);

      const result = await multiAdapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response).toHaveProperty('id');
        expect(result.response).toHaveProperty('model');
        expect(result.response).toHaveProperty('content');
        expect(result.response).toHaveProperty('role');
        expect(result.response).toHaveProperty('finishReason');
        expect(result.response).toHaveProperty('createdAt');

        expect(result.response).not.toHaveProperty('object');
        expect(result.response).not.toHaveProperty('choices');
      }
    });
  });

  describe('Redacted Logging', () => {
    it('should redact sensitive information in logs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockFetch = createMockFetch({
        id: 'resp_1',
        choices: [{ message: { role: 'assistant', content: 'Test' }, finish_reason: 'stop' }],
      });
      global.fetch = mockFetch;

      const adapter = new OpenAIAdapter({
        ...createTestProviderConfig('test', 1),
        apiKey: 'sk-supersecretkey12345',
        enableLogging: true,
      });

      await adapter.complete(createTestRequest());

      const logs = consoleSpy.mock.calls.flat().join(' ');
      expect(logs).not.toContain('sk-supersecretkey12345');
      expect(logs).toContain('***');

      consoleSpy.mockRestore();
    });
  });
});
