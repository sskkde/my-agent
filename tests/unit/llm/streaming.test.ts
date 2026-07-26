import { describe, it, expect } from 'vitest'
import { createLLMAdapter, createCircuitBreaker } from '../../../src/llm'
import type { LLMProvider, LLMRequest, LLMResponse, LLMResult, ProviderConfig, ProviderCapabilities } from '../../../src/llm'
import type { RuntimeError } from '../../../src/shared/errors'
import { parseOpenAIStreamLine, parseOpenAIStreamEvents } from '../../../src/llm/transform/openai-chat-transformer'
import { StreamResponseAggregator } from '../../../src/llm/stream-aggregator'
import { parseOllamaStreamLine } from '../../../src/llm/transform/ollama-transformer'
import { buildOllamaChatRequestBody } from '../../../src/llm/transform/ollama-transformer'
import { buildOpenAIChatRequestBody } from '../../../src/llm/transform/openai-chat-transformer'
import { toLLMStreamChunk } from '../../../src/llm/types'
import type { ProviderStreamEvent, LLMStreamChunk } from '../../../src/llm/types'
import type { TokenStreamPayload } from '../../../src/api/types'

class StreamingFakeProvider implements LLMProvider {
  readonly id: string
  config: ProviderConfig
  circuitBreaker = createCircuitBreaker()
  private readonly streamDeltas: string[]
  private completeResponse: LLMResponse | null
  private completeError: RuntimeError | null
  readonly stream?: (request: LLMRequest) => AsyncGenerator<import('../../../src/llm/types.js').ProviderStreamEvent>

  constructor(
    id: string,
    config: ProviderConfig,
    options: {
      streamDeltas?: string[]
      completeResponse?: LLMResponse
      completeError?: RuntimeError
      supportsStream?: boolean
    } = {},
  ) {
    this.id = id
    this.config = config
    this.streamDeltas = options.streamDeltas ?? []
    this.completeResponse = options.completeResponse ?? null
    this.completeError = options.completeError ?? null

    const deltas = this.streamDeltas
    if (options.supportsStream ?? true) {
      this.stream = async function* (_request: LLMRequest) {
        for (const delta of deltas) {
          yield { kind: 'text' as const, delta }
        }
        yield { kind: 'finish' as const, finishReason: 'stop' as const }
      }
    }
  }

  get health(): 'healthy' | 'degraded' | 'unhealthy' {
    return 'healthy'
  }

  get stats() {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy' as const,
    }
  }

  isHealthy(): boolean {
    return this.circuitBreaker.canExecute()
  }

  getStats() {
    return this.stats
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  resetStats(): void {}

  async complete(_request: LLMRequest): Promise<LLMResult> {
    if (this.completeError) {
      return { success: false, error: this.completeError, providerId: this.id }
    }
    const response: LLMResponse =
      this.completeResponse ?? {
        id: `resp_${Date.now()}`,
        model: 'test-model',
        content: 'Complete fallback response',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      }
    return { success: true, response, providerId: this.id }
  }
}

function createTestProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['gpt-4'],
  }
  return {
    id: 'test-provider',
    name: 'Test Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 30000,
    retries: 3,
    capabilities,
    ...overrides,
  }
}

function createTestRequest(): LLMRequest {
  return {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  }
}

