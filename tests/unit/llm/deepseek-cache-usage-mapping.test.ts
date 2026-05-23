import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter, OpenRouterAdapter } from '../../../src/llm/providers';
import type { ProviderConfig, ProviderCapabilities } from '../../../src/llm/types';

const capabilities: ProviderCapabilities = {
  supportsStreaming: false,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsVision: false,
  maxTokens: 4096,
  supportedModels: ['deepseek-chat'],
};

function createTestProviderConfig(id: string, priority: number): ProviderConfig {
  return {
    id,
    name: id,
    enabled: true,
    priority,
    timeoutMs: 30000,
    retries: 1,
    capabilities,
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
  };
}

function createTestRequest() {
  return {
    model: 'deepseek-chat',
    messages: [{ role: 'user' as const, content: 'Hello' }],
  };
}

function createMockFetch(responseBody: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(responseBody),
  });
}

describe('DeepSeek cache usage mapping', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('providers.ts OpenAIAdapter', () => {
    it('maps prompt_cache_hit_tokens and prompt_cache_miss_tokens', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_ds1',
        model: 'deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      });

      const adapter = new OpenAIAdapter(createTestProviderConfig('deepseek', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage).toBeDefined();
        expect(result.response.usage!.promptCacheHitTokens).toBe(80);
        expect(result.response.usage!.promptCacheMissTokens).toBe(20);
        expect(result.response.usage!.cacheHitRate).toBeCloseTo(0.8);
      }
    });

    it('returns undefined cache fields when no cache fields present', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_plain',
        model: 'deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
        },
      });

      const adapter = new OpenAIAdapter(createTestProviderConfig('deepseek', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage).toBeDefined();
        expect(result.response.usage!.promptCacheHitTokens).toBeUndefined();
        expect(result.response.usage!.promptCacheMissTokens).toBeUndefined();
        expect(result.response.usage!.cacheHitRate).toBeUndefined();
      }
    });

    it('computes cacheHitRate = hit / (hit + miss) when hit + miss > 0', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_rate',
        model: 'deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 5,
          total_tokens: 55,
          prompt_cache_hit_tokens: 30,
          prompt_cache_miss_tokens: 20,
        },
      });

      const adapter = new OpenAIAdapter(createTestProviderConfig('deepseek', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage!.cacheHitRate).toBeCloseTo(30 / 50);
      }
    });

    it('returns cacheHitRate = undefined when hit + miss = 0', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_zero',
        model: 'deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 0,
        },
      });

      const adapter = new OpenAIAdapter(createTestProviderConfig('deepseek', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage!.cacheHitRate).toBeUndefined();
      }
    });

    it('DeepSeek format takes priority over OpenAI nested format when both present', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_both',
        model: 'deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 10,
          total_tokens: 210,
          prompt_tokens_details: {
            cached_tokens: 150,
          },
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      });

      const adapter = new OpenAIAdapter(createTestProviderConfig('deepseek', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage!.promptCacheHitTokens).toBe(80);
        expect(result.response.usage!.promptCacheMissTokens).toBe(20);
        expect(result.response.usage!.cacheHitRate).toBeCloseTo(80 / 100);
      }
    });
  });

  describe('providers.ts OpenRouterAdapter', () => {
    it('maps DeepSeek prompt_cache_hit_tokens and prompt_cache_miss_tokens', async () => {
      globalThis.fetch = createMockFetch({
        id: 'resp_or1',
        model: 'deepseek/deepseek-chat',
        choices: [
          {
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 20,
        },
      });

      const adapter = new OpenRouterAdapter(createTestProviderConfig('openrouter', 1));
      const result = await adapter.complete(createTestRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.response.usage!.promptCacheHitTokens).toBe(80);
        expect(result.response.usage!.promptCacheMissTokens).toBe(20);
        expect(result.response.usage!.cacheHitRate).toBeCloseTo(0.8);
      }
    });
  });
});
