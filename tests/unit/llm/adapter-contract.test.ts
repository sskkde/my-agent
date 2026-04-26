import { describe, it, expect } from 'vitest';
import {
  createLLMAdapter,
  createCircuitBreaker,
  DEFAULT_ADAPTER_CONFIG,
} from '../../../src/llm';
import type {
  LLMAdapterConfig,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMResult,
  ProviderConfig,
  ProviderCapabilities,
  AllProvidersFailedError,
} from '../../../src/llm';
import type { RuntimeError } from '../../../src/shared/errors';

/**
 * Fake LLM Provider for testing
 * Implements LLMProvider interface without making real API calls
 */
class FakeLLMProvider implements LLMProvider {
  readonly id: string;
  config: ProviderConfig;
  circuitBreaker = createCircuitBreaker();
  private responseOverride: LLMResponse | null = null;
  private errorOverride: RuntimeError | null = null;
  private latencyMs = 0;
  private shouldTimeout = false;
  private callCount = 0;
  private healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.config = config;
  }

  setResponse(response: LLMResponse): void {
    this.responseOverride = response;
    this.errorOverride = null;
  }

  setError(error: RuntimeError): void {
    this.errorOverride = error;
    this.responseOverride = null;
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  setShouldTimeout(shouldTimeout: boolean): void {
    this.shouldTimeout = shouldTimeout;
  }

  setHealth(status: 'healthy' | 'degraded' | 'unhealthy'): void {
    this.healthStatus = status;
  }

  get health(): 'healthy' | 'degraded' | 'unhealthy' {
    return this.healthStatus;
  }

  get stats() {
    return {
      totalRequests: this.callCount,
      successfulRequests: this.callCount,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: this.latencyMs,
      healthStatus: this.healthStatus,
    };
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.callCount++;

    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    if (this.shouldTimeout) {
      const timeoutError: RuntimeError = {
        errorId: `err_timeout_${Date.now()}`,
        category: 'timeout',
        code: 'PROVIDER_TIMEOUT',
        message: `Provider ${this.id} timed out after ${this.config.timeoutMs}ms`,
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      };
      return {
        success: false,
        error: timeoutError,
        providerId: this.id,
      };
    }

    if (this.errorOverride) {
      return {
        success: false,
        error: this.errorOverride,
        providerId: this.id,
      };
    }

    const response: LLMResponse = this.responseOverride || {
      id: `resp_${Date.now()}`,
      model: request.model,
      content: `Response from ${this.id}`,
      role: 'assistant',
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    };

    return {
      success: true,
      response,
      providerId: this.id,
    };
  }

  isHealthy(): boolean {
    return this.healthStatus === 'healthy' && this.circuitBreaker.canExecute();
  }

  getStats() {
    return this.stats;
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  resetStats(): void {
    this.callCount = 0;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Create a basic provider config for testing
 */
function createTestProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['gpt-4', 'gpt-3.5-turbo'],
  };

  return {
    id: 'test-provider',
    name: 'Test Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 30000,
    retries: 3,
    capabilities,
    ...overrides,
  };
}

/**
 * Create a basic LLM request for testing
 */
function createTestRequest(): LLMRequest {
  return {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'Hello, world!' },
    ],
    temperature: 0.7,
    maxTokens: 100,
  };
}

