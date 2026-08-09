/**
 * LLM Adapter Types
 * Core types for LLM request/response and provider configuration
 */

import type { RuntimeError } from '../shared/errors'

/**
 * LLM Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * LLM Message
 * Represents a single message in the conversation
 */
export interface LLMMessage {
  role: MessageRole
  content: string
  name?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * LLM Request
 * Complete request to an LLM provider
 */
export interface LLMRequest {
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stopSequences?: string[]
  tools?: ToolDefinition[]
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  responseFormat?: { type: 'json_object' | 'text' }
  /** Session/user reasoning depth; mapped to provider reasoning_effort when supported. */
  reasoningDepth?: import('./reasoning-depth.js').ReasoningDepth
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * LLM Response
 * Response from an LLM provider
 */
export interface LLMResponse {
  id: string
  model: string
  content: string
  role: 'assistant'
  toolCalls?: ToolCall[]
  usage?: TokenUsage
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  createdAt: string
  /**
   * Provider reasoning text (e.g. DeepSeek `reasoning_content`), captured separately from `content`.
   * SAFETY: MUST NOT be merged into `content` or any `channel: 'assistant'` payload.
   * Display is opt-in only (user-facing `reasoningVisible` preference, default false).
   */
  reasoningContent?: string
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
  cacheHitRate?: number
}

/**
 * LLM Request result
 * Either a successful response or an error
 */
export type LLMResult =
  | { success: true; response: LLMResponse; providerId: string }
  | { success: false; error: RuntimeError; providerId: string }

/**
 * Model capabilities flags
 * Detailed capability flags for a specific model
 */
export interface ModelCapabilities {
  streaming: boolean
  functionCalling: boolean
  jsonMode: boolean
  structuredOutput: boolean
  reasoning: boolean
  vision: boolean
  audioInput: boolean
  pdfInput: boolean
  toolChoice: boolean
  parallelToolCalls: boolean
  promptCache: boolean
}

/**
 * Provider capability flags
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean
  supportsFunctionCalling: boolean
  supportsJsonMode: boolean
  supportsVision: boolean
  maxTokens: number
  supportedModels: string[]
  /** Extended model capabilities (v60+) */
  modelCapabilities?: Partial<ModelCapabilities>
  /** Prompt provider family for this provider */
  promptFamily?: PromptProviderFamily
  /** Whether structured output is supported */
  supportsStructuredOutput?: boolean
  /** Whether reasoning capabilities are supported */
  supportsReasoning?: boolean
  /** Whether audio input is supported */
  supportsAudio?: boolean
  /** Whether PDF input is supported */
  supportsPdf?: boolean
  /** Whether parallel tool calls are supported */
  supportsParallelToolCalls?: boolean
  /** Whether prompt caching is supported */
  supportsPromptCache?: boolean
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string
  name: string
  enabled: boolean
  priority: number
  timeoutMs: number
  retries: number
  capabilities: ProviderCapabilities
  apiKey?: string
  baseUrl?: string
  enableLogging?: boolean
  siteUrl?: string
  appName?: string
}

/**
 * All providers failed error
 * Returned when no provider can fulfill the request
 */
export interface AllProvidersFailedError extends RuntimeError {
  category: 'model_error'
  code: 'ALL_PROVIDERS_FAILED'
  attempts: Array<{ providerId: string; error: RuntimeError }>
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
  | 'bedrock'
  | 'dashscope'
  | 'volcengine'
  | 'qianfan'
  | 'zhipu'
  | 'moonshot'
  | 'minimax'
  | 'mimo'
  | 'iflytek-spark'
  | 'stepfun'
  | 'hunyuan'
  | 'siliconflow'

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
  | 'bedrock_converse'

/**
 * Prompt provider family
 * Used for prompt template compatibility
 */
export type PromptProviderFamily =
  | 'openai'
  | 'deepseek'
  | 'ollama'
  | 'anthropic'
  | 'gemini'
  | 'dashscope'
  | 'volcengine'
  | 'qianfan'
  | 'zhipu'
  | 'moonshot'
  | 'minimax'
  | 'mimo'
  | 'iflytek-spark'
  | 'stepfun'
  | 'hunyuan'
  | 'siliconflow'

/**
 * Model limits
 * Token limits for a specific model
 */
export interface ModelLimits {
  contextTokens: number
  outputTokens: number
}

/**
 * Model pricing information
 * Per-million-token pricing (optional, may not be available for all models)
 */
export interface ModelPricing {
  inputPerMTok?: number
  outputPerMTok?: number
  cacheReadPerMTok?: number
  cacheWritePerMTok?: number
}

/**
 * Model information
 * Complete metadata about a specific model
 */
export interface ModelInfo {
  providerId: string
  modelId: string
  family: ProviderFamily
  protocol: ProviderProtocol
  displayName?: string
  capabilities: ModelCapabilities
  limits: ModelLimits
  pricing?: ModelPricing
  requestOptions?: Record<string, unknown>
}

/**
 * Provider runtime configuration
 * Extends base provider config with runtime-specific settings
 */
export interface ProviderRuntimeConfig extends ProviderConfig {
  family?: ProviderFamily
  protocol?: ProviderProtocol
  defaultModel?: string | null
  headers?: Record<string, string>
  customCapabilities?: Partial<ModelCapabilities>
  options?: Record<string, unknown>
  promptFamily?: PromptProviderFamily
  providerType?: string
}

/**
 * Provider candidate for fallback selection
 * Represents a potential provider for request routing
 */
export interface ProviderCandidate {
  providerId: string
  /** Provider type identifier (e.g. 'openai', 'ollama', 'openrouter') */
  providerType: string
  config: ProviderRuntimeConfig
  model: ModelInfo
  priority: number
}

/**
 * Request requirements
 * Constraints that must be satisfied by the selected provider/model
 */
export interface RequestRequirements {
  requiresTools: boolean
  requiresJsonMode: boolean
  requiresStreaming: boolean
  requiresVision: boolean
  requiresAudio: boolean
  requiresPdf: boolean
  minOutputTokens?: number
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
}

/**
 * Fallback policy configuration
 * Controls provider fallback behavior on failures
 */
export interface FallbackPolicy {
  enabled: boolean
  maxAttempts: number
  mode: 'same_model_only' | 'same_capability_only' | 'any_compatible'
}

/**
 * Default fallback policy
 * Enables fallback with best-effort mode
 */
export const DEFAULT_FALLBACK_POLICY: FallbackPolicy = {
  enabled: true,
  maxAttempts: 3,
  mode: 'any_compatible',
}

/**
 * Compute cache hit rate from token usage
 * Returns 0 if cache metrics are unavailable or total is zero
 */
export function computeCacheHitRate(usage: TokenUsage): number {
  const hit = usage.promptCacheHitTokens ?? 0
  const miss = usage.promptCacheMissTokens ?? 0
  const total = hit + miss
  return total > 0 ? hit / total : 0
}

// =============================================================================
// Streaming chunk types (text + tool_calls)
// =============================================================================

/**
 * Finish reason values shared by complete() and stream() paths.
 */
export type LLMFinishReason = LLMResponse['finishReason']

/**
 * Raw provider stream event (provider layer, no providerId).
 * OpenAI-compatible tool_calls arrive as incremental tool_call_delta fragments
 * keyed by `index`; arguments are string fragments to concatenate.
 *
 * `kind: 'reasoning'` carries provider reasoning text (e.g. DeepSeek `reasoning_content`)
 * separately from assistant `text`. SAFETY: reasoning MUST NOT be broadcast on the
 * assistant channel or merged into assistant `content`.
 */
export type ProviderStreamEvent =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'reasoning'; readonly delta: string }
  | {
      readonly kind: 'tool_call_delta'
      readonly index: number
      readonly id?: string
      readonly name?: string
      readonly argumentsDelta?: string
    }
  | { readonly kind: 'finish'; readonly finishReason: LLMFinishReason }

/**
 * Adapter-level stream chunk with provider identity.
 * Kernel consumes this shape to broadcast text tokens and aggregate tool calls.
 *
 * `kind: 'reasoning'` is broadcast on `channel: 'reasoning'` (opt-in UI only);
 * it MUST NOT be aggregated into assistant `content`.
 */
export type LLMStreamChunk =
  | {
      readonly kind: 'text'
      readonly delta: string
      readonly providerId: string
      readonly model?: string
    }
  | {
      readonly kind: 'reasoning'
      readonly delta: string
      readonly providerId: string
      readonly model?: string
    }
  | {
      readonly kind: 'tool_call_delta'
      readonly index: number
      readonly id?: string
      readonly name?: string
      readonly argumentsDelta?: string
      readonly providerId: string
      readonly model?: string
    }
  | {
      readonly kind: 'finish'
      readonly finishReason: LLMFinishReason
      readonly providerId: string
      readonly model?: string
    }

/** Map provider finish_reason string to LLMFinishReason (unknown → stop). */
export function mapFinishReason(value: string | null | undefined): LLMFinishReason {
  if (value === 'stop' || value === 'length' || value === 'tool_calls' || value === 'content_filter') {
    return value
  }
  return 'stop'
}

/** Lift a provider event into an adapter chunk. */
export function toLLMStreamChunk(event: ProviderStreamEvent, providerId: string, model?: string): LLMStreamChunk {
  switch (event.kind) {
    case 'text':
      return { kind: 'text', delta: event.delta, providerId, model }
    case 'reasoning':
      return { kind: 'reasoning', delta: event.delta, providerId, model }
    case 'tool_call_delta':
      return {
        kind: 'tool_call_delta',
        index: event.index,
        id: event.id,
        name: event.name,
        argumentsDelta: event.argumentsDelta,
        providerId,
        model,
      }
    case 'finish':
      return { kind: 'finish', finishReason: event.finishReason, providerId, model }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
