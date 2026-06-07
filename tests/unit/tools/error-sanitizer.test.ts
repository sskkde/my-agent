import { describe, it, expect } from 'vitest'
import { sanitizeErrorMessage, formatPersistedError } from '../../../src/tools/error-sanitizer.js'

describe('sanitizeErrorMessage', () => {
  describe('secret redaction', () => {
    it('should redact OpenAI-style API keys (sk-)', () => {
      const message = 'Connection failed with key sk-1234567890abcdefghijklmnopqrstuvwxyz'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz')
      expect(sanitized).toContain('[REDACTED_API_KEY]')
    })

    it('should redact generic API keys with api_key prefix', () => {
      const message = 'Error: api_key=EXAMPLE_KEY_NOT_REAL_12345678 not found'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('EXAMPLE_KEY_NOT_REAL_12345678')
      expect(sanitized).toContain('[REDACTED]')
    })

    it('should redact Bearer tokens', () => {
      const message =
        'Authorization failed: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
      expect(sanitized).toContain('[REDACTED_TOKEN]')
    })

    it('should redact token values with token= prefix', () => {
      const message = 'Config error: token="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" is invalid'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
      expect(sanitized).toContain('[REDACTED_TOKEN]')
    })

    it('should redact access tokens', () => {
      const message =
        'access_token=ya29.a0AfH6SMBxXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('ya29.a0AfH6SMBx')
      expect(sanitized).toContain('[REDACTED_TOKEN]')
    })

    it('should redact passwords', () => {
      const message = 'Database connection failed: password=supersecretpassword123'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('supersecretpassword123')
      expect(sanitized).toContain('[REDACTED_PASSWORD]')
    })

    it('should redact passwd values', () => {
      const message = 'Auth error: passwd="my_secret_password"'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('my_secret_password')
      expect(sanitized).toContain('[REDACTED_PASSWORD]')
    })

    it('should redact AWS access keys', () => {
      const message = 'AWS auth failed: AKIAIOSFODNN7EXAMPLE'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(sanitized).toContain('[REDACTED_AWS_KEY]')
    })

    it('should redact long hex tokens', () => {
      const message = 'Token a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 is invalid'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
      expect(sanitized).toContain('[REDACTED_TOKEN]')
    })

    it('should redact long base64-encoded values', () => {
      const message =
        'Encoded secret: SGVsbG8gV29ybGQhVGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdGhhdCBzaG91bGQgYmUgcmVkYWN0ZWQ='
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).toContain('[REDACTED]')
    })

    it('should redact private key blocks', () => {
      const message =
        'Key error: -----BEGIN PRIVATE KEY-----MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC-----END PRIVATE KEY-----'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC')
      expect(sanitized).toContain('[REDACTED_PRIVATE_KEY]')
    })

    it('should redact connection string passwords', () => {
      const message = 'Failed to connect: mongodb://admin:secretpass123@localhost:27017/db'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('secretpass123')
      expect(sanitized).toContain('[REDACTED_PASSWORD]')
    })

    it('should redact postgres connection strings', () => {
      const message = 'PostgreSQL error: postgres://user:mypassword@db.example.com:5432/mydb'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('mypassword')
      expect(sanitized).toContain('[REDACTED_PASSWORD]')
    })
  })

  describe('multiple secrets in one message', () => {
    it('should redact multiple different secret types', () => {
      const message =
        'Failed with api_key=sk-test12345678901234567890 and password=secret123 and bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.test'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).not.toContain('sk-test12345678901234567890')
      expect(sanitized).not.toContain('secret123')
      expect(sanitized).toContain('[REDACTED_API_KEY]')
      expect(sanitized).toContain('[REDACTED_PASSWORD]')
      expect(sanitized).toContain('[REDACTED_TOKEN]')
    })
  })

  describe('message length bounding', () => {
    it('should truncate messages longer than 500 characters', () => {
      const longMessage = 'Error: ' + '!'.repeat(600)
      const sanitized = sanitizeErrorMessage(longMessage)
      expect(sanitized.length).toBeLessThanOrEqual(500)
      expect(sanitized).toContain('...')
    })

    it('should preserve messages shorter than 500 characters', () => {
      const shortMessage = 'Error: Connection refused'
      const sanitized = sanitizeErrorMessage(shortMessage)
      expect(sanitized).toBe(shortMessage)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(sanitizeErrorMessage('')).toBe('')
    })

    it('should handle null/undefined by returning fallback', () => {
      expect(sanitizeErrorMessage(null as unknown as string)).toBe('[SANITIZATION_ERROR]')
      expect(sanitizeErrorMessage(undefined as unknown as string)).toBe('[SANITIZATION_ERROR]')
    })

    it('should handle non-string types', () => {
      expect(sanitizeErrorMessage(123 as unknown as string)).toBe('[SANITIZATION_ERROR]')
      expect(sanitizeErrorMessage({} as unknown as string)).toBe('[SANITIZATION_ERROR]')
    })

    it('should not redact safe content', () => {
      const message = 'User authentication failed: invalid credentials'
      const sanitized = sanitizeErrorMessage(message)
      expect(sanitized).toBe(message)
    })
  })
})

describe('formatPersistedError', () => {
  it('should format error with code prefix', () => {
    const message = 'Connection refused'
    const formatted = formatPersistedError('EXECUTION_FAILED', message)
    expect(formatted).toBe('[EXECUTION_FAILED] Connection refused')
  })

  it('should sanitize secrets in formatted message', () => {
    const message = 'Failed with key sk-123456789012345678901234567890'
    const formatted = formatPersistedError('EXECUTION_FAILED', message)
    expect(formatted).not.toContain('sk-123456789012345678901234567890')
    expect(formatted).toContain('[REDACTED_API_KEY]')
    expect(formatted).toContain('[EXECUTION_FAILED]')
  })

  it('should handle different error codes', () => {
    expect(formatPersistedError('SCHEMA_VALIDATION_FAILED', 'Invalid field')).toBe(
      '[SCHEMA_VALIDATION_FAILED] Invalid field',
    )
    expect(formatPersistedError('PERMISSION_DENIED', 'Access denied')).toBe('[PERMISSION_DENIED] Access denied')
    expect(formatPersistedError('TIMEOUT', 'Operation timed out')).toBe('[TIMEOUT] Operation timed out')
  })
})
