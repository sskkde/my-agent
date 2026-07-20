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
  ProviderStreamEvent,
  LLMStreamChunk,
  LLMFinishReason,
} from './types'

export { mapFinishReason, toLLMStreamChunk } from './types'
export { StreamResponseAggregator } from './stream-aggregator.js'
export { supportsStructuredToolStreaming } from './stream-capabilities.js'

// Circuit Breaker
export type {
  CircuitBreakerState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreaker,
  CircuitBreakerOpenError,
} from './circuit-breaker'

export { DEFAULT_CIRCUIT_BREAKER_CONFIG, createCircuitBreaker } from './circuit-breaker'

// Provider
export type { ProviderHealthStatus, ProviderStats, LLMProvider, ProviderFactory, ProviderRegistry } from './provider'

export { createProviderRegistry } from './provider'

export type { LLMAdapterConfig, LLMAdapter } from './adapter'
export { DEFAULT_ADAPTER_CONFIG, createLLMAdapter, createTimeoutError } from './adapter'

export { BaseProvider, OpenAIAdapter, OpenRouterAdapter, OllamaAdapter, MultiProviderLLMAdapter } from './providers'

// Agent Provider Resolver
export type {
  SessionSelection,
  AgentConfigProviderSettings,
  ResolveProviderOptions,
  ProviderCandidate,
  FallbackMetadata,
  ProviderResolutionResult,
  NoProviderAvailableResult,
  ProviderResolutionResultUnion,
} from './agent-provider-resolver'

export { resolveProviderAndModel } from './agent-provider-resolver'
export { resolveProviderFamily } from '../kernel/model-input/model-input-types.js'
