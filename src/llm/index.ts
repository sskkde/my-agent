/**
 * LLM Adapter Module
 * Exports all LLM adapter types and functions
 */

// Types
export type {
  MessageRole,
  LLMMessage,
  ToolCall,
  LLMRequest,
  ToolDefinition,
  LLMResponse,
  TokenUsage,
  LLMResult,
  ProviderCapabilities,
  ProviderConfig,
  AllProvidersFailedError,
} from './types';

// Circuit Breaker
export type {
  CircuitBreakerState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreaker,
  CircuitBreakerOpenError,
} from './circuit-breaker';

export {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  createCircuitBreaker,
} from './circuit-breaker';

// Provider
export type {
  ProviderHealthStatus,
  ProviderStats,
  LLMProvider,
  ProviderFactory,
  ProviderRegistry,
} from './provider';

export { createProviderRegistry } from './provider';

// Adapter
export type { LLMAdapterConfig, LLMAdapter } from './adapter';

export {
  DEFAULT_ADAPTER_CONFIG,
  createLLMAdapter,
  createTimeoutError,
} from './adapter';
