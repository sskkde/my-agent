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
 * Provider capability flags
 */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  supportsVision: boolean;
  maxTokens: number;
  supportedModels: string[];
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
