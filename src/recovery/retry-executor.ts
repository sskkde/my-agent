import type {
  RetryExecutor,
  RetryExecutorConfig,
  RetryOperation,
  RetryPolicy,
  RetryResult,
} from './types.js';
import type { RuntimeError } from '../shared/errors.js';
import { BACKOFF_STRATEGIES } from '../shared/retry.js';

class RetryExecutorImpl implements RetryExecutor {
  private config: RetryExecutorConfig;

  constructor(config: RetryExecutorConfig) {
    this.config = config;
  }

  async executeWithRetry(operation: RetryOperation, policy: RetryPolicy): Promise<RetryResult> {
    let attempts = 0;
    const maxAttempts = policy.maxRetries + 1;
    const startTime = Date.now();
    const timeoutMs = this.config.timeoutMs || 30000;

    while (attempts < maxAttempts) {
      if (Date.now() - startTime > timeoutMs) {
        if (operation.cancelToken && this.config.cancelOperation) {
          await this.config.cancelOperation(operation.cancelToken).catch(() => undefined);
        }
        return {
          success: false,
          attempts,
          timedOut: true,
          error: {
            code: 'TIMEOUT',
            message: 'Operation timed out',
          },
        };
      }

      attempts++;

      try {
        const remainingTime = timeoutMs - (Date.now() - startTime);
        const operationTimeout = Math.min(remainingTime, timeoutMs);

        const result = await this.runWithTimeout(operation.operation(), operationTimeout, operation.cancelToken);
        return {
          success: true,
          data: result,
          attempts,
        };
      } catch (error) {
        const runtimeError = this.normalizeError(error);

        const isLastAttempt = attempts >= maxAttempts;

        if (!this.isRetryable(runtimeError, policy) || isLastAttempt) {
          if (this.isRetryable(runtimeError, policy) && isLastAttempt) {
            return {
              success: false,
              attempts,
              error: {
                code: 'MAX_RETRIES_EXCEEDED',
                message: `Max retries (${policy.maxRetries}) exceeded. Last error: ${runtimeError.message}`,
              },
            };
          }

          return {
            success: false,
            attempts,
            error: {
              code: runtimeError.code,
              message: runtimeError.message,
            },
          };
        }

        if (operation.isWrite && !operation.isIdempotent && policy.requireApprovalBeforeRetry) {
          if (this.config.requestApproval) {
            const approval = await this.config.requestApproval(operation.operationName, runtimeError);
            if (!approval.approved) {
              return {
                success: false,
                attempts,
                requiresUserApproval: true,
                failedDueToApproval: true,
                error: {
                  code: 'RETRY_REJECTED',
                  message: approval.reason || 'Retry rejected by user',
                },
              };
            }
          } else {
            return {
              success: false,
              attempts,
              requiresUserApproval: true,
              error: {
                code: 'APPROVAL_REQUIRED',
                message: 'Non-idempotent write requires approval before retry',
              },
            };
          }
        }

        const delayMs = this.calculateDelay(attempts - 1, policy);
        await this.sleep(delayMs);
      }
    }

    return {
      success: false,
      attempts,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: `Max retries (${policy.maxRetries}) exceeded`,
      },
    };
  }

  isRetryable(error: RuntimeError, policy: RetryPolicy): boolean {
    if (policy.doNotRetryOn && policy.doNotRetryOn.includes(error.category)) {
      return false;
    }

    if (policy.retryableErrors && policy.retryableErrors.length > 0) {
      return policy.retryableErrors.includes(error.category);
    }

    const retryableRecoverabilities = ['retryable_later', 'recoverable_auto'];
    return retryableRecoverabilities.includes(error.recoverability);
  }

  private calculateDelay(attemptNumber: number, policy: RetryPolicy): number {
    const initialDelay = policy.initialDelayMs || 100;
    const maxDelay = policy.maxDelayMs || 30000;

    switch (policy.backoffStrategy) {
      case BACKOFF_STRATEGIES.NONE:
        return 0;

      case BACKOFF_STRATEGIES.FIXED:
        return Math.min(initialDelay, maxDelay);

      case BACKOFF_STRATEGIES.LINEAR:
        return Math.min(initialDelay * (attemptNumber + 1), maxDelay);

      case BACKOFF_STRATEGIES.EXPONENTIAL:
        return Math.min(initialDelay * Math.pow(2, attemptNumber), maxDelay);

      default:
        return Math.min(initialDelay, maxDelay);
    }
  }

  private normalizeError(error: unknown): RuntimeError {
    if (error && typeof error === 'object' && 'category' in error) {
      return error as RuntimeError;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      errorId: `err-${Date.now()}`,
      category: 'system_internal_error',
      code: 'UNKNOWN_ERROR',
      message: errorMessage,
      recoverability: 'non_recoverable',
      source: { module: 'retry_executor' },
      createdAt: new Date().toISOString(),
    };
  }

  private sleep(ms: number): Promise<void> {
    if (this.config.sleep) {
      return this.config.sleep(ms);
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async runWithTimeout<T>(operation: Promise<T>, timeoutMs: number, cancelToken?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (cancelToken && this.config.cancelOperation) {
          this.config.cancelOperation(cancelToken).catch(() => undefined);
        }
        const timeoutError: RuntimeError = {
          errorId: `timeout-${Date.now()}`,
          category: 'timeout',
          code: 'OPERATION_TIMEOUT',
          message: 'Operation timed out',
          recoverability: 'retryable_later',
          source: { module: 'retry_executor' },
          createdAt: new Date().toISOString(),
        };
        reject(timeoutError as unknown as Error);
      }, timeoutMs);

      operation
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

export function createRetryExecutor(config: RetryExecutorConfig): RetryExecutor {
  return new RetryExecutorImpl(config);
}
