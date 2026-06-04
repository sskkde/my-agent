/**
 * LLM Adapter Types
 * Core types for LLM request/response and provider configuration
 */

import type { RuntimeError } from '../shared/errors';

/**
 * LLM Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * LLM Message
 * Represents a single message in the conversation
 */
export interface LLMMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * LLM Request
 * Complete request to an LLM provider
 */
export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'json_object' | 'text' };
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * LLM Response
 * Response from an LLM provider
 */
export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  role: 'assistant';
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  createdAt: string;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  cacheHitRate?: number;
}

/**
 * LLM Request result
 * Either a successful response or an error
 */
export type LLMResult =
  | { success: true; response: LLMResponse; providerId: string }
  | { success: false; error: RuntimeError; providerId: string };

/**
 * Model capabilities flags
 * Detailed capability flags for a specific model
 */
export interface ModelCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  jsonMode: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  vision: boolean;
  audioInput: boolean;
  pdfInput: boolean;
  toolChoice: boolean;
  parallelToolCalls: boolean;
  promptCache: boolean;
}

/**
 * Provider capability flags
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  supportsVision: boolean;
  maxTokens: number;
  supportedModels: string[];
  /** Extended model capabilities (v60+) */
  modelCapabilities?: Partial<ModelCapabilities>;
  /** Prompt provider family for this provider */
  promptFamily?: PromptProviderFamily;
  /** Whether structured output is supported */
  supportsStructuredOutput?: boolean;
  /** Whether reasoning capabilities are supported */
  supportsReasoning?: boolean;
  /** Whether audio input is supported */
  supportsAudio?: boolean;
  /** Whether PDF input is supported */
  supportsPdf?: boolean;
  /** Whether parallel tool calls are supported */
  supportsParallelToolCalls?: boolean;
  /** Whether prompt caching is supported */
  supportsPromptCache?: boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  retries: number;
  capabilities: ProviderCapabilities;
  apiKey?: string;
  baseUrl?: string;
  enableLogging?: boolean;
  siteUrl?: string;
  appName?: string;
}

/**
 * All providers failed error
 * Returned when no provider can fulfill the request
 */
export interface AllProvidersFailedError extends RuntimeError {
  category: 'model_error';
  code: 'ALL_PROVIDERS_FAILED';
  attempts: Array<{ providerId: string; error: RuntimeError }>;
}

// ============================================================================
// v60+ Extensions: Provider Family, Protocol, and Model Types
// ============================================================================

/**
 * Provider family identifier
 * Categorizes providers by their underlying architecture
 */
export type ProviderFamily =
  | 'openai'
  | 'openai_compatible'
  | 'deepseek'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'bedrock';

/**
 * Provider communication protocol
 * Defines the API format used by a provider
 */
export type ProviderProtocol =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini_generate_content'
  | 'ollama_chat'
  | 'bedrock_converse';

/**
 * Prompt provider family
 * Used for prompt template compatibility
 */
export type PromptProviderFamily =
  | 'openai'
  | 'deepseek'
  | 'ollama'
  | 'anthropic'
  | 'gemini';

/**
 * Model limits
 * Token limits for a specific model
 */
export interface ModelLimits {
  contextTokens: number;
  outputTokens: number;
}

/**
 * Model pricing information
 * Per-million-token pricing (optional, may not be available for all models)
 */
export interface ModelPricing {
  inputPerMTok?: number;
  outputPerMTok?: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

/**
 * Model information
 * Complete metadata about a specific model
 */
export interface ModelInfo {
  providerId: string;
  modelId: string;
  family: ProviderFamily;
  protocol: ProviderProtocol;
  displayName?: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  pricing?: ModelPricing;
  requestOptions?: Record<string, unknown>;
}

/**
 * Provider runtime configuration
 * Extends base provider config with runtime-specific settings
 */
export interface ProviderRuntimeConfig extends ProviderConfig {
  family?: ProviderFamily;
  protocol?: ProviderProtocol;
  defaultModel?: string | null;
  headers?: Record<string, string>;
  customCapabilities?: Partial<ModelCapabilities>;
  options?: Record<string, unknown>;
  promptFamily?: PromptProviderFamily;
}

/**
 * Provider candidate for fallback selection
 * Represents a potential provider for request routing
 */
export interface ProviderCandidate {
  providerId: string;
  /** Provider type identifier (e.g. 'openai', 'ollama', 'openrouter') */
  providerType: string;
  config: ProviderRuntimeConfig;
  model: ModelInfo;
  priority: number;
}

/**
 * Request requirements
 * Constraints that must be satisfied by the selected provider/model
 */
export interface RequestRequirements {
  requiresTools: boolean;
  requiresJsonMode: boolean;
  requiresStreaming: boolean;
  requiresVision: boolean;
  requiresAudio: boolean;
  requiresPdf: boolean;
  minOutputTokens?: number;
}

/**
 * Default request requirements
 * No special requirements by default
 */
export const DEFAULT_REQUEST_REQUIREMENTS: RequestRequirements = {
  requiresTools: false,
  requiresJsonMode: false,
  requiresStreaming: false,
  requiresVision: false,
  requiresAudio: false,
  requiresPdf: false,
};

/**
 * Fallback policy configuration
 * Controls provider fallback behavior on failures
 */
export interface FallbackPolicy {
  enabled: boolean;
  maxAttempts: number;
  mode: 'same_model_only' | 'same_capability_only' | 'any_compatible';
}

/**
 * Default fallback policy
 * Enables fallback with best-effort mode
 */
export const DEFAULT_FALLBACK_POLICY: FallbackPolicy = {
  enabled: true,
  maxAttempts: 3,
  mode: 'any_compatible',
};

/**
 * Compute cache hit rate from token usage
 * Returns 0 if cache metrics are unavailable or total is zero
 */
export function computeCacheHitRate(usage: TokenUsage): number {
  const hit = usage.promptCacheHitTokens ?? 0;
  const miss = usage.promptCacheMissTokens ?? 0;
  const total = hit + miss;
  return total > 0 ? hit / total : 0;
}