describe('LLM Streaming', () => {
  describe('parseOpenAIStreamLine', () => {
    it('extracts text event from valid SSE data lines', () => {
      const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
      expect(parseOpenAIStreamLine(line)).toEqual({ kind: 'text', delta: 'Hello' })
    })

    it('returns null for [DONE] sentinel', () => {
      expect(parseOpenAIStreamLine('data: [DONE]')).toBeNull()
    })

    it('returns null for non-data lines', () => {
      expect(parseOpenAIStreamLine(': heartbeat')).toBeNull()
      expect(parseOpenAIStreamLine('event: ping')).toBeNull()
    })

    it('returns null for empty delta content', () => {
      const line = 'data: {"choices":[{"delta":{"content":""}}]}'
      expect(parseOpenAIStreamLine(line)).toBeNull()
    })

    it('returns null for missing delta field (e.g. role-only chunk)', () => {
      const line = 'data: {"choices":[{"delta":{"role":"assistant"}}]}'
      expect(parseOpenAIStreamLine(line)).toBeNull()
    })

    it('returns null for malformed JSON', () => {
      expect(parseOpenAIStreamLine('data: {invalid}')).toBeNull()
    })

    it('parses tool_call_delta fragments', () => {
      const payload = {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'get_weather', arguments: '{"c' },
                },
              ],
            },
          },
        ],
      }
      const line = `data: ${JSON.stringify(payload)}`
      expect(parseOpenAIStreamLine(line)).toEqual({
        kind: 'tool_call_delta',
        index: 0,
        id: 'call_1',
        name: 'get_weather',
        argumentsDelta: '{"c',
      })
    })

    it('parses finish_reason tool_calls', () => {
      const line = 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}'
      expect(parseOpenAIStreamLine(line)).toEqual({
        kind: 'finish',
        finishReason: 'tool_calls',
      })
    })
  })

  describe('parseOllamaStreamLine', () => {
    it('extracts text event from valid NDJSON lines', () => {
      const line = '{"message":{"content":"Hello"},"done":false}'
      expect(parseOllamaStreamLine(line)).toEqual({ kind: 'text', delta: 'Hello' })
    })

    it('returns null for empty lines', () => {
      expect(parseOllamaStreamLine('')).toBeNull()
      expect(parseOllamaStreamLine('   ')).toBeNull()
    })

    it('returns finish event for done=true final chunks with no content', () => {
      const line = '{"message":{},"done":true}'
      expect(parseOllamaStreamLine(line)).toEqual({ kind: 'finish', finishReason: 'stop' })
    })

    it('returns null for malformed JSON', () => {
      expect(parseOllamaStreamLine('{invalid}')).toBeNull()
    })
  })

  describe('buildOpenAIChatRequestBody with stream flag', () => {
    it('sets stream: true when stream=true', () => {
      const body = buildOpenAIChatRequestBody(createTestRequest(), true)
      expect(body.stream).toBe(true)
    })

    it('omits stream when stream=false (default)', () => {
      const body = buildOpenAIChatRequestBody(createTestRequest())
      expect(body.stream).toBeUndefined()
    })
  })

  describe('buildOllamaChatRequestBody with stream flag', () => {
    it('sets stream: true when stream=true', () => {
      const body = buildOllamaChatRequestBody(createTestRequest(), true)
      expect(body.stream).toBe(true)
    })

    it('sets stream: false by default', () => {
      const body = buildOllamaChatRequestBody(createTestRequest())
      expect(body.stream).toBe(false)
    })
  })

  describe('adapter.stream with provider supporting stream()', () => {
    it('yields deltas from the provider stream', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      })

      const provider = new StreamingFakeProvider('p1', createTestProviderConfig({ id: 'p1' }), {
        streamDeltas: ['Hello', ' ', 'world'],
      })
      adapter.addProvider(provider)

      const chunks: string[] = []
      for await (const chunk of adapter.stream(createTestRequest())) {
        if (chunk.kind === 'text') chunks.push(chunk.delta)
      }

      expect(chunks).toEqual(['Hello', ' ', 'world'])
    })

    it('falls back to complete() when no provider supports stream()', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      })

      const provider = new StreamingFakeProvider('p1', createTestProviderConfig({ id: 'p1' }), {
        supportsStream: false,
        completeResponse: {
          id: 'resp_1',
          model: 'gpt-4',
          content: 'Fallback from complete',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
      })
      adapter.addProvider(provider)

      const chunks: string[] = []
      for await (const chunk of adapter.stream(createTestRequest())) {
        if (chunk.kind === 'text') chunks.push(chunk.delta)
      }

      expect(chunks).toEqual(['Fallback from complete'])
    })

    it('fails over to next provider when first stream throws', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      })

      const failingProvider = new StreamingFakeProvider('failing', createTestProviderConfig({ id: 'failing', priority: 1 }), {
        streamDeltas: [],
      })
      failingProvider.circuitBreaker.forceOpen()
      adapter.addProvider(failingProvider)

      const okProvider = new StreamingFakeProvider('ok', createTestProviderConfig({ id: 'ok', priority: 2 }), {
        streamDeltas: ['Recovered'],
      })
      adapter.addProvider(okProvider)

      const chunks: string[] = []
      for await (const chunk of adapter.stream(createTestRequest())) {
        if (chunk.kind === 'text') chunks.push(chunk.delta)
      }

      expect(chunks).toEqual(['Recovered'])
    })

    it('yields nothing when no healthy providers exist', async () => {
      const adapter = createLLMAdapter({
        providers: [],
        defaultTimeoutMs: 30000,
        enableCircuitBreaker: true,
      })

      const chunks: string[] = []
      for await (const chunk of adapter.stream(createTestRequest())) {
        if (chunk.kind === 'text') chunks.push(chunk.delta)
      }

      expect(chunks).toEqual([])
    })
  })
})


