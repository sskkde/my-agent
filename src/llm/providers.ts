import type { LLMRequest, LLMResponse, LLMResult, ProviderConfig } from './types'
import type { LLMProvider, ProviderStats, ProviderHealthStatus } from './provider'
import type { CircuitBreaker, CircuitBreakerConfig } from './circuit-breaker'
import { createCircuitBreaker } from './circuit-breaker'
import type { RuntimeError, ErrorSource } from '../shared/errors'
import {
  buildOpenAIChatRequestBody,
  mapOpenAIChatResponse,
  buildOpenAICompatibleHeaders,
  safeMergeHeaders,
} from './transform/openai-chat-transformer.js'
import { buildOllamaChatRequestBody, mapOllamaChatResponse } from './transform/ollama-transformer.js'
import { createErrorFromResponse } from './transform/provider-errors.js'
import { normalizeDomesticProviderRequest } from './transform/domestic-provider-compat.js'
import { isDomesticProvider } from './catalog/domestic-providers.js'

interface ExtendedProviderConfig extends ProviderConfig {
  apiKey?: string
  baseUrl?: string
  enableLogging?: boolean
  siteUrl?: string
  appName?: string
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
  headers?: Record<string, string>
  providerType?: string
}

interface LLMAdapterConfig {
  providers?: ExtendedProviderConfig[]
  defaultTimeoutMs: number
  enableCircuitBreaker: boolean
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
  enableLogging?: boolean
}

function redactApiKey(key: string | undefined): string {
  if (!key) return '***'
  if (key.length <= 8) return '***'
  return key.slice(0, 3) + '***' + key.slice(-3)
}

function logRequest(url: string, headers: Record<string, string>, enableLogging: boolean): void {
  if (!enableLogging) return
  const redactedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      const match = value.match(/Bearer\s+(.+)/)
      if (match) {
        redactedHeaders[key] = `Bearer ${redactApiKey(match[1])}`
      } else {
        redactedHeaders[key] = value
      }
    } else {
      redactedHeaders[key] = value
    }
  }
  console.log(`[LLM] Request to ${url}`)
  console.log(`[LLM] Headers: ${JSON.stringify(redactedHeaders)}`)
}

function logResponse(providerId: string, success: boolean, latencyMs: number, enableLogging: boolean): void {
  if (!enableLogging) return
  const status = success ? 'SUCCESS' : 'FAILED'
  console.log(`[LLM] ${providerId}: ${status} in ${latencyMs}ms`)
}

function mapOpenAIResponse(data: Record<string, unknown>): LLMResponse {
  return mapOpenAIChatResponse(data)
}

function mapOllamaResponse(data: Record<string, unknown>): LLMResponse {
  return mapOllamaChatResponse(data)
}

function buildRequestBody(request: LLMRequest): Record<string, unknown> {
  return buildOpenAIChatRequestBody(request)
}

export class BaseProvider implements LLMProvider {
  readonly id: string
  config: ExtendedProviderConfig
  circuitBreaker: CircuitBreaker
  private _health: ProviderHealthStatus = 'healthy'
  private _stats: ProviderStats

  constructor(config: ExtendedProviderConfig) {
    this.id = config.id
    this.config = config
    this.circuitBreaker = createCircuitBreaker(config.circuitBreakerConfig)
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy',
    }
  }

  get stats(): ProviderStats {
    return { ...this._stats }
  }

  get health(): ProviderHealthStatus {
    return this._health
  }

  isHealthy(): boolean {
    return this._health !== 'unhealthy' && this.circuitBreaker.canExecute()
  }

  getStats(): ProviderStats {
    return this.stats
  }

  updateConfig(config: Partial<ExtendedProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  resetStats(): void {
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: this._health,
    }
  }

  protected updateStats(success: boolean, latencyMs: number, timeout = false): void {
    this._stats.totalRequests++
    if (success) {
      this._stats.successfulRequests++
      this.circuitBreaker.recordSuccess()
    } else {
      this._stats.failedRequests++
      if (timeout) {
        this._stats.timeoutRequests++
      }
    }
    const totalLatency = this._stats.averageLatencyMs * (this._stats.totalRequests - 1) + latencyMs
    this._stats.averageLatencyMs = totalLatency / this._stats.totalRequests
    this._stats.lastRequestTime = Date.now()
  }

  protected recordError(error: RuntimeError): void {
    this._stats.lastError = error.message
    this._stats.lastErrorTime = Date.now()
    this.circuitBreaker.recordFailure(error)
  }

  protected createTimeoutError(source: ErrorSource): RuntimeError {
    return {
      errorId: `err_timeout_${this.id}_${Date.now()}`,
      category: 'timeout',
      code: 'PROVIDER_TIMEOUT',
      message: `Provider ${this.id} timed out after ${this.config.timeoutMs}ms`,
      recoverability: 'retryable_later',
      source,
      technical: { retryAfterMs: Math.min(this.config.timeoutMs * 2, 60000) },
      createdAt: new Date().toISOString(),
    }
  }

  protected createUnavailableError(source: ErrorSource): RuntimeError {
    return {
      errorId: `err_unavailable_${this.id}_${Date.now()}`,
      category: 'model_error',
      code: 'PROVIDER_UNAVAILABLE',
      message: `Provider ${this.id} is unavailable`,
      recoverability: 'retryable_later',
      source,
      createdAt: new Date().toISOString(),
    }
  }

  protected createCircuitBreakerError(source: ErrorSource): RuntimeError {
    return {
      errorId: `err_circuit_${this.id}_${Date.now()}`,
      category: 'model_error',
      code: 'CIRCUIT_BREAKER_OPEN',
      message: `Circuit breaker is open for provider ${this.id}`,
      recoverability: 'retryable_later',
      source,
      createdAt: new Date().toISOString(),
    }
  }

  async complete(_request: LLMRequest): Promise<LLMResult> {
    throw new Error('Not implemented')
  }
}

