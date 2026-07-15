import { describe, it, expect } from 'vitest'
import { resolveSearchLlm } from '../../../src/api/context.js'
import type { AgentConfig, AgentConfigStore } from '../../../src/storage/agent-config-store.js'
import type {
  ProviderConfigSanitized,
  ProviderConfigStore,
  ProviderType,
} from '../../../src/storage/provider-config-store.js'

/**
 * Fakes that match the real store interfaces (only the slices resolveSearchLlm reads).
 */

function createProviderSanitized(
  overrides: Partial<ProviderConfigSanitized>,
): ProviderConfigSanitized {
  return {
    providerId: 'provider-1',
    userId: 'default-user',
    providerType: 'openrouter' as ProviderType,
    displayName: 'Provider',
    enabled: true,
    baseUrl: null,
    selectedModel: 'model-1',
    source: 'user',
    lastTestStatus: null,
    lastTestedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    configured: true,
    apiKeyLast4: null,
    headersConfigured: false,
    ...overrides,
  }
}

function createProviderConfigStore(
  providers: ProviderConfigSanitized[],
): Pick<ProviderConfigStore, 'getById' | 'listAll'> {
  return {
    getById: (providerId: string) =>
      providers.find((p) => p.providerId === providerId) ?? null,
    listAll: () => providers,
  }
}

function createAgentConfigStore(
  config: AgentConfig | null,
): Pick<AgentConfigStore, 'getGlobalDefault'> {
  return {
    getGlobalDefault: () => config,
  }
}

function createAgentConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return {
    agentConfigId: 'config-1',
    agentId: 'foreground.default',
    scope: 'global',
    userId: null,
    displayName: 'Default Agent',
    enabled: true,
    systemPrompt: null,
    routingPrompt: null,
    providerId: null,
    model: null,
    allowedToolIds: null,
    allowedSkillIds: null,
    routingTimeoutMs: 60000,
    repairAttempts: 1,
    promptType: null,
    promptVersion: null,
    searchLlmProviderId: null,
    searchLlmModel: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('resolveSearchLlm (createApiContext eligibility)', () => {
  describe('order 1: explicit searchLlmProviderId + searchLlmModel', () => {
    it('returns explicit search provider when eligible', () => {
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        searchLlmProviderId: 'deepseek-1',
        searchLlmModel: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toEqual({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        providerType: 'deepseek',
      })
    })

    it('falls through when explicit search provider is mock', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-1',
        providerType: 'mock',
        selectedModel: 'mock-model',
        enabled: true,
        configured: true,
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        searchLlmProviderId: 'mock-1',
        searchLlmModel: 'mock-model',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      // Should NOT return mock; should fall through to foreground deepseek
      expect(result).not.toBeUndefined()
      expect(result?.providerType).not.toBe('mock')
      expect(result?.providerId).toBe('deepseek-1')
    })

    it('falls through when explicit search provider is disabled', () => {
      const disabled = createProviderSanitized({
        providerId: 'disabled-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: false,
        configured: true,
      })
      const usable = createProviderSanitized({
        providerId: 'usable-1',
        providerType: 'openrouter',
        selectedModel: 'gpt-4.1-mini',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        searchLlmProviderId: 'disabled-1',
        searchLlmModel: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([disabled, usable]),
      }

      const result = resolveSearchLlm(stores)

      // Falls through to listAll first eligible (no foreground config)
      expect(result?.providerId).toBe('usable-1')
    })

    it('falls through when explicit search provider is unconfigured', () => {
      const unconfigured = createProviderSanitized({
        providerId: 'unconfigured-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: false,
      })
      const usable = createProviderSanitized({
        providerId: 'usable-1',
        providerType: 'openrouter',
        selectedModel: 'gpt-4.1-mini',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        searchLlmProviderId: 'unconfigured-1',
        searchLlmModel: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([unconfigured, usable]),
      }

      const result = resolveSearchLlm(stores)

      expect(result?.providerId).toBe('usable-1')
    })
  })

  describe('order 2: foreground providerId + model (non-ollama, eligible)', () => {
    it('falls back to foreground when search provider is mock', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-1',
        providerType: 'mock',
        selectedModel: 'mock-model',
        enabled: true,
        configured: true,
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        searchLlmProviderId: 'mock-1',
        searchLlmModel: 'mock-model',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toEqual({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        providerType: 'deepseek',
      })
    })

    it('uses foreground when no search provider is configured', () => {
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        searchLlmProviderId: null,
        searchLlmModel: null,
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toEqual({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        providerType: 'deepseek',
      })
    })

    it('skips foreground when it is ollama', () => {
      const ollama = createProviderSanitized({
        providerId: 'ollama-1',
        providerType: 'ollama',
        selectedModel: 'llama2',
        enabled: true,
        configured: true,
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'ollama-1',
        model: 'llama2',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([ollama, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      // Ollama foreground is skipped; falls through to listAll
      expect(result?.providerId).toBe('deepseek-1')
    })

    it('skips foreground when it is mock', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-fg',
        providerType: 'mock',
        selectedModel: 'mock-model',
        enabled: true,
        configured: true,
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'mock-fg',
        model: 'mock-model',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result?.providerType).not.toBe('mock')
      expect(result?.providerId).toBe('deepseek-1')
    })

    it('skips foreground when it is disabled', () => {
      const disabled = createProviderSanitized({
        providerId: 'disabled-fg',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: false,
        configured: true,
      })
      const usable = createProviderSanitized({
        providerId: 'usable-1',
        providerType: 'openrouter',
        selectedModel: 'gpt-4.1-mini',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'disabled-fg',
        model: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([disabled, usable]),
      }

      const result = resolveSearchLlm(stores)

      expect(result?.providerId).toBe('usable-1')
    })

    it('skips foreground when it is unconfigured', () => {
      const unconfigured = createProviderSanitized({
        providerId: 'unconfigured-fg',
        providerType: 'deepseek',
        selectedModel: 'deepseek-v4-flash',
        enabled: true,
        configured: false,
      })
      const usable = createProviderSanitized({
        providerId: 'usable-1',
        providerType: 'openrouter',
        selectedModel: 'gpt-4.1-mini',
        enabled: true,
        configured: true,
      })
      const agentConfig = createAgentConfig({
        providerId: 'unconfigured-fg',
        model: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([unconfigured, usable]),
      }

      const result = resolveSearchLlm(stores)

      expect(result?.providerId).toBe('usable-1')
    })
  })

  describe('order 3: first eligible provider from listAll()', () => {
    it('returns first enabled+configured+non-mock+non-ollama provider with selectedModel', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-1',
        providerType: 'mock',
        enabled: true,
        configured: true,
        selectedModel: 'mock-model',
      })
      const ollama = createProviderSanitized({
        providerId: 'ollama-1',
        providerType: 'ollama',
        enabled: true,
        configured: true,
        selectedModel: 'llama2',
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-1',
        providerType: 'deepseek',
        enabled: true,
        configured: true,
        selectedModel: 'deepseek-v4-flash',
      })
      const agentConfig = createAgentConfig({})
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock, ollama, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toEqual({
        providerId: 'deepseek-1',
        model: 'deepseek-v4-flash',
        providerType: 'deepseek',
      })
    })

    it('skips providers without selectedModel in listAll scan', () => {
      const noModel = createProviderSanitized({
        providerId: 'no-model',
        providerType: 'deepseek',
        enabled: true,
        configured: true,
        selectedModel: null,
      })
      const withModel = createProviderSanitized({
        providerId: 'with-model',
        providerType: 'openrouter',
        enabled: true,
        configured: true,
        selectedModel: 'gpt-4.1-mini',
      })
      const agentConfig = createAgentConfig({})
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([noModel, withModel]),
      }

      const result = resolveSearchLlm(stores)

      expect(result?.providerId).toBe('with-model')
    })
  })

  describe('order 4: returns undefined when nothing eligible', () => {
    it('returns undefined when only mock is available', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-1',
        providerType: 'mock',
        enabled: true,
        configured: true,
        selectedModel: 'mock-model',
      })
      const agentConfig = createAgentConfig({})
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no providers at all', () => {
      const agentConfig = createAgentConfig({})
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toBeUndefined()
    })

    it('returns undefined when all providers are disabled', () => {
      const disabled = createProviderSanitized({
        providerId: 'disabled-1',
        providerType: 'deepseek',
        enabled: false,
        configured: true,
        selectedModel: 'deepseek-v4-flash',
      })
      const agentConfig = createAgentConfig({})
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([disabled]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).toBeUndefined()
    })
  })

  describe('production scenario: search_llm -> mock, user has deepseek', () => {
    it('falls through mock search to real deepseek foreground provider', () => {
      const mock = createProviderSanitized({
        providerId: 'mock-provider',
        providerType: 'mock',
        displayName: 'Mock',
        enabled: true,
        configured: true,
        selectedModel: 'mock-model',
      })
      const deepseek = createProviderSanitized({
        providerId: 'deepseek-production',
        providerType: 'deepseek',
        displayName: 'DeepSeek',
        enabled: true,
        configured: true,
        selectedModel: 'deepseek-v4-flash',
      })
      const agentConfig = createAgentConfig({
        // Production agent_configs has search_llm -> mock
        searchLlmProviderId: 'mock-provider',
        searchLlmModel: 'mock-model',
        // User has deepseek as foreground
        providerId: 'deepseek-production',
        model: 'deepseek-v4-flash',
      })
      const stores = {
        agentConfigStore: createAgentConfigStore(agentConfig),
        providerConfigStore: createProviderConfigStore([mock, deepseek]),
      }

      const result = resolveSearchLlm(stores)

      expect(result).not.toBeUndefined()
      expect(result?.providerType).toBe('deepseek')
      expect(result?.providerId).toBe('deepseek-production')
      expect(result?.model).toBe('deepseek-v4-flash')
    })
  })
})
