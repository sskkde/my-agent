import { describe, it, expect, afterEach, vi } from 'vitest'
import { createErrorFromResponse } from '../../../src/llm/transform/provider-errors.js'
import { createLLMAdapter, createCircuitBreaker } from '../../../src/llm'
import { OpenAIAdapter } from '../../../src/llm/providers.js'
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMResult,
  ProviderConfig,
  ProviderCapabilities,
  ProviderStreamEvent,
} from '../../../src/llm'
import type { RuntimeError } from '../../../src/shared/errors'

const SOURCE = { module: 'test' }

function createTestProviderConfig(id: string, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
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
    priority: 1,
    timeoutMs: 5000,
    retries: 2,
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

function retryableError(code: string, message: string): RuntimeError {
  return {
    errorId: `err_${code}`,
    category: 'model_error',
    code,
    message,
    recoverability: 'retryable_later',
    source: SOURCE,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Provider that returns a scripted sequence of errors before succeeding.
 * Fails with `errors[i]` on the (i+1)-th attempt, then succeeds.
 */
class SequenceLLMProvider implements LLMProvider {
  readonly id: string
  config: ProviderConfig
  circuitBreaker = createCircuitBreaker()
  private readonly errors: RuntimeError[]
  private readonly successResponse: LLMResponse
  private attempts = 0

  constructor(id: string, config: ProviderConfig, errors: RuntimeError[], successResponse: LLMResponse) {
    this.id = id
    this.config = config
    this.errors = errors
    this.successResponse = successResponse
  }

  get health(): 'healthy' | 'degraded' | 'unhealthy' {
    return 'healthy'
  }

  get stats() {
    return {
      totalRequests: this.attempts,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy' as const,
    }
  }

  async complete(_request: LLMRequest): Promise<LLMResult> {
    this.attempts++
    if (this.attempts <= this.errors.length) {
      return { success: false, error: this.errors[this.attempts - 1]!, providerId: this.id }
    }
    return { success: true, response: this.successResponse, providerId: this.id }
  }

  isHealthy(): boolean {
    return true
  }

  getStats() {
    return this.stats
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  resetStats(): void {
    this.attempts = 0
  }

  getAttempts(): number {
    return this.attempts
  }
}

/**
 * Provider whose stream() throws a retryable error for the first `failures`
 * invocations, then yields a text event.
 */
class SequenceStreamProvider implements LLMProvider {
  readonly id: string
  config: ProviderConfig
  circuitBreaker = createCircuitBreaker()
  private readonly failures: number
  private attempts = 0

  constructor(id: string, config: ProviderConfig, failures: number) {
    this.id = id
    this.config = config
    this.failures = failures
  }

  get health(): 'healthy' | 'degraded' | 'unhealthy' {
    return 'healthy'
  }

  get stats() {
    return {
      totalRequests: this.attempts,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy' as const,
    }
  }

  async *stream(_request: LLMRequest): AsyncGenerator<ProviderStreamEvent> {
    this.attempts++
    if (this.attempts <= this.failures) {
      throw retryableError('PROVIDER_ERROR', 'stream unavailable')
    }
    yield { kind: 'text', delta: 'hello' }
  }

  async complete(_request: LLMRequest): Promise<LLMResult> {
    return { success: false, error: retryableError('PROVIDER_ERROR', 'complete not implemented'), providerId: this.id }
  }

  isHealthy(): boolean {
    return true
  }

  getStats() {
    return this.stats
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  resetStats(): void {
    this.attempts = 0
  }

  getAttempts(): number {
    return this.attempts
  }
}

function successResponse(): LLMResponse {
  return {
    id: 'resp_1',
    model: 'gpt-4',
    content: 'ok',
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  }
}

describe('createErrorFromResponse classification', () => {
  it('classifies 401 as non-retryable AUTH_ERROR', () => {
    const error = createErrorFromResponse(401, 'Unauthorized', 'openai', SOURCE)
    expect(error.code).toBe('AUTH_ERROR')
    expect(error.category).toBe('connector_auth_error')
    expect(error.recoverability).toBe('non_recoverable')
  })

  it('classifies 403 as non-retryable AUTH_ERROR', () => {
    const error = createErrorFromResponse(403, 'Forbidden', 'openai', SOURCE)
    expect(error.code).toBe('AUTH_ERROR')
    expect(error.category).toBe('connector_auth_error')
    expect(error.recoverability).toBe('non_recoverable')
  })

  it('classifies 402 as non-retryable QUOTA_ERROR', () => {
    const error = createErrorFromResponse(402, 'Payment Required', 'openai', SOURCE)
    expect(error.code).toBe('QUOTA_ERROR')
    expect(error.category).toBe('model_error')
    expect(error.recoverability).toBe('non_recoverable')
  })

  it.each([
    ['400', 'Insufficient balance on the account'],
    ['400', 'your quota has been exceeded'],
    ['500', 'insufficient_quota'],
    ['500', 'Account balance is insufficient'],
  ])('classifies %s with quota body as non-retryable QUOTA_ERROR', (status, body) => {
    const error = createErrorFromResponse(Number(status), 'Error', 'openai', SOURCE, { errorBody: body })
    expect(error.code).toBe('QUOTA_ERROR')
    expect(error.recoverability).toBe('non_recoverable')
  })

  it('classifies 429 as retryable RATE_LIMIT_ERROR and honors Retry-After', () => {
    const error = createErrorFromResponse(429, 'Too Many Requests', 'openai', SOURCE, { retryAfterMs: 12345 })
    expect(error.code).toBe('RATE_LIMIT_ERROR')
    expect(error.category).toBe('connector_rate_limited')
    expect(error.recoverability).toBe('retryable_later')
    expect(error.technical?.retryAfterMs).toBe(12345)
  })

  it('defaults 429 retry-after to 60000 when no hint is present', () => {
    const error = createErrorFromResponse(429, 'Too Many Requests', 'openai', SOURCE)
    expect(error.technical?.retryAfterMs).toBe(60000)
  })

  it('keeps 5xx retryable as PROVIDER_ERROR', () => {
    const error = createErrorFromResponse(500, 'Internal Server Error', 'openai', SOURCE)
    expect(error.code).toBe('PROVIDER_ERROR')
    expect(error.recoverability).toBe('retryable_later')
  })

  it('keeps other 4xx retryable as REQUEST_ERROR', () => {
    const error = createErrorFromResponse(400, 'Bad Request', 'openai', SOURCE)
    expect(error.code).toBe('REQUEST_ERROR')
    expect(error.recoverability).toBe('retryable_later')
  })
})

describe('Retry-After header passthrough (live provider path)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reads a numeric Retry-After header into technical.retryAfterMs', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai'),
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': '15' }),
    } as unknown as Response)

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('RATE_LIMIT_ERROR')
      expect(result.error.technical?.retryAfterMs).toBe(15000)
    }
  })

  it('reads an HTTP-date Retry-After header into technical.retryAfterMs', async () => {
    const adapter = new OpenAIAdapter({
      ...createTestProviderConfig('openai'),
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
    })
    const retryAt = new Date(Date.now() + 2500).toUTCString()
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': retryAt }),
    } as unknown as Response)

    const result = await adapter.complete(createTestRequest())
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.technical?.retryAfterMs).toBeGreaterThan(0)
      expect(result.error.technical?.retryAfterMs).toBeLessThanOrEqual(3000)
    }
  })
})

