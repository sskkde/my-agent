/**
 * Mock LLM Adapter for Testing and Development
 * Provides deterministic responses based on message keywords
 */

import type { LLMAdapter, LLMAdapterConfig } from './adapter.js'
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from './provider.js'
import type { CircuitBreaker, CircuitBreakerState, CircuitBreakerStats } from './circuit-breaker.js'
import type { LLMRequest, LLMResult, LLMResponse, ProviderConfig, ProviderCapabilities, LLMStreamChunk } from './types.js'

/**
 * Mock circuit breaker - always closed, all methods no-ops
 */
function createMockCircuitBreaker(): CircuitBreaker {
  const stats: CircuitBreakerStats = {
    state: 'CLOSED' as CircuitBreakerState,
    failureCount: 0,
    successCount: 0,
    totalRequests: 0,
    rejectedRequests: 0,
  }

  return {
    get state() {
      return 'CLOSED' as CircuitBreakerState
    },
    get config() {
      return {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        successThreshold: 2,
      }
    },
    get stats() {
      return { ...stats }
    },
    recordSuccess: () => {
      stats.successCount++
      stats.lastSuccessTime = Date.now()
    },
    recordFailure: () => {
      stats.failureCount++
      stats.lastFailureTime = Date.now()
    },
    canExecute: () => true,
    reset: () => {
      stats.failureCount = 0
      stats.successCount = 0
    },
    forceOpen: () => {},
    forceClose: () => {},
  }
}

/**
 * Deterministic routing based on message keywords
 */
function extractUserTextFromSegmentD(content: string): string {
  // Segment D wraps the real user message. The current user instruction is
  // rendered as a context item prefixed with `[sourceType: conversation_state]`.
  const marker = '[sourceType: conversation_state]'
  const idx = content.indexOf(marker)
  if (idx !== -1) {
    return content.slice(idx + marker.length).trimStart().split('\n')[0]
  }

  // Fallback for history/session-history wrappers that replay the conversation.
  const userMarker = 'User:'
  const userIdx = content.indexOf(userMarker)
  if (userIdx !== -1) {
    return content.slice(userIdx + userMarker.length).trimStart().split('\n')[0]
  }

  return content
}

function findActualUserMessage(messages: Array<{ role: string; content: string }>): string {
  const userMessages = messages.filter((m) => m.role === 'user')
  if (userMessages.length === 0) return ''

  // Prefer the last user message that is not a provenance wrapper, otherwise
  // extract the real user text from the Segment D wrapper.
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const content = userMessages[i].content
    if (!content.includes('## Provenance') && !content.includes('Segment D: Context Bundle')) {
      return content
    }
  }

  return extractUserTextFromSegmentD(userMessages[userMessages.length - 1].content)
}

function routeDeterministically(messages: Array<{ role: string; content: string }>): {
  route: string
  reason: string
  suggestedTools?: string[]
} {
  const content = findActualUserMessage(messages).toLowerCase()

  // Keyword-based routing
  if (content.includes('search') || content.includes('find') || content.includes('look up')) {
    return {
      route: 'dispatch_tool',
      reason: 'User requested to search or find information',
      suggestedTools: ['web_search'],
    }
  }

  if (content.includes('status') || content.includes('progress') || content.includes('what is running')) {
    return {
      route: 'status_query',
      reason: 'User is asking about status or progress',
      suggestedTools: ['status_query'],
    }
  }

  if (content.includes('plan') || content.includes('step') || content.includes('task')) {
    return {
      route: 'spawn_planner',
      reason: 'User is requesting planning or multi-step task execution',
    }
  }

  // Default: answer directly
  return {
    route: 'answer_directly',
    reason: 'Simple question or statement, answering directly',
  }
}

/**
 * Create a mock LLM provider
 */
