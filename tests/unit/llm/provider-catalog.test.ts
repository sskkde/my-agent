import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PROVIDER_CATALOG,
  getProviderCatalogEntry,
  isKnownProviderType,
  listProviderCatalogEntries,
} from '../../../src/llm/catalog/provider-catalog.js'
import {
  DOMESTIC_PROVIDERS,
  getDomesticProvider,
  isDomesticProvider,
  listDomesticProviders,
} from '../../../src/llm/catalog/domestic-providers.js'

describe('ProviderCatalog', () => {
  describe('BUILTIN_PROVIDER_CATALOG', () => {
    it('should have correct entry for openai', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find((e) => e.providerType === 'openai')
      expect(entry).toBeDefined()
      expect(entry?.displayName).toBe('OpenAI')
      expect(entry?.family).toBe('openai')
      expect(entry?.protocol).toBe('openai_chat')
      expect(entry?.requiresApiKey).toBe(true)
      expect(entry?.requiresBaseUrl).toBe(false)
      expect(entry?.defaultBaseUrl).toBeUndefined()
    })

    it('should have correct entry for openrouter', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find((e) => e.providerType === 'openrouter')
      expect(entry).toBeDefined()
      expect(entry?.displayName).toBe('OpenRouter')
      expect(entry?.family).toBe('openai_compatible')
      expect(entry?.protocol).toBe('openai_chat')
      expect(entry?.requiresApiKey).toBe(true)
      expect(entry?.requiresBaseUrl).toBe(false)
    })

    it('should have correct entry for deepseek', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find((e) => e.providerType === 'deepseek')
      expect(entry).toBeDefined()
      expect(entry?.displayName).toBe('DeepSeek')
      expect(entry?.family).toBe('openai_compatible')
      expect(entry?.protocol).toBe('openai_chat')
      expect(entry?.promptFamily).toBe('openai')
      expect(entry?.requiresApiKey).toBe(true)
      expect(entry?.requiresBaseUrl).toBe(false)
      expect(entry?.defaultBaseUrl).toBe('https://api.deepseek.com/v1')
      expect(entry?.defaultModel).toBe('deepseek-v4-flash')
    })

    it('should have correct entry for ollama', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find((e) => e.providerType === 'ollama')
      expect(entry).toBeDefined()
      expect(entry?.displayName).toBe('Ollama')
      expect(entry?.family).toBe('ollama')
      expect(entry?.protocol).toBe('ollama_chat')
      expect(entry?.requiresApiKey).toBe(false)
      expect(entry?.requiresBaseUrl).toBe(true)
      expect(entry?.defaultBaseUrl).toBe('http://localhost:11434')
    })

    it('should have correct entry for custom', () => {
      const entry = BUILTIN_PROVIDER_CATALOG.find((e) => e.providerType === 'custom')
      expect(entry).toBeDefined()
      expect(entry?.displayName).toBe('Custom')
      expect(entry?.family).toBe('openai_compatible')
      expect(entry?.protocol).toBe('openai_chat')
      expect(entry?.requiresApiKey).toBe(true)
      expect(entry?.requiresBaseUrl).toBe(true)
    })

    it('should have displayName for all built-in providers', () => {
      for (const entry of BUILTIN_PROVIDER_CATALOG) {
        expect(entry.displayName).toBeDefined()
        expect(entry.displayName.length).toBeGreaterThan(0)
      }
    })

    it('should have all 13 domestic providers in catalog', () => {
      for (const domestic of DOMESTIC_PROVIDERS) {
        const entry = BUILTIN_PROVIDER_CATALOG.find(
          (e) => e.providerType === domestic.providerType,
        )
        expect(entry).toBeDefined()
        expect(entry?.displayName).toBe(domestic.displayName)
        expect(entry?.family).toBe('openai_compatible')
        expect(entry?.protocol).toBe('openai_chat')
        expect(entry?.promptFamily).toBe('openai')
        expect(entry?.defaultBaseUrl).toBe(domestic.defaultBaseUrl)
        expect(entry?.defaultModel).toBe(domestic.defaultModel)
        expect(entry?.requiresApiKey).toBe(true)
        expect(entry?.requiresBaseUrl).toBe(false)
      }
    })
  })

  describe('getProviderCatalogEntry', () => {
    it('should return entry for known provider types', () => {
      const openaiEntry = getProviderCatalogEntry('openai')
      expect(openaiEntry).not.toBeNull()
      expect(openaiEntry?.providerType).toBe('openai')

      const ollamaEntry = getProviderCatalogEntry('ollama')
      expect(ollamaEntry).not.toBeNull()
      expect(ollamaEntry?.providerType).toBe('ollama')
    })

    it('should return null for unknown provider types', () => {
      const entry = getProviderCatalogEntry('unknown-provider')
      expect(entry).toBeNull()
    })

    it('should return null for empty string', () => {
      const entry = getProviderCatalogEntry('')
      expect(entry).toBeNull()
    })
  })

  describe('isKnownProviderType', () => {
    it('should return true for known provider types', () => {
      expect(isKnownProviderType('openai')).toBe(true)
      expect(isKnownProviderType('openrouter')).toBe(true)
      expect(isKnownProviderType('deepseek')).toBe(true)
      expect(isKnownProviderType('ollama')).toBe(true)
      expect(isKnownProviderType('custom')).toBe(true)
      for (const domestic of DOMESTIC_PROVIDERS) {
        expect(isKnownProviderType(domestic.providerType)).toBe(true)
      }
    })

    it('should return false for unknown provider types', () => {
      expect(isKnownProviderType('unknown')).toBe(false)
      expect(isKnownProviderType('anthropic')).toBe(false)
      expect(isKnownProviderType('')).toBe(false)
    })
  })

  describe('domestic provider definitions', () => {
    it('should have exactly 13 domestic providers', () => {
      expect(DOMESTIC_PROVIDERS.length).toBe(13)
    })

    it.each(DOMESTIC_PROVIDERS.map((p) => [p.providerType, p]))(
      'should have required fields populated for %s',
      (_type, provider) => {
        expect(provider.displayName).toBeTruthy()
        expect(provider.officialDocs).toMatch(/^https?:\/\//)
        expect(provider.defaultBaseUrl).toMatch(/^https?:\/\//)
        expect(provider.defaultModel).toBeTruthy()
        expect(provider.envApiKey).toBeTruthy()
        expect(provider.features).toBeDefined()
        expect(typeof provider.features.supportsStreaming).toBe('boolean')
        expect(typeof provider.features.supportsFunctionCalling).toBe('boolean')
        expect(typeof provider.features.supportsJsonMode).toBe('boolean')
      },
    )

    it.each(DOMESTIC_PROVIDERS.map((p) => [p.providerType, p.envApiKey]))(
      'should have envApiKey ending with _API_KEY for %s',
      (_type, envApiKey) => {
        expect(envApiKey).toMatch(/_API_KEY$/)
      },
    )

    it('should have unique providerType identifiers', () => {
      const types = DOMESTIC_PROVIDERS.map((p) => p.providerType)
      expect(new Set(types).size).toBe(types.length)
    })

    it('should have unique envApiKey names', () => {
      const keys = DOMESTIC_PROVIDERS.map((p) => p.envApiKey)
      expect(new Set(keys).size).toBe(keys.length)
    })
  })

  describe('domestic provider lookup helpers', () => {
    it('getDomesticProvider returns definition for known type', () => {
      const def = getDomesticProvider('dashscope')
      expect(def).toBeDefined()
      expect(def?.displayName).toBe('DashScope')
    })

    it('getDomesticProvider returns undefined for unknown type', () => {
      expect(getDomesticProvider('nonexistent')).toBeUndefined()
    })

    it('isDomesticProvider returns true for all domestic types', () => {
      for (const p of DOMESTIC_PROVIDERS) {
        expect(isDomesticProvider(p.providerType)).toBe(true)
      }
    })

    it('isDomesticProvider returns false for non-domestic types', () => {
      expect(isDomesticProvider('openai')).toBe(false)
      expect(isDomesticProvider('openrouter')).toBe(false)
      expect(isDomesticProvider('ollama')).toBe(false)
      expect(isDomesticProvider('custom')).toBe(false)
      expect(isDomesticProvider('')).toBe(false)
    })

    it('listDomesticProviders returns all 13 providers', () => {
      const list = listDomesticProviders()
      expect(list.length).toBe(13)
    })

    it('listDomesticProviders returns a copy (no mutation)', () => {
      const list1 = listDomesticProviders()
      const list2 = listDomesticProviders()
      expect(list1).not.toBe(list2)
      expect(list1).toEqual(list2)
    })
  })

  describe('listProviderCatalogEntries', () => {
    it('should return 17 entries (4 non-domestic + 13 domestic)', () => {
      const entries = listProviderCatalogEntries()
      expect(entries.length).toBe(17)
    })

    it('should return a copy of the catalog', () => {
      const entries1 = listProviderCatalogEntries()
      const entries2 = listProviderCatalogEntries()
      expect(entries1).not.toBe(entries2)
      expect(entries1).toEqual(entries2)
    })

    it('should include all expected provider types', () => {
      const entries = listProviderCatalogEntries()
      const providerTypes = entries.map((e) => e.providerType)
      expect(providerTypes).toContain('openai')
      expect(providerTypes).toContain('openrouter')
      expect(providerTypes).toContain('deepseek')
      expect(providerTypes).toContain('ollama')
      expect(providerTypes).toContain('custom')
      for (const domestic of DOMESTIC_PROVIDERS) {
        expect(providerTypes).toContain(domestic.providerType)
      }
    })
  })
})