describe('per-provider retry wiring', () => {
  it('retries the same provider up to retries times then succeeds', async () => {
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 2 }),
      [retryableError('PROVIDER_ERROR', 'boom 1'), retryableError('PROVIDER_ERROR', 'boom 2')],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const result = await adapter.complete(createTestRequest())

    expect(result.success).toBe(true)
    expect(provider.getAttempts()).toBe(3)
  })

  it('skips the retry loop for non-retryable auth errors', async () => {
    const authError: RuntimeError = {
      errorId: 'err_auth',
      category: 'connector_auth_error',
      code: 'AUTH_ERROR',
      message: 'invalid api key',
      recoverability: 'non_recoverable',
      source: SOURCE,
      createdAt: new Date().toISOString(),
    }
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 2 }),
      [authError],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const result = await adapter.complete(createTestRequest())

    expect(result.success).toBe(false)
    expect(provider.getAttempts()).toBe(1)
    if (!result.success) {
      expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
      expect(result.error.attempts?.[0]?.error.code).toBe('AUTH_ERROR')
    }
  })

  it('skips the retry loop for quota errors', async () => {
    const quotaError: RuntimeError = {
      errorId: 'err_quota',
      category: 'model_error',
      code: 'QUOTA_ERROR',
      message: 'quota exceeded',
      recoverability: 'non_recoverable',
      source: SOURCE,
      createdAt: new Date().toISOString(),
    }
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 2 }),
      [quotaError],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const result = await adapter.complete(createTestRequest())

    expect(result.success).toBe(false)
    expect(provider.getAttempts()).toBe(1)
  })

  it('does not retry through an open circuit breaker', async () => {
    const breakerError: RuntimeError = {
      errorId: 'err_cb',
      category: 'model_error',
      code: 'CIRCUIT_BREAKER_OPEN',
      message: 'Circuit breaker is open',
      recoverability: 'retryable_later',
      source: SOURCE,
      createdAt: new Date().toISOString(),
    }
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 2 }),
      [breakerError],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const result = await adapter.complete(createTestRequest())

    expect(result.success).toBe(false)
    expect(provider.getAttempts()).toBe(1)
  })

  it('stops retrying once retries are exhausted and reports the last error', async () => {
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 1 }),
      [retryableError('PROVIDER_ERROR', 'boom 1'), retryableError('PROVIDER_ERROR', 'boom 2')],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const result = await adapter.complete(createTestRequest())

    expect(result.success).toBe(false)
    expect(provider.getAttempts()).toBe(2)
    if (!result.success) {
      expect(result.error.code).toBe('ALL_PROVIDERS_FAILED')
      expect(result.error.attempts).toHaveLength(1)
      expect(result.error.attempts?.[0]?.error.code).toBe('PROVIDER_ERROR')
    }
  })

  it('waits at least the provider Retry-After hint before retrying a 429', async () => {
    const rateLimited: RuntimeError = {
      errorId: 'err_429',
      category: 'connector_rate_limited',
      code: 'RATE_LIMIT_ERROR',
      message: 'rate limited',
      recoverability: 'retryable_later',
      source: SOURCE,
      technical: { retryAfterMs: 1200 },
      createdAt: new Date().toISOString(),
    }
    const provider = new SequenceLLMProvider(
      'primary',
      createTestProviderConfig('primary', { retries: 1 }),
      [rateLimited],
      successResponse(),
    )

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const startedAt = Date.now()
    const result = await adapter.complete(createTestRequest())
    const elapsedMs = Date.now() - startedAt

    expect(result.success).toBe(true)
    expect(elapsedMs).toBeGreaterThanOrEqual(1000)
  })

  it('retries a stream that fails before yielding, without duplicating content', async () => {
    const provider = new SequenceStreamProvider('primary', createTestProviderConfig('primary', { retries: 1 }), 1)

    const adapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 30000,
      enableCircuitBreaker: true,
    })
    adapter.addProvider(provider)

    const chunks: string[] = []
    for await (const chunk of adapter.stream(createTestRequest())) {
      if (chunk.kind === 'text') chunks.push(chunk.delta)
    }

    expect(provider.getAttempts()).toBe(2)
    expect(chunks).toEqual(['hello'])
  })
})