function createMockLLMProvider(): LLMProvider {
  const capabilities: ProviderCapabilities = {
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsVision: false,
    maxTokens: 4096,
    supportedModels: ['mock-model'],
  }

  const config: ProviderConfig = {
    id: 'mock',
    name: 'Mock LLM Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 30000,
    retries: 0,
    capabilities,
  }

  let stats: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeoutRequests: 0,
    averageLatencyMs: 0,
    healthStatus: 'healthy' as ProviderHealthStatus,
  }

  const circuitBreaker = createMockCircuitBreaker()

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const startTime = Date.now()
    stats.totalRequests++

    // Generate deterministic response based on message content
    const routing = routeDeterministically(request.messages)

    // For direct answers, return plain text so the frontend streams readable prose.
    // For routed/tooling intents, keep the structured JSON so the kernel can act on it.
    const userVisibleResponse = `Mock response for: ${routing.route}`
    const content =
      routing.route === 'answer_directly'
        ? userVisibleResponse
        : JSON.stringify({
            route: routing.route,
            reason: routing.reason,
            userVisibleResponse,
            suggestedTools: routing.suggestedTools,
          })

    const response: LLMResponse = {
      id: `mock-${Date.now()}`,
      model: request.model,
      content,
      role: 'assistant',
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    }

    const latencyMs = Date.now() - startTime
    stats.successfulRequests++
    stats.averageLatencyMs = (stats.averageLatencyMs * (stats.totalRequests - 1) + latencyMs) / stats.totalRequests
    stats.lastRequestTime = Date.now()

    return {
      success: true,
      response,
      providerId: 'mock',
    }
  }

  return {
    get id() {
      return 'mock'
    },
    get config() {
      return { ...config }
    },
    get circuitBreaker() {
      return circuitBreaker
    },
    get health() {
      return stats.healthStatus
    },
    get stats() {
      return { ...stats }
    },
    complete,
    isHealthy: () => true,
    getStats: () => ({ ...stats }),
    updateConfig: (newConfig: Partial<ProviderConfig>) => {
      Object.assign(config, newConfig)
    },
    resetStats: () => {
      stats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        timeoutRequests: 0,
        averageLatencyMs: 0,
        healthStatus: 'healthy',
      }
    },
  }
}

/**
 * Create a mock LLM adapter for testing and development
 */
export function createMockLLMAdapter(): LLMAdapter {
  const providers: LLMProvider[] = [createMockLLMProvider()]

  const config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 30000,
    enableCircuitBreaker: false,
    enableLogging: false,
  }

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const provider = providers[0]
    if (!provider) {
      return {
        success: false,
        error: {
          errorId: `err_no_provider_${Date.now()}`,
          category: 'model_error',
          code: 'NO_PROVIDER',
          message: 'No mock provider available',
          recoverability: 'retryable_later',
          source: { module: 'mock_adapter' },
          createdAt: new Date().toISOString(),
        },
        providerId: 'none',
      }
    }
    return provider.complete(request)
  }

  async function* stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const result = await complete(request)
    if (!result.success) {
      return
    }

    const response = result.response
    const providerId = result.providerId
    const model = response.model

    // Split text into small chunks to simulate real LLM streaming.
    const content = response.content
    const chunkSize = 4
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunk = content.slice(i, i + chunkSize)
      yield { kind: 'text', delta: chunk, providerId, model }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    // Emit tool_calls after text (if any) so kernel can dispatch tools.
    if (response.toolCalls) {
      for (let index = 0; index < response.toolCalls.length; index++) {
        const tc = response.toolCalls[index]
        if (!tc) continue
        yield {
          kind: 'tool_call_delta',
          index,
          id: tc.id,
          name: tc.function.name,
          argumentsDelta: tc.function.arguments,
          providerId,
          model,
        }
      }
    }

    yield {
      kind: 'finish',
      finishReason: response.finishReason,
      providerId,
      model,
    }
  }

  return {
    get config() {
      return config
    },
    get providers() {
      return [...providers]
    },
    complete,
    stream,
    addProvider: (provider: LLMProvider) => {
      providers.push(provider)
    },
    removeProvider: (providerId: string) => {
      const index = providers.findIndex((p) => p.id === providerId)
      if (index !== -1) {
        providers.splice(index, 1)
      }
    },
    getProvider: (providerId: string) => {
      return providers.find((p) => p.id === providerId)
    },
    getHealthyProviders: () => {
      return providers.filter((p) => p.isHealthy())
    },
    updateProviderPriority: (providerId: string, priority: number) => {
      const provider = providers.find((p) => p.id === providerId)
      if (provider) {
        provider.updateConfig({ ...provider.config, priority })
      }
    },
  }
}
