/**
 * LLM Adapter with Fallback Support
 * Orchestrates multiple LLM providers with automatic failover
 */

import type { LLMProvider } from './provider';
import type {
  LLMRequest,
  LLMResult,
  ProviderConfig,
  AllProvidersFailedError,
} from './types';
import type { CircuitBreakerConfig } from './circuit-breaker';
import type { RuntimeError, ErrorSource } from '../shared/errors';
import type { RetryPolicy } from '../shared/retry';

/**
 * LLM Adapter configuration
 */
export interface LLMAdapterConfig {
  /** Provider configurations in priority order */
  providers: ProviderConfig[];

  /** Default timeout for requests */
  defaultTimeoutMs: number;

  /** Whether to enable circuit breakers */
  enableCircuitBreaker: boolean;

  /** Circuit breaker configuration */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;

  /** Retry policy for failed requests */
  retryPolicy?: RetryPolicy;

  /** Whether to enable request/response logging */
  enableLogging?: boolean;
}

/**
 * Default adapter configuration
 */
export const DEFAULT_ADAPTER_CONFIG: Omit<LLMAdapterConfig, 'providers'> = {
  defaultTimeoutMs: 60000,
  enableCircuitBreaker: true,
  enableLogging: false,
};



/**
 * LLM Adapter with multi-provider support
 */
export interface LLMAdapter {
  /** Adapter configuration */
  readonly config: LLMAdapterConfig;

  /** Registered providers in priority order */
  readonly providers: LLMProvider[];

  /**
   * Execute a request with automatic failover
   * Tries providers in priority order until one succeeds
   */
  complete(request: LLMRequest): Promise<LLMResult>;

  /**
   * Add a provider to the adapter
   */
  addProvider(provider: LLMProvider): void;

  /**
   * Remove a provider by ID
   */
  removeProvider(providerId: string): void;

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): LLMProvider | undefined;

  /**
   * Get all healthy providers
   */
  getHealthyProviders(): LLMProvider[];

  /**
   * Update provider priority
   */
  updateProviderPriority(providerId: string, priority: number): void;
}

/**
 * Create an AllProvidersFailedError
 */
function createAllProvidersFailedError(
  attempts: Array<{ providerId: string; error: RuntimeError }>,
  source: ErrorSource
): AllProvidersFailedError {
  return {
    errorId: `err_all_providers_failed_${Date.now()}`,
    category: 'model_error',
    code: 'ALL_PROVIDERS_FAILED',
    message: `All providers failed after ${attempts.length} attempts`,
    recoverability: 'retryable_later',
    source,
    attempts,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create an LLM adapter with fallback support
 */
export function createLLMAdapter(config: LLMAdapterConfig): LLMAdapter {
  const providers: LLMProvider[] = [];
  const finalConfig = { ...DEFAULT_ADAPTER_CONFIG, ...config };

  const getHealthyProviders = (): LLMProvider[] => {
    return providers
      .filter((p) => p.isHealthy())
      .sort((a, b) => a.config.priority - b.config.priority);
  };

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const healthyProviders = getHealthyProviders();

    if (healthyProviders.length === 0) {
      const error = createAllProvidersFailedError(
        [],
        { module: 'llm_adapter' }
      );
      return {
        success: false,
        error,
        providerId: 'none',
      };
    }

    const attempts: Array<{ providerId: string; error: RuntimeError }> = [];

    for (const provider of healthyProviders) {
      const startTime = Date.now();

      try {
        const result = await provider.complete(request);
        const latencyMs = Date.now() - startTime;

        if (result.success) {
          if (finalConfig.enableLogging) {
            console.log(`[LLM Adapter] Success via ${provider.id} in ${latencyMs}ms`);
          }
          return result;
        } else {
          attempts.push({
            providerId: provider.id,
            error: result.error,
          });
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const runtimeError: RuntimeError = {
          errorId: `err_provider_exception_${Date.now()}`,
          category: 'model_error',
          code: 'PROVIDER_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverability: 'retryable_later',
          source: { module: 'llm_adapter', runId: request.model },
          createdAt: new Date().toISOString(),
        };

        attempts.push({
          providerId: provider.id,
          error: runtimeError,
        });

        if (finalConfig.enableLogging) {
          console.error(
            `[LLM Adapter] Provider ${provider.id} failed after ${latencyMs}ms:`,
            runtimeError.message
          );
        }
      }
    }

    // All providers failed
    const allFailedError = createAllProvidersFailedError(
      attempts,
      { module: 'llm_adapter' }
    );

    return {
      success: false,
      error: allFailedError,
      providerId: 'none',
    };
  };

  const addProvider = (provider: LLMProvider): void => {
    providers.push(provider);
    // Keep sorted by priority
    providers.sort((a, b) => a.config.priority - b.config.priority);
  };

  const removeProvider = (providerId: string): void => {
    const index = providers.findIndex((p) => p.id === providerId);
    if (index !== -1) {
      providers.splice(index, 1);
    }
  };

  const getProvider = (providerId: string): LLMProvider | undefined => {
    return providers.find((p) => p.id === providerId);
  };

  const updateProviderPriority = (providerId: string, priority: number): void => {
    const provider = providers.find((p) => p.id === providerId);
    if (provider) {
      provider.updateConfig({ ...provider.config, priority });
      providers.sort((a, b) => a.config.priority - b.config.priority);
    }
  };

  return {
    get config() {
      return finalConfig;
    },
    get providers() {
      return [...providers];
    },
    complete,
    addProvider,
    removeProvider,
    getProvider,
    getHealthyProviders,
    updateProviderPriority,
  };
}

/**
 * Create a timeout error
 */
export function createTimeoutError(
  providerId: string,
  timeoutMs: number,
  source: ErrorSource
): RuntimeError {
  return {
    errorId: `err_timeout_${Date.now()}`,
    category: 'timeout',
    code: 'PROVIDER_TIMEOUT',
    message: `Provider ${providerId} timed out after ${timeoutMs}ms`,
    recoverability: 'retryable_later',
    source,
    technical: {
      retryAfterMs: Math.min(timeoutMs * 2, 60000),
    },
    createdAt: new Date().toISOString(),
  };
}
