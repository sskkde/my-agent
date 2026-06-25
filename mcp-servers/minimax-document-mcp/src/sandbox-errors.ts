/**
 * Sandbox Error Types and Factory
 *
 * Structured error codes and responses compatible with
 * normalizeConnectorResponse expectations.
 */

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

/**
 * Error codes used by sandbox operations.
 * All snake_case per contract convention.
 */
export type SandboxErrorCode =
  | 'path_traversal'
  | 'absolute_path_rejected'
  | 'symlink_escape'
  | 'file_too_large'
  | 'quota_exceeded'
  | 'workspace_error'
  | 'sandbox_timeout'
  | 'file_not_found'
  | 'invalid_artifact_ref'
  | 'unsupported_format'
  | 'sheet_not_found'

// ---------------------------------------------------------------------------
// Error Interfaces
// ---------------------------------------------------------------------------

/**
 * Structured error shape matching NormalizedConnectorResult.error.
 */
export interface SandboxError {
  code: SandboxErrorCode
  message: string
  recoverable: boolean
  category?: string
}

/**
 * Structured error response matching NormalizedConnectorResult shape.
 * Can be returned directly as a tool call result.
 */
export interface SandboxErrorResponse {
  status: 'failed'
  error: SandboxError
  recoverability: 'non_recoverable' | 'retryable_later'
  metadata?: {
    sensitivity?: 'low' | 'medium' | 'high' | 'restricted'
  }
}

/**
 * Artifact reference returned by generation tools.
 * Matches the contract's artifact policy (no raw binary).
 */
export interface ArtifactReference {
  fileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  downloadUrl: string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a structured error response compatible with normalizeConnectorResponse.
 */
export function createSandboxError(
  code: SandboxErrorCode,
  message: string,
  options?: { recoverable?: boolean; category?: string; sensitivity?: 'low' | 'medium' | 'high' | 'restricted' },
): SandboxErrorResponse {
  const { recoverable = false, category = 'tool_validation_error', sensitivity = 'medium' } = options ?? {}
  return {
    status: 'failed',
    error: { code, message, recoverable, category },
    recoverability: recoverable ? 'retryable_later' : 'non_recoverable',
    metadata: { sensitivity },
  }
}