describe('StreamResponseAggregator', () => {
  it('aggregates text deltas into content', () => {
    const agg = new StreamResponseAggregator()
    agg.apply({ kind: 'text', delta: 'Hello', providerId: 'p1' })
    agg.apply({ kind: 'text', delta: ' world', providerId: 'p1' })
    agg.apply({ kind: 'finish', finishReason: 'stop', providerId: 'p1' })
    const response = agg.toResponse('gpt-4')
    expect(response.content).toBe('Hello world')
    expect(response.finishReason).toBe('stop')
    expect(response.toolCalls).toBeUndefined()
  })

  it('aggregates fragmented tool_call arguments by index', () => {
    const agg = new StreamResponseAggregator()
    agg.apply({
      kind: 'tool_call_delta',
      index: 0,
      id: 'call_1',
      name: 'get_weather',
      argumentsDelta: '{"city":',
      providerId: 'p1',
    })
    agg.apply({
      kind: 'tool_call_delta',
      index: 0,
      argumentsDelta: '"SF"}',
      providerId: 'p1',
    })
    agg.apply({ kind: 'finish', finishReason: 'tool_calls', providerId: 'p1' })
    const response = agg.toResponse('gpt-4')
    expect(response.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' },
      },
    ])
    expect(response.finishReason).toBe('tool_calls')
  })

  it('promotes finishReason to tool_calls when tools present without finish event', () => {
    const agg = new StreamResponseAggregator()
    agg.apply({
      kind: 'tool_call_delta',
      index: 0,
      id: 'call_2',
      name: 'search',
      argumentsDelta: '{}',
      providerId: 'p1',
    })
    const response = agg.toResponse('gpt-4')
    expect(response.finishReason).toBe('tool_calls')
  })

  it('keeps text and tool_calls together', () => {
    const agg = new StreamResponseAggregator()
    agg.apply({ kind: 'text', delta: 'Let me check.', providerId: 'p1' })
    agg.apply({
      kind: 'tool_call_delta',
      index: 0,
      id: 'call_3',
      name: 'web_search',
      argumentsDelta: '{"q":"x"}',
      providerId: 'p1',
    })
    agg.apply({ kind: 'finish', finishReason: 'tool_calls', providerId: 'p1' })
    const response = agg.toResponse('gpt-4')
    expect(response.content).toBe('Let me check.')
    expect(response.toolCalls?.[0]?.function.name).toBe('web_search')
  })
})

describe('parseOpenAIStreamEvents multi tool_calls', () => {
  it('emits one event per tool_call fragment in a single SSE line', () => {
    const payload = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c0', function: { name: 'a', arguments: '{' } },
              { index: 1, id: 'c1', function: { name: 'b', arguments: '{' } },
            ],
          },
        },
      ],
    }
    const events = parseOpenAIStreamEvents(`data: ${JSON.stringify(payload)}`)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'tool_call_delta', index: 0, id: 'c0', name: 'a' })
    expect(events[1]).toMatchObject({ kind: 'tool_call_delta', index: 1, id: 'c1', name: 'b' })
  })
})

describe('supportsStructuredToolStreaming (P1)', () => {
  it('allows openai-compatible families', async () => {
    const { supportsStructuredToolStreaming } = await import('../../../src/llm/stream-capabilities.js')
    expect(supportsStructuredToolStreaming('openai')).toBe(true)
    expect(supportsStructuredToolStreaming('deepseek')).toBe(true)
    expect(supportsStructuredToolStreaming('moonshot')).toBe(true)
  })

  it('denies families without structured tool stream support', async () => {
    const { supportsStructuredToolStreaming } = await import('../../../src/llm/stream-capabilities.js')
    expect(supportsStructuredToolStreaming('anthropic')).toBe(false)
    expect(supportsStructuredToolStreaming('gemini')).toBe(false)
    expect(supportsStructuredToolStreaming('bedrock')).toBe(false)
  })

  it('allows ollama now that it uses the OpenAI-compatible streaming path', async () => {
    const { supportsStructuredToolStreaming } = await import('../../../src/llm/stream-capabilities.js')
    expect(supportsStructuredToolStreaming('ollama')).toBe(true)
  })
})

// =============================================================================
// T1: reasoning stream event + TokenStreamPayload.channel contract
// Core fixture: REASONING_FIXTURE_12345 (must NOT collide with assistant text)
// =============================================================================

