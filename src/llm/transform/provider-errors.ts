/**
 * Provider error mapping utilities
 * Maps HTTP responses to structured RuntimeError objects
 */

import type { RuntimeError, ErrorSource } from '../../shared/errors'

/**
 * Error body patterns that indicate quota exhaustion / insufficient balance.
 * Providers commonly surface these as 4xx/5xx bodies rather than HTTP 402.
 */
const QUOTA_ERROR_BODY_PATTERN = /insufficient|quota|balance/i

/**
 * Optional signals used to refine HTTP-error classification.
 * Both are best-effort and default to undefined when unavailable.
 */
export interface ProviderErrorResponseOptions {
  /** Raw provider error body text, used for quota/insufficient-balance detection */
  errorBody?: string
  /** Retry-After hint in milliseconds derived from the provider Retry-After header */
  retryAfterMs?: number
}

/**
 * Creates a structured RuntimeError from an HTTP response
 *
 * @param status - HTTP status code
 * @param statusText - HTTP status text
 * @param providerId - Provider identifier for error tracking
 * @param source - Error source for debugging
 * @param options - Optional error body text and Retry-After hint
 * @returns Structured RuntimeError with appropriate category and code
 */
export function createErrorFromResponse(
  status: number,
  statusText: string,
  providerId: string,
  source: ErrorSource,
  options: ProviderErrorResponseOptions = {},
): RuntimeError {
  const baseError = {
    errorId: `err_${providerId}_${Date.now()}`,
    message: `HTTP ${status}: ${statusText}`,
    source,
    createdAt: new Date().toISOString(),
  }

  // 401/403 -> authentication/authorization failure (terminal, never retried)
  if (status === 401 || status === 403) {
    return {
      ...baseError,
      category: 'connector_auth_error',
      code: 'AUTH_ERROR',
      recoverability: 'non_recoverable',
    }
  }

  // 402 -> payment required (quota / insufficient balance) (terminal, never retried)
  if (status === 402) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'QUOTA_ERROR',
      recoverability: 'non_recoverable',
    }
  }

  if (status === 429) {
    return {
      ...baseError,
      category: 'connector_rate_limited',
      code: 'RATE_LIMIT_ERROR',
      recoverability: 'retryable_later',
      technical: { retryAfterMs: options.retryAfterMs ?? 60000 },
    }
  }

  // Provider body explicitly reports quota exhaustion -> terminal, never retried
  if (options.errorBody && QUOTA_ERROR_BODY_PATTERN.test(options.errorBody)) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'QUOTA_ERROR',
      recoverability: 'non_recoverable',
    }
  }

  if (status >= 500) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'PROVIDER_ERROR',
      recoverability: 'retryable_later',
    }
  }

  if (status >= 400) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'REQUEST_ERROR',
      recoverability: 'retryable_later',
    }
  }

  return {
    ...baseError,
    category: 'model_error',
    code: 'UNKNOWN_ERROR',
    recoverability: 'retryable_later',
  }
}
