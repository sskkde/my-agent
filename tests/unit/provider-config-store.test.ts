import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager } from '../../src/storage/connection.js';
import { createProviderConfigStore } from '../../src/storage/provider-config-store.js';
import type { ConnectionManager } from '../../src/storage/connection.js';
import type { ProviderConfigStore } from '../../src/storage/provider-config-store.js';

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
    updated_at TEXT NOT NULL,
    family TEXT DEFAULT NULL,
    protocol TEXT DEFAULT NULL,
    priority INTEGER DEFAULT NULL,
    headers_json TEXT DEFAULT NULL,
    capabilities_json TEXT DEFAULT NULL,
    models_json TEXT DEFAULT NULL,
    default_model TEXT DEFAULT NULL,
    options_json TEXT DEFAULT NULL
  )
`;

const CREATE_INDEX_SQL = `CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)`;

describe('provider-config-store', () => {
  let connection: ConnectionManager;
  let store: ProviderConfigStore;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, APP_SECRET_KEY: 'test-secret-key-for-encryption' };
    connection = createConnectionManager(':memory:');
    connection.open();
    connection.exec(CREATE_TABLE_SQL);
    connection.exec(CREATE_INDEX_SQL);
    store = createProviderConfigStore(connection);
  });

  afterEach(() => {
    connection.close();
    process.env = originalEnv;
  });

  describe('create', () => {
    it('should create a provider config with API key', () => {
      const result = store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI GPT-4',
        apiKey: 'sk-test-1234'
      });

      expect(result.providerId).toBe('prov-001');
      expect(result.userId).toBe('user-001');
      expect(result.providerType).toBe('openai');
      expect(result.displayName).toBe('OpenAI GPT-4');
      expect(result.enabled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.apiKeyLast4).toBe('1234');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a provider config without API key', () => {
      const result = store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Local Ollama'
      });

      expect(result.providerId).toBe('prov-001');
      expect(result.configured).toBe(false);
      expect(result.apiKeyLast4).toBeNull();
    });

    it('should not treat blank Ollama base URL as configured', () => {
      const result = store.create({
        providerId: 'prov-blank-ollama',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Blank Ollama',
        baseUrl: '   ',
      });

      expect(result.configured).toBe(false);
    });

    it('should treat Ollama base URL as configured without API key', () => {
      const result = store.create({
        providerId: 'prov-local-ollama',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Local Ollama',
        baseUrl: 'http://localhost:11434',
      });

      expect(result.configured).toBe(true);
      expect(result.apiKeyLast4).toBeNull();
    });

    it('should create with all optional fields', () => {
      const result = store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openrouter',
        displayName: 'OpenRouter',
        enabled: false,
        baseUrl: 'https://api.openrouter.ai',
        selectedModel: 'anthropic/claude-3-opus',
        apiKey: 'sk-or-12345678'
      });

      expect(result.enabled).toBe(false);
      expect(result.baseUrl).toBe('https://api.openrouter.ai');
      expect(result.selectedModel).toBe('anthropic/claude-3-opus');
      expect(result.configured).toBe(true);
      expect(result.apiKeyLast4).toBe('5678');
    });

    it('should create a custom provider config with base URL and API key', () => {
      const result = store.create({
        providerId: 'prov-custom-001',
        userId: 'user-001',
        providerType: 'custom',
        displayName: 'Custom OpenAI Compatible',
        baseUrl: 'https://api.example.com/v1',
        selectedModel: 'custom-model',
        apiKey: 'custom-key-1234'
      });

      expect(result.providerType).toBe('custom');
      expect(result.baseUrl).toBe('https://api.example.com/v1');
      expect(result.selectedModel).toBe('custom-model');
      expect(result.configured).toBe(true);
      expect(result.apiKeyLast4).toBe('1234');
    });

    it('should throw on duplicate providerId', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI 1'
      });

      expect(() => {
        store.create({
          providerId: 'prov-001',
          userId: 'user-002',
          providerType: 'ollama',
          displayName: 'Ollama'
        });
      }).toThrow();
    });

    it('should throw when APP_SECRET_KEY is missing and apiKey provided', () => {
      delete process.env.APP_SECRET_KEY;

      expect(() => {
        store.create({
          providerId: 'prov-001',
          userId: 'user-001',
          providerType: 'openai',
          displayName: 'OpenAI',
          apiKey: 'sk-test-1234'
        });
      }).toThrow('APP_SECRET_KEY environment variable is required');
    });
  });

  describe('getById', () => {
    it('should return sanitized config without encrypted API key', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-test-1234'
      });

      const result = store.getById('prov-001');

      expect(result).not.toBeNull();
      expect(result?.providerId).toBe('prov-001');
      expect(result?.configured).toBe(true);
      expect(result?.apiKeyLast4).toBe('1234');
      expect(result).not.toHaveProperty('apiKey');
      expect(result).not.toHaveProperty('encryptedApiKey');
    });

    it('should return null for non-existent provider', () => {
      const result = store.getById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getByIdWithSecret', () => {
    it('should return config with decrypted API key', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-test-1234'
      });

      const result = store.getByIdWithSecret('prov-001');

      expect(result).not.toBeNull();
      expect(result?.providerId).toBe('prov-001');
      expect(result?.apiKey).toBe('sk-test-1234');
    });

    it('should return null apiKey when no key stored', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Ollama'
      });

      const result = store.getByIdWithSecret('prov-001');

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBeNull();
    });

    it('should return null for non-existent provider', () => {
      const result = store.getByIdWithSecret('non-existent');
      expect(result).toBeNull();
    });

    it('should throw when APP_SECRET_KEY is missing', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-test-1234'
      });

      delete process.env.APP_SECRET_KEY;

      expect(() => {
        store.getByIdWithSecret('prov-001');
      }).toThrow('APP_SECRET_KEY environment variable is required');
    });
  });

  describe('listByUser', () => {
    it('should return empty array when no providers', () => {
      const result = store.listByUser('user-001');
      expect(result).toEqual([]);
    });

    it('should return only providers for specified user', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      store.create({
        providerId: 'prov-002',
        userId: 'user-002',
        providerType: 'ollama',
        displayName: 'Ollama'
      });

      const result = store.listByUser('user-001');

      expect(result).toHaveLength(1);
      expect(result[0].providerId).toBe('prov-001');
      expect(result[0].userId).toBe('user-001');
    });

    it('should return sorted by created_at descending', async () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI 1'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      store.create({
        providerId: 'prov-002',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Ollama'
      });

      const result = store.listByUser('user-001');

      expect(result).toHaveLength(2);
      expect(result[0].providerId).toBe('prov-002');
      expect(result[1].providerId).toBe('prov-001');
    });

    it('should never expose encrypted or raw API keys', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-secret-1234'
      });

      const result = store.listByUser('user-001');

      expect(result[0].configured).toBe(true);
      expect(result[0].apiKeyLast4).toBe('1234');
      expect(result[0]).not.toHaveProperty('apiKey');
      expect(result[0]).not.toHaveProperty('encryptedApiKey');
    });
  });

  describe('update', () => {
    it('should update display name', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'Old Name'
      });

      const result = store.update('prov-001', { displayName: 'New Name' });
      expect(result).toBe(true);

      const updated = store.getById('prov-001');
      expect(updated?.displayName).toBe('New Name');
    });

    it('should update enabled status', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        enabled: true
      });

      store.update('prov-001', { enabled: false });

      const updated = store.getById('prov-001');
      expect(updated?.enabled).toBe(false);
    });

    it('should update base URL and selected model', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      store.update('prov-001', {
        baseUrl: 'https://custom.openai.com',
        selectedModel: 'gpt-4-turbo'
      });

      const updated = store.getById('prov-001');
      expect(updated?.baseUrl).toBe('https://custom.openai.com');
      expect(updated?.selectedModel).toBe('gpt-4-turbo');
    });

    it('should re-encrypt API key when updating', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-old-1234'
      });

      store.update('prov-001', { apiKey: 'sk-new-5678' });

      const updated = store.getById('prov-001');
      expect(updated?.apiKeyLast4).toBe('5678');
      expect(updated?.configured).toBe(true);

      const withSecret = store.getByIdWithSecret('prov-001');
      expect(withSecret?.apiKey).toBe('sk-new-5678');
    });

    it('should preserve old API key when not provided in update', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-original-1234'
      });

      store.update('prov-001', { displayName: 'Updated Name' });

      const withSecret = store.getByIdWithSecret('prov-001');
      expect(withSecret?.apiKey).toBe('sk-original-1234');
    });

    it('should return false when no updates provided', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      const result = store.update('prov-001', {});
      expect(result).toBe(false);
    });

    it('should return true even for non-existent provider (no rows affected)', () => {
      const result = store.update('non-existent', { displayName: 'New' });
      expect(result).toBe(true);
    });

    it('should throw when APP_SECRET_KEY is missing and apiKey provided', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      delete process.env.APP_SECRET_KEY;

      expect(() => {
        store.update('prov-001', { apiKey: 'sk-new-1234' });
      }).toThrow('APP_SECRET_KEY environment variable is required');
    });
  });

  describe('remove', () => {
    it('should remove provider config', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      const result = store.remove('prov-001');
      expect(result).toBe(true);

      const retrieved = store.getById('prov-001');
      expect(retrieved).toBeNull();
    });

    it('should return true even for non-existent provider', () => {
      const result = store.remove('non-existent');
      expect(result).toBe(true);
    });
  });

  describe('updateTestStatus', () => {
    it('should update test status and timestamp', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      const result = store.updateTestStatus('prov-001', 'success');
      expect(result).toBe(true);

      const updated = store.getById('prov-001');
      expect(updated?.lastTestStatus).toBe('success');
      expect(updated?.lastTestedAt).toBeDefined();
    });

    it('should update test status to failed', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      store.updateTestStatus('prov-001', 'failed');

      const updated = store.getById('prov-001');
      expect(updated?.lastTestStatus).toBe('failed');
    });

    it('should return true even for non-existent provider', () => {
      const result = store.updateTestStatus('non-existent', 'success');
      expect(result).toBe(true);
    });
  });

  describe('sanitization', () => {
    it('should never include encrypted_api_key in getById', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-secret-1234'
      });

      const result = store.getById('prov-001') as unknown as Record<string, unknown>;

      expect(result.encryptedApiKey).toBeUndefined();
      expect(result.encrypted_api_key).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });

    it('should never include encrypted_api_key in listByUser', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-secret-1234'
      });

      const result = store.listByUser('user-001')[0] as unknown as Record<string, unknown>;

      expect(result.encryptedApiKey).toBeUndefined();
      expect(result.encrypted_api_key).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
    });

    it('should include apiKey only in getByIdWithSecret', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-secret-1234'
      });

      const sanitized = store.getById('prov-001') as unknown as Record<string, unknown>;
      const withSecret = store.getByIdWithSecret('prov-001') as unknown as Record<string, unknown>;

      expect(sanitized.apiKey).toBeUndefined();
      expect(withSecret.apiKey).toBe('sk-secret-1234');
    });

    it('should expose configured boolean and apiKeyLast4 in sanitized responses', () => {
      store.create({
        providerId: 'prov-001',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-secret-1234'
      });

      const sanitized = store.getById('prov-001');
      const list = store.listByUser('user-001')[0];

      expect(sanitized?.configured).toBe(true);
      expect(sanitized?.apiKeyLast4).toBe('1234');
      expect(list.configured).toBe(true);
      expect(list.apiKeyLast4).toBe('1234');
    });
  });

  describe('all provider types', () => {
    it('should support openai provider type', () => {
      const result = store.create({
        providerId: 'prov-openai',
        userId: 'user-001',
        providerType: 'openai',
        displayName: 'OpenAI'
      });

      expect(result.providerType).toBe('openai');
    });

    it('should support openrouter provider type', () => {
      const result = store.create({
        providerId: 'prov-openrouter',
        userId: 'user-001',
        providerType: 'openrouter',
        displayName: 'OpenRouter'
      });

      expect(result.providerType).toBe('openrouter');
    });

    it('should support ollama provider type', () => {
      const result = store.create({
        providerId: 'prov-ollama',
        userId: 'user-001',
        providerType: 'ollama',
        displayName: 'Ollama'
      });

      expect(result.providerType).toBe('ollama');
    });
  });
});
