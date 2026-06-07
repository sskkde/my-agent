import { describe, it, expect, beforeEach } from 'vitest'
import { createCircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../../../src/llm'
import type { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerStats } from '../../../src/llm'
import type { RuntimeError } from '../../../src/shared/errors'

describe('Circuit Breaker Contracts', () => {
  describe('CircuitBreakerState', () => {
    it('should accept all circuit breaker states', () => {
      const states: CircuitBreakerState[] = ['CLOSED', 'OPEN', 'HALF_OPEN']

      expect(states).toHaveLength(3)

      states.forEach((state) => {
        expect(typeof state).toBe('string')
      })
    })

    it('should distinguish between states', () => {
      expect('CLOSED').not.toBe('OPEN')
      expect('OPEN').not.toBe('HALF_OPEN')
      expect('HALF_OPEN').not.toBe('CLOSED')
    })
  })

  describe('CircuitBreakerConfig', () => {
    it('should accept valid circuit breaker configuration', () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        successThreshold: 2,
      }

      expect(config.failureThreshold).toBe(5)
      expect(config.resetTimeoutMs).toBe(30000)
      expect(config.successThreshold).toBe(2)
    })

    it('should have default configuration values', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs).toBe(30000)
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(2)
    })
  })

  describe('CircuitBreakerStats', () => {
    it('should track circuit breaker statistics', () => {
      const stats: CircuitBreakerStats = {
        state: 'CLOSED',
        failureCount: 3,
        successCount: 10,
        lastFailureTime: Date.now() - 1000,
        lastSuccessTime: Date.now(),
        totalRequests: 20,
        rejectedRequests: 2,
      }

      expect(stats.state).toBe('CLOSED')
      expect(stats.failureCount).toBe(3)
      expect(stats.successCount).toBe(10)
      expect(stats.totalRequests).toBe(20)
      expect(stats.rejectedRequests).toBe(2)
    })

    it('should handle optional stat fields', () => {
      const stats: CircuitBreakerStats = {
        state: 'OPEN',
        failureCount: 5,
        successCount: 0,
        totalRequests: 10,
        rejectedRequests: 5,
      }

      expect(stats.lastFailureTime).toBeUndefined()
      expect(stats.lastSuccessTime).toBeUndefined()
    })
  })

  describe('CircuitBreaker - CLOSED State', () => {
    let breaker: CircuitBreaker

    beforeEach(() => {
      breaker = createCircuitBreaker()
    })

    it('should start in CLOSED state', () => {
      expect(breaker.state).toBe('CLOSED')
    })

    it('should allow execution in CLOSED state', () => {
      expect(breaker.canExecute()).toBe(true)
    })

    it('should track successful requests', () => {
      breaker.recordSuccess()

      expect(breaker.stats.successCount).toBe(0)
      expect(breaker.stats.failureCount).toBe(0)
      expect(breaker.stats.lastSuccessTime).toBeDefined()
    })

    it('should track failures but stay CLOSED below threshold', () => {
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)
      breaker.recordFailure(error)
      breaker.recordFailure(error)

      expect(breaker.state).toBe('CLOSED')
      expect(breaker.stats.failureCount).toBe(4)
      expect(breaker.stats.lastFailureTime).toBeDefined()
    })

    it('should transition to OPEN after reaching failure threshold', () => {
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      for (let i = 0; i < DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        breaker.recordFailure(error)
      }

      expect(breaker.state).toBe('OPEN')
    })

    it('should track total requests', () => {
      breaker.canExecute()
      breaker.canExecute()
      breaker.canExecute()

      expect(breaker.stats.totalRequests).toBe(3)
    })
  })

  describe('CircuitBreaker - OPEN State', () => {
    let breaker: CircuitBreaker

    beforeEach(() => {
      breaker = createCircuitBreaker({ failureThreshold: 2 })
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)
    })

    it('should be in OPEN state after failures', () => {
      expect(breaker.state).toBe('OPEN')
    })

    it('should reject executions in OPEN state', () => {
      expect(breaker.canExecute()).toBe(false)
    })

    it('should track rejected requests', () => {
      breaker.canExecute()
      breaker.canExecute()

      expect(breaker.stats.rejectedRequests).toBe(2)
    })

    it('should not increment failure count in OPEN state', () => {
      const error: RuntimeError = {
        errorId: 'err_test2',
        category: 'model_error',
        code: 'TEST_ERROR_2',
        message: 'Test error 2',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      const failureCountBefore = breaker.stats.failureCount
      breaker.recordFailure(error)

      expect(breaker.stats.failureCount).toBe(failureCountBefore)
    })

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const shortTimeoutBreaker = createCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 50,
      })

      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      shortTimeoutBreaker.recordFailure(error)
      shortTimeoutBreaker.recordFailure(error)

      expect(shortTimeoutBreaker.state).toBe('OPEN')

      await new Promise((resolve) => setTimeout(resolve, 60))

      shortTimeoutBreaker.canExecute()

      expect(shortTimeoutBreaker.state).toBe('HALF_OPEN')
    })

    it('should remain OPEN before reset timeout expires', async () => {
      const longTimeoutBreaker = createCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10000,
      })

      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      longTimeoutBreaker.recordFailure(error)
      longTimeoutBreaker.recordFailure(error)

      longTimeoutBreaker.canExecute()

      expect(longTimeoutBreaker.state).toBe('OPEN')
    })
  })

  describe('CircuitBreaker - HALF_OPEN State', () => {
    let breaker: CircuitBreaker

    beforeEach(async () => {
      breaker = createCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10,
        successThreshold: 2,
      })

      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)

      await new Promise((resolve) => setTimeout(resolve, 20))

      breaker.canExecute()
    })

    it('should transition to HALF_OPEN after timeout', () => {
      expect(breaker.state).toBe('HALF_OPEN')
    })

    it('should allow execution in HALF_OPEN state', () => {
      expect(breaker.canExecute()).toBe(true)
    })

    it('should transition to CLOSED after success threshold', () => {
      breaker.recordSuccess()
      breaker.recordSuccess()

      expect(breaker.state).toBe('CLOSED')
    })

    it('should transition to OPEN on failure in HALF_OPEN', () => {
      const error: RuntimeError = {
        errorId: 'err_test2',
        category: 'model_error',
        code: 'TEST_ERROR_2',
        message: 'Test error 2',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)

      expect(breaker.state).toBe('OPEN')
    })
  })

  describe('CircuitBreaker - Manual Control', () => {
    it('should force open the circuit', () => {
      const breaker = createCircuitBreaker()

      expect(breaker.state).toBe('CLOSED')

      breaker.forceOpen()

      expect(breaker.state).toBe('OPEN')
      expect(breaker.canExecute()).toBe(false)
    })

    it('should force close the circuit', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 2 })
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)

      expect(breaker.state).toBe('OPEN')

      breaker.forceClose()

      expect(breaker.state).toBe('CLOSED')
      expect(breaker.canExecute()).toBe(true)
    })

    it('should reset circuit breaker', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 2 })
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)
      breaker.canExecute()
      breaker.canExecute()

      expect(breaker.state).toBe('OPEN')
      expect(breaker.stats.totalRequests).toBe(2)
      expect(breaker.stats.rejectedRequests).toBe(2)

      breaker.reset()

      expect(breaker.state).toBe('CLOSED')
      expect(breaker.stats.totalRequests).toBe(0)
      expect(breaker.stats.rejectedRequests).toBe(0)
      expect(breaker.stats.failureCount).toBe(0)
    })
  })

  describe('CircuitBreaker - Custom Configuration', () => {
    it('should use custom failure threshold', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 3 })
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)

      expect(breaker.state).toBe('CLOSED')

      breaker.recordFailure(error)

      expect(breaker.state).toBe('OPEN')
    })

    it('should use custom success threshold', async () => {
      const breaker = createCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 10,
        successThreshold: 3,
      })

      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.recordFailure(error)
      breaker.recordFailure(error)

      await new Promise((resolve) => setTimeout(resolve, 20))
      breaker.canExecute()

      expect(breaker.state).toBe('HALF_OPEN')

      breaker.recordSuccess()
      breaker.recordSuccess()

      expect(breaker.state).toBe('HALF_OPEN')

      breaker.recordSuccess()

      expect(breaker.state).toBe('CLOSED')
    })

    it('should merge partial configuration with defaults', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 10 })

      expect(breaker.config.failureThreshold).toBe(10)
      expect(breaker.config.resetTimeoutMs).toBe(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs)
      expect(breaker.config.successThreshold).toBe(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold)
    })
  })

  describe('CircuitBreaker - Stats Tracking', () => {
    it('should track all statistics correctly', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 5 })
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      breaker.canExecute()
      breaker.canExecute()
      breaker.recordSuccess()
      breaker.recordFailure(error)
      breaker.recordFailure(error)
      breaker.canExecute()

      const stats = breaker.stats

      expect(stats.totalRequests).toBe(3)
      expect(stats.failureCount).toBe(2)
      expect(stats.state).toBe('CLOSED')
      expect(stats.lastSuccessTime).toBeDefined()
      expect(stats.lastFailureTime).toBeDefined()
    })

    it('should update timestamps on success/failure', () => {
      const breaker = createCircuitBreaker()
      const error: RuntimeError = {
        errorId: 'err_test',
        category: 'model_error',
        code: 'TEST_ERROR',
        message: 'Test error',
        recoverability: 'retryable_later',
        source: { module: 'test' },
        createdAt: new Date().toISOString(),
      }

      const beforeSuccess = Date.now()
      breaker.recordSuccess()
      const afterSuccess = Date.now()

      expect(breaker.stats.lastSuccessTime).toBeGreaterThanOrEqual(beforeSuccess)
      expect(breaker.stats.lastSuccessTime).toBeLessThanOrEqual(afterSuccess)

      const beforeFailure = Date.now()
      breaker.recordFailure(error)
      const afterFailure = Date.now()

      expect(breaker.stats.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure)
      expect(breaker.stats.lastFailureTime).toBeLessThanOrEqual(afterFailure)
    })
  })

  describe('CircuitBreaker - Immutability', () => {
    it('should not allow external state modification', () => {
      const breaker = createCircuitBreaker()

      const initialState = breaker.state
      const initialConfig = breaker.config
      const initialStats = breaker.stats

      breaker.recordSuccess()

      expect(breaker.state).toBe(initialState)
      expect(breaker.config).toBe(initialConfig)
      expect(breaker.stats).not.toBe(initialStats)
    })

    it('should provide read-only access to config', () => {
      const breaker = createCircuitBreaker({ failureThreshold: 3 })

      const config = breaker.config
      expect(config.failureThreshold).toBe(3)
    })
  })
})

describe('CircuitBreakerError', () => {
  it('should define circuit breaker open error structure', () => {
    const error = {
      errorId: 'err_cbo_001',
      category: 'model_error',
      code: 'CIRCUIT_BREAKER_OPEN',
      message: 'Circuit breaker is open for provider openai',
      recoverability: 'retryable_later',
      source: { module: 'llm_adapter' },
      providerId: 'openai',
      remainingCooldownMs: 15000,
      createdAt: new Date().toISOString(),
    }

    expect(error.category).toBe('model_error')
    expect(error.code).toBe('CIRCUIT_BREAKER_OPEN')
    expect(error.providerId).toBe('openai')
    expect(error.remainingCooldownMs).toBe(15000)
  })
})
