/**
 * AgentlyMail Response Normalizer
 *
 * Parses CLI stdout/stderr and exit codes into a typed ConnectorResponse.
 * Never returns success for non-zero exit codes. Redacts likely secrets
 * from stderr before including in error messages.
 */

import type { ConnectorResponse, ConnectorResponseStatus } from '../types.js'
import type {
  AgentlyMailExitCode,
  AgentlyMailCliEnvelope,
} from './types.js'

// ─── Secret redaction ──────────────────────────────────────────────────────────

/**
 * Regex matching long alphanumeric strings that look like tokens, cookies,
 * or session keys. Threshold: 20+ chars of [A-Za-z0-9_-].
 * Avoids redacting normal words, short IDs, or common CLI output.
 */
const SECRET_PATTERN = /[A-Za-z0-9_-]{20,}/g

/**
 * Replace likely secret tokens in stderr with [REDACTED].
 * Preserves surrounding text for diagnostics.
 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[REDACTED]')
}

// ─── Retry-After parsing ───────────────────────────────────────────────────────

/**
 * Parse a Retry-After value from envelope metadata.
 * Accepts seconds (number) or HTTP-date strings.
 * Returns milliseconds, or undefined if not parseable.
 */
export function parseRetryAfterMs(value: unknown): number | undefined {
  if (value == null) return undefined

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value * 1000
  }

  if (typeof value === 'string') {
    const asNum = Number(value)
    if (Number.isFinite(asNum) && asNum >= 0) {
      return asNum * 1000
    }
    const asDate = Date.parse(value)
    if (!Number.isNaN(asDate)) {
      const delta = asDate - Date.now()
      return delta > 0 ? delta : 0
    }
  }

  if (isRecord(value) && 'retry_after' in value) {
    return parseRetryAfterMs(value.retry_after)
  }

  return undefined
}

// ─── Envelope parsing ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSuccessEnvelope(
  envelope: AgentlyMailCliEnvelope,
): envelope is { data: unknown } {
  return isRecord(envelope) && 'data' in envelope
}

function isErrorEnvelope(
  envelope: AgentlyMailCliEnvelope,
): envelope is { error: { code: string; message: string } } {
  return (
    isRecord(envelope) &&
    'error' in envelope &&
    isRecord((envelope as Record<string, unknown>).error)
  )
}

/**
 * Try to parse raw stdout as a JSON envelope.
 * Returns the parsed envelope, or undefined if stdout is empty or malformed.
 */
function parseEnvelope(rawStdout: string): AgentlyMailCliEnvelope | undefined {
  const trimmed = rawStdout.trim()
  if (trimmed.length === 0) return undefined

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isRecord(parsed)) {
      return parsed as unknown as AgentlyMailCliEnvelope
    }
    return undefined
  } catch {
    return undefined
  }
}

// ─── Default retry delays ──────────────────────────────────────────────────────

const DEFAULT_RETRY_AFTER_MS = 30_000

// ─── Exit code → status mapping ────────────────────────────────────────────────

interface ExitCodeMapping {
  status: ConnectorResponseStatus
  errorCode: string
  recoverable: boolean
  includeRetryMetadata: boolean
  specialCode?: string
}

function mapExitCode(exitCode: number): ExitCodeMapping {
  switch (exitCode as AgentlyMailExitCode) {
    case 0:
      return {
        status: 'success',
        errorCode: 'success',
        recoverable: false,
        includeRetryMetadata: false,
      }
    case 1:
      return {
        status: 'failed',
        errorCode: 'AGENTLY_SERVER_ERROR',
        recoverable: true,
        includeRetryMetadata: true,
      }
    case 2:
      return {
        status: 'failed',
        errorCode: 'INVALID_PARAMETERS',
        recoverable: false,
        includeRetryMetadata: false,
      }
    case 3:
      return {
        status: 'auth_required',
        errorCode: 'AUTH_EXPIRED',
        recoverable: true,
        includeRetryMetadata: false,
      }
    case 4:
      return {
        status: 'failed',
        errorCode: 'LOCAL_NETWORK_ERROR',
        recoverable: true,
        includeRetryMetadata: true,
      }
    case 6:
      return {
        status: 'failed',
        errorCode: 'PERMANENT_REJECTION',
        recoverable: false,
        includeRetryMetadata: false,
      }
    case 7:
      return {
        status: 'rate_limited',
        errorCode: 'RATE_LIMITED',
        recoverable: true,
        includeRetryMetadata: true,
      }
    case 8:
      return {
        status: 'failed',
        errorCode: 'MISSING_CONFIRMATION_TOKEN',
        recoverable: true,
        includeRetryMetadata: false,
        specialCode: 'MISSING_CONFIRMATION_TOKEN',
      }
    default:
      return {
        status: 'failed',
        errorCode: 'UNKNOWN_EXIT_CODE',
        recoverable: false,
        includeRetryMetadata: false,
      }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize raw AgentlyMail CLI output into a ConnectorResponse.
 *
 * @param rawStdout - Raw stdout from the CLI process
 * @param rawStderr - Raw stderr from the CLI process
 * @param exitCode  - Process exit code (expected: 0,1,2,3,4,6,7,8)
 * @param requestId - Caller-assigned request ID
 * @param connectorInstanceId - Connector instance that produced this output
 */
export function normalizeAgentlyMailResponse(
  rawStdout: string,
  rawStderr: string,
  exitCode: number,
  requestId: string,
  connectorInstanceId: string,
): ConnectorResponse {
  const envelope = parseEnvelope(rawStdout)
  const mapping = mapExitCode(exitCode)

  // ── Success (exit 0) ──────────────────────────────────────────────────────
  if (exitCode === 0) {
    const data = envelope && isSuccessEnvelope(envelope) ? envelope.data : undefined
    return {
      status: 'success',
      requestId,
      connectorInstanceId,
      data,
    }
  }

  // ── Non-zero exits ────────────────────────────────────────────────────────
  const redactedStderr = redactSecrets(rawStderr)

  // Extract error details from envelope when available
  let envelopeErrorCode: string | undefined
  let envelopeMessage: string | undefined
  if (envelope && isErrorEnvelope(envelope)) {
    envelopeErrorCode = envelope.error.code
    envelopeMessage = envelope.error.message
  }

  // Build the error message: prefer envelope, fall back to redacted stderr
  const errorMessage = envelopeMessage ?? (redactedStderr.trim().length > 0
    ? redactedStderr.trim()
    : `CLI exited with code ${exitCode}`)

  // Build base response
  const response: ConnectorResponse = {
    status: mapping.status,
    requestId,
    connectorInstanceId,
    error: {
      code: mapping.specialCode ?? envelopeErrorCode ?? mapping.errorCode,
      message: errorMessage,
      recoverable: mapping.recoverable,
    },
  }

  // ── Retry metadata for recoverable / rate-limited errors ──────────────────
  if (mapping.status === 'rate_limited') {
    const retryAfterMs = parseRetryAfterMs(
      envelope && isRecord(envelope) && 'metadata' in envelope
        ? (envelope as Record<string, unknown>).metadata
        : undefined,
    ) ?? DEFAULT_RETRY_AFTER_MS

    response.metadata = {
      retryAfterMs,
    }
  } else if (mapping.includeRetryMetadata) {
    response.metadata = {
      retryAfterMs: DEFAULT_RETRY_AFTER_MS,
    }
  }

  return response
}
