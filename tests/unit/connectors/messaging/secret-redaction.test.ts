/**
 * Tests for recursive secret redaction.
 */

import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../../../../src/connectors/messaging/secret-redaction.js'

describe('redactSecrets', () => {
  describe('default secret field names', () => {
    it('should redact token', () => {
      const result = redactSecrets({ token: 'secret123', name: 'ok' }) as Record<string, unknown>
      expect(result.token).toBe('[REDACTED]')
      expect(result.name).toBe('ok')
    })

    it('should redact secret', () => {
      const result = redactSecrets({ secret: 's3cret' }) as Record<string, unknown>
      expect(result.secret).toBe('[REDACTED]')
    })

    it('should redact appSecret', () => {
      const result = redactSecrets({ appSecret: 'app123' }) as Record<string, unknown>
      expect(result.appSecret).toBe('[REDACTED]')
    })

    it('should redact app_secret', () => {
      const result = redactSecrets({ app_secret: 'app_123' }) as Record<string, unknown>
      expect(result.app_secret).toBe('[REDACTED]')
    })

    it('should redact botToken', () => {
      const result = redactSecrets({ botToken: 'bot123' }) as Record<string, unknown>
      expect(result.botToken).toBe('[REDACTED]')
    })

    it('should redact bot_token', () => {
      const result = redactSecrets({ bot_token: 'bot_123' }) as Record<string, unknown>
      expect(result.bot_token).toBe('[REDACTED]')
    })

    it('should redact access_token', () => {
      const result = redactSecrets({ access_token: 'at_123' }) as Record<string, unknown>
      expect(result.access_token).toBe('[REDACTED]')
    })

    it('should redact accessToken', () => {
      const result = redactSecrets({ accessToken: 'at123' }) as Record<string, unknown>
      expect(result.accessToken).toBe('[REDACTED]')
    })

    it('should redact apiKey', () => {
      const result = redactSecrets({ apiKey: 'key123' }) as Record<string, unknown>
      expect(result.apiKey).toBe('[REDACTED]')
    })

    it('should redact api_key', () => {
      const result = redactSecrets({ api_key: 'key_123' }) as Record<string, unknown>
      expect(result.api_key).toBe('[REDACTED]')
    })

    it('should redact webhookSecret', () => {
      const result = redactSecrets({ webhookSecret: 'wh123' }) as Record<string, unknown>
      expect(result.webhookSecret).toBe('[REDACTED]')
    })

    it('should redact webhook_secret', () => {
      const result = redactSecrets({ webhook_secret: 'wh_123' }) as Record<string, unknown>
      expect(result.webhook_secret).toBe('[REDACTED]')
    })

    it('should redact verificationToken', () => {
      const result = redactSecrets({ verificationToken: 'vt123' }) as Record<string, unknown>
      expect(result.verificationToken).toBe('[REDACTED]')
    })

    it('should redact verification_token', () => {
      const result = redactSecrets({ verification_token: 'vt_123' }) as Record<string, unknown>
      expect(result.verification_token).toBe('[REDACTED]')
    })
  })

  describe('nested objects', () => {
    it('should redact secrets in nested objects', () => {
      const input = {
        name: 'connector',
        config: {
          token: 'nested-secret',
          url: 'https://example.com',
        },
      }
      const result = redactSecrets(input) as Record<string, unknown>
      const config = result.config as Record<string, unknown>
      expect(config.token).toBe('[REDACTED]')
      expect(config.url).toBe('https://example.com')
    })

    it('should redact deeply nested secrets', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              apiKey: 'deep-secret',
            },
          },
        },
      }
      const result = redactSecrets(input) as Record<string, unknown>
      const l1 = result.level1 as Record<string, unknown>
      const l2 = l1.level2 as Record<string, unknown>
      const l3 = l2.level3 as Record<string, unknown>
      expect(l3.apiKey).toBe('[REDACTED]')
    })
  })

  describe('arrays', () => {
    it('should redact secrets in arrays of objects', () => {
      const input = {
        items: [
          { token: 't1', name: 'a' },
          { token: 't2', name: 'b' },
        ],
      }
      const result = redactSecrets(input) as Record<string, unknown>
      const items = result.items as Array<Record<string, unknown>>
      expect(items[0].token).toBe('[REDACTED]')
      expect(items[0].name).toBe('a')
      expect(items[1].token).toBe('[REDACTED]')
      expect(items[1].name).toBe('b')
    })

    it('should handle top-level arrays', () => {
      const input = [{ secret: 's1' }, { secret: 's2' }]
      const result = redactSecrets(input) as Array<Record<string, unknown>>
      expect(result[0].secret).toBe('[REDACTED]')
      expect(result[1].secret).toBe('[REDACTED]')
    })
  })

  describe('circular references', () => {
    it('should handle circular references without stack overflow', () => {
      const obj: Record<string, unknown> = { name: 'root', token: 'secret' }
      obj.self = obj
      const result = redactSecrets(obj) as Record<string, unknown>
      expect(result.token).toBe('[REDACTED]')
      expect(result.self).toBe('[Circular]')
    })
  })

  describe('primitives and edge cases', () => {
    it('should return null as-is', () => {
      expect(redactSecrets(null)).toBeNull()
    })

    it('should return undefined as-is', () => {
      expect(redactSecrets(undefined)).toBeUndefined()
    })

    it('should return strings as-is', () => {
      expect(redactSecrets('hello')).toBe('hello')
    })

    it('should return numbers as-is', () => {
      expect(redactSecrets(42)).toBe(42)
    })

    it('should return booleans as-is', () => {
      expect(redactSecrets(true)).toBe(true)
    })

    it('should not mutate the original object', () => {
      const input = { token: 'original', name: 'test' }
      redactSecrets(input)
      expect(input.token).toBe('original')
    })
  })

  describe('custom secret field names', () => {
    it('should use custom field names when provided', () => {
      const result = redactSecrets(
        { password: 'pw123', token: 't123' },
        ['password'],
      ) as Record<string, unknown>
      expect(result.password).toBe('[REDACTED]')
      expect(result.token).toBe('t123')
    })
  })
})