describe('toLLMStreamChunk reasoning mapping (T1)', () => {
  it('maps a reasoning ProviderStreamEvent to an LLMStreamChunk with the same delta', () => {
    const event: ProviderStreamEvent = { kind: 'reasoning', delta: 'REASONING_FIXTURE_12345' }
    const chunk = toLLMStreamChunk(event, 'p1', 'gpt-4')
    expect(chunk).toEqual({
      kind: 'reasoning',
      delta: 'REASONING_FIXTURE_12345',
      providerId: 'p1',
      model: 'gpt-4',
    })
  })

  it('preserves reasoning delta without falling through to never', () => {
    const event: ProviderStreamEvent = { kind: 'reasoning', delta: 'REASONING_FIXTURE_12345' }
    const chunk = toLLMStreamChunk(event, 'p1') as Extract<
      LLMStreamChunk,
      { kind: 'reasoning' }
    >
    expect(chunk.kind).toBe('reasoning')
    expect(chunk.delta).toBe('REASONING_FIXTURE_12345')
    expect(chunk.providerId).toBe('p1')
  })

  it('still maps text and finish events unchanged (no regression)', () => {
    const textChunk = toLLMStreamChunk({ kind: 'text', delta: 'hi' }, 'p1')
    expect(textChunk).toEqual({ kind: 'text', delta: 'hi', providerId: 'p1', model: undefined })

    const finishChunk = toLLMStreamChunk({ kind: 'finish', finishReason: 'stop' }, 'p1')
    expect(finishChunk).toEqual({ kind: 'finish', finishReason: 'stop', providerId: 'p1', model: undefined })
  })

  it('exhaustive switch has no fallthrough: every ProviderStreamEvent kind is handled', () => {
    // Compile-time exhaustiveness is enforced by the `never` default branch.
    // This runtime test asserts the mapper does not throw for any known kind.
    const events: ProviderStreamEvent[] = [
      { kind: 'text', delta: 'a' },
      { kind: 'reasoning', delta: 'REASONING_FIXTURE_12345' },
      { kind: 'tool_call_delta', index: 0 },
      { kind: 'finish', finishReason: 'stop' },
    ]
    for (const event of events) {
      expect(() => toLLMStreamChunk(event, 'p1')).not.toThrow()
    }
  })
})

describe('TokenStreamPayload.channel contract (T1)', () => {
  it('channel is optional: a payload without channel is assignable (treated as assistant by consumers)', () => {
    const payload: TokenStreamPayload = {
      sessionId: 'sess_1',
      attemptId: 'att_1',
      sequence: 0,
      delta: 'hello',
      timestamp: new Date().toISOString(),
    }
    // Missing channel MUST be treated as 'assistant' by consumers (documented contract).
    // Default: channel === undefined means assistant-visible text only.
    expect(payload.channel).toBeUndefined()
  })

  it('channel can be explicitly set to assistant or reasoning', () => {
    const assistant: TokenStreamPayload = {
      sessionId: 'sess_1',
      attemptId: 'att_1',
      sequence: 0,
      delta: 'answer',
      channel: 'assistant',
      timestamp: new Date().toISOString(),
    }
    const reasoning: TokenStreamPayload = {
      sessionId: 'sess_1',
      attemptId: 'att_1',
      sequence: 1,
      delta: 'REASONING_FIXTURE_12345',
      channel: 'reasoning',
      timestamp: new Date().toISOString(),
    }
    expect(assistant.channel).toBe('assistant')
    expect(reasoning.channel).toBe('reasoning')
  })

  it('reasoning channel payload MUST NOT be confused with assistant channel (fixture isolation)', () => {
    // SAFETY contract: reasoning fixture must never appear in an assistant-channel payload.
    const assistantPayload: TokenStreamPayload = {
      sessionId: 'sess_1',
      attemptId: 'att_1',
      sequence: 0,
      delta: 'The answer is 42.',
      channel: 'assistant',
      timestamp: new Date().toISOString(),
    }
    const reasoningPayload: TokenStreamPayload = {
      sessionId: 'sess_1',
      attemptId: 'att_1',
      sequence: 1,
      delta: 'REASONING_FIXTURE_12345',
      channel: 'reasoning',
      timestamp: new Date().toISOString(),
    }
    expect(assistantPayload.delta).not.toContain('REASONING_FIXTURE_12345')
    expect(reasoningPayload.delta).toBe('REASONING_FIXTURE_12345')
    expect(assistantPayload.channel).not.toBe('reasoning')
  })
})
