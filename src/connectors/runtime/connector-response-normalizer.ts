/**
 * Connector Response Normalizer
 * Maps ConnectorResponse to unified ToolExecutionResult/DispatchResult formats
 * with proper RuntimeError categorization and recoverability.
 */

import type { ConnectorResponse } from '../types.js'
import type { Recoverability, RuntimeErrorCategory } from '../../shared/errors.js'

// Normalized result status (aligned with ToolExecutionResult)
export type NormalizedResultStatus = 'completed' | 'waiting' | 'denied' | 'failed' | 'timeout' | 'cancelled'

// Auth challenge information for user recovery
export interface AuthChallenge {
  type: 'bearer' | 'api_key' | 'oauth2' | 'basic' | 'custom'
  message: string
  authUrl?: string
  scopes?: string[]
}

// Rate limit information
export interface RateLimitInfo {
  remaining: number
  resetAt?: string
  retryAfterMs?: number
}

// Normalized metadata
export interface NormalizedMetadata {
  operationRef?: string
  retryAfterMs?: number
  authChallenge?: AuthChallenge
  rateLimitInfo?: RateLimitInfo
  sensitivity?: 'low' | 'medium' | 'high' | 'restricted'
  warning?: string
}

// Normalized error
export interface NormalizedError {
  code: string
  message: string
  recoverable: boolean
  category?: RuntimeErrorCategory
}

// Normalized connector result
export interface NormalizedConnectorResult {
  status: NormalizedResultStatus
  error?: NormalizedError
  metadata?: NormalizedMetadata
  recoverability?: Recoverability
  synthetic?: boolean
  data?: unknown
}

// Normalizer options
export interface NormalizerOptions {
  sensitivity?: 'low' | 'medium' | 'high' | 'restricted'
  defaultRetryAfterMs?: number
}

// Error code to recoverability mapping
const ERROR_CODE_RECOVERABILITY: Record<string, Recoverability> = {
  // User-recoverable errors
  invalid_credentials: 'recoverable_with_user',
  token_expired: 'recoverable_with_user',
  token_revoked: 'recoverable_with_user',
  insufficient_permissions: 'recoverable_with_user',
  account_suspended: 'recoverable_with_user',

  // Retryable later
  service_unavailable: 'retryable_later',
  internal_error: 'retryable_later',
  connection_failed: 'retryable_later',
  dns_failure: 'retryable_later',

  // Non-recoverable
  resource_not_found: 'non_recoverable',
  invalid_request: 'non_recoverable',
  validation_error: 'non_recoverable',
  unsupported_operation: 'non_recoverable',
}

const ERROR_CODE_CATEGORY: Record<string, RuntimeErrorCategory> = {
  invalid_credentials: 'connector_auth_error',
  token_expired: 'connector_auth_error',
  token_revoked: 'connector_auth_error',
  insufficient_permissions: 'permission_error',
  permission_denied: 'permission_error',
  approval_rejected: 'approval_rejected',
  service_unavailable: 'system_internal_error',
  internal_error: 'system_internal_error',
  connection_failed: 'system_internal_error',
  dns_failure: 'system_internal_error',
  resource_not_found: 'connector_auth_error',
  invalid_request: 'user_input_error',
  validation_error: 'tool_validation_error',
  unsupported_operation: 'tool_validation_error',
  rate_limited: 'connector_rate_limited',
  connector_timeout: 'timeout',
  timeout: 'timeout',
}

function determineErrorCategory(code: string, fallback: RuntimeErrorCategory): RuntimeErrorCategory {
  return ERROR_CODE_CATEGORY[code] ?? fallback
}

/**
 * Determines recoverability based on error code
 */
function determineErrorRecoverability(code: string, connectorRecoverable: boolean): Recoverability {
  // Check explicit mapping first
  if (ERROR_CODE_RECOVERABILITY[code]) {
    return ERROR_CODE_RECOVERABILITY[code]
  }

  // Fall back to connector's recoverable flag
  return connectorRecoverable ? 'retryable_later' : 'non_recoverable'
}

/**
 * Normalizes a connector response to a unified result format.
 *
 * Status mapping:
 * - success → completed, no error
 * - started_async → waiting, metadata.operationRef set
 * - partial_success → completed with warning in metadata
 * - auth_required → recoverable_with_user, metadata.authChallenge set
 * - permission_denied → denied, error.code="permission_denied"
 * - rate_limited → retryable_later, metadata.retryAfterMs set
 * - failed → failed, error from connector
 * - timeout → timeout, error.code="connector_timeout"
 * - cancelled → cancelled, synthetic=true
 */
