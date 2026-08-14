import type { LLMRequest, LLMResponse, LLMResult, ProviderConfig } from './types'
import { applyReasoningDepthToBody } from './reasoning-depth.js'
import { mapOpenAIChatResponse } from './transform/openai-chat-transformer.js'
import { createErrorFromResponse } from './transform/provider-errors.js'
import type { LLMProvider, ProviderStats, ProviderHealthStatus } from './provider'
import type { CircuitBreaker, CircuitBreakerConfig } from './circuit-breaker'
import { createCircuitBreaker } from './circuit-breaker'
import type { RuntimeError, ErrorSource } from '../shared/errors'

interface ExtendedProviderConfig extends ProviderConfig {
  apiKey?: string
  baseUrl?: string
  enableLogging?: boolean
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
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

function buildRequestBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name && { name: m.name }),
      ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      ...(m.toolCalls &&
        m.toolCalls.length > 0 && {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        }),
    })),
  }

  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  if (request.topP !== undefined) body.top_p = request.topP
  if (request.frequencyPenalty !== undefined) body.frequency_penalty = request.frequencyPenalty
  if (request.presencePenalty !== undefined) body.presence_penalty = request.presencePenalty
  if (request.stopSequences !== undefined) body.stop = request.stopSequences
  if (request.tools !== undefined) {
    body.tools = request.tools.map((t) => ({
      type: t.type,
      function: t.function,
    }))
  }
  if (request.toolChoice !== undefined) {
    if (typeof request.toolChoice === 'string') {
      body.tool_choice = request.toolChoice
    } else {
      body.tool_choice = {
        type: 'function',
        function: { name: request.toolChoice.function.name },
      }
    }
  }
  if (request.responseFormat !== undefined) {
    body.response_format = { type: request.responseFormat.type }
  }

  return applyReasoningDepthToBody('openai', body, request.reasoningDepth)
}

class BaseProvider implements LLMProvider {
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

  get health(): ProviderHealthStatus {
    return this._health
  }

  get stats(): ProviderStats {
    return { ...this._stats }
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
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1'
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }

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