describe('LLM Adapter Contracts', () => {
  describe('LLMAdapterConfig', () => {
    it('should accept valid adapter configuration', () => {
      const providerConfig = createTestProviderConfig({ id: 'provider-1' });

      const config: LLMAdapterConfig = {
        providers: [providerConfig],
        defaultTimeoutMs: 60000,
        enableCircuitBreaker: true,
        enableLogging: false,
      };

      expect(config.providers).toHaveLength(1);
      expect(config.defaultTimeoutMs).toBe(60000);
      expect(config.enableCircuitBreaker).toBe(true);
    });

    it('should accept multiple providers in priority order', () => {
      const config: LLMAdapterConfig = {
        providers: [
          createTestProviderConfig({ id: 'primary', priority: 1 }),
          createTestProviderConfig({ id: 'secondary', priority: 2 }),
          createTestProviderConfig({ id: 'tertiary', priority: 3 }),
        ],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      };

      expect(config.providers).toHaveLength(3);
      expect(config.providers[0].priority).toBe(1);
      expect(config.providers[1].priority).toBe(2);
      expect(config.providers[2].priority).toBe(3);
    });

    it('should have default configuration values', () => {
      expect(DEFAULT_ADAPTER_CONFIG.defaultTimeoutMs).toBe(60000);
      expect(DEFAULT_ADAPTER_CONFIG.enableCircuitBreaker).toBe(true);
      expect(DEFAULT_ADAPTER_CONFIG.enableLogging).toBe(false);
    });
  });

  describe('Provider Fallback', () => {
    it('should use primary provider when healthy', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const primary = new FakeLLMProvider('primary', createTestProviderConfig({ id: 'primary', priority: 1 }));
      primary.setResponse({
        id: 'resp_primary',
        model: 'gpt-4',
        content: 'Primary response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });

      adapter.addProvider(primary);

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      expect(result.providerId).toBe('primary');
      expect(result.success && result.response.content).toBe('Primary response');
    });

    it('should fallback to secondary provider when primary times out', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 5000,
        enableCircuitBreaker: true,
      });

      // Primary provider - will timeout
      const primary = new FakeLLMProvider(
        'primary',
        createTestProviderConfig({ id: 'primary', priority: 1, timeoutMs: 1000 })
      );
      primary.setShouldTimeout(true);
      adapter.addProvider(primary);

      // Secondary provider - will succeed
      const secondary = new FakeLLMProvider(
        'secondary',
        createTestProviderConfig({ id: 'secondary', priority: 2, timeoutMs: 1000 })
      );
      secondary.setResponse({
        id: 'resp_secondary',
        model: 'gpt-4',
        content: 'Secondary response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(secondary);

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      expect(result.providerId).toBe('secondary');
      expect(result.success && result.response.content).toBe('Secondary response');
    });

    it('should fallback to secondary provider when primary returns error', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      // Primary provider - will fail
      const primary = new FakeLLMProvider('primary', createTestProviderConfig({ id: 'primary', priority: 1 }));
      primary.setError({
        errorId: 'err_primary',
        category: 'model_error',
        code: 'PRIMARY_FAILED',
        message: 'Primary provider failed',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(primary);

      // Secondary provider - will succeed
      const secondary = new FakeLLMProvider('secondary', createTestProviderConfig({ id: 'secondary', priority: 2 }));
      secondary.setResponse({
        id: 'resp_secondary',
        model: 'gpt-4',
        content: 'Secondary response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(secondary);

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      expect(result.providerId).toBe('secondary');
    });

    it('should skip unhealthy providers in fallback chain', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      // Primary - unhealthy
      const primary = new FakeLLMProvider('primary', createTestProviderConfig({ id: 'primary', priority: 1 }));
      primary.setHealth('unhealthy');
      primary.circuitBreaker.forceOpen();
      adapter.addProvider(primary);

      // Secondary - healthy and succeeds
      const secondary = new FakeLLMProvider('secondary', createTestProviderConfig({ id: 'secondary', priority: 2 }));
      secondary.setHealth('healthy');
      secondary.setResponse({
        id: 'resp_secondary',
        model: 'gpt-4',
        content: 'Secondary response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(secondary);

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      expect(result.providerId).toBe('secondary');
    });

    it('should return model_error when all providers fail', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      // All providers will fail
      const primary = new FakeLLMProvider('primary', createTestProviderConfig({ id: 'primary', priority: 1 }));
      primary.setError({
        errorId: 'err_primary',
        category: 'model_error',
        code: 'PRIMARY_FAILED',
        message: 'Primary provider failed',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(primary);

      const secondary = new FakeLLMProvider('secondary', createTestProviderConfig({ id: 'secondary', priority: 2 }));
      secondary.setError({
        errorId: 'err_secondary',
        category: 'connector_rate_limited',
        code: 'RATE_LIMITED',
        message: 'Secondary provider rate limited',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(secondary);

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      expect(result.providerId).toBe('none');

      if (!result.success) {
        expect(result.error.category).toBe('model_error');
        expect(result.error.code).toBe('ALL_PROVIDERS_FAILED');
        expect(result.error.message).toContain('All providers failed');
        expect('attempts' in result.error).toBe(true);

        const allFailedError = result.error as unknown as AllProvidersFailedError;
        expect(allFailedError.attempts).toHaveLength(2);
        expect(allFailedError.attempts[0].providerId).toBe('primary');
        expect(allFailedError.attempts[1].providerId).toBe('secondary');
      }
    });

    it('should not crash when no providers are registered', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(false);
      expect(result.providerId).toBe('none');

      if (!result.success) {
        expect(result.error.category).toBe('model_error');
        expect(result.error.code).toBe('ALL_PROVIDERS_FAILED');
      }
    });

    it('should sort providers by priority', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      // Add providers in reverse priority order
      const tertiary = new FakeLLMProvider('tertiary', createTestProviderConfig({ id: 'tertiary', priority: 3 }));
      const primary = new FakeLLMProvider('primary', createTestProviderConfig({ id: 'primary', priority: 1 }));
      const secondary = new FakeLLMProvider('secondary', createTestProviderConfig({ id: 'secondary', priority: 2 }));

      adapter.addProvider(tertiary);
      adapter.addProvider(primary);
      adapter.addProvider(secondary);

      const providers = adapter.providers;

      expect(providers[0].id).toBe('primary');
      expect(providers[1].id).toBe('secondary');
      expect(providers[2].id).toBe('tertiary');
    });

    it('should update provider priority dynamically', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test', priority: 5 }));
      adapter.addProvider(provider);

      expect(adapter.providers[0].config.priority).toBe(5);

      adapter.updateProviderPriority('test', 1);

      expect(adapter.providers[0].config.priority).toBe(1);
    });
  });

  describe('Timeout Behavior', () => {
    it('should respect provider-specific timeout configuration', async () => {
      const provider = new FakeLLMProvider(
        'test',
        createTestProviderConfig({ id: 'test', timeoutMs: 5000 })
      );

      expect(provider.config.timeoutMs).toBe(5000);
    });

    it('should track provider latency statistics', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test' }));
      provider.setLatency(100);
      provider.setResponse({
        id: 'resp_1',
        model: 'gpt-4',
        content: 'Test response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });
      adapter.addProvider(provider);

      await adapter.complete(createTestRequest());

      const stats = provider.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.averageLatencyMs).toBe(100);
    });
  });

  describe('Provider Management', () => {
    it('should add and remove providers', () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test' }));

      adapter.addProvider(provider);
      expect(adapter.providers).toHaveLength(1);

      adapter.removeProvider('test');
      expect(adapter.providers).toHaveLength(0);
    });

    it('should get provider by ID', () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test' }));
      adapter.addProvider(provider);

      const retrieved = adapter.getProvider('test');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test');
    });

    it('should return undefined for unknown provider ID', () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const retrieved = adapter.getProvider('unknown');
      expect(retrieved).toBeUndefined();
    });

    it('should get only healthy providers', () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      });

      const healthy = new FakeLLMProvider('healthy', createTestProviderConfig({ id: 'healthy' }));
      const unhealthy = new FakeLLMProvider('unhealthy', createTestProviderConfig({ id: 'unhealthy' }));
      unhealthy.setHealth('unhealthy');

      adapter.addProvider(healthy);
      adapter.addProvider(unhealthy);

      const healthyProviders = adapter.getHealthyProviders();
      expect(healthyProviders).toHaveLength(1);
      expect(healthyProviders[0].id).toBe('healthy');
    });
  });

  describe('FakeLLMProvider', () => {
    it('should track call count', async () => {
      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test' }));
      provider.setResponse({
        id: 'resp_1',
        model: 'gpt-4',
        content: 'Test',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });

      expect(provider.getCallCount()).toBe(0);

      await provider.complete(createTestRequest());
      expect(provider.getCallCount()).toBe(1);

      await provider.complete(createTestRequest());
      expect(provider.getCallCount()).toBe(2);
    });

    it('should reset call count', async () => {
      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test' }));
      provider.setResponse({
        id: 'resp_1',
        model: 'gpt-4',
        content: 'Test',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      });

      await provider.complete(createTestRequest());
      expect(provider.getCallCount()).toBe(1);

      provider.resetStats();
      expect(provider.getCallCount()).toBe(0);
    });

    it('should allow dynamic config updates', () => {
      const provider = new FakeLLMProvider('test', createTestProviderConfig({ id: 'test', timeoutMs: 30000 }));

      expect(provider.config.timeoutMs).toBe(30000);

      provider.updateConfig({ timeoutMs: 5000 });
      expect(provider.config.timeoutMs).toBe(5000);
    });
  });
});