export class OpenAIAdapter extends BaseProvider {
  private baseUrl: string
  private apiKey: string

  constructor(config: ExtendedProviderConfig) {
    super(config)
    // Normalize base URL by trimming trailing slashes to avoid /v1//chat/completions
    const rawBaseUrl = config.baseUrl || 'https://api.openai.com/v1'
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || ''
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const source: ErrorSource = { module: 'openai_adapter', runId: request.model }

    if (!this.circuitBreaker.canExecute()) {
      const error = this.createCircuitBreakerError(source)
      return { success: false, error, providerId: this.id }
    }

    const startTime = Date.now()
    const url = `${this.baseUrl}/chat/completions`
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
    const headers = safeMergeHeaders(baseHeaders, this.config.headers)

    logRequest(url, headers, this.config.enableLogging || false)

    let body = buildRequestBody(request)
    if (this.config.providerType && isDomesticProvider(this.config.providerType)) {
      body = normalizeDomesticProviderRequest(this.config.providerType, body)
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        const error = createErrorFromResponse(response.status, response.statusText, this.id, source)
        this.recordError(error)
        this.updateStats(false, latencyMs)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error, providerId: this.id }
      }

      const data = (await response.json()) as Record<string, unknown>
      const mappedResponse = mapOpenAIResponse(data)

      this.updateStats(true, latencyMs)
      logResponse(this.id, true, latencyMs, this.config.enableLogging || false)

      return { success: true, response: mappedResponse, providerId: this.id }
    } catch (error) {
      const latencyMs = Date.now() - startTime

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = this.createTimeoutError(source)
        this.recordError(timeoutError)
        this.updateStats(false, latencyMs, true)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error: timeoutError, providerId: this.id }
      }

      const connectionError: RuntimeError = {
        errorId: `err_connection_${this.id}_${Date.now()}`,
        category: 'model_error',
        code: 'CONNECTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        recoverability: 'retryable_later',
        source,
        createdAt: new Date().toISOString(),
      }

      this.recordError(connectionError)
      this.updateStats(false, latencyMs)
      logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
      return { success: false, error: connectionError, providerId: this.id }
    }
  }
}

export class OpenRouterAdapter extends BaseProvider {
  private baseUrl: string
  private apiKey: string
  private siteUrl?: string
  private appName?: string

  constructor(config: ExtendedProviderConfig) {
    super(config)
    // Normalize base URL by trimming trailing slashes to avoid /v1//chat/completions
    const rawBaseUrl = config.baseUrl || 'https://openrouter.ai/api/v1'
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || ''
    this.siteUrl = config.siteUrl
    this.appName = config.appName
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const source: ErrorSource = { module: 'openrouter_adapter', runId: request.model }

    if (!this.circuitBreaker.canExecute()) {
      const error = this.createCircuitBreakerError(source)
      return { success: false, error, providerId: this.id }
    }

    const startTime = Date.now()
    const url = `${this.baseUrl}/chat/completions`
    const headers = buildOpenAICompatibleHeaders({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      siteUrl: this.siteUrl,
      appName: this.appName,
      extraHeaders: this.config.headers,
    })

    logRequest(url, headers, this.config.enableLogging || false)

    const body = buildRequestBody(request)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        const error = createErrorFromResponse(response.status, response.statusText, this.id, source)
        this.recordError(error)
        this.updateStats(false, latencyMs)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error, providerId: this.id }
      }

      const data = (await response.json()) as Record<string, unknown>
      const mappedResponse = mapOpenAIResponse(data)

      this.updateStats(true, latencyMs)
      logResponse(this.id, true, latencyMs, this.config.enableLogging || false)

      return { success: true, response: mappedResponse, providerId: this.id }
    } catch (error) {
      const latencyMs = Date.now() - startTime

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = this.createTimeoutError(source)
        this.recordError(timeoutError)
        this.updateStats(false, latencyMs, true)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error: timeoutError, providerId: this.id }
      }

      const connectionError: RuntimeError = {
        errorId: `err_connection_${this.id}_${Date.now()}`,
        category: 'model_error',
        code: 'CONNECTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        recoverability: 'retryable_later',
        source,
        createdAt: new Date().toISOString(),
      }

      this.recordError(connectionError)
      this.updateStats(false, latencyMs)
      logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
      return { success: false, error: connectionError, providerId: this.id }
    }
  }
}

