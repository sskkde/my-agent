/**
 * Phase 4 API Response Envelope
 *
 * Standardized response format for all Phase 4 endpoints (Connectors API,
 * Observability API, DLQ endpoints).
 *
 * Every response includes:
 * - `ok`: true for success, false for error
 * - `requestId`: traceable request identifier
 * - `data`: payload on success / `error`: error details on failure
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiErrorResponse;

/**
 * Create a standardized success response envelope.
 */
export function success<T>(data: T, requestId?: string): ApiSuccess<T> {
  return {
    ok: true,
    data,
    requestId: requestId ?? 'unknown',
  };
}

/**
 * Create a standardized error response envelope.
 */
export function envelopeError(
  code: string,
  message: string,
  requestId?: string,
  details?: unknown,
): ApiErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    requestId: requestId ?? 'unknown',
  };
}
