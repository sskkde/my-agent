import { describe, it, expect } from 'vitest';
import { resolveSearchLLM, providerSupportsFunctionCalling } from '../../../src/search/search-llm-resolver.js';
import type { AgentConfig } from '../../../src/storage/agent-config-store.js';
import type { ProviderConfigStore, ProviderConfigWithSecret, ProviderType } from '../../../src/storage/provider-config-store.js';

function createMockProviderConfigStore(providers: ProviderConfigWithSecret[]): ProviderConfigStore {
  return {
    getByIdWithSecret: (providerId: string) => providers.find(p => p.providerId === providerId) || null,
    listByUser: () => [],
    create: () => ({}) as never,
    update: () => false,
    remove: () => false,
    getById: () => null,
    updateTestStatus: () => false,
  } as ProviderConfigStore;
}

function createMockProvider(overrides: Partial<ProviderConfigWithSecret>): ProviderConfigWithSecret {
  return {
    providerId: 'provider-search',
    userId: 'user-123',
    providerType: 'openrouter' as ProviderType,
    displayName: 'Search Provider',
    enabled: true,
    baseUrl: null,
    selectedModel: 'gpt-4.1-mini',
    source: 'user',
    lastTestStatus: null,
    lastTestedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    apiKey: 'sk-test-key',
    ...overrides,
  };
}

function createMockAgentConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return {
    agentConfigId: 'config-1',
    agentId: 'foreground.default',
    scope: 'global',
    userId: null,
    displayName: 'Default Agent',
    enabled: true,
    systemPrompt: null,
    routingPrompt: null,
    providerId: 'provider-main',
    model: 'gpt-4',
    allowedToolIds: null,
    allowedSkillIds: null,
    routingTimeoutMs: 60000,
    repairAttempts: 1,
    promptType: null,
    promptVersion: null,
    searchLlmProviderId: 'provider-search',
    searchLlmModel: 'gpt-4.1-mini',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveSearchLLM', () => {
  describe('success cases', () => {
    it('resolves search provider and model from agent config', () => {
      const provider = createMockProvider({});
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('provider-search');
        expect(result.model).toBe('gpt-4.1-mini');
        expect(result.provider).toBe(provider);
        expect(result.usedMainConfigFallback).toBe(false);
      }
    });

    it('does not use main model provider/model', () => {
      const searchProvider = createMockProvider({
        providerId: 'provider-search',
        selectedModel: 'gpt-4.1-mini',
      });
      const agentConfig = createMockAgentConfig({
        providerId: 'provider-main',
        model: 'gpt-4',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });
      const store = createMockProviderConfigStore([searchProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('provider-search');
        expect(result.model).toBe('gpt-4.1-mini');
        expect(result.providerId).not.toBe('provider-main');
        expect(result.model).not.toBe('gpt-4');
        expect(result.usedMainConfigFallback).toBe(false);
      }
    });
  });

  describe('fallback to main agent config', () => {
    it('falls back to main config when searchLlmProviderId is not configured', () => {
      const mainProvider = createMockProvider({
        providerId: 'provider-main',
        selectedModel: 'gpt-4',
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: 'gpt-4.1-mini',
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([mainProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('provider-main');
        expect(result.model).toBe('gpt-4');
        expect(result.usedMainConfigFallback).toBe(true);
      }
    });

    it('falls back to main config when searchLlmModel is not configured', () => {
      const mainProvider = createMockProvider({
        providerId: 'provider-main',
        selectedModel: 'gpt-4',
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: 'provider-search',
        searchLlmModel: null,
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([mainProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('provider-main');
        expect(result.model).toBe('gpt-4');
        expect(result.usedMainConfigFallback).toBe(true);
      }
    });

    it('falls back to main config when both searchLlmProviderId and searchLlmModel are not configured', () => {
      const mainProvider = createMockProvider({
        providerId: 'provider-main',
        selectedModel: 'gpt-4',
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: null,
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([mainProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('provider-main');
        expect(result.model).toBe('gpt-4');
        expect(result.usedMainConfigFallback).toBe(true);
      }
    });
  });

  describe('fail closed cases', () => {
    it('returns error when neither search nor main provider/model are configured', () => {
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: null,
        providerId: null,
        model: null,
      });
      const store = createMockProviderConfigStore([]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_MODEL_NOT_CONFIGURED');
      }
    });

    it('returns error when provider is not found', () => {
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_NOT_FOUND');
      }
    });

    it('returns error when provider belongs to different user', () => {
      const provider = createMockProvider({ userId: 'other-user' });
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_NOT_FOUND');
      }
    });

    it('returns error when provider is disabled', () => {
      const provider = createMockProvider({ enabled: false });
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_UNAVAILABLE');
      }
    });

    it('returns error when provider has no API key (non-Ollama)', () => {
      const provider = createMockProvider({ apiKey: null, providerType: 'openrouter' });
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_UNAVAILABLE');
      }
    });

    it('returns error when Ollama provider has no base URL', () => {
      const provider = createMockProvider({
        providerType: 'ollama',
        baseUrl: null,
        apiKey: null,
      });
      const agentConfig = createMockAgentConfig({});
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_UNAVAILABLE');
      }
    });

    it('succeeds when Ollama provider has base URL but no API key', () => {
      const provider = createMockProvider({
        providerId: 'ollama-search',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
        apiKey: null,
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: 'ollama-search',
      });
      const store = createMockProviderConfigStore([provider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.providerId).toBe('ollama-search');
      }
    });

    it('returns error when fallback provider is not found', () => {
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: null,
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_NOT_FOUND');
      }
    });

    it('returns error when fallback provider is disabled', () => {
      const mainProvider = createMockProvider({
        providerId: 'provider-main',
        enabled: false,
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: null,
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([mainProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_UNAVAILABLE');
      }
    });

    it('returns error when fallback provider belongs to different user', () => {
      const mainProvider = createMockProvider({
        providerId: 'provider-main',
        userId: 'other-user',
      });
      const agentConfig = createMockAgentConfig({
        searchLlmProviderId: null,
        searchLlmModel: null,
        providerId: 'provider-main',
        model: 'gpt-4',
      });
      const store = createMockProviderConfigStore([mainProvider]);

      const result = resolveSearchLLM({
        agentConfig,
        providerConfigStore: store,
        userId: 'user-123',
      });

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.errorCode).toBe('SEARCH_PROVIDER_NOT_FOUND');
      }
    });
  });
});

describe('providerSupportsFunctionCalling', () => {
  it('returns true for openrouter', () => {
    const provider = createMockProvider({ providerType: 'openrouter' });
    expect(providerSupportsFunctionCalling(provider)).toBe(true);
  });

  it('returns true for openai', () => {
    const provider = createMockProvider({ providerType: 'openai' });
    expect(providerSupportsFunctionCalling(provider)).toBe(true);
  });

  it('returns true for ollama', () => {
    const provider = createMockProvider({ providerType: 'ollama' });
    expect(providerSupportsFunctionCalling(provider)).toBe(true);
  });

  it('returns true for custom providers (assumed support)', () => {
    const provider = createMockProvider({ providerType: 'custom' });
    expect(providerSupportsFunctionCalling(provider)).toBe(true);
  });
});