export class OllamaAdapter extends BaseProvider {
  private baseUrl: string

  constructor(config: ExtendedProviderConfig) {
    super(config)
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const source: ErrorSource = { module: 'ollama_adapter', runId: request.model }

    if (!this.circuitBreaker.canExecute()) {
      const error = this.createCircuitBreakerError(source)
      return { success: false, error, providerId: this.id }
    }

    const startTime = Date.now()
    const url = `${this.baseUrl}/api/chat`
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const headers = safeMergeHeaders(baseHeaders, this.config.headers)

    logRequest(url, headers, this.config.enableLogging || false)

    const body = buildOllamaChatRequestBody(request)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - startTime

      if (!response.ok) {
        const error = createErrorFromResponse(response.status, response.statusText, this.id, source)
        this.recordError(error)
        this.updateStats(false, latencyMs)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error, providerId: this.id }
      }

      const data = (await response.json()) as Record<string, unknown>
      const mappedResponse = mapOllamaResponse(data)

      this.updateStats(true, latencyMs)
      logResponse(this.id, true, latencyMs, this.config.enableLogging || false)

      return { success: true, response: mappedResponse, providerId: this.id }
    } catch (error) {
      const latencyMs = Date.now() - startTime

      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = this.createTimeoutError(source)
        this.recordError(timeoutError)
        this.updateStats(false, latencyMs, true)
        logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
        return { success: false, error: timeoutError, providerId: this.id }
      }

      const connectionError: RuntimeError = {
        errorId: `err_connection_${this.id}_${Date.now()}`,
        category: 'model_error',
        code: 'PROVIDER_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Unknown error',
        recoverability: 'retryable_later',
        source,
        createdAt: new Date().toISOString(),
      }

      this.recordError(connectionError)
      this.updateStats(false, latencyMs)
      logResponse(this.id, false, latencyMs, this.config.enableLogging || false)
      return { success: false, error: connectionError, providerId: this.id }
    }
  }
}

export class MultiProviderLLMAdapter {
  private providers: BaseProvider[] = []
  config: LLMAdapterConfig

  constructor(config: LLMAdapterConfig) {
    this.config = config
    if (config.providers) {
      for (const providerConfig of config.providers) {
        if (providerConfig.name.toLowerCase().includes('openrouter')) {
          this.addProvider(new OpenRouterAdapter(providerConfig))
        } else if (providerConfig.name.toLowerCase().includes('ollama')) {
          this.addProvider(new OllamaAdapter(providerConfig))
        } else {
          this.addProvider(new OpenAIAdapter(providerConfig))
        }
      }
    }
  }

  addProvider(provider: BaseProvider): void {
    this.providers.push(provider)
    this.providers.sort((a, b) => a.config.priority - b.config.priority)
  }

  removeProvider(providerId: string): void {
    const index = this.providers.findIndex((p) => p.id === providerId)
    if (index !== -1) {
      this.providers.splice(index, 1)
    }
  }

  getProvider(providerId: string): BaseProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }

  getHealthyProviders(): BaseProvider[] {
    return this.providers.filter((p) => p.isHealthy()).sort((a, b) => a.config.priority - b.config.priority)
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const source: ErrorSource = { module: 'multi_provider_adapter', runId: request.model }
    const sortedProviders = [...this.providers].sort((a, b) => a.config.priority - b.config.priority)

    if (sortedProviders.length === 0) {
      const error: RuntimeError = {
        errorId: `err_all_providers_failed_${Date.now()}`,
        category: 'model_error',
        code: 'ALL_PROVIDERS_FAILED',
        message: 'All providers failed after 0 attempts',
        recoverability: 'retryable_later',
        source,
        attempts: [],
        createdAt: new Date().toISOString(),
      }
      return { success: false, error, providerId: 'none' }
    }

    const attempts: Array<{ providerId: string; error: RuntimeError }> = []

    for (const provider of sortedProviders) {
      const result = await provider.complete(request)

      if (result.success) {
        return result
      } else {
        attempts.push({ providerId: provider.id, error: result.error })
      }
    }

    const allFailedError: RuntimeError = {
      errorId: `err_all_providers_failed_${Date.now()}`,
      category: 'model_error',
      code: 'ALL_PROVIDERS_FAILED',
      message: `All providers failed after ${attempts.length} attempts`,
      recoverability: 'retryable_later',
      source,
      attempts,
      createdAt: new Date().toISOString(),
    }

    return { success: false, error: allFailedError, providerId: 'none' }
  }
}
