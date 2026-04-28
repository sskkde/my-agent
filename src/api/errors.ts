import type { ApiError } from './types.js';

export class ApiErrorFactory {
  static notFound(message = 'Resource not found'): ApiError {
    return {
      error: {
        code: 'NOT_FOUND',
        message
      }
    };
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return {
      error: {
        code: 'BAD_REQUEST',
        message,
        details
      }
    };
  }

  static internalError(message = 'Internal server error'): ApiError {
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message
      }
    };
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return {
      error: {
        code: 'UNAUTHORIZED',
        message
      }
    };
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return {
      error: {
        code: 'FORBIDDEN',
        message
      }
    };
  }

  static conflict(message = 'Conflict'): ApiError {
    return {
      error: {
        code: 'CONFLICT',
        message
      }
    };
  }

  static serviceUnavailable(message = 'Service unavailable'): ApiError {
    return {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message
      }
    };
  }
}

export function errorToJson(error: ApiError): string {
  return JSON.stringify(error);
}

export function createErrorResponse(code: string, message: string, details?: unknown): ApiError {
  return {
    error: {
      code,
      message,
      details
    }
  };
}