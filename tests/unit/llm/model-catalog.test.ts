import { describe, it, expect } from 'vitest'
import {
  modelKey,
  getBuiltinModel,
  createFallbackModelInfo,
  resolveModelInfo,
} from '../../../src/llm/catalog/model-catalog.js'
import {
  DEFAULT_TEXT_MODEL_CAPABILITIES,
  DEFAULT_LIMITS,
  BUILTIN_MODELS,
} from '../../../src/llm/catalog/builtin-models.js'
import { DOMESTIC_PROVIDERS } from '../../../src/llm/catalog/domestic-providers.js'

describe('Model Catalog', () => {
  describe('modelKey', () => {
    it('returns providerId/modelId format', () => {
      expect(modelKey('deepseek', 'deepseek-chat')).toBe('deepseek/deepseek-chat')
      expect(modelKey('openai', 'gpt-4o-mini')).toBe('openai/gpt-4o-mini')
    })
  })

  describe('getBuiltinModel', () => {
    it('returns null for unknown model', () => {
      const result = getBuiltinModel('unknown', 'unknown-model')
      expect(result).toBeNull()
    })

    it('returns correct model for deepseek-chat with promptCache=true and functionCalling=true', () => {
      const result = getBuiltinModel('deepseek', 'deepseek-chat')
      expect(result).not.toBeNull()
      expect(result!.providerId).toBe('deepseek')
      expect(result!.modelId).toBe('deepseek-chat')
      expect(result!.capabilities.promptCache).toBe(true)
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.jsonMode).toBe(true)
    })

    it('returns deepseek-v4-flash as current DeepSeek model', () => {
      const result = getBuiltinModel('deepseek', 'deepseek-v4-flash')
      expect(result).not.toBeNull()
      expect(result!.providerId).toBe('deepseek')
      expect(result!.modelId).toBe('deepseek-v4-flash')
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.jsonMode).toBe(true)
      expect(result!.capabilities.promptCache).toBe(true)
      expect(result!.limits.contextTokens).toBe(1000000)
      expect(result!.limits.outputTokens).toBe(384000)
    })

    it('returns deepseek-reasoner with reasoning=true', () => {
      const result = getBuiltinModel('deepseek', 'deepseek-reasoner')
      expect(result).not.toBeNull()
      expect(result!.providerId).toBe('deepseek')
      expect(result!.modelId).toBe('deepseek-reasoner')
      expect(result!.capabilities.reasoning).toBe(true)
    })

    it('returns gpt-4o-mini', () => {
      const result = getBuiltinModel('openai', 'gpt-4o-mini')
      expect(result).not.toBeNull()
      expect(result!.providerId).toBe('openai')
      expect(result!.modelId).toBe('gpt-4o-mini')
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.vision).toBe(true)
      expect(result!.capabilities.parallelToolCalls).toBe(true)
    })

    it('returns dashscope qwen-plus', () => {
      const result = getBuiltinModel('dashscope', 'qwen-plus')
      expect(result).not.toBeNull()
      expect(result!.capabilities.streaming).toBe(true)
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.jsonMode).toBe(true)
      expect(result!.limits.contextTokens).toBe(128000)
      expect(result!.limits.outputTokens).toBe(8192)
    })

    it('returns volcengine doubao-pro-32k', () => {
      const result = getBuiltinModel('volcengine', 'doubao-pro-32k')
      expect(result).not.toBeNull()
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.limits.contextTokens).toBe(32000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns qianfan ernie-4.0-8k', () => {
      const result = getBuiltinModel('qianfan', 'ernie-4.0-8k')
      expect(result).not.toBeNull()
      expect(result!.limits.contextTokens).toBe(8000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns zhipu glm-4-plus', () => {
      const result = getBuiltinModel('zhipu', 'glm-4-plus')
      expect(result).not.toBeNull()
      expect(result!.limits.contextTokens).toBe(128000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns moonshot moonshot-v1-auto', () => {
      const result = getBuiltinModel('moonshot', 'moonshot-v1-auto')
      expect(result).not.toBeNull()
      expect(result!.limits.contextTokens).toBe(128000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns minimax MiniMax-Text-01 without jsonMode', () => {
      const result = getBuiltinModel('minimax', 'MiniMax-Text-01')
      expect(result).not.toBeNull()
      expect(result!.capabilities.jsonMode).toBe(false)
      expect(result!.limits.contextTokens).toBe(256000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns jdcloud-yanxi yanxi-v1 with minimal capabilities', () => {
      const result = getBuiltinModel('jdcloud-yanxi', 'yanxi-v1')
      expect(result).not.toBeNull()
      expect(result!.capabilities.streaming).toBe(true)
      expect(result!.capabilities.functionCalling).toBe(false)
      expect(result!.capabilities.jsonMode).toBe(false)
      expect(result!.limits.contextTokens).toBe(8000)
      expect(result!.limits.outputTokens).toBe(2048)
    })

    it('returns mimo mimo-v1', () => {
      const result = getBuiltinModel('mimo', 'mimo-v1')
      expect(result).not.toBeNull()
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.limits.contextTokens).toBe(32000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns iflytek-spark spark-max without jsonMode', () => {
      const result = getBuiltinModel('iflytek-spark', 'spark-max')
      expect(result).not.toBeNull()
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.jsonMode).toBe(false)
      expect(result!.limits.contextTokens).toBe(8000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns stepfun step-1v-32k without jsonMode', () => {
      const result = getBuiltinModel('stepfun', 'step-1v-32k')
      expect(result).not.toBeNull()
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.capabilities.jsonMode).toBe(false)
      expect(result!.limits.contextTokens).toBe(32000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns hunyuan hunyuan-pro', () => {
      const result = getBuiltinModel('hunyuan', 'hunyuan-pro')
      expect(result).not.toBeNull()
      expect(result!.capabilities.jsonMode).toBe(true)
      expect(result!.limits.contextTokens).toBe(32000)
      expect(result!.limits.outputTokens).toBe(4096)
    })

    it('returns siliconflow Qwen/Qwen2.5-7B-Instruct', () => {
      const result = getBuiltinModel('siliconflow', 'Qwen/Qwen2.5-7B-Instruct')
      expect(result).not.toBeNull()
      expect(result!.capabilities.functionCalling).toBe(true)
      expect(result!.limits.contextTokens).toBe(32000)
      expect(result!.limits.outputTokens).toBe(4096)
    })
  })

  describe('createFallbackModelInfo', () => {
    it('returns a fallback with conservative defaults for unknown model', () => {
      const result = createFallbackModelInfo('unknown', 'unknown-model')
      expect(result.providerId).toBe('unknown')
      expect(result.modelId).toBe('unknown-model')
      expect(result.family).toBe('openai_compatible')
      expect(result.protocol).toBe('openai_chat')
      expect(result.capabilities.streaming).toBe(false)
      expect(result.capabilities.functionCalling).toBe(false)
      expect(result.capabilities.jsonMode).toBe(false)
      expect(result.capabilities.structuredOutput).toBe(false)
      expect(result.capabilities.reasoning).toBe(false)
      expect(result.capabilities.vision).toBe(false)
      expect(result.capabilities.audioInput).toBe(false)
      expect(result.capabilities.pdfInput).toBe(false)
      expect(result.capabilities.toolChoice).toBe(false)
      expect(result.capabilities.parallelToolCalls).toBe(false)
      expect(result.capabilities.promptCache).toBe(false)
      expect(result.limits.contextTokens).toBe(8192)
      expect(result.limits.outputTokens).toBe(4096)
    })

    it('accepts custom family and protocol', () => {
      const result = createFallbackModelInfo('test-provider', 'test-model', 'anthropic', 'anthropic_messages')
      expect(result.family).toBe('anthropic')
      expect(result.protocol).toBe('anthropic_messages')
    })
  })

  describe('resolveModelInfo', () => {
    it('returns builtin model when available', () => {
      const result = resolveModelInfo('deepseek', 'deepseek-chat')
      expect(result.providerId).toBe('deepseek')
      expect(result.modelId).toBe('deepseek-chat')
      expect(result.capabilities.promptCache).toBe(true)
      expect(result.capabilities.functionCalling).toBe(true)
    })

    it('returns fallback for unknown model', () => {
      const result = resolveModelInfo('unknown', 'unknown-model')
      expect(result.providerId).toBe('unknown')
      expect(result.modelId).toBe('unknown-model')
      expect(result.family).toBe('openai_compatible')
      expect(result.capabilities.functionCalling).toBe(false)
      expect(result.capabilities.promptCache).toBe(false)
    })

    it('passes family and protocol to fallback when model not found', () => {
      const result = resolveModelInfo('custom', 'custom-model', 'gemini', 'gemini_generate_content')
      expect(result.family).toBe('gemini')
      expect(result.protocol).toBe('gemini_generate_content')
    })
  })

  describe('DEFAULT_TEXT_MODEL_CAPABILITIES', () => {
    it('has all booleans = false (conservative)', () => {
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.streaming).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.functionCalling).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.jsonMode).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.structuredOutput).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.reasoning).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.vision).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.audioInput).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.pdfInput).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.toolChoice).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.parallelToolCalls).toBe(false)
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.promptCache).toBe(false)
    })
  })

  describe('DEFAULT_LIMITS', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_LIMITS.contextTokens).toBe(8192)
      expect(DEFAULT_LIMITS.outputTokens).toBe(4096)
    })
  })

  describe('BUILTIN_MODELS', () => {
    it('contains at least 16 models', () => {
      expect(BUILTIN_MODELS.length).toBeGreaterThanOrEqual(16)
    })

    it('contains deepseek-chat', () => {
      const deepseekChat = BUILTIN_MODELS.find((m) => m.providerId === 'deepseek' && m.modelId === 'deepseek-chat')
      expect(deepseekChat).toBeDefined()
    })

    it('contains deepseek-v4-flash', () => {
      const deepseekV4Flash = BUILTIN_MODELS.find(
        (m) => m.providerId === 'deepseek' && m.modelId === 'deepseek-v4-flash',
      )
      expect(deepseekV4Flash).toBeDefined()
    })

    it('contains deepseek-reasoner', () => {
      const deepseekReasoner = BUILTIN_MODELS.find(
        (m) => m.providerId === 'deepseek' && m.modelId === 'deepseek-reasoner',
      )
      expect(deepseekReasoner).toBeDefined()
    })

    it('contains gpt-4o-mini', () => {
      const gpt4oMini = BUILTIN_MODELS.find((m) => m.providerId === 'openai' && m.modelId === 'gpt-4o-mini')
      expect(gpt4oMini).toBeDefined()
    })

    it('contains entries for all 13 domestic providers', () => {
      const domesticProviderIds = [
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
      ]
      for (const providerId of domesticProviderIds) {
        const entry = BUILTIN_MODELS.find((m) => m.providerId === providerId)
        expect(entry, `missing entry for domestic provider: ${providerId}`).toBeDefined()
      }
    })

    it('all domestic models use openai_compatible family and openai_chat protocol', () => {
      const domesticProviderIds = [
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
        'siliconflow',
      ]
      for (const providerId of domesticProviderIds) {
        const model = BUILTIN_MODELS.find((m) => m.providerId === providerId)
        expect(model, `missing model for ${providerId}`).toBeDefined()
        expect(model!.family, `${providerId} family`).toBe('openai_compatible')
        expect(model!.protocol, `${providerId} protocol`).toBe('openai_chat')
      }
    })

    it('all domestic provider default models resolve correctly via getBuiltinModel', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        const model = getBuiltinModel(provider.providerType, provider.defaultModel)
        expect(model, `missing builtin model for ${provider.providerType}/${provider.defaultModel}`).not.toBeNull()
        expect(model!.providerId).toBe(provider.providerType)
        expect(model!.modelId).toBe(provider.defaultModel)
      }
    })

    it('domestic provider model capabilities match feature flags', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        const model = getBuiltinModel(provider.providerType, provider.defaultModel)
        expect(model, `missing model for ${provider.providerType}`).not.toBeNull()
        expect(model!.capabilities.functionCalling, `${provider.providerType} functionCalling`).toBe(
          provider.features.supportsFunctionCalling,
        )
        expect(model!.capabilities.jsonMode, `${provider.providerType} jsonMode`).toBe(
          provider.features.supportsJsonMode,
        )
      }
    })

    it('domestic provider default models have non-zero contextTokens', () => {
      for (const provider of DOMESTIC_PROVIDERS) {
        const model = getBuiltinModel(provider.providerType, provider.defaultModel)
        expect(model, `missing model for ${provider.providerType}`).not.toBeNull()
        expect(model!.limits.contextTokens, `${provider.providerType} contextTokens`).toBeGreaterThan(0)
        expect(model!.limits.outputTokens, `${provider.providerType} outputTokens`).toBeGreaterThan(0)
      }
    })
  })
})
