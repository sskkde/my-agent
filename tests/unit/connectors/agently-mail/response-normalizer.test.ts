import { describe, it, expect } from 'vitest'
import {
  normalizeAgentlyMailResponse,
  redactSecrets,
  parseRetryAfterMs,
} from '../../../../src/connectors/agently-mail/response-normalizer.js'

describe('agently-mail/response-normalizer', () => {
  const requestId = 'req-test-001'
  const connectorInstanceId = 'conn-agently-001'

  const successEnvelope = JSON.stringify({ data: { id: 'msg_abc123', subject: 'Hello' } })
  const errorEnvelope = JSON.stringify({
    error: { code: 'SOME_ERROR', message: 'Something went wrong' },
  })

  // ── redactSecrets ─────────────────────────────────────────────────────────

  describe('redactSecrets', () => {
    it('should redact long alphanumeric strings that look like tokens', () => {
      const input = 'Error: token abcdefghijklmnopqrstuvwxyz012345 expired'
      const result = redactSecrets(input)
      expect(result).toBe('Error: token [REDACTED] expired')
    })

    it('should redact strings with hyphens and underscores', () => {
      const input = 'cookie: session_abc_def-ghi_jkl_mno_pqr_stu'
      const result = redactSecrets(input)
      expect(result).toBe('cookie: [REDACTED]')
    })

    it('should NOT redact short strings', () => {
      const input = 'Error code: abc123'
      const result = redactSecrets(input)
      expect(result).toBe('Error code: abc123')
    })

    it('should redact multiple secrets in one line', () => {
      const input = 'tok_Abcdefghijklmnopqrst012345 and tok_Xywzabcedfghijklmnopqr'
      const result = redactSecrets(input)
      expect(result).toBe('[REDACTED] and [REDACTED]')
    })

    it('should handle empty string', () => {
      expect(redactSecrets('')).toBe('')
    })

    it('should preserve surrounding diagnostic text', () => {
      const input = 'Connection failed to mail.example.com with token abcdefghijklmnopqrstuvwxyz012345'
      const result = redactSecrets(input)
      expect(result).toBe('Connection failed to mail.example.com with token [REDACTED]')
    })
  })

  // ── parseRetryAfterMs ─────────────────────────────────────────────────────

  describe('parseRetryAfterMs', () => {
    it('should convert seconds number to milliseconds', () => {
      expect(parseRetryAfterMs(60)).toBe(60_000)
    })

    it('should convert numeric string seconds to milliseconds', () => {
      expect(parseRetryAfterMs('120')).toBe(120_000)
    })

    it('should return undefined for null/undefined', () => {
      expect(parseRetryAfterMs(null)).toBeUndefined()
      expect(parseRetryAfterMs(undefined)).toBeUndefined()
    })

    it('should return undefined for negative values', () => {
      expect(parseRetryAfterMs(-5)).toBeUndefined()
    })

    it('should handle zero', () => {
      expect(parseRetryAfterMs(0)).toBe(0)
    })

    it('should handle object with retry_after field', () => {
      const result = parseRetryAfterMs({ retry_after: 30 })
      expect(result).toBe(30_000)
    })

    it('should return undefined for non-retry_after object', () => {
      expect(parseRetryAfterMs({ foo: 'bar' })).toBeUndefined()
    })
  })

  // ── Exit code 0: success ──────────────────────────────────────────────────

  describe('exit code 0 (success)', () => {
    it('should return status=success with data from envelope', () => {
      const result = normalizeAgentlyMailResponse(
        successEnvelope, '', 0, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('success')
      expect(result.requestId).toBe(requestId)
      expect(result.connectorInstanceId).toBe(connectorInstanceId)
      expect(result.data).toEqual({ id: 'msg_abc123', subject: 'Hello' })
      expect(result.error).toBeUndefined()
    })

    it('should return status=success with undefined data when stdout is empty', () => {
      const result = normalizeAgentlyMailResponse('', '', 0, requestId, connectorInstanceId)

      expect(result.status).toBe('success')
      expect(result.data).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    it('should return status=success with undefined data when stdout is malformed JSON', () => {
      const result = normalizeAgentlyMailResponse('not json!!!', '', 0, requestId, connectorInstanceId)

      expect(result.status).toBe('success')
      expect(result.data).toBeUndefined()
    })
  })

  // ── Exit code 1: server error / network fluctuation ───────────────────────

  describe('exit code 1 (server error)', () => {
    it('should return status=failed with recoverable=true and retry metadata', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 1, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.message).toBe('Something went wrong')
      expect(result.error?.recoverable).toBe(true)
      expect(result.metadata?.retryAfterMs).toBe(30_000)
    })

    it('should fall back to redacted stderr when no envelope', () => {
      const stderr = 'Server returned 500 with token abcdefghijklmnopqrstuvwxyz012345'
      const result = normalizeAgentlyMailResponse('', stderr, 1, requestId, connectorInstanceId)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toContain('[REDACTED]')
      expect(result.error?.message).not.toContain('abcdefghijklmnopqrstuvwxyz012345')
      expect(result.error?.recoverable).toBe(true)
      expect(result.metadata?.retryAfterMs).toBe(30_000)
    })

    it('should use fallback message when no envelope and empty stderr', () => {
      const result = normalizeAgentlyMailResponse('', '', 1, requestId, connectorInstanceId)

      expect(result.error?.message).toBe('CLI exited with code 1')
    })
  })

  // ── Exit code 2: invalid parameters ───────────────────────────────────────

  describe('exit code 2 (invalid parameters)', () => {
    it('should return status=failed with recoverable=false and no retry metadata', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 2, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.recoverable).toBe(false)
      expect(result.metadata?.retryAfterMs).toBeUndefined()
    })
  })

  // ── Exit code 3: auth expired ─────────────────────────────────────────────

  describe('exit code 3 (auth expired)', () => {
    it('should return status=auth_required (NOT success)', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 3, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('auth_required')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.message).toBe('Something went wrong')
      expect(result.error?.recoverable).toBe(true)
    })

    it('should NOT return success for exit 3 even with valid JSON stdout', () => {
      const result = normalizeAgentlyMailResponse(
        successEnvelope, '', 3, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('auth_required')
      expect(result.status).not.toBe('success')
    })

    it('should fall back to stderr when no envelope', () => {
      const result = normalizeAgentlyMailResponse(
        '', 'Authentication expired', 3, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('auth_required')
      expect(result.error?.message).toBe('Authentication expired')
    })
  })

  // ── Exit code 4: local network error ──────────────────────────────────────

  describe('exit code 4 (local network error)', () => {
    it('should return status=failed with recoverable=true and retry metadata', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 4, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.recoverable).toBe(true)
      expect(result.metadata?.retryAfterMs).toBe(30_000)
    })
  })

  // ── Exit code 6: permanent rejection ──────────────────────────────────────

  describe('exit code 6 (permanent rejection)', () => {
    it('should return status=failed with recoverable=false and no retry metadata', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 6, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.recoverable).toBe(false)
      expect(result.metadata?.retryAfterMs).toBeUndefined()
    })
  })

  // ── Exit code 7: rate limited ─────────────────────────────────────────────

  describe('exit code 7 (rate limited)', () => {
    it('should return status=rate_limited with retry metadata', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 7, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('rate_limited')
      expect(result.error?.code).toBe('SOME_ERROR')
      expect(result.error?.recoverable).toBe(true)
      expect(result.metadata?.retryAfterMs).toBeDefined()
    })

    it('should use default retry delay when no Retry-After in envelope', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 7, requestId, connectorInstanceId,
      )

      expect(result.metadata?.retryAfterMs).toBe(30_000)
    })

    it('should parse Retry-After from envelope metadata', () => {
      const envelopeWithRetry = JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        metadata: { retry_after: 120 },
      })

      const result = normalizeAgentlyMailResponse(
        envelopeWithRetry, '', 7, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('rate_limited')
      expect(result.metadata?.retryAfterMs).toBe(120_000)
    })

    it('should fall back to stderr when no envelope', () => {
      const result = normalizeAgentlyMailResponse(
        '', 'Rate limit exceeded', 7, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('rate_limited')
      expect(result.error?.message).toBe('Rate limit exceeded')
      expect(result.metadata?.retryAfterMs).toBe(30_000)
    })
  })

  // ── Exit code 8: missing confirmation token ───────────────────────────────

  describe('exit code 8 (missing confirmation token)', () => {
    it('should return status=failed with special MISSING_CONFIRMATION_TOKEN code', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 8, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MISSING_CONFIRMATION_TOKEN')
      expect(result.error?.recoverable).toBe(true)
    })

    it('should NOT return success for exit 8', () => {
      const result = normalizeAgentlyMailResponse(
        successEnvelope, '', 8, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MISSING_CONFIRMATION_TOKEN')
    })
  })

  // ── Unknown exit codes ────────────────────────────────────────────────────

  describe('unknown exit codes', () => {
    it('should return status=failed with recoverable=false for exit 99', () => {
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, '', 99, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.recoverable).toBe(false)
    })
  })

  // ── Malformed / empty JSON ────────────────────────────────────────────────

  describe('malformed and empty stdout', () => {
    it('should handle completely empty stdout', () => {
      const result = normalizeAgentlyMailResponse('', '', 1, requestId, connectorInstanceId)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toBe('CLI exited with code 1')
    })

    it('should handle malformed JSON stdout', () => {
      const result = normalizeAgentlyMailResponse(
        '{broken json', 'stderr output', 1, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.message).toBe('stderr output')
    })

    it('should handle JSON array instead of object', () => {
      const result = normalizeAgentlyMailResponse(
        '[1, 2, 3]', '', 1, requestId, connectorInstanceId,
      )

      expect(result.status).toBe('failed')
      expect(result.error?.message).toBe('CLI exited with code 1')
    })

    it('should handle whitespace-only stdout', () => {
      const result = normalizeAgentlyMailResponse('   \n  \t  ', '', 0, requestId, connectorInstanceId)

      expect(result.status).toBe('success')
      expect(result.data).toBeUndefined()
    })
  })

  // ── Secret redaction in stderr ─────────────────────────────────────────────

  describe('secret redaction in stderr', () => {
    it('should redact tokens in stderr before including in error message', () => {
      const stderr = 'Auth failed: token sk_abcdefghijklmnopqrstuvwxyz0123456789 is invalid'
      const result = normalizeAgentlyMailResponse('', stderr, 3, requestId, connectorInstanceId)

      expect(result.error?.message).toContain('[REDACTED]')
      expect(result.error?.message).not.toContain('sk_abcdefghijklmnopqrstuvwxyz0123456789')
    })

    it('should prefer envelope message over stderr when both present', () => {
      const stderr = 'secret_token abcdefghijklmnopqrstuvwxyz012345 leaked'
      const result = normalizeAgentlyMailResponse(
        errorEnvelope, stderr, 1, requestId, connectorInstanceId,
      )

      expect(result.error?.message).toBe('Something went wrong')
    })
  })

  // ── ConnectorResponse shape ───────────────────────────────────────────────

  describe('ConnectorResponse shape', () => {
    it('should always include requestId and connectorInstanceId', () => {
      const result = normalizeAgentlyMailResponse('', '', 0, requestId, connectorInstanceId)

      expect(result.requestId).toBe(requestId)
      expect(result.connectorInstanceId).toBe(connectorInstanceId)
    })

    it('should never return success for any non-zero exit code', () => {
      const nonZeroCodes = [1, 2, 3, 4, 6, 7, 8, 99, -1, 255]
      for (const code of nonZeroCodes) {
        const result = normalizeAgentlyMailResponse(
          successEnvelope, '', code, requestId, connectorInstanceId,
        )
        expect(result.status).not.toBe('success')
      }
    })
  })
})
