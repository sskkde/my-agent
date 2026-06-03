/**
 * Provider error mapping utilities
 * Maps HTTP responses to structured RuntimeError objects
 */

import type { RuntimeError, ErrorSource } from '../../shared/errors';

/**
 * Creates a structured RuntimeError from an HTTP response
 *
 * @param status - HTTP status code
 * @param statusText - HTTP status text
 * @param providerId - Provider identifier for error tracking
 * @param source - Error source for debugging
 * @returns Structured RuntimeError with appropriate category and code
 */
export function createErrorFromResponse(
  status: number,
  statusText: string,
  providerId: string,
  source: ErrorSource
): RuntimeError {
  const baseError = {
    errorId: `err_${providerId}_${Date.now()}`,
    message: `HTTP ${status}: ${statusText}`,
    recoverability: 'retryable_later' as const,
    source,
    createdAt: new Date().toISOString(),
  };

  if (status === 429) {
    return {
      ...baseError,
      category: 'connector_rate_limited',
      code: 'RATE_LIMIT_ERROR',
      technical: { retryAfterMs: 60000 },
    };
  }

  if (status >= 500) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'PROVIDER_ERROR',
    };
  }

  if (status >= 400) {
    return {
      ...baseError,
      category: 'model_error',
      code: 'REQUEST_ERROR',
    };
  }

  return {
    ...baseError,
    category: 'model_error',
    code: 'UNKNOWN_ERROR',
  };
}
