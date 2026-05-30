/**
 * Search LLM Resolver
 * Resolves search-specific provider/model configuration, isolated from main foreground model.
 */

import type { ProviderConfigStore, ProviderConfigWithSecret } from '../storage/provider-config-store.js';
import type { AgentConfig } from '../storage/agent-config-store.js';

/**
 * Search LLM resolution result
 */
export interface SearchLLMResolutionResult {
  type: 'success';
  providerId: string;
  model: string;
  provider: ProviderConfigWithSecret;
  usedMainConfigFallback: boolean;
}

export interface SearchLLMResolutionError {
  type: 'error';
  errorCode: 'SEARCH_MODEL_NOT_CONFIGURED' | 'SEARCH_PROVIDER_NOT_FOUND' | 'SEARCH_PROVIDER_UNAVAILABLE';
  message: string;
}

export type ResolveSearchLLMResult = SearchLLMResolutionResult | SearchLLMResolutionError;

/**
 * Options for resolving search LLM provider/model
 */
export interface ResolveSearchLLMOptions {
  agentConfig: AgentConfig;
  providerConfigStore: ProviderConfigStore;
  userId: string;
}

/**
 * Resolve search-specific LLM provider and model.
 * 
 * Resolution order:
 * 1. AgentConfig.searchLlmProviderId/searchLlmModel (if configured)
 * 2. Fall back to AgentConfig.providerId/model (main agent config)
 * 3. Fail if neither is configured
 * 
 * @param options Resolution options
 * @returns Search LLM resolution result
 */
export function resolveSearchLLM(options: ResolveSearchLLMOptions): ResolveSearchLLMResult {
  const { agentConfig, providerConfigStore, userId } = options;

  let providerId: string;
  let model: string;
  let usedMainConfigFallback = false;

  if (agentConfig.searchLlmProviderId && agentConfig.searchLlmModel) {
    providerId = agentConfig.searchLlmProviderId;
    model = agentConfig.searchLlmModel;
  } else if (agentConfig.providerId && agentConfig.model) {
    providerId = agentConfig.providerId;
    model = agentConfig.model;
    usedMainConfigFallback = true;
  } else {
    return {
      type: 'error',
      errorCode: 'SEARCH_MODEL_NOT_CONFIGURED',
      message: 'Search LLM provider/model not configured in agent config',
    };
  }

  // Get provider with secret
  const provider = providerConfigStore.getByIdWithSecret(providerId);
  
  if (!provider) {
    return {
      type: 'error',
      errorCode: 'SEARCH_PROVIDER_NOT_FOUND',
      message: `Search provider not found: ${providerId}`,
    };
  }

  // Verify ownership - search provider must belong to the user
  if (provider.userId !== userId) {
    return {
      type: 'error',
      errorCode: 'SEARCH_PROVIDER_NOT_FOUND',
      message: `Search provider not accessible for user: ${providerId}`,
    };
  }

  // Check if provider is enabled
  if (!provider.enabled) {
    return {
      type: 'error',
      errorCode: 'SEARCH_PROVIDER_UNAVAILABLE',
      message: `Search provider is disabled: ${providerId}`,
    };
  }

  // Check if provider has usable credentials
  const hasApiKey = provider.providerType !== 'ollama' && provider.apiKey;
  const hasBaseUrl = provider.providerType === 'ollama' && provider.baseUrl;
  if (!hasApiKey && !hasBaseUrl) {
    return {
      type: 'error',
      errorCode: 'SEARCH_PROVIDER_UNAVAILABLE',
      message: `Search provider is not configured with credentials: ${providerId}`,
    };
  }

  return {
    type: 'success',
    providerId,
    model,
    provider,
    usedMainConfigFallback,
  };
}

/**
 * Check if a provider supports function/tool calling.
 * All standard providers (openrouter, openai, ollama) support function calling.
 * Custom providers are assumed to support it unless explicitly known otherwise.
 */
export function providerSupportsFunctionCalling(provider: ProviderConfigWithSecret): boolean {
  // All standard provider types support function calling
  const supportedTypes = ['openrouter', 'openai', 'ollama'];
  
  if (supportedTypes.includes(provider.providerType)) {
    return true;
  }

  // Custom providers - assume they support function calling
  // If they don't, the LLM call will fail and we return SEARCH_MODEL_INCAPABLE
  return true;
}
