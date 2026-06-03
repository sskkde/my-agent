/**
 * Built-in Model Definitions
 * Static model catalog with conservative defaults and known model capabilities
 */

import type { ModelInfo, ModelCapabilities, ModelLimits } from '../types.js';

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
};

/**
 * Default model limits
 * Conservative token limits for unknown models
 */
export const DEFAULT_LIMITS: ModelLimits = {
  contextTokens: 8192,
  outputTokens: 4096,
};

/**
 * Built-in model catalog
 * Known models with their specific capabilities and limits
 */
export const BUILTIN_MODELS: ModelInfo[] = [
  {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    family: 'deepseek',
    protocol: 'openai_chat',
    displayName: 'DeepSeek Chat',
    capabilities: {
      ...DEFAULT_TEXT_MODEL_CAPABILITIES,
      functionCalling: true,
      jsonMode: true,
      promptCache: true,
    },
    limits: {
      contextTokens: 128000,
      outputTokens: 8192,
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
      reasoning: true,
    },
    limits: {
      contextTokens: 64000,
      outputTokens: 8192,
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
];
