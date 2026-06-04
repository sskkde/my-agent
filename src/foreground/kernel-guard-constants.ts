/**
 * Kernel Foreground Guard Constants and Error Mapping
 *
 * Defines foreground kernel limits and safe user-visible error messages.
 * Maps kernel errors to ForegroundTurnResult with redacted error details.
 *
 * @module foreground/kernel-guard-constants
 */

import type { ForegroundTurnResult } from './foreground-runner-types.js';
import type { KernelRunResult, KernelRunStatus } from '../kernel/types.js';

// ─── Foreground Guard Constants ───────────────────────────────────────────────

/**
 * Default maximum iterations for foreground kernel execution.
 * This limit prevents runaway tool loops in user-facing interactions.
 */
export const DEFAULT_FOREGROUND_MAX_ITERATIONS = 6;

/**
 * Default timeout in milliseconds for foreground kernel execution.
 * Limits total execution time to prevent long-running user-facing requests.
 */
export const DEFAULT_FOREGROUND_TIMEOUT_MS = 60000;

// ─── User-Visible Error Messages ──────────────────────────────────────────────

/**
 * Safe user-visible message when max iterations are exceeded.
 * Does NOT expose internal iteration count or technical details.
 */
export const MAX_ITERATION_EXCEEDED_USER_MESSAGE =
  'I could not complete this in the allowed number of steps. Please try breaking it into a smaller request.';

/**
 * Safe user-visible message when timeout occurs.
 * Does NOT expose timeout duration or internal timing details.
 */
export const TIMEOUT_USER_MESSAGE =
  'The request took too long to process. Please try a simpler request.';

/**
 * Safe user-visible message for generic LLM errors.
 */
export const LLM_ERROR_USER_MESSAGE =
  'The AI service encountered an issue. Please try again.';

/**
 * Safe user-visible message for generic kernel errors.
 */
export const GENERIC_ERROR_USER_MESSAGE =
  'Something went wrong while processing your request. Please try again.';

// ─── Error Mapping Types ─────────────────────────────────────────────────────

/**
 * Kernel error type for mapping purposes.
 * Represents the different failure modes of AgentKernel.run().
 */
export type KernelErrorType =
  | 'MAX_ITERATIONS_EXCEEDED'
  | 'TIMEOUT'
  | 'LLM_ERROR'
  | 'GENERIC_ERROR';

/**
 * Runtime summary for failed foreground turn.
 * Provides safe diagnostic information without exposing sensitive data.
 */
export interface ForegroundErrorRuntimeSummary {
  /** Error code for classification */
  code: KernelErrorType;
  /** Whether the error might be recoverable on retry */
  recoverable: boolean;
  /** Redacted error detail - safe for logging */
  errorDetail: 'redacted';
}

// ─── Error Mapping Function ──────────────────────────────────────────────────

/**
 * Maps a KernelRunResult with failure status to a ForegroundTurnResult.
 *
 * CRITICAL: This function NEVER includes raw error messages or stack traces
 * in the finalResponse. Error details are redacted for user safety.
 *
 * @param kernelResult - The kernel result with failure status
 * @returns A ForegroundTurnResult with safe user-visible response
 */
export function mapKernelErrorToForegroundResult(
  kernelResult: KernelRunResult
): ForegroundTurnResult {
  const errorType = classifyKernelError(kernelResult);
  const userMessage = getUserVisibleMessage(errorType);

  return {
    status: 'failed',
    finalResponse: userMessage,
    decisionTrace: {
      route: 'answer_directly',
      requiresPlanner: false,
      reason: `Kernel execution failed: ${errorType}`,
    },
    runtimeSummary: {
      toolCallSummaries: kernelResult.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status: 'failed' as const,
        summary: 'Tool execution interrupted',
      })),
    },
    error: {
      code: errorType,
      message: kernelResult.error?.message ?? 'Kernel error',
    },
  };
}

/**
 * Classifies a KernelRunResult into a KernelErrorType.
 */
function classifyKernelError(result: KernelRunResult): KernelErrorType {
  const status = result.finalStatus;

  if (status === 'max_iterations_reached') {
    return 'MAX_ITERATIONS_EXCEEDED';
  }

  if (status === 'timeout') {
    return 'TIMEOUT';
  }

  // Check for LLM-specific error codes
  if (result.error?.code) {
    const code = result.error.code;
    if (
      code.includes('LLM') ||
      code.includes('PROVIDER') ||
      code.includes('RATE_LIMIT') ||
      code.includes('AUTH') ||
      code.includes('MODEL')
    ) {
      return 'LLM_ERROR';
    }
  }

  return 'GENERIC_ERROR';
}

/**
 * Returns the appropriate user-visible message for an error type.
 */
function getUserVisibleMessage(errorType: KernelErrorType): string {
  switch (errorType) {
    case 'MAX_ITERATIONS_EXCEEDED':
      return MAX_ITERATION_EXCEEDED_USER_MESSAGE;
    case 'TIMEOUT':
      return TIMEOUT_USER_MESSAGE;
    case 'LLM_ERROR':
      return LLM_ERROR_USER_MESSAGE;
    default:
      return GENERIC_ERROR_USER_MESSAGE;
  }
}

/**
 * Determines if an error type might be recoverable on retry.
 */
export function isRecoverableError(errorType: KernelErrorType): boolean {
  // Timeout and LLM errors may be transient
  return errorType === 'TIMEOUT' || errorType === 'LLM_ERROR';
}

// ─── Helper to create synthetic kernel error result ───────────────────────────

/**
 * Creates a synthetic KernelRunResult for error scenarios.
 * Useful when the kernel did not complete a full run.
 */
export function createSyntheticKernelErrorResult(
  errorType: KernelErrorType,
  message: string
): KernelRunResult {
  const status: KernelRunStatus =
    errorType === 'MAX_ITERATIONS_EXCEEDED'
      ? 'max_iterations_reached'
      : errorType === 'TIMEOUT'
        ? 'timeout'
        : 'failed';

  return {
    finalStatus: status,
    iterationsUsed: 0,
    toolCalls: [],
    transcript: [],
    error: {
      code: errorType,
      message,
    },
  };
}