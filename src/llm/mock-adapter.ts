/**
 * Mock LLM Adapter for Testing and Development
 * Provides deterministic responses based on message keywords
 */

import type { LLMAdapter, LLMAdapterConfig } from './adapter.js';
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from './provider.js';
import type { CircuitBreaker, CircuitBreakerState, CircuitBreakerStats } from './circuit-breaker.js';
import type { LLMRequest, LLMResult, LLMResponse, ProviderConfig, ProviderCapabilities } from './types.js';
import type { ExactContextUsage } from '../api/types.js';

/**
 * Mock circuit breaker - always closed, all methods no-ops
 */
function createMockCircuitBreaker(): CircuitBreaker {
  const stats: CircuitBreakerStats = {
    state: 'CLOSED' as CircuitBreakerState,
    failureCount: 0,
    successCount: 0,
    totalRequests: 0,
    rejectedRequests: 0,
  };

  return {
    get state() { return 'CLOSED' as CircuitBreakerState; },
    get config() {
      return {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        successThreshold: 2,
      };
    },
    get stats() { return { ...stats }; },
    recordSuccess: () => { stats.successCount++; stats.lastSuccessTime = Date.now(); },
    recordFailure: () => { stats.failureCount++; stats.lastFailureTime = Date.now(); },
    canExecute: () => true,
    reset: () => { stats.failureCount = 0; stats.successCount = 0; },
    forceOpen: () => {},
    forceClose: () => {},
  };
}

/**
 * Deterministic routing based on message keywords
 */
function routeDeterministically(messages: Array<{ role: string; content: string }>): {
  route: string;
  reason: string;
  suggestedTools?: string[];
} {
  // Get the last user message
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const content = (lastUserMessage?.content ?? '').toLowerCase();

  // Keyword-based routing
  if (content.includes('search') || content.includes('find') || content.includes('look up')) {
    return {
      route: 'dispatch_tool',
      reason: 'User requested to search or find information',
      suggestedTools: ['web.search'],
    };
  }

  if (content.includes('status') || content.includes('progress') || content.includes('what is running')) {
    return {
      route: 'status_query',
      reason: 'User is asking about status or progress',
      suggestedTools: ['status.query'],
    };
  }

  if (content.includes('plan') || content.includes('step') || content.includes('task')) {
    return {
      route: 'spawn_planner',
      reason: 'User is requesting planning or multi-step task execution',
    };
  }

  // Default: answer directly
  return {
    route: 'answer_directly',
    reason: 'Simple question or statement, answering directly',
  };
}

/**
 * Create a mock LLM provider
 */
function createMockLLMProvider(): LLMProvider {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: false,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['mock-model'],
  };

  const config: ProviderConfig = {
    id: 'mock',
    name: 'Mock LLM Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 30000,
    retries: 0,
    capabilities,
  };

  let stats: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeoutRequests: 0,
    averageLatencyMs: 0,
    healthStatus: 'healthy' as ProviderHealthStatus,
  };

  const circuitBreaker = createMockCircuitBreaker();

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const startTime = Date.now();
    stats.totalRequests++;

    // Generate deterministic response based on message content
    const routing = routeDeterministically(request.messages);

    const response: LLMResponse = {
      id: `mock-${Date.now()}`,
      model: request.model,
      content: JSON.stringify({
        route: routing.route,
        reason: routing.reason,
        userVisibleResponse: `Mock response for: ${routing.route}`,
        suggestedTools: routing.suggestedTools,
      }),
      role: 'assistant',
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    };

    const latencyMs = Date.now() - startTime;
    stats.successfulRequests++;
    stats.averageLatencyMs = (stats.averageLatencyMs * (stats.totalRequests - 1) + latencyMs) / stats.totalRequests;
    stats.lastRequestTime = Date.now();

    return {
      success: true,
      response,
      providerId: 'mock',
    };
  };

  return {
    get id() { return 'mock'; },
    get config() { return { ...config }; },
    get circuitBreaker() { return circuitBreaker; },
    get health() { return stats.healthStatus; },
    get stats() { return { ...stats }; },
    complete,
    isHealthy: () => true,
    getStats: () => ({ ...stats }),
    updateConfig: (newConfig: Partial<ProviderConfig>) => {
      Object.assign(config, newConfig);
    },
    resetStats: () => {
      stats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        timeoutRequests: 0,
        averageLatencyMs: 0,
        healthStatus: 'healthy',
      };
    },
  };
}

/**
 * Create a mock LLM adapter for testing and development
 */
export function createMockLLMAdapter(): LLMAdapter {
  const providers: LLMProvider[] = [createMockLLMProvider()];

  const config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 30000,
    enableCircuitBreaker: false,
    enableLogging: false,
  };

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const provider = providers[0];
    if (!provider) {
      return {
        success: false,
        error: {
          errorId: `err_no_provider_${Date.now()}`,
          category: 'model_error',
          code: 'NO_PROVIDER',
          message: 'No mock provider available',
          recoverability: 'retryable_later',
          source: { module: 'mock_adapter' },
          createdAt: new Date().toISOString(),
        },
        providerId: 'none',
      };
    }
    return provider.complete(request);
  };

  async function* stream(request: LLMRequest): AsyncGenerator<{ delta: string; providerId: string; model?: string; usage?: ExactContextUsage }> {
    const result = await complete(request);
    if (result.success) {
      yield {
        delta: result.response.content,
        providerId: result.providerId,
        model: result.response.model,
      };
    }
  }

  return {
    get config() { return config; },
    get providers() { return [...providers]; },
    complete,
    stream,
    addProvider: (provider: LLMProvider) => {
      providers.push(provider);
    },
    removeProvider: (providerId: string) => {
      const index = providers.findIndex(p => p.id === providerId);
      if (index !== -1) {
        providers.splice(index, 1);
      }
    },
    getProvider: (providerId: string) => {
      return providers.find(p => p.id === providerId);
    },
    getHealthyProviders: () => {
      return providers.filter(p => p.isHealthy());
    },
    updateProviderPriority: (providerId: string, priority: number) => {
      const provider = providers.find(p => p.id === providerId);
      if (provider) {
        provider.updateConfig({ ...provider.config, priority });
      }
    },
  };
}
