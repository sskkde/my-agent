import { describe, it, expect } from 'vitest';
import {
  modelKey,
  getBuiltinModel,
  createFallbackModelInfo,
  resolveModelInfo,
} from '../../../src/llm/catalog/model-catalog.js';
import {
  DEFAULT_TEXT_MODEL_CAPABILITIES,
  DEFAULT_LIMITS,
  BUILTIN_MODELS,
} from '../../../src/llm/catalog/builtin-models.js';

describe('Model Catalog', () => {
  describe('modelKey', () => {
    it('returns providerId/modelId format', () => {
      expect(modelKey('deepseek', 'deepseek-chat')).toBe('deepseek/deepseek-chat');
      expect(modelKey('openai', 'gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    });
  });

  describe('getBuiltinModel', () => {
    it('returns null for unknown model', () => {
      const result = getBuiltinModel('unknown', 'unknown-model');
      expect(result).toBeNull();
    });

    it('returns correct model for deepseek-chat with promptCache=true and functionCalling=true', () => {
      const result = getBuiltinModel('deepseek', 'deepseek-chat');
      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('deepseek');
      expect(result!.modelId).toBe('deepseek-chat');
      expect(result!.capabilities.promptCache).toBe(true);
      expect(result!.capabilities.functionCalling).toBe(true);
      expect(result!.capabilities.jsonMode).toBe(true);
    });

    it('returns deepseek-reasoner with reasoning=true', () => {
      const result = getBuiltinModel('deepseek', 'deepseek-reasoner');
      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('deepseek');
      expect(result!.modelId).toBe('deepseek-reasoner');
      expect(result!.capabilities.reasoning).toBe(true);
    });

    it('returns gpt-4o-mini', () => {
      const result = getBuiltinModel('openai', 'gpt-4o-mini');
      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('openai');
      expect(result!.modelId).toBe('gpt-4o-mini');
      expect(result!.capabilities.functionCalling).toBe(true);
      expect(result!.capabilities.vision).toBe(true);
      expect(result!.capabilities.parallelToolCalls).toBe(true);
    });
  });

  describe('createFallbackModelInfo', () => {
    it('returns a fallback with conservative defaults for unknown model', () => {
      const result = createFallbackModelInfo('unknown', 'unknown-model');
      expect(result.providerId).toBe('unknown');
      expect(result.modelId).toBe('unknown-model');
      expect(result.family).toBe('openai_compatible');
      expect(result.protocol).toBe('openai_chat');
      expect(result.capabilities.streaming).toBe(false);
      expect(result.capabilities.functionCalling).toBe(false);
      expect(result.capabilities.jsonMode).toBe(false);
      expect(result.capabilities.structuredOutput).toBe(false);
      expect(result.capabilities.reasoning).toBe(false);
      expect(result.capabilities.vision).toBe(false);
      expect(result.capabilities.audioInput).toBe(false);
      expect(result.capabilities.pdfInput).toBe(false);
      expect(result.capabilities.toolChoice).toBe(false);
      expect(result.capabilities.parallelToolCalls).toBe(false);
      expect(result.capabilities.promptCache).toBe(false);
      expect(result.limits.contextTokens).toBe(8192);
      expect(result.limits.outputTokens).toBe(4096);
    });

    it('accepts custom family and protocol', () => {
      const result = createFallbackModelInfo(
        'test-provider',
        'test-model',
        'anthropic',
        'anthropic_messages'
      );
      expect(result.family).toBe('anthropic');
      expect(result.protocol).toBe('anthropic_messages');
    });
  });

  describe('resolveModelInfo', () => {
    it('returns builtin model when available', () => {
      const result = resolveModelInfo('deepseek', 'deepseek-chat');
      expect(result.providerId).toBe('deepseek');
      expect(result.modelId).toBe('deepseek-chat');
      expect(result.capabilities.promptCache).toBe(true);
      expect(result.capabilities.functionCalling).toBe(true);
    });

    it('returns fallback for unknown model', () => {
      const result = resolveModelInfo('unknown', 'unknown-model');
      expect(result.providerId).toBe('unknown');
      expect(result.modelId).toBe('unknown-model');
      expect(result.family).toBe('openai_compatible');
      expect(result.capabilities.functionCalling).toBe(false);
      expect(result.capabilities.promptCache).toBe(false);
    });

    it('passes family and protocol to fallback when model not found', () => {
      const result = resolveModelInfo(
        'custom',
        'custom-model',
        'gemini',
        'gemini_generate_content'
      );
      expect(result.family).toBe('gemini');
      expect(result.protocol).toBe('gemini_generate_content');
    });
  });

  describe('DEFAULT_TEXT_MODEL_CAPABILITIES', () => {
    it('has all booleans = false (conservative)', () => {
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.streaming).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.functionCalling).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.jsonMode).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.structuredOutput).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.reasoning).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.vision).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.audioInput).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.pdfInput).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.toolChoice).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.parallelToolCalls).toBe(false);
      expect(DEFAULT_TEXT_MODEL_CAPABILITIES.promptCache).toBe(false);
    });
  });

  describe('DEFAULT_LIMITS', () => {
    it('has reasonable defaults', () => {
      expect(DEFAULT_LIMITS.contextTokens).toBe(8192);
      expect(DEFAULT_LIMITS.outputTokens).toBe(4096);
    });
  });

  describe('BUILTIN_MODELS', () => {
    it('contains at least 3 models', () => {
      expect(BUILTIN_MODELS.length).toBeGreaterThanOrEqual(3);
    });

    it('contains deepseek-chat', () => {
      const deepseekChat = BUILTIN_MODELS.find(
        (m) => m.providerId === 'deepseek' && m.modelId === 'deepseek-chat'
      );
      expect(deepseekChat).toBeDefined();
    });

    it('contains deepseek-reasoner', () => {
      const deepseekReasoner = BUILTIN_MODELS.find(
        (m) => m.providerId === 'deepseek' && m.modelId === 'deepseek-reasoner'
      );
      expect(deepseekReasoner).toBeDefined();
    });

    it('contains gpt-4o-mini', () => {
      const gpt4oMini = BUILTIN_MODELS.find(
        (m) => m.providerId === 'openai' && m.modelId === 'gpt-4o-mini'
      );
      expect(gpt4oMini).toBeDefined();
    });
  });
});
