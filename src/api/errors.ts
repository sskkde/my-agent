import type { ApiError } from './types.js'
import { envelopeError, type ApiErrorResponse } from './response-envelope.js'

export class ApiErrorFactory {
  static notFound(message = 'Resource not found', requestId?: string): ApiErrorResponse {
    return envelopeError('NOT_FOUND', message, requestId)
  }

  static badRequest(message: string, details?: unknown, requestId?: string): ApiErrorResponse {
    return envelopeError('BAD_REQUEST', message, requestId, details)
  }

  static internalError(message = 'Internal server error', requestId?: string): ApiErrorResponse {
    return envelopeError('INTERNAL_ERROR', message, requestId)
  }

  static unauthorized(message = 'Unauthorized', requestId?: string): ApiErrorResponse {
    return envelopeError('UNAUTHORIZED', message, requestId)
  }

  static forbidden(message = 'Forbidden', requestId?: string): ApiErrorResponse {
    return envelopeError('FORBIDDEN', message, requestId)
  }

  static conflict(message = 'Conflict', requestId?: string): ApiErrorResponse {
    return envelopeError('CONFLICT', message, requestId)
  }

  static serviceUnavailable(message = 'Service unavailable', requestId?: string): ApiErrorResponse {
    return envelopeError('SERVICE_UNAVAILABLE', message, requestId)
  }
}

export function errorToJson(error: ApiError | ApiErrorResponse): string {
  return JSON.stringify(error)
}

export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  requestId?: string,
): ApiErrorResponse {
  return envelopeError(code, message, requestId, details)
}
