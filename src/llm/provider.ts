/**
 * LLM Provider Interface
 * Abstract interface for LLM provider implementations
 */

import type { LLMRequest, LLMResult, ProviderConfig } from './types';
import type { CircuitBreaker } from './circuit-breaker';

/**
 * Provider health status
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Provider statistics
 */
export interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  averageLatencyMs: number;
  lastRequestTime?: number;
  lastErrorTime?: number;
  lastError?: string;
  healthStatus: ProviderHealthStatus;
}

/**
 * LLM Provider interface
 * All LLM provider implementations must conform to this interface
 */
export interface LLMProvider {
  /** Unique identifier for this provider instance */
  readonly id: string;

  /** Provider configuration */
  readonly config: ProviderConfig;

  /** Circuit breaker for this provider */
  readonly circuitBreaker: CircuitBreaker;

  /** Current health status */
  readonly health: ProviderHealthStatus;

  /** Current statistics */
  readonly stats: ProviderStats;

  /**
   * Execute a completion request
   * @param request The LLM request
   * @returns Promise resolving to LLMResult (success or error)
   */
  complete(request: LLMRequest): Promise<LLMResult>;

  /**
   * Stream a completion request
   * @param request The LLM request
   * @returns AsyncGenerator yielding response chunks
   */
  stream?(request: LLMRequest): AsyncGenerator<string>;

  /**
   * Check if the provider is healthy and can accept requests
   * Considers both health status and circuit breaker state
   */
  isHealthy(): boolean;

  /**
   * Get current provider statistics
   */
  getStats(): ProviderStats;

  /**
   * Update provider configuration
   */
  updateConfig(config: Partial<ProviderConfig>): void;

  /**
   * Reset provider statistics
   */
  resetStats(): void;
}

/**
 * Provider factory function type
 */
export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

/**
 * Provider registry for managing multiple providers
 */
export interface ProviderRegistry {
  /** Register a provider factory */
  register(type: string, factory: ProviderFactory): void;

  /** Create a provider instance */
  create(type: string, config: ProviderConfig): LLMProvider;

  /** Get all registered provider types */
  getRegisteredTypes(): string[];
}

/**
 * Create a provider registry
 */
export function createProviderRegistry(): ProviderRegistry {
  const factories = new Map<string, ProviderFactory>();

  return {
    register(type: string, factory: ProviderFactory): void {
      factories.set(type, factory);
    },

    create(type: string, config: ProviderConfig): LLMProvider {
      const factory = factories.get(type);
      if (!factory) {
        throw new Error(`Unknown provider type: ${type}`);
      }
      return factory(config);
    },

    getRegisteredTypes(): string[] {
      return Array.from(factories.keys());
    },
  };
}
