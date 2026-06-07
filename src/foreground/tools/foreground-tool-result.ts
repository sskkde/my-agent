/**
 * Foreground Tool Result Types
 * Shared result shape for all foreground tools
 */

import type { TurnTranscript } from '../../storage/transcript-store.js'

/**
 * Error details for recoverable/non-recoverable errors
 */
export interface ForegroundToolError {
  code: string
  recoverable: boolean
  message: string
}

/**
 * Generic result shape for foreground tools
 * Provides consistent interface for success/error, user-visible summary, and runtime details
 */
export interface ForegroundToolResult<T = unknown> {
  success: boolean
  data?: T
  userVisibleSummary: string
  runtimeSummary: TurnTranscript['runtimeSummary']
  error?: ForegroundToolError
}

/**
 * Helper to create a successful tool result
 */
export function createSuccessResult<T>(
  data: T,
  userVisibleSummary: string,
  runtimeSummary: TurnTranscript['runtimeSummary'] = {},
): ForegroundToolResult<T> {
  return {
    success: true,
    data,
    userVisibleSummary,
    runtimeSummary,
  }
}

/**
 * Helper to create a failed tool result
 */
export function createErrorResult<T = never>(
  errorCode: string,
  errorMessage: string,
  recoverable: boolean = false,
  userVisibleSummary?: string,
  runtimeSummary: TurnTranscript['runtimeSummary'] = {},
): ForegroundToolResult<T> {
  return {
    success: false,
    userVisibleSummary: userVisibleSummary ?? `Error: ${errorMessage}`,
    runtimeSummary,
    error: {
      code: errorCode,
      recoverable,
      message: errorMessage,
    },
  }
}
