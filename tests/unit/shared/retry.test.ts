import { describe, it, expect } from 'vitest'
import type { RetryPolicy, BackoffStrategy } from '../../../src/shared/retry'
import { isRetryable, getRetryClassification, RECOVERABILITY, BACKOFF_STRATEGIES } from '../../../src/shared/retry'
import type { RuntimeError, RuntimeErrorCategory } from '../../../src/shared/errors'

describe('Retry Contracts', () => {
  describe('BackoffStrategy', () => {
    it('should accept all documented backoff strategies', () => {
      const strategies: BackoffStrategy[] = ['none', 'fixed', 'linear', 'exponential']

      expect(strategies).toHaveLength(4)

      strategies.forEach((strategy) => {
        expect(typeof strategy).toBe('string')
      })
    })

    it('should export BACKOFF_STRATEGIES constant', () => {
      expect(BACKOFF_STRATEGIES).toEqual({
        NONE: 'none',
        FIXED: 'fixed',
        LINEAR: 'linear',
        EXPONENTIAL: 'exponential',
      })
    })
  })

  describe('RetryPolicy', () => {
    it('should create a RetryPolicy with all fields', () => {
      const retryOn: RuntimeErrorCategory[] = ['connector_rate_limited', 'timeout', 'model_error']

      const doNotRetryOn: RuntimeErrorCategory[] = ['approval_rejected', 'permission_error']

      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        retryOn,
        doNotRetryOn,
        requireApprovalBeforeRetry: true,
      }

      expect(policy.maxAttempts).toBe(3)
      expect(policy.backoff).toBe('exponential')
      expect(policy.initialDelayMs).toBe(1000)
      expect(policy.maxDelayMs).toBe(30000)
      expect(policy.retryOn).toEqual(retryOn)
      expect(policy.doNotRetryOn).toEqual(doNotRetryOn)
      expect(policy.requireApprovalBeforeRetry).toBe(true)
    })

    it('should create a minimal RetryPolicy', () => {
      const policy: RetryPolicy = {
        maxAttempts: 1,
        backoff: 'none',
      }

      expect(policy.maxAttempts).toBe(1)
      expect(policy.backoff).toBe('none')
      expect(policy.initialDelayMs).toBeUndefined()
      expect(policy.maxDelayMs).toBeUndefined()
      expect(policy.retryOn).toBeUndefined()
      expect(policy.doNotRetryOn).toBeUndefined()
      expect(policy.requireApprovalBeforeRetry).toBeUndefined()
    })

    it('should support fixed backoff', () => {
      const policy: RetryPolicy = {
        maxAttempts: 5,
        backoff: 'fixed',
        initialDelayMs: 2000,
      }

      expect(policy.backoff).toBe('fixed')
      expect(policy.initialDelayMs).toBe(2000)
    })

    it('should support linear backoff', () => {
      const policy: RetryPolicy = {
        maxAttempts: 3,
        backoff: 'linear',
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      }

      expect(policy.backoff).toBe('linear')
    })
  })

  describe('RECOVERABILITY constants', () => {
    it('should export all recoverability values', () => {
      expect(RECOVERABILITY).toEqual({
        RECOVERABLE_AUTO: 'recoverable_auto',
        RECOVERABLE_WITH_USER: 'recoverable_with_user',
        RECOVERABLE_WITH_APPROVAL: 'recoverable_with_approval',
        RETRYABLE_LATER: 'retryable_later',
        NON_RECOVERABLE: 'non_recoverable',
      })
    })
  })

  describe('isRetryable', () => {
    it('should return true for retryable_later recoverability', () => {
      const error: RuntimeError = {
        errorId: 'err_001',
        category: 'connector_rate_limited',
        code: 'RATE_LIMIT',
        message: 'Rate limited',
        recoverability: 'retryable_later',
        source: { module: 'connector' },
        createdAt: new Date().toISOString(),
      }

      expect(isRetryable(error)).toBe(true)
    })

    it('should return true for recoverable_auto', () => {
      const error: RuntimeError = {
        errorId: 'err_002',
        category: 'context_overflow',
        code: 'CONTEXT_OVERFLOW',
        message: 'Context overflow',
        recoverability: 'recoverable_auto',
        source: { module: 'kernel' },
        createdAt: new Date().toISOString(),
      }

      expect(isRetryable(error)).toBe(true)
    })

    it('should return false for non_recoverable', () => {
      const error: RuntimeError = {
        errorId: 'err_003',
        category: 'approval_rejected',
        code: 'APPROVAL_DENIED',
        message: 'User rejected approval',
        recoverability: 'non_recoverable',
        source: { module: 'approval' },
        createdAt: new Date().toISOString(),
      }

      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for recoverable_with_user', () => {
      const error: RuntimeError = {
        errorId: 'err_004',
        category: 'user_input_error',
        code: 'MISSING_INFO',
        message: 'Missing user information',
        recoverability: 'recoverable_with_user',
        source: { module: 'planner' },
        createdAt: new Date().toISOString(),
      }

      expect(isRetryable(error)).toBe(false)
    })

    it('should return false for recoverable_with_approval', () => {
      const error: RuntimeError = {
        errorId: 'err_005',
        category: 'permission_error',
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
        recoverability: 'recoverable_with_approval',
        source: { module: 'dispatcher' },
        createdAt: new Date().toISOString(),
      }

      expect(isRetryable(error)).toBe(false)
    })
  })

  describe('getRetryClassification', () => {
    it('should classify connector_rate_limited as retryable_later', () => {
      const result = getRetryClassification('connector_rate_limited')
      expect(result).toBe('retryable_later')
    })

    it('should classify timeout as retryable_later', () => {
      const result = getRetryClassification('timeout')
      expect(result).toBe('retryable_later')
    })

    it('should classify external_event_timeout as retryable_later', () => {
      const result = getRetryClassification('external_event_timeout')
      expect(result).toBe('retryable_later')
    })

    it('should classify model_error as retryable_later', () => {
      const result = getRetryClassification('model_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify approval_rejected as non_recoverable', () => {
      const result = getRetryClassification('approval_rejected')
      expect(result).toBe('non_recoverable')
    })

    it('should classify permission_error as non_recoverable', () => {
      const result = getRetryClassification('permission_error')
      expect(result).toBe('non_recoverable')
    })

    it('should classify connector_auth_error as non_recoverable', () => {
      const result = getRetryClassification('connector_auth_error')
      expect(result).toBe('non_recoverable')
    })

    it('should classify tool_validation_error as recoverable_auto', () => {
      const result = getRetryClassification('tool_validation_error')
      expect(result).toBe('recoverable_auto')
    })

    it('should classify user_input_error as recoverable_with_user', () => {
      const result = getRetryClassification('user_input_error')
      expect(result).toBe('recoverable_with_user')
    })

    it('should classify context_overflow as recoverable_auto', () => {
      const result = getRetryClassification('context_overflow')
      expect(result).toBe('recoverable_auto')
    })

    it('should classify system_internal_error as retryable_later', () => {
      const result = getRetryClassification('system_internal_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify state_conflict as retryable_later', () => {
      const result = getRetryClassification('state_conflict')
      expect(result).toBe('retryable_later')
    })

    it('should classify tool_execution_error as non_recoverable', () => {
      const result = getRetryClassification('tool_execution_error')
      expect(result).toBe('non_recoverable')
    })

    it('should classify workflow_step_error as retryable_later', () => {
      const result = getRetryClassification('workflow_step_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify subagent_error as retryable_later', () => {
      const result = getRetryClassification('subagent_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify planner_error as retryable_later', () => {
      const result = getRetryClassification('planner_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify dispatcher_error as retryable_later', () => {
      const result = getRetryClassification('dispatcher_error')
      expect(result).toBe('retryable_later')
    })

    it('should classify duplicate_event as non_recoverable', () => {
      const result = getRetryClassification('duplicate_event')
      expect(result).toBe('non_recoverable')
    })
  })
})
