import { describe, it, expect } from 'vitest'
import { createLLMAdapter, createCircuitBreaker } from '../../../src/llm'
import type { LLMProvider, LLMRequest, LLMResponse, LLMResult, ProviderConfig, ProviderCapabilities } from '../../../src/llm'
import type { RuntimeError } from '../../../src/shared/errors'
import { parseOpenAIStreamLine } from '../../../src/llm/transform/openai-chat-transformer'
import { parseOllamaStreamLine } from '../../../src/llm/transform/ollama-transformer'
import { buildOllamaChatRequestBody } from '../../../src/llm/transform/ollama-transformer'
import { buildOpenAIChatRequestBody } from '../../../src/llm/transform/openai-chat-transformer'

class StreamingFakeProvider implements LLMProvider {
  readonly id: string
  config: ProviderConfig
  circuitBreaker = createCircuitBreaker()
  private readonly streamDeltas: string[]
  private completeResponse: LLMResponse | null
  private completeError: RuntimeError | null
  readonly stream?: (request: LLMRequest) => AsyncGenerator<string>

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
      this.stream = async function* (_request: LLMRequest): AsyncGenerator<string> {
        for (const delta of deltas) {
          yield delta
        }
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
    it('extracts delta content from valid SSE data lines', () => {
      const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
      expect(parseOpenAIStreamLine(line)).toBe('Hello')
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
  })

  describe('parseOllamaStreamLine', () => {
    it('extracts message content from valid NDJSON lines', () => {
      const line = '{"message":{"content":"Hello"},"done":false}'
      expect(parseOllamaStreamLine(line)).toBe('Hello')
    })

    it('returns null for empty lines', () => {
      expect(parseOllamaStreamLine('')).toBeNull()
      expect(parseOllamaStreamLine('   ')).toBeNull()
    })

    it('returns null for done=true final chunks with no content', () => {
      const line = '{"message":{},"done":true}'
      expect(parseOllamaStreamLine(line)).toBeNull()
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
        chunks.push(chunk.delta)
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
        chunks.push(chunk.delta)
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
        chunks.push(chunk.delta)
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
        chunks.push(chunk.delta)
      }

      expect(chunks).toEqual([])
    })
  })
})