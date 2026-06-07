import { describe, it, expect } from 'vitest'
import { createModelInputRedactor } from '../../../../src/kernel/model-input/model-input-redactor.js'

describe('ModelInputRedactor', () => {
  describe('key-based redaction', () => {
    it('redacts fields with sensitive key names', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        name: 'test',
        password: 'super-secret',
        apiKey: 'sk-12345',
        token: 'bearer-abc',
      }

      const result = redactor.redact(payload)

      expect(result.name).toBe('test')
      expect(result.password).toBe('[REDACTED]')
      expect(result.apiKey).toBe('[REDACTED]')
      expect(result.token).toBe('[REDACTED]')
    })

    it('redacts nested sensitive fields', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        user: {
          name: 'Alice',
          auth: {
            secret: 'my-secret',
            accessToken: 'tok-123',
          },
        },
      }

      const result = redactor.redact(payload)

      expect(result.user.name).toBe('Alice')
      expect(result.user.auth.secret).toBe('[REDACTED]')
      expect(result.user.auth.accessToken).toBe('[REDACTED]')
    })

    it('redacts case-insensitively', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        Password: 'secret1',
        API_KEY: 'secret2',
        Authorization: 'Bearer xyz',
      }

      const result = redactor.redact(payload)

      expect(result.Password).toBe('[REDACTED]')
      expect(result.API_KEY).toBe('[REDACTED]')
      expect(result.Authorization).toBe('[REDACTED]')
    })

    it('redacts keys containing sensitive patterns as substrings', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        userPassword: 'secret',
        refreshTokenValue: 'tok-abc',
        apiSecretKey: 'sk-123',
      }

      const result = redactor.redact(payload)

      expect(result.userPassword).toBe('[REDACTED]')
      expect(result.refreshTokenValue).toBe('[REDACTED]')
      expect(result.apiSecretKey).toBe('[REDACTED]')
    })
  })

  describe('content-based redaction', () => {
    it('redacts JSON-like key:value patterns in strings', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        log: 'User logged in with password: "super-secret"',
        config: 'api_key: "sk-12345" for production',
      }

      const result = redactor.redact(payload)

      expect(result.log).toBe('User logged in with password: [REDACTED]')
      expect(result.config).toContain('[REDACTED]')
      expect(result.config).not.toContain('sk-12345')
    })

    it('redacts PEM certificate blocks in strings', () => {
      const redactor = createModelInputRedactor()
      const pemBlock = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdef
-----END RSA PRIVATE KEY-----`
      const payload = {
        certificate: pemBlock,
        name: 'test-cert',
      }

      const result = redactor.redact(payload)

      expect(result.certificate).toBe('[REDACTED]')
      expect(result.name).toBe('test-cert')
    })

    it('redacts authorization patterns in strings', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        header: 'authorization: "Bearer sk-or-12345"',
      }

      const result = redactor.redact(payload)

      expect(result.header).toContain('[REDACTED]')
      expect(result.header).not.toContain('sk-or-12345')
    })
  })

  describe('array handling', () => {
    it('redacts sensitive fields in arrays', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        users: [
          { name: 'Alice', password: 'pass1' },
          { name: 'Bob', password: 'pass2' },
        ],
      }

      const result = redactor.redact(payload)

      expect(result.users[0].name).toBe('Alice')
      expect(result.users[0].password).toBe('[REDACTED]')
      expect(result.users[1].name).toBe('Bob')
      expect(result.users[1].password).toBe('[REDACTED]')
    })
  })

  describe('primitive handling', () => {
    it('returns null and undefined as-is', () => {
      const redactor = createModelInputRedactor()
      expect(redactor.redact(null)).toBe(null)
      expect(redactor.redact(undefined)).toBe(undefined)
    })

    it('returns numbers and booleans as-is', () => {
      const redactor = createModelInputRedactor()
      expect(redactor.redact(42)).toBe(42)
      expect(redactor.redact(true)).toBe(true)
    })

    it('returns non-sensitive strings as-is', () => {
      const redactor = createModelInputRedactor()
      expect(redactor.redact('hello world')).toBe('hello world')
    })
  })

  describe('deep clone behavior', () => {
    it('does not mutate the original payload', () => {
      const redactor = createModelInputRedactor()
      const payload = { password: 'secret', name: 'test' }
      const result = redactor.redact(payload)

      expect(result.password).toBe('[REDACTED]')
      expect(payload.password).toBe('secret')
    })
  })

  describe('custom options', () => {
    it('supports extra redact fields', () => {
      const redactor = createModelInputRedactor({
        extraRedactFields: ['customSensitive'],
      })
      const payload = {
        customSensitive: 'should-be-redacted',
        normalField: 'visible',
      }

      const result = redactor.redact(payload)

      expect(result.customSensitive).toBe('[REDACTED]')
      expect(result.normalField).toBe('visible')
    })

    it('supports extra sensitive patterns', () => {
      const redactor = createModelInputRedactor({
        extraSensitivePatterns: [{ pattern: /internal-id:\s*\d+/gi, replacement: 'internal-id: [REDACTED]' }],
      })
      const payload = {
        log: 'internal-id: 12345 processed',
      }

      const result = redactor.redact(payload)

      expect(result.log).toBe('internal-id: [REDACTED] processed')
    })
  })

  describe('security guarantees', () => {
    it('snapshot must not contain raw API keys', () => {
      const redactor = createModelInputRedactor()
      const payload = { apiKey: 'sk-or-v1-1234567890abcdef' }
      const result = redactor.redact(payload)
      const serialized = JSON.stringify(result)

      expect(serialized).not.toContain('sk-or-v1-1234567890abcdef')
      expect(result.apiKey).toBe('[REDACTED]')
    })

    it('snapshot must not contain OAuth refresh tokens', () => {
      const redactor = createModelInputRedactor()
      const payload = { refreshToken: 'refresh-abc-123' }
      const result = redactor.redact(payload)

      expect(result.refreshToken).toBe('[REDACTED]')
    })

    it('snapshot must not contain authorization headers', () => {
      const redactor = createModelInputRedactor()
      const payload = { authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9' }
      const result = redactor.redact(payload)

      expect(result.authHeader).toBe('[REDACTED]')
    })

    it('snapshot must not contain database passwords', () => {
      const redactor = createModelInputRedactor()
      const payload = { dbPassword: 'postgres://admin:password123@db' }
      const result = redactor.redact(payload)

      expect(result.dbPassword).toBe('[REDACTED]')
    })

    it('snapshot must not contain private key PEM blocks', () => {
      const redactor = createModelInputRedactor()
      const payload = {
        config: 'key = -----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
      }
      const result = redactor.redact(payload)

      expect(result.config).not.toContain('BEGIN PRIVATE KEY')
      expect(result.config).toContain('[REDACTED]')
    })

    it('snapshot must not contain webhook secrets', () => {
      const redactor = createModelInputRedactor()
      const payload = { webhookSecret: 'whsec_abc123' }
      const result = redactor.redact(payload)

      expect(result.webhookSecret).toBe('[REDACTED]')
    })

    it('snapshot must not contain credentials', () => {
      const redactor = createModelInputRedactor()
      const payload = { credentials: { user: 'admin', pass: 'secret' } }
      const result = redactor.redact(payload)

      expect(result.credentials).toBe('[REDACTED]')
    })
  })
})
