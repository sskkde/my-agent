import { describe, expect, it } from 'vitest';
import {
  buildProviderRuntimeConfig,
  resolveProviderCandidates,
  type EnvProviderDescriptor,
} from '../../../src/llm/routing/provider-resolver.js';
import type { ProviderConfigWithSecret } from '../../../src/storage/provider-config-store.js';
import type { ModelInfo } from '../../../src/llm/types.js';
import { getProviderCatalogEntry } from '../../../src/llm/catalog/provider-catalog.js';

function createMockProvider(
  overrides: Partial<ProviderConfigWithSecret> = {}
): ProviderConfigWithSecret {
  return {
    providerId: 'test-provider',
    userId: 'test-user',
    providerType: 'openai',
    displayName: 'Test Provider',
    enabled: true,
    baseUrl: null,
    selectedModel: null,
    apiKey: 'sk-test-key',
    source: 'database',
    lastTestStatus: null,
    lastTestedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockEnvProvider(
  overrides: Partial<EnvProviderDescriptor> = {}
): EnvProviderDescriptor {
  return {
    providerType: 'openai',
    providerId: 'env-openai',
    apiKey: 'sk-env-key',
    ...overrides,
  };
}

function createMockModel(): ModelInfo {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    capabilities: {
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      structuredOutput: false,
      reasoning: false,
      vision: false,
      audioInput: false,
      pdfInput: false,
      toolChoice: false,
      parallelToolCalls: false,
      promptCache: false,
    },
    limits: {
      contextTokens: 8192,
      outputTokens: 4096,
    },
  };
}

describe('provider-resolver', () => {
  describe('buildProviderRuntimeConfig', () => {
    it('uses catalog defaults when DB fields are missing', () => {
      const provider = createMockProvider({
        providerType: 'openai',
        family: null,
        protocol: null,
        defaultModel: null,
      });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.family).toBe('openai');
      expect(config.protocol).toBe('openai_chat');
      expect(config.promptFamily).toBe('openai');
    });

    it('uses DB fields when set (family, protocol, defaultModel)', () => {
      const provider = createMockProvider({
        providerType: 'openai',
        family: 'anthropic',
        protocol: 'anthropic_messages',
        defaultModel: 'claude-3-opus',
      });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.family).toBe('anthropic');
      expect(config.protocol).toBe('anthropic_messages');
      expect(config.defaultModel).toBe('claude-3-opus');
    });

    it('uses selectedModel as fallback for defaultModel', () => {
      const provider = createMockProvider({
        providerType: 'openai',
        defaultModel: null,
        selectedModel: 'gpt-4',
      });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.defaultModel).toBe('gpt-4');
    });

    it('applies DeepSeek default baseUrl when not set', () => {
      const provider = createMockProvider({
        providerType: 'deepseek',
        baseUrl: null,
        apiKey: 'sk-deepseek',
      });
      const catalog = getProviderCatalogEntry('deepseek');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.baseUrl).toBe('https://api.deepseek.com');
    });

    it('preserves explicit baseUrl for DeepSeek', () => {
      const provider = createMockProvider({
        providerType: 'deepseek',
        baseUrl: 'https://custom.deepseek.api',
        apiKey: 'sk-deepseek',
      });
      const catalog = getProviderCatalogEntry('deepseek');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.baseUrl).toBe('https://custom.deepseek.api');
    });

    it('uses catalog defaultModel when DB has no model', () => {
      const provider = createMockProvider({
        providerType: 'deepseek',
        defaultModel: null,
        selectedModel: null,
        apiKey: 'sk-deepseek',
      });
      const catalog = getProviderCatalogEntry('deepseek');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.defaultModel).toBe('deepseek-v4-flash');
    });

    it('falls back to gpt-4o-mini when no model specified anywhere', () => {
      const provider = createMockProvider({
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
        defaultModel: null,
        selectedModel: null,
        apiKey: null,
      });
      const catalog = getProviderCatalogEntry('ollama');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.defaultModel).toBe('gpt-4o-mini');
    });

    it('uses provider priority from DB', () => {
      const provider = createMockProvider({ priority: 50 });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.priority).toBe(50);
    });

    it('defaults priority to 100 when not set', () => {
      const provider = createMockProvider({ priority: null });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.priority).toBe(100);
    });

    it('includes headers from provider config', () => {
      const provider = createMockProvider({
        headers: { 'X-Custom-Header': 'custom-value' },
      });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.headers).toEqual({ 'X-Custom-Header': 'custom-value' });
    });

    it('includes options from provider config', () => {
      const provider = createMockProvider({
        options: { temperature: 0.7, maxRetries: 3 },
      });
      const catalog = getProviderCatalogEntry('openai');
      const model = createMockModel();

      const config = buildProviderRuntimeConfig(provider, catalog, model);

      expect(config.options).toEqual({ temperature: 0.7, maxRetries: 3 });
    });
  });

  describe('resolveProviderCandidates', () => {
    it('returns empty array for empty input', () => {
      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toEqual([]);
    });

    it('DB provider priority starts at 10 and increments by 10', () => {
      const providers = [
        createMockProvider({ providerId: 'provider-1' }),
        createMockProvider({ providerId: 'provider-2' }),
        createMockProvider({ providerId: 'provider-3' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      expect(candidates[0].priority).toBe(10);
      expect(candidates[1].priority).toBe(20);
      expect(candidates[2].priority).toBe(30);
    });

    it('Env provider priority starts at 100 and increments by 10', () => {
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-1' }),
        createMockEnvProvider({ providerId: 'env-2' }),
        createMockEnvProvider({ providerId: 'env-3' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      expect(candidates[0].priority).toBe(100);
      expect(candidates[1].priority).toBe(110);
      expect(candidates[2].priority).toBe(120);
    });

    it('Preferred provider gets priority 1', () => {
      const providers = [
        createMockProvider({ providerId: 'provider-1' }),
        createMockProvider({ providerId: 'preferred-provider' }),
        createMockProvider({ providerId: 'provider-3' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        preferredProviderId: 'preferred-provider',
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      const preferred = candidates.find((c) => c.providerId === 'preferred-provider');
      expect(preferred?.priority).toBe(1);
      expect(candidates[0].priority).toBe(1);
    });

    it('DB provider with same id as env provider overrides env provider', () => {
      const dbProvider = createMockProvider({ providerId: 'openai' });
      const envProvider = createMockEnvProvider({ providerId: 'openai' });

      const candidates = resolveProviderCandidates({
        dbProviders: [dbProvider],
        envProviders: [envProvider],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('openai');
      expect(candidates[0].priority).toBe(10);
    });

    it('Disabled providers are excluded', () => {
      const providers = [
        createMockProvider({ providerId: 'enabled-provider', enabled: true }),
        createMockProvider({ providerId: 'disabled-provider', enabled: false }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('enabled-provider');
    });

    it('Ollama provider without baseUrl is excluded', () => {
      const providers = [
        createMockProvider({
          providerId: 'ollama-no-url',
          providerType: 'ollama',
          baseUrl: null,
          apiKey: null,
        }),
        createMockProvider({
          providerId: 'ollama-with-url',
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434',
          apiKey: null,
        }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('ollama-with-url');
    });

    it('Non-ollama without apiKey is excluded', () => {
      const providers = [
        createMockProvider({
          providerId: 'openai-no-key',
          providerType: 'openai',
          apiKey: null,
        }),
        createMockProvider({
          providerId: 'openai-with-key',
          providerType: 'openai',
          apiKey: 'sk-test',
        }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('openai-with-key');
    });

    it('NODE_ENV === "test" skips env providers', () => {
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-openai' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'test',
      });

      expect(candidates).toHaveLength(0);
    });

    it('NODE_ENV !== "test" includes env providers', () => {
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-openai' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('env-openai');
    });

    it('Sort order is by priority ascending', () => {
      const dbProviders = [
        createMockProvider({ providerId: 'db-1' }),
        createMockProvider({ providerId: 'db-2' }),
      ];
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-1' }),
        createMockEnvProvider({ providerId: 'env-2' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders,
        envProviders,
        preferredProviderId: 'env-2',
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(4);
      expect(candidates[0].providerId).toBe('env-2');
      expect(candidates[0].priority).toBe(1);
      expect(candidates[1].providerId).toBe('db-1');
      expect(candidates[1].priority).toBe(10);
      expect(candidates[2].providerId).toBe('db-2');
      expect(candidates[2].priority).toBe(20);
      expect(candidates[3].providerId).toBe('env-1');
      expect(candidates[3].priority).toBe(100);
    });

    it('Preferred DB provider does not increment priority counter', () => {
      const providers = [
        createMockProvider({ providerId: 'provider-1' }),
        createMockProvider({ providerId: 'preferred-provider' }),
        createMockProvider({ providerId: 'provider-3' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        preferredProviderId: 'preferred-provider',
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      const ids = candidates.map((c) => c.providerId);
      expect(ids).toContain('preferred-provider');
      
      const nonPreferred = candidates.filter((c) => c.providerId !== 'preferred-provider');
      expect(nonPreferred[0].priority).toBe(10);
      expect(nonPreferred[1].priority).toBe(20);
    });

    it('Preferred env provider does not increment priority counter', () => {
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-1' }),
        createMockEnvProvider({ providerId: 'env-preferred' }),
        createMockEnvProvider({ providerId: 'env-2' }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        preferredProviderId: 'env-preferred',
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      const nonPreferred = candidates.filter((c) => c.providerId !== 'env-preferred');
      expect(nonPreferred[0].priority).toBe(100);
      expect(nonPreferred[1].priority).toBe(110);
    });

    it('Env provider without credentials is excluded', () => {
      const envProviders = [
        createMockEnvProvider({ providerId: 'env-with-key', apiKey: 'sk-test' }),
        createMockEnvProvider({ providerId: 'env-no-key', apiKey: undefined }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('env-with-key');
    });

    it('Env ollama without baseUrl is excluded', () => {
      const envProviders = [
        createMockEnvProvider({
          providerId: 'env-ollama-no-url',
          providerType: 'ollama',
          baseUrl: undefined,
          apiKey: undefined,
        }),
        createMockEnvProvider({
          providerId: 'env-ollama-with-url',
          providerType: 'ollama',
          baseUrl: 'http://localhost:11434',
          apiKey: undefined,
        }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].providerId).toBe('env-ollama-with-url');
    });

    it('Uses custom modelResolver when provided', () => {
      const customModel: ModelInfo = {
        providerId: 'custom-provider',
        modelId: 'custom-model',
        family: 'openai_compatible',
        protocol: 'openai_chat',
        capabilities: {
          streaming: true,
          functionCalling: true,
          jsonMode: false,
          structuredOutput: false,
          reasoning: false,
          vision: false,
          audioInput: false,
          pdfInput: false,
          toolChoice: false,
          parallelToolCalls: false,
          promptCache: false,
        },
        limits: {
          contextTokens: 32000,
          outputTokens: 8000,
        },
      };

      const candidates = resolveProviderCandidates({
        dbProviders: [createMockProvider()],
        envProviders: [],
        modelResolver: () => customModel,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model).toEqual(customModel);
    });

    it('Resolves model info for each provider', () => {
      const provider = createMockProvider({
        providerType: 'deepseek',
        selectedModel: 'deepseek-chat',
        apiKey: 'sk-deepseek',
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.modelId).toBe('deepseek-chat');
      expect(candidates[0].model.family).toBe('deepseek');
    });

    it('Unknown provider type is excluded from env providers', () => {
      const envProviders = [
        createMockEnvProvider({
          providerId: 'unknown-provider',
          providerType: 'unknown' as any,
        }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: [],
        envProviders,
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(0);
    });

    it('DB provider with unknown type still works (uses defaults)', () => {
      const provider = createMockProvider({
        providerType: 'unknown' as any,
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].config.family).toBe('openai_compatible');
      expect(candidates[0].config.protocol).toBe('openai_chat');
    });

    it('Derives correct capabilities for JSON mode providers', () => {
      const openai = createMockProvider({
        providerId: 'openai-provider',
        providerType: 'openai',
      });
      const openrouter = createMockProvider({
        providerId: 'openrouter-provider',
        providerType: 'openrouter',
      });
      const deepseek = createMockProvider({
        providerId: 'deepseek-provider',
        providerType: 'deepseek',
        apiKey: 'sk-test',
      });
      const ollama = createMockProvider({
        providerId: 'ollama-provider',
        providerType: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [openai, openrouter, deepseek, ollama],
        envProviders: [],
        nodeEnv: 'development',
      });

      const openaiConfig = candidates.find((c) => c.providerId === 'openai-provider');
      const openrouterConfig = candidates.find((c) => c.providerId === 'openrouter-provider');
      const deepseekConfig = candidates.find((c) => c.providerId === 'deepseek-provider');
      const ollamaConfig = candidates.find((c) => c.providerId === 'ollama-provider');

      expect(openaiConfig?.config.capabilities.supportsJsonMode).toBe(true);
      expect(openrouterConfig?.config.capabilities.supportsJsonMode).toBe(true);
      expect(deepseekConfig?.config.capabilities.supportsJsonMode).toBe(true);
      expect(ollamaConfig?.config.capabilities.supportsJsonMode).toBe(false);
    });

    it('Respects explicit DB priority over auto-increment', () => {
      const providers = [
        createMockProvider({ providerId: 'provider-1', priority: 5 }),
        createMockProvider({ providerId: 'provider-2', priority: null }),
        createMockProvider({ providerId: 'provider-3', priority: 15 }),
      ];

      const candidates = resolveProviderCandidates({
        dbProviders: providers,
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(3);
      const provider1 = candidates.find((c) => c.providerId === 'provider-1');
      const provider2 = candidates.find((c) => c.providerId === 'provider-2');
      const provider3 = candidates.find((c) => c.providerId === 'provider-3');

      expect(provider1?.priority).toBe(5);
      expect(provider2?.priority).toBe(10);
      expect(provider3?.priority).toBe(15);
    });

    it('Applies provider.capabilities boolean overrides to model', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        capabilities: {
          functionCalling: false,
          jsonMode: true,
          vision: true,
        },
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.capabilities.functionCalling).toBe(false);
      expect(candidates[0].model.capabilities.jsonMode).toBe(true);
      expect(candidates[0].model.capabilities.vision).toBe(true);
    });

    it('Ignores non-boolean provider.capabilities fields', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        capabilities: {
          functionCalling: false,
          invalidField: 'should-be-ignored',
          anotherField: 123,
        },
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.capabilities.functionCalling).toBe(false);
    });

    it('Applies provider.models displayName override', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        selectedModel: 'test-model',
        models: [
          {
            modelId: 'test-model',
            displayName: 'Custom Display Name',
          },
        ],
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.displayName).toBe('Custom Display Name');
    });

    it('Applies provider.models capabilities override', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        selectedModel: 'test-model',
        models: [
          {
            modelId: 'test-model',
            capabilities: {
              functionCalling: false,
              jsonMode: true,
            },
          },
        ],
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.capabilities.functionCalling).toBe(false);
      expect(candidates[0].model.capabilities.jsonMode).toBe(true);
    });

    it('Applies provider.models limits override', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        selectedModel: 'test-model',
        models: [
          {
            modelId: 'test-model',
            limits: {
              contextTokens: 64000,
              outputTokens: 4096,
            },
          },
        ],
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.limits.contextTokens).toBe(64000);
      expect(candidates[0].model.limits.outputTokens).toBe(4096);
    });

    it('DB/global capabilities override model-specific override', () => {
      const provider = createMockProvider({
        providerId: 'custom-provider',
        selectedModel: 'test-model',
        capabilities: {
          functionCalling: false,
        },
        models: [
          {
            modelId: 'test-model',
            capabilities: {
              functionCalling: true,
              jsonMode: true,
            },
          },
        ],
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.capabilities.functionCalling).toBe(false);
      expect(candidates[0].model.capabilities.jsonMode).toBe(true);
    });

    it('DeepSeek default model is deepseek-v4-flash', () => {
      const provider = createMockProvider({
        providerType: 'deepseek',
        apiKey: 'sk-deepseek',
        selectedModel: null,
      });

      const candidates = resolveProviderCandidates({
        dbProviders: [provider],
        envProviders: [],
        nodeEnv: 'development',
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].model.modelId).toBe('deepseek-v4-flash');
    });
  });
});
