/**
 * Sandbox Guards — Size Enforcement, Timeouts, and Type Guards
 */

import { createSandboxError, type SandboxErrorResponse } from './sandbox-errors.js'

// ---------------------------------------------------------------------------
// Constants (derived from README upload config + contract timeout classes)
// ---------------------------------------------------------------------------

/** Single file size limit: 10 MiB (UPLOAD_MAX_FILE_SIZE_BYTES) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** Per-session storage quota: 100 MiB (UPLOAD_PER_SESSION_QUOTA_BYTES) */
export const SESSION_QUOTA_BYTES = 100 * 1024 * 1024

/** Timeout classes from contract section 5 */
export const TIMEOUT_MS = {
  fast: 10_000,
  standard: 30_000,
  generation: 60_000,
  heavy: 120_000,
} as const

export type TimeoutClass = keyof typeof TIMEOUT_MS

// ---------------------------------------------------------------------------
// Size Enforcement
// ---------------------------------------------------------------------------

/**
 * Enforces a size limit on input data.
 */
export function enforceSizeLimit(
  sizeBytes: number,
  maxBytes = MAX_FILE_SIZE_BYTES,
  label = 'Input',
): void {
  if (sizeBytes > maxBytes) {
    throw createSandboxError(
      'file_too_large',
      `${label} size ${formatBytes(sizeBytes)} exceeds limit of ${formatBytes(maxBytes)}`,
    )
  }
}

/**
 * Enforces the per-session quota by checking current usage + new data.
 */
export function enforceQuota(
  currentUsageBytes: number,
  newBytes: number,
  quotaBytes = SESSION_QUOTA_BYTES,
): void {
  if (currentUsageBytes + newBytes > quotaBytes) {
    throw createSandboxError(
      'quota_exceeded',
      `Adding ${formatBytes(newBytes)} would exceed session quota of ${formatBytes(quotaBytes)} (current: ${formatBytes(currentUsageBytes)})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Timeout Wrappers
// ---------------------------------------------------------------------------

/**
 * Wraps an async operation with a timeout.
 * Rejects with a sandbox_timeout error if the operation takes too long.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label = 'Operation',
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createSandboxError(
        'sandbox_timeout',
        `${label} timed out after ${timeoutMs}ms`,
        { recoverable: true, category: 'timeout' },
      ))
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(), timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

/**
 * Returns the timeout duration for a given timeout class.
 */
export function getTimeoutMs(timeoutClass: TimeoutClass): number {
  return TIMEOUT_MS[timeoutClass]
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/**
 * Type guard for SandboxErrorResponse.
 */
export function isSandboxError(value: unknown): value is SandboxErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    (value as Record<string, unknown>).status === 'failed' &&
    'error' in value &&
    typeof (value as Record<string, unknown>).error === 'object'
  )
}

/**
 * Type guard for Node.js system errors (has a `code` property).
 * @internal
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats bytes into a human-readable string.
 * @internal
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