export function normalizeConnectorResponse(
  response: ConnectorResponse,
  options?: NormalizerOptions,
): NormalizedConnectorResult {
  const { sensitivity, defaultRetryAfterMs = 60000 } = options ?? {}

  switch (response.status) {
    case 'success':
      return {
        status: 'completed',
        data: response.data,
        metadata: sensitivity ? { sensitivity } : undefined,
      }

    case 'started_async':
      return {
        status: 'waiting',
        metadata: {
          operationRef: response.metadata?.operationId ?? '',
          sensitivity,
        },
      }

    case 'partial_success':
      return {
        status: 'completed',
        data: response.data,
        metadata: {
          warning: response.error?.message ?? 'Partial success with warnings',
          sensitivity,
        },
      }

    case 'auth_required':
      return {
        status: 'failed',
        error: {
          code: response.error?.code ?? 'auth_required',
          message: response.error?.message ?? 'Authentication required',
          recoverable: true,
          category: 'connector_auth_error',
        },
        recoverability: 'recoverable_with_user',
        metadata: {
          authChallenge: {
            type: 'bearer',
            message: response.error?.message ?? 'Please authenticate to continue',
          },
          sensitivity,
        },
      }

    case 'permission_denied':
      return {
        status: 'denied',
        error: {
          code: 'permission_denied',
          message: response.error?.message ?? 'Permission denied',
          recoverable: response.error?.recoverable ?? true,
          category: 'permission_error',
        },
        recoverability: response.error?.recoverable === false ? 'non_recoverable' : 'recoverable_with_user',
        metadata: { sensitivity },
      }

    case 'rate_limited':
      const retryAfterMs = response.metadata?.retryAfterMs ?? defaultRetryAfterMs
      return {
        status: 'failed',
        error: {
          code: 'rate_limited',
          message: response.error?.message ?? 'Rate limit exceeded',
          recoverable: true,
          category: 'connector_rate_limited',
        },
        recoverability: 'retryable_later',
        metadata: {
          retryAfterMs,
          rateLimitInfo: {
            remaining: response.metadata?.rateLimitRemaining ?? 0,
            resetAt: response.metadata?.rateLimitResetAt,
            retryAfterMs,
          },
          sensitivity,
        },
      }

    case 'failed':
      const errorCode = response.error?.code ?? 'execution_failed'
      const errorMessage = response.error?.message ?? 'Connector execution failed'
      const connectorRecoverable = response.error?.recoverable ?? false

      return {
        status: 'failed',
        error: {
          code: errorCode,
          message: errorMessage,
          recoverable: connectorRecoverable,
          category: determineErrorCategory(
            errorCode,
            connectorRecoverable ? 'system_internal_error' : 'tool_execution_error',
          ),
        },
        recoverability: determineErrorRecoverability(errorCode, connectorRecoverable),
        metadata: { sensitivity },
      }

    case 'timeout':
      return {
        status: 'timeout',
        error: {
          code: 'connector_timeout',
          message: response.error?.message ?? 'Connector operation timed out',
          recoverable: true,
          category: 'timeout',
        },
        recoverability: 'retryable_later',
        metadata: { sensitivity },
      }

    case 'cancelled':
      return {
        status: 'cancelled',
        synthetic: true,
        metadata: { sensitivity },
      }

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = response.status
      throw new Error(`Unknown connector response status: ${_exhaustive}`)
  }
}

/**
 * Creates a synthetic cancelled response
 */
export function createCancelledResponse(requestId: string, connectorInstanceId: string): ConnectorResponse {
  return {
    status: 'cancelled',
    requestId,
    connectorInstanceId,
  }
}

/**
 * Creates a synthetic timeout response
 */
export function createTimeoutResponse(
  requestId: string,
  connectorInstanceId: string,
  timeoutMs: number,
): ConnectorResponse {
  return {
    status: 'timeout',
    requestId,
    connectorInstanceId,
    error: {
      code: 'connector_timeout',
      message: `Operation timed out after ${timeoutMs}ms`,
      recoverable: true,
    },
  }
}
