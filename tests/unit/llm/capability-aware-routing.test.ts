import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createProviderConfigStore, type ProviderConfigStore } from '../../../src/storage/provider-config-store.js'
import { createProviderScopedLLMAdapter } from '../../../src/llm/provider-runtime.js'
import type { LLMRequest } from '../../../src/llm/types.js'

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
    family TEXT,
    protocol TEXT,
    priority INTEGER,
    headers_json TEXT,
    capabilities_json TEXT,
    models_json TEXT,
    default_model TEXT,
    options_json TEXT
  )
`

describe('capability-aware routing', () => {
  let connection: ConnectionManager
  let providerConfigStore: ProviderConfigStore
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      APP_SECRET_KEY: 'test-secret-key-for-capability-routing',
    }
    connection = createConnectionManager(':memory:')
    connection.open()
    connection.exec(CREATE_TABLE_SQL)
    connection.exec('CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)')
    providerConfigStore = createProviderConfigStore(connection)
  })

  afterEach(() => {
    connection.close()
    process.env = originalEnv
  })

  describe('tools request filters non-capable provider', () => {
    it('routes to function-calling provider when request has tools', async () => {
      providerConfigStore.create({
        providerId: 'ollama',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'No Function Calling',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'basic-model',
      })

      providerConfigStore.create({
        providerId: 'openai',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Has Function Calling',
        apiKey: 'sk-fc',
        selectedModel: 'gpt-4o-mini',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get weather',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        }

        const result = await adapter.complete(request)

        expect(result.success).toBe(false)
        if (!result.success) {
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('openai')
          expect(attemptedIds).not.toContain('ollama')
        }
      })
    })

    it('filters ollama provider but keeps openai for tools request', async () => {
      providerConfigStore.create({
        providerId: 'ollama',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'Ollama Basic',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama2',
      })

      providerConfigStore.create({
        providerId: 'openai',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'OpenAI',
        apiKey: 'sk-test',
        selectedModel: 'gpt-4o-mini',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Use the tool' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'search',
                description: 'Search the web',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('openai')
          expect(attemptedIds).not.toContain('ollama')
        }
      })
    })
  })

  describe('JSON request filters non-capable provider', () => {
    it('routes to json-mode provider when request requires json_object', async () => {
      providerConfigStore.create({
        providerId: 'ollama',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'No JSON Mode',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama2',
      })

      providerConfigStore.create({
        providerId: 'openai',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Has JSON Mode',
        apiKey: 'sk-json',
        selectedModel: 'gpt-4o-mini',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Return JSON' }],
          responseFormat: { type: 'json_object' },
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('openai')
          expect(attemptedIds).not.toContain('ollama')
        }
      })
    })

    it('filters custom provider but keeps deepseek for json request', async () => {
      providerConfigStore.create({
        providerId: 'custom-no-json',
        userId: 'user-1',
        providerType: 'custom',
        displayName: 'Custom No JSON',
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.api.com/v1',
        selectedModel: 'custom-model',
      })

      providerConfigStore.create({
        providerId: 'deepseek',
        userId: 'user-1',
        providerType: 'deepseek',
        displayName: 'DeepSeek',
        apiKey: 'sk-ds',
        selectedModel: 'deepseek-chat',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Return JSON' }],
          responseFormat: { type: 'json_object' },
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('deepseek')
          expect(attemptedIds).not.toContain('custom-no-json')
        }
      })
    })
  })

  describe('all providers filtered returns ALL_PROVIDERS_FAILED', () => {
    it('returns ALL_PROVIDERS_FAILED when no provider supports required capability', async () => {
      providerConfigStore.create({
        providerId: 'ollama-no-fc-1',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'Ollama 1',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'basic-model-1',
      })

      providerConfigStore.create({
        providerId: 'ollama-no-fc-2',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'Ollama 2',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'basic-model-2',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Use tools' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'do_thing',
                description: 'Do a thing',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
          expect(result.error.message).toContain('capability')
          expect(result.providerId).toBe('none')
        }
      })
    })

    it('returns ALL_PROVIDERS_FAILED when all providers lack json mode', async () => {
      providerConfigStore.create({
        providerId: 'ollama-no-json',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'Ollama',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama2',
      })

      providerConfigStore.create({
        providerId: 'custom-no-json',
        userId: 'user-1',
        providerType: 'custom',
        displayName: 'Custom',
        apiKey: 'sk-custom',
        baseUrl: 'https://custom.api.com/v1',
        selectedModel: 'custom-model',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Return JSON' }],
          responseFormat: { type: 'json_object' },
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
          expect(result.providerId).toBe('none')
        }
      })
    })
  })

  describe('no capability requirements - all providers eligible', () => {
    it('attempts all providers when request has no special requirements', async () => {
      providerConfigStore.create({
        providerId: 'openai',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'Provider A',
        apiKey: 'sk-a',
        selectedModel: 'gpt-4o-mini',
      })

      providerConfigStore.create({
        providerId: 'ollama',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'Provider B',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama2',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders('user-1', async () => {
        const request: LLMRequest = {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }

        const result = await adapter.complete(request)
        expect(result.success).toBe(false)

        if (!result.success) {
          expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('openai')
          expect(attemptedIds).toContain('ollama')
        }
      })
    })
  })

  describe('user scope isolation preserved', () => {
    it('capability filtering respects user scope boundaries', async () => {
      providerConfigStore.create({
        providerId: 'ollama',
        userId: 'user-1',
        providerType: 'ollama',
        displayName: 'User1 Ollama',
        baseUrl: 'http://localhost:11434',
        selectedModel: 'llama2',
      })

      providerConfigStore.create({
        providerId: 'openai',
        userId: 'user-2',
        providerType: 'openai',
        displayName: 'User2 OpenAI',
        apiKey: 'sk-user2',
        selectedModel: 'gpt-4o-mini',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      const toolsRequest: LLMRequest = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Use tools' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'test_fn',
              description: 'Test function',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }

      await adapter.runWithUserProviders('user-1', async () => {
        const result = await adapter.complete(toolsRequest)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
        }
      })

      await adapter.runWithUserProviders('user-2', async () => {
        const result = await adapter.complete(toolsRequest)
        expect(result.success).toBe(false)
        if (!result.success) {
          const attemptedIds = result.error.attempts?.map((a) => a.providerId) ?? []
          expect(attemptedIds).toContain('openai')
        }
      })
    })
  })

  describe('preferred provider preserved with capability filtering', () => {
    it('preferred provider gets priority in capability-filtered results', async () => {
      providerConfigStore.create({
        providerId: 'openai-1',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'OpenAI 1',
        apiKey: 'sk-1',
        selectedModel: 'gpt-4o-mini',
      })

      providerConfigStore.create({
        providerId: 'openai-2',
        userId: 'user-1',
        providerType: 'openai',
        displayName: 'OpenAI 2',
        apiKey: 'sk-2',
        selectedModel: 'gpt-4o-mini',
      })

      const adapter = createProviderScopedLLMAdapter({ providerConfigStore })

      await adapter.runWithUserProviders(
        'user-1',
        async () => {
          const providers = adapter.getHealthyProviders()
          expect(providers[0].id).toBe('openai-1')
          expect(providers[0].config.priority).toBe(1)
        },
        'openai-1',
      )
    })
  })
})
