import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createProviderConfigStore, type ProviderConfigStore } from '../../../src/storage/provider-config-store.js';
import { createProviderScopedLLMAdapter } from '../../../src/llm/provider-runtime.js';

const CREATE_TABLE_SQL = `
  CREATE TABLE provider_configs (
    provider_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','custom')),
    display_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    base_url TEXT,
    selected_model TEXT,
    encrypted_api_key TEXT,
    api_key_last4 TEXT,
    source TEXT NOT NULL DEFAULT 'database',
    last_test_status TEXT,
    last_tested_at TEXT,
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
});