describe('LLM Types Contracts', () => {
  describe('LLMRequest', () => {
    it('should create a valid LLM request', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.7,
        maxTokens: 100,
        topP: 0.9,
      };

      expect(request.model).toBe('gpt-4');
      expect(request.messages).toHaveLength(2);
      expect(request.temperature).toBe(0.7);
    });

    it('should accept all message roles', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'User message' },
          { role: 'assistant', content: 'Assistant message' },
          { role: 'tool', content: 'Tool result', toolCallId: 'call_1' },
        ],
      };

      expect(request.messages[0].role).toBe('system');
      expect(request.messages[1].role).toBe('user');
      expect(request.messages[2].role).toBe('assistant');
      expect(request.messages[3].role).toBe('tool');
    });

    it('should support tool definitions', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
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
        toolChoice: 'auto',
      };

      expect(request.tools).toHaveLength(1);
      expect(request.tools?.[0].type).toBe('function');
    });
  });

  describe('LLMResponse', () => {
    it('should create a valid LLM response', () => {
      const response: LLMResponse = {
        id: 'resp_123',
        model: 'gpt-4',
        content: 'Hello! How can I help you?',
        role: 'assistant',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 8,
          totalTokens: 18,
        },
        createdAt: new Date().toISOString(),
      };

      expect(response.id).toBe('resp_123');
      expect(response.model).toBe('gpt-4');
      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.finishReason).toBe('stop');
    });

    it('should support tool calls in response', () => {
      const response: LLMResponse = {
        id: 'resp_456',
        model: 'gpt-4',
        content: '',
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"Paris"}',
            },
          },
        ],
        finishReason: 'tool_calls',
        createdAt: new Date().toISOString(),
      };

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].function.name).toBe('get_weather');
    });
  });

  describe('ProviderCapabilities', () => {
    it('should define provider capabilities', () => {
      const capabilities: ProviderCapabilities = {
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsJsonMode: true,
        supportsVision: false,
        maxTokens: 8192,
        supportedModels: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      };

      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.supportsVision).toBe(false);
      expect(capabilities.maxTokens).toBe(8192);
      expect(capabilities.supportedModels).toContain('gpt-4');
    });
  });

  describe('ProviderConfig', () => {
    it('should define complete provider configuration', () => {
      const config: ProviderConfig = {
        id: 'openai',
        name: 'OpenAI',
        enabled: true,
        priority: 1,
        timeoutMs: 30000,
        retries: 3,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['gpt-4', 'gpt-3.5-turbo'],
        },
      };

      expect(config.id).toBe('openai');
      expect(config.enabled).toBe(true);
      expect(config.priority).toBe(1);
      expect(config.timeoutMs).toBe(30000);
      expect(config.retries).toBe(3);
    });
  });
});
