import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createProviderConfigStore, type ProviderConfigStore } from '../../../src/storage/provider-config-store.js';
import {
  resolveProviderAndModel,
  type ResolveProviderOptions,
  type ProviderResolutionResult,
  type NoProviderAvailableResult,
} from '../../../src/llm/agent-provider-resolver.js';

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

describe('agent-provider-resolver', () => {
  let connection: ConnectionManager;
  let providerConfigStore: ProviderConfigStore;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      APP_SECRET_KEY: 'test-secret-key-for-agent-provider-resolver',
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



  describe('precedence order', () => {
    it('should use session selected provider/model when available (highest precedence)', () => {
      // Setup user providers - including the session provider
      providerConfigStore.create({
        providerId: 'session-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Session Provider',
        apiKey: 'sk-test',
        enabled: true,
        selectedModel: 'session-model',
      });

      providerConfigStore.create({
        providerId: 'user-provider-1',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'User Provider 1',
        apiKey: 'sk-test-2',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {
          selectedProviderId: 'session-provider',
          selectedModel: 'session-model',
        },
        agentConfig: {
          providerId: 'agent-provider',
          model: 'agent-model',
        },
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('session-provider');
      expect(successResult.selectedModel).toBe('session-model');
      expect(successResult.candidates[0].providerId).toBe('session-provider');
    });

    it('should fall back to agent config when session has no selection', () => {
      // Create the agent config provider in DB
      providerConfigStore.create({
        providerId: 'agent-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Agent Provider',
        apiKey: 'sk-test',
        enabled: true,
        selectedModel: 'agent-model',
      });

      providerConfigStore.create({
        providerId: 'user-provider-1',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'User Provider 1',
        apiKey: 'sk-test-2',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {
          selectedProviderId: undefined,
          selectedModel: undefined,
        },
        agentConfig: {
          providerId: 'agent-provider',
          model: 'agent-model',
        },
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('agent-provider');
      expect(successResult.selectedModel).toBe('agent-model');
    });

    it('should fall back to user provider default when session and agent config are empty', () => {
      providerConfigStore.create({
        providerId: 'user-provider-1',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'User Provider 1',
        apiKey: 'sk-test',
        enabled: true,
        selectedModel: 'user-model-1',
      });

      const options: ResolveProviderOptions = {
        session: {
          selectedProviderId: undefined,
          selectedModel: undefined,
        },
        agentConfig: {
          providerId: undefined,
          model: undefined,
        },
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('user-provider-1');
      expect(successResult.selectedModel).toBe('user-model-1');
    });

    it('should use first enabled/configured provider as user default (ordered by created_at DESC)', async () => {
      // Create providers in reverse order to verify ordering
      providerConfigStore.create({
        providerId: 'user-provider-2',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'User Provider 2',
        apiKey: 'sk-test-2',
        enabled: true,
        selectedModel: 'model-2',
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      providerConfigStore.create({
        providerId: 'user-provider-1',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'User Provider 1',
        apiKey: 'sk-test-1',
        enabled: true,
        selectedModel: 'model-1',
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      // Should use user-provider-1 (newer, first in DESC order)
      expect(successResult.selectedProviderId).toBe('user-provider-1');
      expect(successResult.selectedModel).toBe('model-1');
    });
  });

  describe('fallback behavior', () => {
    it('should skip disabled providers in fallback chain', () => {
      providerConfigStore.create({
        providerId: 'disabled-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Disabled Provider',
        apiKey: 'sk-test',
        enabled: false,
        selectedModel: 'disabled-model',
      });

      providerConfigStore.create({
        providerId: 'enabled-provider',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'Enabled Provider',
        apiKey: 'sk-test-2',
        enabled: true,
        selectedModel: 'enabled-model',
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('enabled-provider');
      expect(successResult.candidates.map(c => c.providerId)).not.toContain('disabled-provider');
    });

    it('should skip unconfigured providers (no api key for non-ollama)', () => {
      providerConfigStore.create({
        providerId: 'unconfigured-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Unconfigured Provider',
        enabled: true,
        // No API key
      });

      providerConfigStore.create({
        providerId: 'configured-provider',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'Configured Provider',
        apiKey: 'sk-test',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('configured-provider');
      expect(successResult.candidates.map(c => c.providerId)).not.toContain('unconfigured-provider');
    });

    it('should include fallback metadata when fallback occurs', () => {
      providerConfigStore.create({
        providerId: 'primary-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Primary Provider',
        enabled: false, // Disabled, will trigger fallback
      });

      providerConfigStore.create({
        providerId: 'fallback-provider',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'Fallback Provider',
        apiKey: 'sk-test',
        enabled: true,
        selectedModel: 'fallback-model',
      });

      const options: ResolveProviderOptions = {
        session: { selectedProviderId: 'primary-provider' },
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.fallbackMetadata).toBeDefined();
      expect(successResult.fallbackMetadata?.originalProviderId).toBe('primary-provider');
      expect(successResult.fallbackMetadata?.fallbackReason).toBe('provider_disabled');
      expect(successResult.fallbackMetadata?.actualProviderId).toBe('fallback-provider');
    });

    it('should not expose secrets in fallback metadata', () => {
      providerConfigStore.create({
        providerId: 'fallback-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Fallback Provider',
        apiKey: 'sk-secret-key-1234',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: { selectedProviderId: 'nonexistent-provider' },
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.fallbackMetadata).toBeDefined();
      // Ensure no API key in metadata
      const metadataStr = JSON.stringify(successResult.fallbackMetadata);
      expect(metadataStr).not.toContain('sk-secret-key');
      expect(metadataStr).not.toContain('1234');
    });
  });

  describe('no-provider result', () => {
    it('should return typed no-provider result when no providers available', () => {
      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-with-no-providers',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('no-provider');
      const noProviderResult = result as NoProviderAvailableResult;
      expect(noProviderResult.reason).toBe('no_configured_providers');
      expect(noProviderResult.candidates).toHaveLength(0);
    });

    it('should return no-provider when all user providers are disabled', () => {
      providerConfigStore.create({
        providerId: 'disabled-1',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Disabled 1',
        apiKey: 'sk-test',
        enabled: false,
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('no-provider');
    });

    it('should return no-provider when session provider does not exist and no fallbacks', () => {
      const options: ResolveProviderOptions = {
        session: { selectedProviderId: 'nonexistent-provider' },
        agentConfig: {},
        userId: 'user-with-no-providers',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('no-provider');
      const noProviderResult = result as NoProviderAvailableResult;
      expect(noProviderResult.reason).toBe('requested_provider_unavailable');
      expect(noProviderResult.requestedProviderId).toBe('nonexistent-provider');
    });
  });

  describe('candidate ordering', () => {
    it('should return ordered provider candidates based on precedence', async () => {
      providerConfigStore.create({
        providerId: 'user-provider-1',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'User Provider 1',
        apiKey: 'sk-test',
        enabled: true,
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      providerConfigStore.create({
        providerId: 'user-provider-2',
        userId: 'user-1',
        providerType: 'openrouter',
        displayName: 'User Provider 2',
        apiKey: 'sk-test-2',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: { selectedProviderId: 'session-provider' },
        agentConfig: { providerId: 'agent-provider' },
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      // Session provider should be first (even if not in DB)
      expect(successResult.candidates[0].providerId).toBe('session-provider');
      // Then agent config provider
      expect(successResult.candidates[1].providerId).toBe('agent-provider');
      // Then user providers in order (user-provider-2 is newer, comes first)
      expect(successResult.candidates[2].providerId).toBe('user-provider-2');
      expect(successResult.candidates[3].providerId).toBe('user-provider-1');
    });

    it('should include env providers in candidates when available', () => {
      // Temporarily set env vars
      const envBackup = { ...process.env };
      process.env.OPENROUTER_API_KEY = 'test-key';

      providerConfigStore.create({
        providerId: 'user-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'User Provider',
        apiKey: 'sk-test',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
        includeEnvProviders: true,
      };

      const result = resolveProviderAndModel(options);

      // Restore env
      process.env = envBackup;

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      const candidateIds = successResult.candidates.map(c => c.providerId);
      expect(candidateIds).toContain('openrouter');
    });

    it('should include DeepSeek env provider with a DeepSeek default model', () => {
      const envBackup = { ...process.env };
      process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
        includeEnvProviders: true,
      };

      const result = resolveProviderAndModel(options);

      process.env = envBackup;

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('deepseek');
      expect(successResult.selectedModel).toBe('deepseek-v4-flash');
    });
  });

  describe('model selection', () => {
    it('should use session model when session provider is selected', () => {
      // Create the session provider
      providerConfigStore.create({
        providerId: 'session-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Session Provider',
        apiKey: 'sk-test',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {
          selectedProviderId: 'session-provider',
          selectedModel: 'session-specific-model',
        },
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedModel).toBe('session-specific-model');
    });

    it('should use agent config model when falling back to agent config', () => {
      // Create the agent config provider
      providerConfigStore.create({
        providerId: 'agent-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Agent Provider',
        apiKey: 'sk-test',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {
          providerId: 'agent-provider',
          model: 'agent-specific-model',
        },
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedModel).toBe('agent-specific-model');
    });

    it('should allow model override even when using different provider', () => {
      providerConfigStore.create({
        providerId: 'fallback-provider',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Fallback Provider',
        apiKey: 'sk-test',
        enabled: true,
        selectedModel: 'provider-default-model',
      });

      const options: ResolveProviderOptions = {
        session: {
          selectedProviderId: 'nonexistent-provider',
          selectedModel: 'override-model',
        },
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      // Falls back to available provider but keeps session model
      expect(successResult.selectedProviderId).toBe('fallback-provider');
      expect(successResult.selectedModel).toBe('override-model');
    });

    it('should default DeepSeek database providers to a DeepSeek model when none is configured', () => {
      providerConfigStore.create({
        providerId: 'deepseek-provider',
        userId: 'user-1',
        providerType: 'deepseek',
        displayName: 'DeepSeek Provider',
        apiKey: 'sk-deepseek',
        enabled: true,
      });

      const options: ResolveProviderOptions = {
        session: {},
        agentConfig: {},
        userId: 'user-1',
        providerConfigStore,
      };

      const result = resolveProviderAndModel(options);

      expect(result.type).toBe('success');
      const successResult = result as ProviderResolutionResult;
      expect(successResult.selectedProviderId).toBe('deepseek-provider');
      expect(successResult.selectedModel).toBe('deepseek-v4-flash');
    });
  });
});
