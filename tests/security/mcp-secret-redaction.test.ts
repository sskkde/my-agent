/**
 * MCP Secret Redaction Tests
 *
 * Validates that credentials embedded in MCP URLs, config objects, and error
 * messages are properly redacted before reaching metadata, logs, or audit events.
 */

import { describe, it, expect } from 'vitest'
import {
  redactMcpUrl,
  redactMcpConfig,
  redactMcpErrorMessage,
} from '../../src/connectors/mcp/mcp-secret-redaction.js'

const SENTINEL_SECRET = 'AMAP_SECRET_SHOULD_NOT_APPEAR'

describe('MCP Secret Redaction', () => {
  // =========================================================================
  // URL redaction
  // =========================================================================
  describe('redactMcpUrl', () => {
    it('redacts ?key= from AMap MCP URL', () => {
      const url = `https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}`
      const redacted = redactMcpUrl(url)

      expect(redacted).toBe('https://mcp.amap.com/mcp?key=%5BREDACTED%5D')
      expect(redacted).not.toContain(SENTINEL_SECRET)
    })

    it('redacts api_key query parameter', () => {
      const url = `https://mcp.amap.com/sse?api_key=${SENTINEL_SECRET}`
      const redacted = redactMcpUrl(url)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('api_key=%5BREDACTED%5D')
    })

    it('redacts token query parameter', () => {
      const url = `https://mcp.amap.com/mcp?token=${SENTINEL_SECRET}&format=json`
      const redacted = redactMcpUrl(url)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('token=%5BREDACTED%5D')
      expect(redacted).toContain('format=json')
    })

    it('redacts access_token query parameter', () => {
      const url = `https://mcp.amap.com/mcp?access_token=${SENTINEL_SECRET}`
      const redacted = redactMcpUrl(url)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('access_token=%5BREDACTED%5D')
    })

    it('redacts multiple sensitive params in same URL', () => {
      const url = `https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}&token=another_secret&safe=value`
      const redacted = redactMcpUrl(url)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).not.toContain('another_secret')
      expect(redacted).toContain('safe=value')
    })

    it('preserves URLs without sensitive params', () => {
      const url = 'https://mcp.amap.com/mcp?format=json&lang=zh'
      const redacted = redactMcpUrl(url)

      expect(redacted).toBe(url)
    })

    it('handles invalid URLs gracefully', () => {
      const result = redactMcpUrl('not-a-valid-url')
      expect(result).toBe('not-a-valid-url')
    })

    it('handles empty string', () => {
      expect(redactMcpUrl('')).toBe('')
    })

    it('handles non-string input gracefully', () => {
      // @ts-expect-error testing runtime safety
      expect(redactMcpUrl(undefined)).toBeUndefined()
      // @ts-expect-error testing runtime safety
      expect(redactMcpUrl(null)).toBeNull()
    })
  })

  // =========================================================================
  // Config/object redaction
  // =========================================================================
  describe('redactMcpConfig', () => {
    it('redacts apiKey field in config object', () => {
      const config = { apiKey: SENTINEL_SECRET, name: 'amap' }
      const redacted = redactMcpConfig(config)

      expect(redacted.apiKey).toBe('[REDACTED]')
      expect(redacted.name).toBe('amap')
    })

    it('redacts token field in config object', () => {
      const config = { token: SENTINEL_SECRET, endpoint: '/mcp' }
      const redacted = redactMcpConfig(config)

      expect(redacted.token).toBe('[REDACTED]')
      expect(redacted.endpoint).toBe('/mcp')
    })

    it('redacts access_token field in config object', () => {
      const config = { access_token: SENTINEL_SECRET, userId: 'u1' }
      const redacted = redactMcpConfig(config)

      expect(redacted.access_token).toBe('[REDACTED]')
      expect(redacted.userId).toBe('u1')
    })

    it('redacts nested secret fields', () => {
      const config = {
        server: { baseUrl: 'https://mcp.amap.com/mcp', apiKey: SENTINEL_SECRET },
        auth: { authorization: `Bearer ${SENTINEL_SECRET}` },
      }
      const redacted = redactMcpConfig(config)

      expect(redacted.server.apiKey).toBe('[REDACTED]')
      expect(redacted.server.baseUrl).toBe('https://mcp.amap.com/mcp')
      expect(redacted.auth.authorization).toBe('[REDACTED]')
    })

    it('redacts secrets in arrays', () => {
      const config = {
        connections: [
          { name: 'prod', apiKey: SENTINEL_SECRET },
          { name: 'dev', token: 'dev_secret' },
        ],
      }
      const redacted = redactMcpConfig(config)

      expect(redacted.connections[0].apiKey).toBe('[REDACTED]')
      expect(redacted.connections[0].name).toBe('prod')
      expect(redacted.connections[1].token).toBe('[REDACTED]')
    })

    it('redacts URLs with embedded secrets in string values', () => {
      const config = {
        endpoint: `https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}`,
        name: 'amap',
      }
      const redacted = redactMcpConfig(config)

      expect(redacted.endpoint).not.toContain(SENTINEL_SECRET)
      expect(redacted.endpoint).toContain('[REDACTED]')
      expect(redacted.name).toBe('amap')
    })

    it('handles circular references safely', () => {
      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj
      const redacted = redactMcpConfig(obj)

      expect(redacted.name).toBe('test')
      expect(redacted.self).toBe('[Circular]')
    })

    it('preserves null and undefined', () => {
      expect(redactMcpConfig(null)).toBeNull()
      expect(redactMcpConfig(undefined)).toBeUndefined()
    })

    it('preserves primitive values', () => {
      expect(redactMcpConfig(42)).toBe(42)
      expect(redactMcpConfig(true)).toBe(true)
      expect(redactMcpConfig('hello')).toBe('hello')
    })
  })

  // =========================================================================
  // Error message redaction
  // =========================================================================
  describe('redactMcpErrorMessage', () => {
    it('redacts URLs with embedded secrets in error messages', () => {
      const message = `Connection failed to https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}`
      const redacted = redactMcpErrorMessage(message)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('[REDACTED]')
    })

    it('redacts bearer tokens in error messages', () => {
      const message = `Auth failed: Bearer ${SENTINEL_SECRET}`
      const redacted = redactMcpErrorMessage(message)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('[REDACTED]')
    })

    it('redacts inline api_key=value patterns', () => {
      const message = `Config error: api_key=${SENTINEL_SECRET}`
      const redacted = redactMcpErrorMessage(message)

      expect(redacted).not.toContain(SENTINEL_SECRET)
      expect(redacted).toContain('[REDACTED]')
    })

    it('truncates excessively long messages', () => {
      const longMessage = 'x'.repeat(1000)
      const redacted = redactMcpErrorMessage(longMessage)

      expect(redacted.length).toBeLessThanOrEqual(500)
      expect(redacted).toContain('...')
    })

    it('handles empty string', () => {
      expect(redactMcpErrorMessage('')).toBe('')
    })

    it('handles non-string input', () => {
      // @ts-expect-error testing runtime safety
      expect(redactMcpErrorMessage(null)).toBe('[SANITIZATION_ERROR]')
      // @ts-expect-error testing runtime safety
      expect(redactMcpErrorMessage(undefined)).toBe('[SANITIZATION_ERROR]')
    })

    it('preserves non-sensitive error messages', () => {
      const message = 'MCP session is disconnected or unhealthy'
      const redacted = redactMcpErrorMessage(message)

      expect(redacted).toBe(message)
    })
  })

  // =========================================================================
  // Sentinel verification: AMAP_SECRET_SHOULD_NOT_APPEAR
  // =========================================================================
  describe('sentinel verification', () => {
    it('sentinel never appears in redacted URL output', () => {
      const url = `https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}`
      const serialized = JSON.stringify(redactMcpUrl(url))
      expect(serialized).not.toContain(SENTINEL_SECRET)
    })

    it('sentinel never appears in redacted config output', () => {
      const config = {
        baseUrl: `https://mcp.amap.com/mcp?key=${SENTINEL_SECRET}`,
        apiKey: SENTINEL_SECRET,
        token: SENTINEL_SECRET,
        access_token: SENTINEL_SECRET,
        nested: { secret: SENTINEL_SECRET },
      }
      const serialized = JSON.stringify(redactMcpConfig(config))
      expect(serialized).not.toContain(SENTINEL_SECRET)
    })

    it('sentinel never appears in redacted error output', () => {
      const message = `Failed: api_key=${SENTINEL_SECRET} token=${SENTINEL_SECRET}`
      const serialized = JSON.stringify(redactMcpErrorMessage(message))
      expect(serialized).not.toContain(SENTINEL_SECRET)
    })
  })
})
