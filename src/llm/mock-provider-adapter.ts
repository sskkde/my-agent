import type { LLMRequest, LLMResult } from './types.js'
import type { ProviderConfig } from './types.js'
import type { LLMProvider, ProviderStats, ProviderHealthStatus } from './provider.js'
import type { CircuitBreaker } from './circuit-breaker.js'
import { createCircuitBreaker } from './circuit-breaker.js'
import { getMockProviderRegistry, buildMockLLMResult } from './mock-provider-registry.js'

interface MockProviderConfig extends ProviderConfig {
  apiKey?: string
  baseUrl?: string
}

export class MockProvider implements LLMProvider {
  readonly id: string
  config: MockProviderConfig
  circuitBreaker: CircuitBreaker
  private _health: ProviderHealthStatus = 'healthy'
  private _stats: ProviderStats

  constructor(config: MockProviderConfig) {
    this.id = config.id
    this.config = config
    this.circuitBreaker = createCircuitBreaker()
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

  updateConfig(config: Partial<MockProviderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  resetStats(): void {
    this._stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy',
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const startTime = Date.now()
    this._stats.totalRequests++

    const registry = getMockProviderRegistry()
    const responseConfig = registry.getNextResponse(request)

    if (responseConfig.delayMs && responseConfig.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseConfig.delayMs))
    }

    const durationMs = Date.now() - startTime
    registry.recordInteraction(request, responseConfig, durationMs)

    const result = buildMockLLMResult(responseConfig, request.model, this.id)

    this._stats.successfulRequests++
    this._stats.lastRequestTime = Date.now()
    this._stats.averageLatencyMs =
      (this._stats.averageLatencyMs * (this._stats.totalRequests - 1) + durationMs) /
      this._stats.totalRequests

    return result
  }

  async *stream(request: LLMRequest): AsyncGenerator<string> {
    const startTime = Date.now()
    this._stats.totalRequests++

    const registry = getMockProviderRegistry()
    const peeked = registry.peekNextResponse(request)

    if (!peeked.content || peeked.content.length === 0) {
      return
    }

    const responseConfig = registry.consumeNextResponse(request)

    if (responseConfig.delayMs && responseConfig.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseConfig.delayMs))
    }

    const content = responseConfig.content
    const tokens = content.split(/(\s+)/)

    for (const token of tokens) {
      if (token.length > 0) {
        yield token
      }
    }

    const durationMs = Date.now() - startTime
    registry.recordInteraction(request, responseConfig, durationMs)

    this._stats.successfulRequests++
    this._stats.lastRequestTime = Date.now()
    this._stats.averageLatencyMs =
      (this._stats.averageLatencyMs * (this._stats.totalRequests - 1) + durationMs) /
      this._stats.totalRequests
  }
}
