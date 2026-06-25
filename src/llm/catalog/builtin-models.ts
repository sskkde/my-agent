/**
 * Built-in Model Definitions
 * Static model catalog with conservative defaults and known model capabilities
 */

import type { ModelInfo, ModelCapabilities, ModelLimits } from '../types.js'

/**
 * Default text model capabilities
 * Conservative defaults: all features disabled for safety
 */
export const DEFAULT_TEXT_MODEL_CAPABILITIES: ModelCapabilities = {
  streaming: false,
  functionCalling: false,
  jsonMode: false,
  structuredOutput: false,
  reasoning: false,
  vision: false,
  audioInput: false,
  pdfInput: false,
  toolChoice: false,
  parallelToolCalls: false,
  promptCache: false,
}

/**
 * Default model limits
 * Conservative token limits for unknown models
 */
export const DEFAULT_LIMITS: ModelLimits = {
  contextTokens: 8192,
  outputTokens: 4096,
}

/**
 * Built-in model catalog
 * Known models with their specific capabilities and limits
 */
export const BUILTIN_MODELS: ModelInfo[] = [
  {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    family: 'deepseek',
    protocol: 'openai_chat',
    displayName: 'DeepSeek V4 Flash',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      promptCache: true,
    },
    limits: {
      contextTokens: 1000000,
      outputTokens: 384000,
    },
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    family: 'deepseek',
    protocol: 'openai_chat',
    displayName: 'DeepSeek Chat',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      promptCache: true,
    },
    limits: {
      contextTokens: 1000000,
      outputTokens: 384000,
    },
  },
  {
    providerId: 'deepseek',
    modelId: 'deepseek-reasoner',
    family: 'deepseek',
    protocol: 'openai_chat',
    displayName: 'DeepSeek Reasoner',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      reasoning: true,
      jsonMode: true,
      promptCache: true,
    },
    limits: {
      contextTokens: 1000000,
      outputTokens: 384000,
    },
  },
  {
    providerId: 'openai',
    modelId: 'gpt-4o-mini',
    family: 'openai',
    protocol: 'openai_chat',
    displayName: 'GPT-4o mini',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      vision: true,
      parallelToolCalls: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 16384,
    },
  },
  {
    providerId: 'openrouter',
    modelId: 'gpt-4o-mini',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'GPT-4o mini (via OpenRouter)',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
      vision: true,
      parallelToolCalls: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 16384,
    },
  },

  // --- Domestic providers (China-based LLM providers) ---

  {
    providerId: 'dashscope',
    modelId: 'qwen-plus',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'DashScope Qwen Plus',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 8192,
    },
  },
  {
    providerId: 'volcengine',
    modelId: 'doubao-pro-32k',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'Volcano Doubao Pro 32K',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 32000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'qianfan',
    modelId: 'ernie-4.0-8k',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'Qianfan ERNIE 4.0 8K',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 8000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'zhipu',
    modelId: 'glm-4-plus',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'Zhipu GLM-4 Plus',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'moonshot',
    modelId: 'moonshot-v1-auto',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'Moonshot V1 Auto',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'minimax',
    modelId: 'MiniMax-Text-01',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'MiniMax Text 01',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
    },
    limits: {
      contextTokens: 256000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'jdcloud-yanxi',
    modelId: 'yanxi-v1',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'JD Cloud Yanxi V1',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
    },
    limits: {
      contextTokens: 8000,
      outputTokens: 2048,
    },
  },
  {
    providerId: 'mimo',
    modelId: 'mimo-v1',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'MiMo V1',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 32000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'iflytek-spark',
    modelId: 'spark-max',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'iFlyTek Spark Max',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
    },
    limits: {
      contextTokens: 8000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'stepfun',
    modelId: 'step-1v-32k',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'StepFun Step-1V 32K',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
    },
    limits: {
      contextTokens: 32000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'hunyuan',
    modelId: 'hunyuan-pro',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'Hunyuan Pro',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 32000,
      outputTokens: 4096,
    },
  },
  {
    providerId: 'siliconflow',
    modelId: 'Qwen/Qwen2.5-7B-Instruct',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    displayName: 'SiliconFlow Qwen2.5 7B',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      streaming: true,
      functionCalling: true,
      jsonMode: true,
    },
    limits: {
      contextTokens: 32000,
      outputTokens: 4096,
    },
  },
]
