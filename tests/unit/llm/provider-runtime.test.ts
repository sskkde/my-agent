import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createProviderConfigStore, type ProviderConfigStore } from '../../../src/storage/provider-config-store.js';
import { createProviderScopedLLMAdapter } from '../../../src/llm/provider-runtime.js';

const CREATE_TABLE_SQL = `
  CREATE TABLE provider_configs (
    provider_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','deepseek','custom')),
    display_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    base_url TEXT,
    selected_model TEXT,
    encrypted_api_key TEXT,
    api_key_last4 TEXT,
    source TEXT NOT NULL DEFAULT 'database',
    last_test_status TEXT,
    last_tested_at TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

describe('provider-runtime', () => {
  let connection: ConnectionManager;
  let providerConfigStore: ProviderConfigStore;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      APP_SECRET_KEY: 'test-secret-key-for-provider-runtime',
    };
    connection = createConnectionManager(':memory:');
    connection.open();
    connection.exec(CREATE_TABLE_SQL);
    connection.exec('CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)');
    providerConfigStore = createProviderConfigStore(connection);
  });

  afterEach(() => {
    connection.close();
    process.env = originalEnv;
  });

  it('loads configured database providers for the processing user', async () => {
    providerConfigStore.create({
      providerId: 'provider-user-1',
      userId: 'user-1',
      providerType: 'openrouter',
      displayName: 'User 1 OpenRouter',
      apiKey: 'sk-user-1',
      selectedModel: 'openrouter/model-1',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      expect(adapter.providers).toHaveLength(1);
      expect(adapter.providers[0].id).toBe('provider-user-1');
      expect(adapter.providers[0].config.capabilities.supportedModels).toEqual(['openrouter/model-1']);
    });
  });

  it('isolates provider scopes across users and restores the outer scope', async () => {
    providerConfigStore.create({
      providerId: 'provider-user-1',
      userId: 'user-1',
      providerType: 'openai',
      displayName: 'User 1 OpenAI',
      apiKey: 'sk-user-1',
    });
    providerConfigStore.create({
      providerId: 'provider-user-2',
      userId: 'user-2',
      providerType: 'ollama',
      displayName: 'User 2 Ollama',
      baseUrl: 'http://localhost:11434',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      expect(adapter.providers.map((provider) => provider.id)).toEqual(['provider-user-1']);

      await adapter.runWithUserProviders('user-2', async () => {
        expect(adapter.providers.map((provider) => provider.id)).toEqual(['provider-user-2']);
      });

      expect(adapter.providers.map((provider) => provider.id)).toEqual(['provider-user-1']);
    });
  });

  it('does not leak one user provider into another user with no providers', async () => {
    providerConfigStore.create({
      providerId: 'provider-user-1',
      userId: 'user-1',
      providerType: 'openai',
      displayName: 'User 1 OpenAI',
      apiKey: 'sk-user-1',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      expect(adapter.providers).toHaveLength(1);
    });

    await adapter.runWithUserProviders('user-2', async () => {
      expect(adapter.providers).toHaveLength(0);
    });
  });

  it('prioritizes user database providers over environment providers', async () => {
    process.env.NODE_ENV = 'development';
    process.env.OPENAI_API_KEY = 'sk-env-key';

    providerConfigStore.create({
      providerId: 'user-openai',
      userId: 'user-1',
      providerType: 'openai',
      displayName: 'User OpenAI',
      apiKey: 'sk-user-key',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      const providers = adapter.providers;
      expect(providers.length).toBeGreaterThan(0);
      
      const userProvider = providers.find(p => p.id === 'user-openai');
      const envProvider = providers.find(p => p.id === 'openai');
      
      expect(userProvider).toBeDefined();
      expect(envProvider).toBeDefined();
      expect(userProvider!.config.priority).toBeLessThan(envProvider!.config.priority);
    });

    delete process.env.OPENAI_API_KEY;
  });

  it('gives highest priority to preferred provider', async () => {
    providerConfigStore.create({
      providerId: 'provider-1',
      userId: 'user-1',
      providerType: 'openai',
      displayName: 'Provider 1',
      apiKey: 'sk-1',
    });

    providerConfigStore.create({
      providerId: 'provider-2',
      userId: 'user-1',
      providerType: 'openrouter',
      displayName: 'Provider 2',
      apiKey: 'sk-2',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });
    let preferredProviderId = '';

    await adapter.runWithUserProviders('user-1', async () => {
      const providers = adapter.getHealthyProviders();
      expect(providers.length).toBe(2);
      expect(providers.map((provider) => provider.id).sort()).toEqual(['provider-1', 'provider-2']);
      expect(providers[0].config.priority).toBe(10);
      expect(providers[1].config.priority).toBe(20);
      preferredProviderId = providers[1].id;
    });

    await adapter.runWithUserProviders('user-1', async () => {
      const providers = adapter.getHealthyProviders();
      expect(providers[0].id).toBe(preferredProviderId);
      expect(providers[0].config.priority).toBe(1);
      expect(providers[1].config.priority).toBe(10);
    }, preferredProviderId);
  });

  it('assigns supportsJsonMode true for openai and openrouter providers', async () => {
    providerConfigStore.create({
      providerId: 'openai-provider',
      userId: 'user-1',
      providerType: 'openai',
      displayName: 'User OpenAI',
      apiKey: 'sk-user-1',
    });

    providerConfigStore.create({
      providerId: 'openrouter-provider',
      userId: 'user-1',
      providerType: 'openrouter',
      displayName: 'User OpenRouter',
      apiKey: 'sk-user-2',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      const providers = adapter.providers;
      expect(providers.length).toBe(2);

      const openaiProvider = providers.find(p => p.id === 'openai-provider');
      const openrouterProvider = providers.find(p => p.id === 'openrouter-provider');

      expect(openaiProvider?.config.capabilities.supportsJsonMode).toBe(true);
      expect(openrouterProvider?.config.capabilities.supportsJsonMode).toBe(true);
    });
  });

  it('creates DeepSeek providers with OpenAI-compatible defaults', async () => {
    providerConfigStore.create({
      providerId: 'deepseek-provider',
      userId: 'user-1',
      providerType: 'deepseek',
      displayName: 'User DeepSeek',
      apiKey: 'sk-deepseek',
      selectedModel: 'deepseek-v4-flash',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      const provider = adapter.providers.find(p => p.id === 'deepseek-provider');

      expect(provider).toBeDefined();
      expect(provider?.config.baseUrl).toBe('https://api.deepseek.com');
      expect(provider?.config.capabilities.supportsFunctionCalling).toBe(true);
      expect(provider?.config.capabilities.supportsJsonMode).toBe(true);
      expect(provider?.config.capabilities.supportedModels).toEqual(['deepseek-v4-flash']);
    });
  });

  it('creates DeepSeek env providers with a DeepSeek default model', async () => {
    process.env.NODE_ENV = 'development';
    process.env.DEEPSEEK_API_KEY = 'sk-env-deepseek';

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-without-db-providers', async () => {
      const provider = adapter.providers.find(p => p.id === 'deepseek');

      expect(provider).toBeDefined();
      expect(provider?.config.baseUrl).toBe('https://api.deepseek.com');
      expect(provider?.config.capabilities.supportedModels).toEqual(['deepseek-v4-flash']);
    });

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('assigns supportsJsonMode false for custom and ollama providers', async () => {
    providerConfigStore.create({
      providerId: 'custom-provider',
      userId: 'user-1',
      providerType: 'custom',
      displayName: 'Custom Provider',
      apiKey: 'sk-custom',
      baseUrl: 'https://api.siliconflow.cn/v1',
    });

    providerConfigStore.create({
      providerId: 'ollama-provider',
      userId: 'user-1',
      providerType: 'ollama',
      displayName: 'Ollama',
      baseUrl: 'http://localhost:11434',
    });

    const adapter = createProviderScopedLLMAdapter({ providerConfigStore });

    await adapter.runWithUserProviders('user-1', async () => {
      const providers = adapter.providers;
      expect(providers.length).toBe(2);

      const customProvider = providers.find(p => p.id === 'custom-provider');
      const ollamaProvider = providers.find(p => p.id === 'ollama-provider');

      expect(customProvider?.config.capabilities.supportsJsonMode).toBe(false);
      expect(ollamaProvider?.config.capabilities.supportsJsonMode).toBe(false);
    });
  });
});
