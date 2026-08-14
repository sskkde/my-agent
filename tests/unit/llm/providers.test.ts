import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LLMRequest, ProviderConfig, ProviderCapabilities } from '../../../src/llm'
import { OpenAIAdapter, OpenRouterAdapter, OllamaAdapter } from '../../../src/llm/providers'

function createTestProviderConfig(
  id: string,
  priority: number = 1,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['gpt-4'],
  }
  return {
    id,
    name: `${id} Provider`,
    enabled: true,
    priority,
    timeoutMs: 5000,
    retries: 2,
    capabilities,
    ...overrides,
  }
}

function createTestRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function requestHeaders(fetchMock: unknown, callIndex: number = 0): Record<string, string> {
  const mocked = fetchMock as {
    mock: { calls: Array<[unknown, RequestInit | undefined]> }
  }
  const init = mocked.mock.calls[callIndex]?.[1]
  const headers = init?.headers
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    throw new Error('Expected fetch to be called with plain object headers')
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, typeof value === 'string' ? value : value.join(', ')]),
  )
}

function createStalledStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
      signal.addEventListener(
        'abort',
        () => {
          controller.error(new DOMException('The operation was aborted', 'AbortError'))
        },
        { once: true },
      )
    },
    pull() {
      return new Promise<void>(() => {})
    },
  })
}

function createOkResponse(): unknown {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => ({
      id: 'resp_1',
      model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  }
}

describe('stream idle watchdog', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('aborts a stalled stream after the idle interval with a timeout-classified error', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai', 1, { timeoutMs: 2000, streamIdleTimeoutMs: 100 }),
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    })

    global.fetch = vi.fn().mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) {
        throw new Error('Expected fetch to receive an abort signal')
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: createStalledStream(signal),
      } as unknown as Response)
    })

    await expect(
      (async () => {
        for await (const _event of adapter.stream(createTestRequest())) {
          // consume
        }
      })(),
    ).rejects.toMatchObject({
      category: 'timeout',
      code: 'PROVIDER_TIMEOUT',
      recoverability: 'retryable_later',
    })
  })

  it('does not abort a stream that keeps delivering chunks within the idle interval', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai', 1, { timeoutMs: 3000, streamIdleTimeoutMs: 250 }),
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
    })

    global.fetch = vi.fn().mockImplementation(async () => {
      const encoder = new TextEncoder()
      let tick = 0
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const push = (): void => {
            tick++
            if (tick > 5) {
              controller.close()
              return
            }
            if (tick === 5) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
            } else {
              const payload = { choices: [{ delta: { content: `c${tick}` } }] }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
            }
            setTimeout(push, 20)
          }
          push()
        },
      })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: stream,
      } as unknown as Response
    })

    const chunks: string[] = []
    for await (const event of adapter.stream(createTestRequest())) {
      if (event.kind === 'text') chunks.push(event.delta)
    }
    expect(chunks).toEqual(['c1', 'c2', 'c3', 'c4'])
  })
})

describe('outbound attribution headers', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it.each([
    [
      'OpenAI',
      () =>
        new OpenAIAdapter({ ...createTestProviderConfig('openai'), apiKey: 'k', baseUrl: 'https://api.openai.com/v1' }),
    ],
    [
      'OpenRouter',
      () =>
        new OpenRouterAdapter({
          ...createTestProviderConfig('openrouter'),
          apiKey: 'k',
          baseUrl: 'https://openrouter.ai/api/v1',
        }),
    ],
    [
      'Ollama',
      () =>
        new OllamaAdapter({ ...createTestProviderConfig('ollama'), apiKey: 'k', baseUrl: 'http://localhost:11434' }),
    ],
  ])('sends an x-request-id header on %s complete requests', async (_name, createAdapter) => {
    const adapter = createAdapter()
    const fetchMock = vi.fn().mockResolvedValue(createOkResponse() as unknown as Response)
    global.fetch = fetchMock

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(true)

    expect(requestHeaders(fetchMock)['x-request-id']).toMatch(UUID_RE)
  })

  it('uses a fresh x-request-id per request', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai'),
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
    })
    const fetchMock = vi.fn().mockResolvedValue(createOkResponse() as unknown as Response)
    global.fetch = fetchMock

    await adapter.complete(createTestRequest())
    await adapter.complete(createTestRequest())

    const first = requestHeaders(fetchMock, 0)['x-request-id']
    const second = requestHeaders(fetchMock, 1)['x-request-id']
    expect(first).toMatch(UUID_RE)
    expect(second).toMatch(UUID_RE)
    expect(second).not.toBe(first)
  })

  it('sends an x-request-id header on stream requests', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai'),
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
    })
    const encoder = new TextEncoder()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
          controller.close()
        },
      }),
    } as unknown as Response)
    global.fetch = fetchMock

    const chunks: string[] = []
    for await (const event of adapter.stream(createTestRequest())) {
      if (event.kind === 'text') chunks.push(event.delta)
    }
    expect(chunks).toEqual(['hi'])
    expect(requestHeaders(fetchMock)['x-request-id']).toMatch(UUID_RE)
  })
})

describe('provider request id on errors', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function createErrorAdapter(): OpenAIAdapter {
    return new OpenAIAdapter({
      ...createTestProviderConfig('openai'),
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
    })
  }

  it('attaches x-request-id to non-2xx complete errors', async () => {
    const adapter = createErrorAdapter()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'x-request-id': 'req-abc-123' }),
      json: async () => ({}),
    } as unknown as Response)

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('RATE_LIMIT_ERROR')
      expect(result.error.technical).toMatchObject({ requestId: 'req-abc-123' })
    }
  })

  it('falls back to x-deepseek-request-id when x-request-id is absent', async () => {
    const adapter = createErrorAdapter()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'x-deepseek-request-id': 'deepseek-req-7' }),
      json: async () => ({}),
    } as unknown as Response)

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PROVIDER_ERROR')
      expect(result.error.technical).toMatchObject({ requestId: 'deepseek-req-7' })
    }
  })

  it('leaves technical payload unchanged when no request id header is present', async () => {
    const adapter = createErrorAdapter()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: async () => ({}),
    } as unknown as Response)

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PROVIDER_ERROR')
      expect(result.error.technical).toBeUndefined()
    }
  })

  it('attaches x-request-id to non-2xx stream errors', async () => {
    const adapter = createErrorAdapter()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'x-request-id': 'req-stream-9' }),
    } as unknown as Response)

    await expect(
      (async () => {
        for await (const _event of adapter.stream(createTestRequest())) {
          // consume
        }
      })(),
    ).rejects.toMatchObject({
      code: 'STREAM_ERROR',
      technical: { requestId: 'req-stream-9' },
    })
  })
})
