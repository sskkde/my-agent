import type {
  RetryAttemptAudit,
  RetryExecutor,
  RetryExecutorConfig,
  RetryOperation,
  RetryPolicy,
  RetryResult,
} from './types.js'
import type { RuntimeError } from '../shared/errors.js'
import { BACKOFF_STRATEGIES } from '../shared/retry.js'

class RetryExecutorImpl implements RetryExecutor {
  private config: RetryExecutorConfig

  constructor(config: RetryExecutorConfig) {
    this.config = config
  }

  async executeWithRetry(operation: RetryOperation, policy: RetryPolicy): Promise<RetryResult> {
    let attempts = 0
    const maxAttempts = this.getMaxAttempts(policy)
    const startTime = Date.now()
    const timeoutMs = this.config.timeoutMs || 30000
    const auditTrail: RetryAttemptAudit[] = []

    while (attempts < maxAttempts) {
      if (Date.now() - startTime > timeoutMs) {
        if (operation.cancelToken && this.config.cancelOperation) {
          await this.config.cancelOperation(operation.cancelToken).catch(() => undefined)
        }
        return {
          success: false,
          attempts,
          timedOut: true,
          auditTrail,
          error: {
            code: 'TIMEOUT',
            message: 'Operation timed out',
          },
        }
      }

      attempts++
      auditTrail.push(this.createAudit(attempts, 'started', operation.operationName))

      try {
        const remainingTime = timeoutMs - (Date.now() - startTime)
        const operationTimeout = Math.min(remainingTime, timeoutMs)

        const result = await this.runWithTimeout(operation.operation(), operationTimeout, operation.cancelToken)
        auditTrail.push(this.createAudit(attempts, 'succeeded', operation.operationName))
        return {
          success: true,
          data: result,
          attempts,
          auditTrail,
        }
      } catch (error) {
        const runtimeError = this.normalizeError(error)
        auditTrail.push(this.createAudit(attempts, 'failed', operation.operationName, runtimeError))

        const isLastAttempt = attempts >= maxAttempts

        if (!this.isRetryable(runtimeError, policy) || isLastAttempt) {
          if (this.isRetryable(runtimeError, policy) && isLastAttempt) {
            return {
              success: false,
              attempts,
              auditTrail,
              error: {
                code: 'MAX_RETRIES_EXCEEDED',
                message: `Max retry attempts (${maxAttempts}) exceeded. Last error: ${runtimeError.message}`,
              },
            }
          }

          return {
            success: false,
            attempts,
            auditTrail,
            error: {
              code: runtimeError.code,
              message: runtimeError.message,
            },
          }
        }

        if (operation.isWrite && !operation.isIdempotent && policy.requireApprovalBeforeRetry) {
          if (this.config.requestApproval) {
            const approval = await this.config.requestApproval(operation.operationName, runtimeError)
            if (!approval.approved) {
              return {
                success: false,
                attempts,
                requiresUserApproval: true,
                failedDueToApproval: true,
                auditTrail,
                error: {
                  code: 'RETRY_REJECTED',
                  message: approval.reason || 'Retry rejected by user',
                },
              }
            }
          } else {
            return {
              success: false,
              attempts,
              requiresUserApproval: true,
              auditTrail,
              error: {
                code: 'APPROVAL_REQUIRED',
                message: 'Non-idempotent write requires approval before retry',
              },
            }
          }
        }

        const delayMs = this.calculateDelay(attempts - 1, policy)
        auditTrail.push(this.createAudit(attempts, 'retry_scheduled', operation.operationName, runtimeError, delayMs))
        await this.sleep(delayMs)
      }
    }

    return {
      success: false,
      attempts,
      auditTrail,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: `Max retry attempts (${maxAttempts}) exceeded`,
      },
    }
  }

  isRetryable(error: RuntimeError, policy: RetryPolicy): boolean {
    if (policy.doNotRetryOn && policy.doNotRetryOn.includes(error.category)) {
      return false
    }

    const retryableCategories = policy.retryableErrorCategories ?? policy.retryableErrors ?? policy.retryOn
    if (retryableCategories && retryableCategories.length > 0) {
      return retryableCategories.includes(error.category)
    }

    const retryableRecoverabilities = ['retryable_later', 'recoverable_auto']
    return retryableRecoverabilities.includes(error.recoverability)
  }

  private calculateDelay(attemptNumber: number, policy: RetryPolicy): number {
    const initialDelay = policy.initialDelayMs || 100
    const maxDelay = policy.maxDelayMs || 30000
    const backoffStrategy = policy.backoffStrategy ?? policy.backoff ?? BACKOFF_STRATEGIES.EXPONENTIAL
    const jitterRatio = policy.jitterRatio ?? 0

    let delayMs: number
    switch (backoffStrategy) {
      case BACKOFF_STRATEGIES.NONE:
        delayMs = 0
        break

      case BACKOFF_STRATEGIES.FIXED:
        delayMs = initialDelay
        break

      case BACKOFF_STRATEGIES.LINEAR:
        delayMs = initialDelay * (attemptNumber + 1)
        break

      case BACKOFF_STRATEGIES.EXPONENTIAL:
        delayMs = initialDelay * Math.pow(2, attemptNumber)
        break

      default:
        delayMs = initialDelay
    }

    const boundedDelay = Math.min(delayMs, maxDelay)
    if (jitterRatio <= 0 || boundedDelay <= 0) {
      return boundedDelay
    }

    const jitter = boundedDelay * jitterRatio * Math.random()
    return Math.min(Math.floor(boundedDelay + jitter), maxDelay)
  }

  private getMaxAttempts(policy: RetryPolicy): number {
    if (policy.maxAttempts !== undefined) {
      return Math.max(1, policy.maxAttempts)
    }

    return Math.max(1, (policy.maxRetries ?? 0) + 1)
  }

  private createAudit(
    attempt: number,
    status: RetryAttemptAudit['status'],
    operationName: string,
    error?: RuntimeError,
    delayMs?: number,
  ): RetryAttemptAudit {
    return {
      attempt,
      status,
      operationName,
      errorCategory: error?.category,
      errorCode: error?.code,
      delayMs,
      timestamp: new Date().toISOString(),
    }
  }

  private normalizeError(error: unknown): RuntimeError {
    if (error && typeof error === 'object' && 'category' in error) {
      const candidate = error as Partial<RuntimeError> & { message?: string }
      return {
        errorId: candidate.errorId ?? `err-${Date.now()}`,
        category: candidate.category as RuntimeError['category'],
        code: candidate.code ?? String(candidate.category).toUpperCase(),
        message: candidate.message ?? 'Runtime error',
        recoverability: candidate.recoverability ?? 'non_recoverable',
        source: candidate.source ?? { module: 'retry_executor' },
        userVisible: candidate.userVisible,
        technical: candidate.technical,
        createdAt: candidate.createdAt ?? new Date().toISOString(),
        attempts: candidate.attempts,
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      errorId: `err-${Date.now()}`,
      category: 'system_internal_error',
      code: 'UNKNOWN_ERROR',
      message: errorMessage,
      recoverability: 'non_recoverable',
      source: { module: 'retry_executor' },
      createdAt: new Date().toISOString(),
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.config.sleep) {
      return this.config.sleep(ms)
    }
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async runWithTimeout<T>(operation: Promise<T>, timeoutMs: number, cancelToken?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (cancelToken && this.config.cancelOperation) {
          this.config.cancelOperation(cancelToken).catch(() => undefined)
        }
        const timeoutError: RuntimeError = {
          errorId: `timeout-${Date.now()}`,
          category: 'timeout',
          code: 'OPERATION_TIMEOUT',
          message: 'Operation timed out',
          recoverability: 'retryable_later',
          source: { module: 'retry_executor' },
          createdAt: new Date().toISOString(),
        }
        reject(timeoutError as unknown as Error)
      }, timeoutMs)

      operation
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }
}

export function createRetryExecutor(config: RetryExecutorConfig): RetryExecutor {
  return new RetryExecutorImpl(config)
}
