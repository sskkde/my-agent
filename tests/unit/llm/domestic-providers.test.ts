import { describe, it, expect } from 'vitest'
import {
  DOMESTIC_PROVIDERS,
  getDomesticProvider,
  listDomesticProviders,
  isDomesticProvider,
} from '../../../src/llm/catalog/domestic-providers.js'

/**
 * Expected domestic provider types — all 13 China-based LLM providers.
 */
const EXPECTED_PROVIDER_TYPES = [
  'dashscope',
  'volcengine',
  'qianfan',
  'zhipu',
  'moonshot',
  'minimax',
  'jdcloud-yanxi',
  'mimo',
  'iflytek-spark',
  'stepfun',
  'hunyuan',
  'deepseek',
  'siliconflow',
] as const

describe('DomesticProviders', () => {
  // ---------------------------------------------------------------------------
  // Catalog integrity
  // ---------------------------------------------------------------------------

  describe('DOMESTIC_PROVIDERS catalog', () => {
    it('should contain exactly 13 providers', () => {
      expect(DOMESTIC_PROVIDERS.length).toBe(13)
    })

    it('should have all expected provider types', () => {
      const types = DOMESTIC_PROVIDERS.map((p) => p.providerType)
      for (const expected of EXPECTED_PROVIDER_TYPES) {
        expect(types).toContain(expected)
      }
    })

    it('should have no duplicate provider types', () => {
      const types = DOMESTIC_PROVIDERS.map((p) => p.providerType)
      const unique = new Set(types)
      expect(unique.size).toBe(types.length)
    })

    it('should have non-empty displayName for every provider', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.displayName.length).toBeGreaterThan(0)
      }
    })

    it('should have valid URL for officialDocs on every provider', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.officialDocs).toMatch(/^https?:\/\//)
      }
    })

    it('should have valid URL for defaultBaseUrl on every provider', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.defaultBaseUrl).toMatch(/^https?:\/\//)
      }
    })

    it('should have non-empty defaultModel for every provider', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.defaultModel.length).toBeGreaterThan(0)
      }
    })

    it('should have non-empty envApiKey for every provider', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.envApiKey.length).toBeGreaterThan(0)
        // Env var names should be UPPER_SNAKE_CASE
        expect(provider.envApiKey).toMatch(/^[A-Z][A-Z0-9_]*$/)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Per-provider spot checks
  // ---------------------------------------------------------------------------

  describe('individual provider definitions', () => {
    it('dashscope: should point to Alibaba Model Studio', () => {
      const p = getDomesticProvider('dashscope')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('DashScope')
      expect(p?.officialDocs).toContain('aliyun.com')
      expect(p?.defaultBaseUrl).toContain('dashscope.aliyuncs.com')
      expect(p?.defaultModel).toBe('qwen-plus')
      expect(p?.envApiKey).toBe('DASHSCOPE_API_KEY')
      expect(p?.envBaseUrl).toBe('DASHSCOPE_BASE_URL')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(true)
    })

    it('volcengine: should point to Volcano Engine', () => {
      const p = getDomesticProvider('volcengine')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('Volcano Engine')
      expect(p?.officialDocs).toContain('volcengine.com')
      expect(p?.defaultBaseUrl).toContain('ark.cn-beijing.volces.com')
      expect(p?.defaultModel).toBe('doubao-pro-32k')
      expect(p?.envApiKey).toBe('VOLCENGINE_API_KEY')
    })

    it('qianfan: should point to Baidu Qianfan', () => {
      const p = getDomesticProvider('qianfan')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('Qianfan')
      expect(p?.officialDocs).toContain('baidu.com')
      expect(p?.defaultModel).toBe('ernie-4.0-8k')
    })

    it('zhipu: should point to Zhipu AI GLM', () => {
      const p = getDomesticProvider('zhipu')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('Zhipu AI')
      expect(p?.officialDocs).toContain('bigmodel.cn')
      expect(p?.defaultModel).toBe('glm-4-plus')
    })

    it('moonshot: should point to Moonshot platform', () => {
      const p = getDomesticProvider('moonshot')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('Moonshot AI')
      expect(p?.officialDocs).toContain('moonshot.cn')
      expect(p?.defaultModel).toBe('moonshot-v1-auto')
    })

    it('minimax: should have streaming but no JSON mode', () => {
      const p = getDomesticProvider('minimax')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('MiniMax')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(false)
    })

    it('jdcloud-yanxi: should have limited feature support', () => {
      const p = getDomesticProvider('jdcloud-yanxi')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('JD Cloud Yanxi')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(false)
      expect(p?.features.supportsJsonMode).toBe(false)
    })

    it('mimo: should support full feature set', () => {
      const p = getDomesticProvider('mimo')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('MiMo')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(true)
    })

    it('iflytek-spark: should have streaming and function calling', () => {
      const p = getDomesticProvider('iflytek-spark')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('iFlyTek Spark')
      expect(p?.officialDocs).toContain('xfyun.cn')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(false)
    })

    it('stepfun: should have streaming and function calling', () => {
      const p = getDomesticProvider('stepfun')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('StepFun')
      expect(p?.officialDocs).toContain('stepfun.com')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(false)
    })

    it('hunyuan: should point to Tencent Hunyuan', () => {
      const p = getDomesticProvider('hunyuan')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('Hunyuan')
      expect(p?.officialDocs).toContain('tencent.com')
      expect(p?.defaultModel).toBe('hunyuan-pro')
    })

    it('deepseek: should point to DeepSeek platform', () => {
      const p = getDomesticProvider('deepseek')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('DeepSeek')
      expect(p?.officialDocs).toContain('deepseek.com')
      expect(p?.defaultModel).toBe('deepseek-v4-flash')
    })

    it('siliconflow: should support full feature set', () => {
      const p = getDomesticProvider('siliconflow')
      expect(p).toBeDefined()
      expect(p?.displayName).toBe('SiliconFlow')
      expect(p?.officialDocs).toContain('siliconflow.cn')
      expect(p?.features.supportsStreaming).toBe(true)
      expect(p?.features.supportsFunctionCalling).toBe(true)
      expect(p?.features.supportsJsonMode).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // getDomesticProvider helper
  // ---------------------------------------------------------------------------

  describe('getDomesticProvider', () => {
    it('should return definition for known domestic provider', () => {
      const provider = getDomesticProvider('dashscope')
      expect(provider).toBeDefined()
      expect(provider?.providerType).toBe('dashscope')
    })

    it('should return undefined for unknown provider type', () => {
      const provider = getDomesticProvider('nonexistent')
      expect(provider).toBeUndefined()
    })

    it('should return undefined for empty string', () => {
      const provider = getDomesticProvider('')
      expect(provider).toBeUndefined()
    })

    it('should return undefined for non-domestic built-in providers', () => {
      expect(getDomesticProvider('openai')).toBeUndefined()
      expect(getDomesticProvider('openrouter')).toBeUndefined()
      expect(getDomesticProvider('ollama')).toBeUndefined()
      expect(getDomesticProvider('custom')).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // listDomesticProviders helper
  // ---------------------------------------------------------------------------

  describe('listDomesticProviders', () => {
    it('should return all 13 providers', () => {
      const providers = listDomesticProviders()
      expect(providers.length).toBe(13)
    })

    it('should return a new array each call (defensive copy)', () => {
      const first = listDomesticProviders()
      const second = listDomesticProviders()
      expect(first).not.toBe(second)
      expect(first).toEqual(second)
    })

    it('should contain all expected provider types', () => {
      const providers = listDomesticProviders()
      const types = providers.map((p) => p.providerType)
      for (const expected of EXPECTED_PROVIDER_TYPES) {
        expect(types).toContain(expected)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // isDomesticProvider helper
  // ---------------------------------------------------------------------------

  describe('isDomesticProvider', () => {
    it('should return true for all 13 domestic providers', () => {
      for (const type of EXPECTED_PROVIDER_TYPES) {
        expect(isDomesticProvider(type)).toBe(true)
      }
    })

    it('should return false for non-domestic providers', () => {
      expect(isDomesticProvider('openai')).toBe(false)
      expect(isDomesticProvider('openrouter')).toBe(false)
      expect(isDomesticProvider('ollama')).toBe(false)
      expect(isDomesticProvider('custom')).toBe(false)
    })

    it('should return false for unknown strings', () => {
      expect(isDomesticProvider('unknown')).toBe(false)
      expect(isDomesticProvider('')).toBe(false)
      expect(isDomesticProvider('DeepSeek')).toBe(false) // case-sensitive
    })
  })

  // ---------------------------------------------------------------------------
  // Feature flags consistency
  // ---------------------------------------------------------------------------

  describe('feature flags', () => {
    it('should have all providers support streaming', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(provider.features.supportsStreaming).toBe(true)
      }
    })

    it('should have every provider define all three feature flags', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        expect(typeof provider.features.supportsStreaming).toBe('boolean')
        expect(typeof provider.features.supportsFunctionCalling).toBe('boolean')
        expect(typeof provider.features.supportsJsonMode).toBe('boolean')
      }
    })
  })
})


