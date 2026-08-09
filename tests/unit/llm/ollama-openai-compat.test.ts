import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMRequest, ProviderStreamEvent } from '../../../src/llm/types.js'
import { OllamaAdapter } from '../../../src/llm/providers.js'

interface CapturedCall {
  url: string
  init: RequestInit
}

function createMockFetch(response: object, status = 200, captures: CapturedCall[]): typeof fetch {
  return vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    captures.push({ url: String(url), init: init ?? {} })
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as Response
  })
}

function createStreamMockFetch(chunks: string[], captures: CapturedCall[]): typeof fetch {
  const encoder = new TextEncoder()
  return vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    captures.push({ url: String(url), init: init ?? {} })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: stream,
      json: async () => ({}),
      text: async () => '',
    } as Response
  })
}

describe('OllamaAdapter OpenAI-compatible path', () => {
  const originalFetch = global.fetch
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('complete()', () => {
    it('POSTs to {base}/v1/chat/completions (NOT /api/chat)', async () => {
      const captures: CapturedCall[] = []
      global.fetch = createMockFetch(
        {
          id: 'chatcmpl-1',
          model: 'llama3',
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
        200,
        captures,
      )

      const adapter = new OllamaAdapter({
        id: 'ollama-test',
        name: 'Ollama Test',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'http://localhost:11434',
      })

      const request: LLMRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello' }],
      }

      const result = await adapter.complete(request)

      expect(result.success).toBe(true)
      expect(captures).toHaveLength(1)
      expect(captures[0].url).toBe('http://localhost:11434/v1/chat/completions')
      expect(captures[0].url).not.toContain('/api/chat')
    })

    it('includes a tools field in the request body when the LLMRequest has tools', async () => {
      const captures: CapturedCall[] = []
      global.fetch = createMockFetch(
        {
          id: 'chatcmpl-2',
          model: 'llama3',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
        200,
        captures,
      )

      const adapter = new OllamaAdapter({
        id: 'ollama-tools',
        name: 'Ollama Tools',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'http://localhost:11434',
      })

      const request: LLMRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }

      const result = await adapter.complete(request)

      expect(result.success).toBe(true)
      expect(captures).toHaveLength(1)
      const body = JSON.parse(String(captures[0].init.body)) as Record<string, unknown>
      expect(body).toHaveProperty('tools')
      expect(Array.isArray(body.tools)).toBe(true)
      expect((body.tools as Array<{ function: { name: string } }>)[0].function.name).toBe('get_weather')
    })

    it('always sends an Authorization: Bearer header (placeholder for local)', async () => {
      const captures: CapturedCall[] = []
      global.fetch = createMockFetch(
        {
          id: 'chatcmpl-3',
          model: 'llama3',
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        },
        200,
        captures,
      )

      const adapter = new OllamaAdapter({
        id: 'ollama-no-key',
        name: 'Ollama No Key',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'http://localhost:11434',
      })

      await adapter.complete({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })

      const headers = captures[0].init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer ollama')
    })

    it('uses the configured apiKey for the Authorization header when provided', async () => {
      const captures: CapturedCall[] = []
      global.fetch = createMockFetch(
        {
          id: 'chatcmpl-4',
          model: 'llama3',
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        },
        200,
        captures,
      )

      const adapter = new OllamaAdapter({
        id: 'ollama-cloud',
        name: 'Ollama Cloud',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'https://ollama.com',
        apiKey: 'sk-real-cloud-key',
      })

      await adapter.complete({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })

      const headers = captures[0].init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-real-cloud-key')
      expect(captures[0].url).toBe('https://ollama.com/v1/chat/completions')
    })

    it('normalizes a base URL that already ends with /v1 without doubling it', async () => {
      const captures: CapturedCall[] = []
      global.fetch = createMockFetch(
        {
          id: 'chatcmpl-5',
          model: 'llama3',
          choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        },
        200,
        captures,
      )

      const adapter = new OllamaAdapter({
        id: 'ollama-v1',
        name: 'Ollama v1',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'http://localhost:11434/v1',
      })

      await adapter.complete({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })

      expect(captures[0].url).toBe('http://localhost:11434/v1/chat/completions')
    })
  })

  describe('stream()', () => {
    it('POSTs to {base}/v1/chat/completions and parses OpenAI SSE tool_call deltas', async () => {
      const captures: CapturedCall[] = []
      const ssePayload = JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'get_weather', arguments: '{"city":"SF"}' },
                },
              ],
            },
          },
        ],
      })
      global.fetch = createStreamMockFetch([`data: ${ssePayload}\n`, 'data: [DONE]\n'], captures)

      const adapter = new OllamaAdapter({
        id: 'ollama-stream',
        name: 'Ollama Stream',
        enabled: true,
        priority: 1,
        timeoutMs: 5000,
        retries: 0,
        capabilities: {
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsJsonMode: true,
          supportsVision: false,
          maxTokens: 4096,
          supportedModels: ['llama3'],
        },
        baseUrl: 'http://localhost:11434',
      })

      const request: LLMRequest = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }

      const events: ProviderStreamEvent[] = []
      for await (const event of adapter.stream(request)) {
        events.push(event)
      }

      expect(captures[0].url).toBe('http://localhost:11434/v1/chat/completions')
      const body = JSON.parse(String(captures[0].init.body)) as Record<string, unknown>
      expect(body).toHaveProperty('tools')
      expect(body.stream).toBe(true)
      const toolCallEvent = events.find((e) => e.kind === 'tool_call_delta')
      expect(toolCallEvent).toBeDefined()
    })
  })
})
