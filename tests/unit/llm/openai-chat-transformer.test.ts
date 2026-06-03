import { describe, it, expect } from 'vitest';
import {
  buildOpenAIChatRequestBody,
  mapOpenAIChatResponse,
  buildOpenAICompatibleHeaders,
} from '../../../src/llm/transform/openai-chat-transformer';
import type { LLMRequest } from '../../../src/llm/types';

describe('openai-chat-transformer', () => {
  describe('buildOpenAIChatRequestBody', () => {
    it('maps messages with role/content correctly', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.model).toBe('gpt-4');
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('includes tools when present', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: { type: 'object' },
            },
          },
        ],
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.tools).toBeDefined();
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object' },
          },
        },
      ]);
    });

    it('includes tool_choice when present (string)', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        toolChoice: 'auto',
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.tool_choice).toBe('auto');
    });

    it('includes tool_choice when present (object)', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        toolChoice: { type: 'function', function: { name: 'get_weather' } },
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.tool_choice).toEqual({
        type: 'function',
        function: { name: 'get_weather' },
      });
    });

    it('includes response_format when present', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        responseFormat: { type: 'json_object' },
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('includes max_tokens as max_tokens', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 1000,
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.max_tokens).toBe(1000);
    });

    it('includes temperature, top_p, etc. when present', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.7,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        stopSequences: ['STOP'],
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.frequency_penalty).toBe(0.5);
      expect(body.presence_penalty).toBe(0.3);
      expect(body.stop).toEqual(['STOP']);
    });

    it('maps toolCalls in messages correctly', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
              },
            ],
          },
        ],
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.messages).toEqual([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
            },
          ],
        },
      ]);
    });

    it('maps toolCallId in messages correctly', () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'tool',
            content: '{"temp": 72}',
            toolCallId: 'call_123',
          },
        ],
      };

      const body = buildOpenAIChatRequestBody(request);

      expect(body.messages).toEqual([
        {
          role: 'tool',
          content: '{"temp": 72}',
          tool_call_id: 'call_123',
        },
      ]);
    });
  });

  describe('mapOpenAIChatResponse', () => {
    it('maps basic response (id, model, content, role)', () => {
      const data = {
        id: 'resp_123',
        model: 'gpt-4',
        choices: [
          {
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.id).toBe('resp_123');
      expect(response.model).toBe('gpt-4');
      expect(response.content).toBe('Hello!');
      expect(response.role).toBe('assistant');
      expect(response.finishReason).toBe('stop');
    });

    it('maps tool_calls correctly', () => {
      const data = {
        id: 'resp_123',
        model: 'gpt-4',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'call_abc',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"NYC"}',
        },
      });
      expect(response.finishReason).toBe('tool_calls');
    });

    it('maps OpenAI nested cache (prompt_tokens_details.cached_tokens)', () => {
      const data = {
        id: 'resp_123',
        model: 'gpt-4',
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
          prompt_tokens_details: {
            cached_tokens: 80,
          },
        },
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.usage).toBeDefined();
      expect(response.usage!.promptTokens).toBe(100);
      expect(response.usage!.completionTokens).toBe(10);
      expect(response.usage!.totalTokens).toBe(110);
      expect(response.usage!.promptCacheHitTokens).toBe(80);
      expect(response.usage!.promptCacheMissTokens).toBe(20);
      expect(response.usage!.cacheHitRate).toBeCloseTo(0.8);
    });

    it('maps DeepSeek flat cache (prompt_cache_hit_tokens)', () => {
      const data = {
        id: 'resp_123',
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
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.usage!.promptCacheHitTokens).toBe(80);
      expect(response.usage!.promptCacheMissTokens).toBe(20);
      expect(response.usage!.cacheHitRate).toBeCloseTo(0.8);
    });

    it('DeepSeek flat takes priority over nested', () => {
      const data = {
        id: 'resp_123',
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
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.usage!.promptCacheHitTokens).toBe(80);
      expect(response.usage!.promptCacheMissTokens).toBe(20);
      expect(response.usage!.cacheHitRate).toBeCloseTo(80 / 100);
    });

    it('returns undefined cache fields when no cache fields present', () => {
      const data = {
        id: 'resp_123',
        model: 'gpt-4',
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
      };

      const response = mapOpenAIChatResponse(data);

      expect(response.usage).toBeDefined();
      expect(response.usage!.promptCacheHitTokens).toBeUndefined();
      expect(response.usage!.promptCacheMissTokens).toBeUndefined();
      expect(response.usage!.cacheHitRate).toBeUndefined();
    });
  });

  describe('buildOpenAICompatibleHeaders', () => {
    it('builds basic headers with apiKey', () => {
      const headers = buildOpenAICompatibleHeaders({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer sk-test');
    });

    it('includes siteUrl and appName when provided', () => {
      const headers = buildOpenAICompatibleHeaders({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        siteUrl: 'https://example.com',
        appName: 'MyApp',
      });

      expect(headers['HTTP-Referer']).toBe('https://example.com');
      expect(headers['X-Title']).toBe('MyApp');
    });

    it('omits siteUrl and appName when not provided', () => {
      const headers = buildOpenAICompatibleHeaders({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      });

      expect(headers['HTTP-Referer']).toBeUndefined();
      expect(headers['X-Title']).toBeUndefined();
    });
  });
});
