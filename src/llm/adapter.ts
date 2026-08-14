/**
 * LLM Adapter with Fallback Support
 * Orchestrates multiple LLM providers with automatic failover
 */

import type { LLMProvider } from './provider'
import type { LLMRequest, LLMResult, ProviderConfig, AllProvidersFailedError, LLMStreamChunk } from './types.js'
import { toLLMStreamChunk } from './types.js'
import type { CircuitBreakerConfig } from './circuit-breaker'
import type { RuntimeError, ErrorSource } from '../shared/errors'
import type { RetryPolicy } from '../shared/retry'
import { isRetryable } from '../shared/retry'

/**
 * Per-provider retry backoff (exponential with jitter).
 * Local to the adapter: retry-executor's RetryResult/cancel-token shape does
 * not map onto a per-provider attempt loop inside one complete()/stream() call.
 */
const RETRY_INITIAL_DELAY_MS = 500
const RETRY_BACKOFF_FACTOR = 2
const RETRY_MAX_DELAY_MS = 10000
const RETRY_JITTER_RATIO = 0.1

function computeRetryDelayMs(retryIndex: number): number {
  const delayMs = RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, retryIndex)
  const boundedDelay = Math.min(delayMs, RETRY_MAX_DELAY_MS)
  const jitter = boundedDelay * RETRY_JITTER_RATIO * Math.random()
  return Math.min(Math.floor(boundedDelay + jitter), RETRY_MAX_DELAY_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRuntimeError(error: unknown): error is RuntimeError {
  return (
    typeof error === 'object' && error !== null && 'recoverability' in error && 'code' in error && 'category' in error
  )
}

/** Whether a provider error warrants a same-provider retry (recoverability-gated). */
function shouldRetryProviderError(error: RuntimeError): boolean {
  // Never retry through an already-open circuit breaker - it is blocking by design.
  if (error.code === 'CIRCUIT_BREAKER_OPEN') {
    return false
  }
  return isRetryable(error)
}

/** Backoff wait, never less than the provider Retry-After hint (e.g. 429), capped at the ceiling. */
function retryWaitMs(error: RuntimeError, retryIndex: number): number {
  const backoffMs = computeRetryDelayMs(retryIndex)
  const retryAfterMs = error.technical?.retryAfterMs ?? 0
  return Math.min(Math.max(backoffMs, retryAfterMs), RETRY_MAX_DELAY_MS)
}

/**
 * LLM Adapter configuration
 */
export interface LLMAdapterConfig {
  /** Provider configurations in priority order */
  providers: ProviderConfig[]

  /** Default timeout for requests */
  defaultTimeoutMs: number

  /** Whether to enable circuit breakers */
  enableCircuitBreaker: boolean

  /** Circuit breaker configuration */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>

  /** Retry policy for failed requests */
  retryPolicy?: RetryPolicy

  /** Whether to enable request/response logging */
  enableLogging?: boolean
}

/**
 * Default adapter configuration
 */
export const DEFAULT_ADAPTER_CONFIG: Omit<LLMAdapterConfig, 'providers'> = {
  defaultTimeoutMs: 60000,
  enableCircuitBreaker: true,
  enableLogging: false,
}

/**
 * LLM Adapter with multi-provider support
 */
export interface LLMAdapter {
  /** Adapter configuration */
  readonly config: LLMAdapterConfig

  /** Registered providers in priority order */
  readonly providers: LLMProvider[]

  /**
   * Execute a request with automatic failover
   * Tries providers in priority order until one succeeds
   */
  complete(request: LLMRequest): Promise<LLMResult>

  /**
   * Stream a completion request with automatic failover
   * Falls back to complete() if provider doesn't support streaming
   */
  stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk>

  /**
   * Add a provider to the adapter
   */
  addProvider(provider: LLMProvider): void

  /**
   * Remove a provider by ID
   */
  removeProvider(providerId: string): void

  /**
   * Get provider by ID
   */
  getProvider(providerId: string): LLMProvider | undefined

  /**
   * Get all healthy providers
   */
  getHealthyProviders(): LLMProvider[]

  /**
   * Update provider priority
   */
  updateProviderPriority(providerId: string, priority: number): void
}

/**
 * Create an AllProvidersFailedError
 */
function createAllProvidersFailedError(
  attempts: Array<{ providerId: string; error: RuntimeError }>,
  source: ErrorSource,
): AllProvidersFailedError {
  return {
    errorId: `err_all_providers_failed_${Date.now()}`,
    category: 'model_error',
    code: 'ALL_PROVIDERS_FAILED',
    message: `All providers failed after ${attempts.length} attempts`,
    recoverability: 'retryable_later',
    source,
    attempts,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Create an LLM adapter with fallback support
 */
export function createLLMAdapter(config: LLMAdapterConfig): LLMAdapter {
  const providers: LLMProvider[] = []
  const finalConfig = { ...DEFAULT_ADAPTER_CONFIG, ...config }

  const getHealthyProviders = (): LLMProvider[] => {
    return providers.filter((p) => p.isHealthy()).sort((a, b) => a.config.priority - b.config.priority)
  }

  const complete = async (request: LLMRequest): Promise<LLMResult> => {
    const healthyProviders = getHealthyProviders()

    if (healthyProviders.length === 0) {
      const error = createAllProvidersFailedError([], { module: 'llm_adapter' })
      return {
        success: false,
        error,
        providerId: 'none',
      }
    }

    const attempts: Array<{ providerId: string; error: RuntimeError }> = []

    for (const provider of healthyProviders) {
      const startTime = Date.now()

      try {
        const result = await completeProviderWithRetries(provider, request)
        const latencyMs = Date.now() - startTime

        if (result.success) {
          if (finalConfig.enableLogging) {
            console.log(`[LLM Adapter] Success via ${provider.id} in ${latencyMs}ms`)
          }
          return result
        } else {
          attempts.push({
            providerId: provider.id,
            error: result.error,
          })
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime
        const runtimeError: RuntimeError = {
          errorId: `err_provider_exception_${Date.now()}`,
          category: 'model_error',
          code: 'PROVIDER_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverability: 'retryable_later',
          source: { module: 'llm_adapter', runId: request.model },
          createdAt: new Date().toISOString(),
        }

        attempts.push({
          providerId: provider.id,
          error: runtimeError,
        })

        if (finalConfig.enableLogging) {
          console.error(`[LLM Adapter] Provider ${provider.id} failed after ${latencyMs}ms:`, runtimeError.message)
        }
      }
    }

    // All providers failed
    const allFailedError = createAllProvidersFailedError(attempts, { module: 'llm_adapter' })

    return {
      success: false,
      error: allFailedError,
      providerId: 'none',
    }
  }

  /**
   * Attempts one provider up to `retries + 1` times.
   * Non-retryable errors (auth/quota/invalid request/context overflow) and an
   * open circuit breaker skip the retry loop immediately; the backoff is
   * bounded by the provider's own timeout budget so the whole sequence stays
   * inside a single complete() call. Failover (trying the next provider) is a
   * separate mechanism in the caller and is unaffected.
   */
  const completeProviderWithRetries = async (provider: LLMProvider, req: LLMRequest): Promise<LLMResult> => {
    const maxRetries = Math.max(0, provider.config.retries ?? 0)
    const attemptDeadline = Date.now() + Math.max(provider.config.timeoutMs, finalConfig.defaultTimeoutMs)
    let lastResult: LLMResult | undefined

    for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex++) {
      try {
        const result = await provider.complete(req)
        lastResult = result
        if (result.success || !shouldRetryProviderError(result.error)) {
          return result
        }
      } catch (error) {
        lastResult = {
          success: false,
          error: {
            errorId: `err_provider_exception_${Date.now()}`,
            category: 'model_error',
            code: 'PROVIDER_EXCEPTION',
            message: error instanceof Error ? error.message : 'Unknown error',
            recoverability: 'retryable_later',
            source: { module: 'llm_adapter', runId: req.model },
            createdAt: new Date().toISOString(),
          },
          providerId: provider.id,
        }
      }

      if (retryIndex >= maxRetries) break
      if (!lastResult || lastResult.success) break

      const waitMs = retryWaitMs(lastResult.error, retryIndex)
      if (Date.now() + waitMs >= attemptDeadline) break
      await sleep(waitMs)
    }

    return lastResult as LLMResult
  }

  async function* stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const healthyProviders = getHealthyProviders()

    if (healthyProviders.length === 0) {
      return
    }

    for (const provider of healthyProviders) {
      if (provider.stream) {
        try {
          const maxRetries = Math.max(0, provider.config.retries ?? 0)
          const attemptDeadline = Date.now() + Math.max(provider.config.timeoutMs, finalConfig.defaultTimeoutMs)
          let yieldedAny = false

          for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex++) {
            try {
              for await (const event of provider.stream(request)) {
                yieldedAny = true
                yield toLLMStreamChunk(event, provider.id, request.model)
              }
              return
            } catch (error) {
              // Never retry a stream that already emitted chunks - replay would duplicate content.
              if (yieldedAny) throw error

              const runtimeError = isRuntimeError(error) ? error : undefined
              if (runtimeError !== undefined && !shouldRetryProviderError(runtimeError)) throw error
              if (retryIndex >= maxRetries) throw error

              const waitMs =
                runtimeError === undefined ? computeRetryDelayMs(retryIndex) : retryWaitMs(runtimeError, retryIndex)
              if (Date.now() + waitMs >= attemptDeadline) throw error
              await sleep(waitMs)
            }
          }
        } catch {
          continue
        }
      }
    }

    // Fallback: complete() then emit structured chunks (text and/or tool_calls)
    const fallbackResult = await complete(request)
    if (!fallbackResult.success) {
      return
    }
    const response = fallbackResult.response
    const providerId = fallbackResult.providerId
    if (response.content) {
      yield {
        kind: 'text',
        delta: response.content,
        providerId,
        model: request.model,
      }
    }
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
          model: request.model,
        }
      }
    }
    yield {
      kind: 'finish',
      finishReason: response.finishReason,
      providerId,
      model: request.model,
    }
  }

  const addProvider = (provider: LLMProvider): void => {
    providers.push(provider)
    // Keep sorted by priority
    providers.sort((a, b) => a.config.priority - b.config.priority)
  }

  const removeProvider = (providerId: string): void => {
    const index = providers.findIndex((p) => p.id === providerId)
    if (index !== -1) {
      providers.splice(index, 1)
    }
  }

  const getProvider = (providerId: string): LLMProvider | undefined => {
    return providers.find((p) => p.id === providerId)
  }

  const updateProviderPriority = (providerId: string, priority: number): void => {
    const provider = providers.find((p) => p.id === providerId)
    if (provider) {
      provider.updateConfig({ ...provider.config, priority })
      providers.sort((a, b) => a.config.priority - b.config.priority)
    }
  }

  return {
    get config() {
      return finalConfig
    },
    get providers() {
      return [...providers]
    },
    complete,
    stream,
    addProvider,
    removeProvider,
    getProvider,
    getHealthyProviders,
    updateProviderPriority,
  }
}

/**
 * Create a timeout error
 */
export function createTimeoutError(providerId: string, timeoutMs: number, source: ErrorSource): RuntimeError {
  return {
    errorId: `err_timeout_${Date.now()}`,
    category: 'timeout',
    code: 'PROVIDER_TIMEOUT',
    message: `Provider ${providerId} timed out after ${timeoutMs}ms`,
    recoverability: 'retryable_later',
    source,
    technical: {
      retryAfterMs: Math.min(timeoutMs * 2, 60000),
    },
    createdAt: new Date().toISOString(),
  }
}
