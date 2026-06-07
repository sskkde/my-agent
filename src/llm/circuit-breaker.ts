/**
 * Circuit Breaker Pattern for LLM Providers
 * Implements the circuit breaker state machine for fault tolerance
 */

import type { RuntimeError } from '../shared/errors'

/**
 * Circuit breaker states
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing, requests are blocked immediately
 * - HALF_OPEN: Testing if service recovered
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number
  /** Time in milliseconds before attempting reset (half-open) */
  resetTimeoutMs: number
  /** Number of successful requests in half-open state to close the circuit */
  successThreshold: number
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  successThreshold: 2,
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState
  failureCount: number
  successCount: number
  lastFailureTime?: number
  lastSuccessTime?: number
  totalRequests: number
  rejectedRequests: number
}

/**
 * Circuit breaker for a single provider
 */
export interface CircuitBreaker {
  /** Current state of the circuit */
  state: CircuitBreakerState
  /** Configuration for this circuit breaker */
  config: CircuitBreakerConfig
  /** Current statistics */
  stats: CircuitBreakerStats
  /** Record a successful request */
  recordSuccess(): void
  /** Record a failed request */
  recordFailure(error: RuntimeError): void
  /** Check if a request should be allowed */
  canExecute(): boolean
  /** Reset the circuit breaker to CLOSED state */
  reset(): void
  /** Force open the circuit (for manual intervention) */
  forceOpen(): void
  /** Force close the circuit (for manual intervention) */
  forceClose(): void
}

/**
 * Circuit breaker error
 * Thrown when a request is rejected due to open circuit
 */
export interface CircuitBreakerOpenError extends RuntimeError {
  category: 'model_error'
  code: 'CIRCUIT_BREAKER_OPEN'
  providerId: string
  remainingCooldownMs: number
}

/**
 * Create a new circuit breaker instance
 * Factory function for creating circuit breakers
 */
export function createCircuitBreaker(config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
  const finalConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }

  let state: CircuitBreakerState = 'CLOSED'
  let failureCount = 0
  let successCount = 0
  let lastFailureTime: number | undefined
  let lastSuccessTime: number | undefined
  let totalRequests = 0
  let rejectedRequests = 0

  const getStats = (): CircuitBreakerStats => ({
    state,
    failureCount,
    successCount,
    lastFailureTime,
    lastSuccessTime,
    totalRequests,
    rejectedRequests,
  })

  const transitionTo = (newState: CircuitBreakerState): void => {
    state = newState

    if (newState === 'CLOSED') {
      failureCount = 0
      successCount = 0
    } else if (newState === 'OPEN') {
      successCount = 0
    } else if (newState === 'HALF_OPEN') {
      successCount = 0
      failureCount = 0
    }
  }

  const canExecute = (): boolean => {
    totalRequests++

    if (state === 'CLOSED') {
      return true
    }

    if (state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - (lastFailureTime || 0)
      if (timeSinceLastFailure >= finalConfig.resetTimeoutMs) {
        transitionTo('HALF_OPEN')
        return true
      }
      rejectedRequests++
      return false
    }

    // HALF_OPEN - allow limited requests
    return true
  }

  const recordSuccess = (): void => {
    lastSuccessTime = Date.now()

    if (state === 'HALF_OPEN') {
      successCount++
      if (successCount >= finalConfig.successThreshold) {
        transitionTo('CLOSED')
      }
    } else if (state === 'CLOSED') {
      // Stay in CLOSED, just update success time
    }
  }

  const recordFailure = (): void => {
    lastFailureTime = Date.now()

    if (state === 'HALF_OPEN') {
      transitionTo('OPEN')
    } else if (state === 'CLOSED') {
      failureCount++
      if (failureCount >= finalConfig.failureThreshold) {
        transitionTo('OPEN')
      }
    }
  }

  const reset = (): void => {
    transitionTo('CLOSED')
    totalRequests = 0
    rejectedRequests = 0
  }

  const forceOpen = (): void => {
    transitionTo('OPEN')
    lastFailureTime = Date.now()
  }

  const forceClose = (): void => {
    transitionTo('CLOSED')
  }

  return {
    get state() {
      return state
    },
    get config() {
      return finalConfig
    },
    get stats() {
      return getStats()
    },
    recordSuccess,
    recordFailure,
    canExecute,
    reset,
    forceOpen,
    forceClose,
  }
}
