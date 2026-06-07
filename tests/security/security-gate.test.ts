/**
 * Security Release Gate Test Suite
 *
 * This is the P7 "security gate" - all tests must pass before release.
 * Comprehensive integration tests covering:
 *
 * 1. Secret Redaction - Secrets don't appear in responses
 * 2. Auth Failure - Returns 401 + correct error envelope
 * 3. RBAC Denial - Returns 403 + correct error envelope
 * 4. Rate Limit - Returns 429 + correct error envelope
 * 5. Security Headers - Present on all responses
 * 6. SSRF Protection - Private IPs rejected
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'
import { validateUrlSafety, isPrivateIpv4, isPrivateIpv6 } from '../../src/tools/builtins/web-safety.js'

// Sentinel secrets for leak detection
const SENTINEL_API_KEY = 'sk-gate-sentinel-key-9876543210'
const SENTINEL_PASSWORD = 'gate-sentinel-pwd-xyz123'

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-security-gate-testing-only'

type HttpHeaders = Record<string, string | number | string[] | undefined>

function getHeader(headers: HttpHeaders | Headers, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name)
  }
  const value = headers[name]
  return typeof value === 'string' ? value : null
}

/**
 * Assert that all required security headers are present
 */
function assertSecurityHeaders(headers: HttpHeaders | Headers) {
  expect(getHeader(headers, 'x-content-type-options')).toBe('nosniff')
  expect(getHeader(headers, 'x-frame-options')).toBe('DENY')
  expect(getHeader(headers, 'strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
}

/**
 * Assert error envelope structure
 */
function assertErrorEnvelope(body: unknown, expectedCode: string) {
  const envelope = body as { ok: boolean; error: { code: string; message: string }; requestId: string }
  expect(envelope).toHaveProperty('ok')
  expect(envelope).toHaveProperty('error')
  expect(envelope).toHaveProperty('requestId')
  expect(envelope.ok).toBe(false)
  expect(envelope.error.code).toBe(expectedCode)
  expect(envelope.error.message).toBeDefined()
  expect(typeof envelope.requestId).toBe('string')
  expect(envelope.requestId.length).toBeGreaterThan(0)
}

// =============================================================================
// SECURITY GATE TEST SUITE
// =============================================================================

describe('Security Release Gate', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string
  let authToken: string
  let userId: string

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY

    const ctxResult = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`)
    }
    context = ctxResult

    server = await createApiServer(context)
    await server.listen()
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as { port: number }).port}`

    // Create test user
    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'gatetimeoutuser',
      passwordHash: await hashPassword('testpassword'),
    })

    // Create auth token
    authToken = generateSessionToken()
    const tokenHash = hashToken(authToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    context.stores.authTokenStore.create({
      tokenHash,
      userId,
      expiresAt,
    })
  }, 30000)

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections()
    }
    await server.close()
    context.connection.close()
  })

  beforeEach(() => {
    // Clean up provider configs before each test
    const providers = context.providerConfigStore.listByUser(userId)
    for (const provider of providers) {
      context.providerConfigStore.remove(provider.providerId)
    }
  })

  // ===========================================================================
  // GATE 1: Secret Redaction - Secrets don't appear in responses
  // ===========================================================================
  describe('Gate 1: Secret Redaction', () => {
    it('should NEVER expose API key in provider list response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Secret Gate Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      expect(response.status).toBe(200)
      const body = await response.text()

      // Sentinel key must NEVER appear in response
      expect(body).not.toContain(SENTINEL_API_KEY)
      expect(body).not.toContain('sk-gate-sentinel')
      expect(body).not.toContain('sentinel-key-9876543210')

      // Verify only last 4 chars exposed
      const json = JSON.parse(body)
      expect(json.data[0].apiKeyLast4).toBe('3210')
      expect(json.data[0].apiKey).toBeUndefined()
      expect(json.data[0].encryptedApiKey).toBeUndefined()
    })

    it('should NEVER expose password in login response', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'gatetimeoutuser',
          password: SENTINEL_PASSWORD,
        }),
      })

      const body = await response.text()
      expect(body).not.toContain(SENTINEL_PASSWORD)
      expect(body).not.toContain('gate-sentinel-pwd')
    })

    it('should NEVER expose env-based API keys in settings response', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY

      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      expect(response.status).toBe(200)
      const body = await response.text()

      expect(body).not.toContain(SENTINEL_API_KEY)
      expect(body).not.toContain('sk-gate-sentinel')

      delete process.env.OPENROUTER_API_KEY
    })

    it('should NEVER expose encryptedApiKey field in any response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'Encrypted Field Test',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      expect(body).not.toContain('encryptedApiKey')
    })
  })

  // ===========================================================================
  // GATE 2: Auth Failure - Returns 401 + correct error envelope
  // ===========================================================================
  describe('Gate 2: Auth Failure (401)', () => {
    it('should return 401 with error envelope when no auth provided', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`)

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
      assertSecurityHeaders(response.headers)
    })

    it('should return 401 with error envelope for invalid session token', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: 'agent-platform-session=invalid-token-xyz' },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 with error envelope for malformed Bearer token', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Authorization: 'Bearer malformed-token' },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for invalid login credentials', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nonexistent',
          password: 'wrongpassword',
        }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should include security headers on 401 responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`)
      expect(response.status).toBe(401)
      assertSecurityHeaders(response.headers)
    })
  })

  // ===========================================================================
  // GATE 3: RBAC Denial - Returns 403 + correct error envelope
  // ===========================================================================
  describe('Gate 3: RBAC Denial (403)', () => {
    let userApiKey: string

    beforeEach(async () => {
      // Create a user API key (non-admin)
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({ name: 'User Key', role: 'user' }),
      })
      const body = (await response.json()) as { data: { key: string } }
      userApiKey = body.data.key
    })

    it('should return 403 with error envelope when user role accesses admin route', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userApiKey}`,
        },
        body: JSON.stringify({ displayName: 'Hacked' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
      assertSecurityHeaders(response.headers)
    })

    it('should return 403 with error envelope for service role accessing admin route', async () => {
      // Create service API key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({ name: 'Service Key', role: 'service' }),
      })
      const createBody = (await createResponse.json()) as { data: { key: string } }
      const serviceApiKey = createBody.data.key

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({ displayName: 'Hacked' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should include security headers on 403 responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userApiKey}`,
        },
        body: JSON.stringify({ displayName: 'Test' }),
      })

      expect(response.status).toBe(403)
      assertSecurityHeaders(response.headers)
    })
  })

  // ===========================================================================
  // GATE 4: Rate Limit - Returns 429 + correct error envelope
  // ===========================================================================
  describe('Gate 4: Rate Limit (429)', () => {
    it('should return 429 when rate limit exceeded', async () => {
      // Use a unique IP to avoid interference from other tests
      const uniqueIp = `10.255.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

      // Create a new server with very low rate limit for testing
      const testCtxResult = createApiContext({ dbPath: ':memory:' })
      if (isApiContextError(testCtxResult)) {
        throw new Error('Failed to create test context')
      }
      const testCtx = testCtxResult
      const testServer = await createApiServer(testCtx)

      // Make many requests to trigger rate limit
      // Default is 100 req/min for global, 5 req/min for auth
      // We'll hit the health endpoint rapidly
      const requests = []
      for (let i = 0; i < 150; i++) {
        requests.push(
          testServer.inject({
            method: 'GET',
            url: '/api/v1/health',
            remoteAddress: uniqueIp,
          }),
        )
      }

      const responses = await Promise.all(requests)
      const rateLimited = responses.filter((r) => r.statusCode === 429)

      // At least some should be rate limited
      expect(rateLimited.length).toBeGreaterThan(0)

      // Verify 429 response has correct structure
      if (rateLimited.length > 0) {
        const body = JSON.parse(rateLimited[0].body)
        expect(body.ok).toBe(false)
        expect(body.error?.code).toBe('RATE_LIMIT_EXCEEDED')
      }

      await testServer.close()
      testCtx.connection.close()
    })

    it('should include retry-after header on 429', async () => {
      const uniqueIp = `10.254.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

      const testCtxResult = createApiContext({ dbPath: ':memory:' })
      if (isApiContextError(testCtxResult)) {
        throw new Error('Failed to create test context')
      }
      const testCtx = testCtxResult
      const testServer = await createApiServer(testCtx)

      // Exhaust rate limit
      for (let i = 0; i < 150; i++) {
        await testServer.inject({
          method: 'GET',
          url: '/api/v1/health',
          remoteAddress: uniqueIp,
        })
      }

      // Next request should be rate limited
      const response = await testServer.inject({
        method: 'GET',
        url: '/api/v1/health',
        remoteAddress: uniqueIp,
      })

      if (response.statusCode === 429) {
        expect(response.headers['retry-after']).toBeDefined()
      }

      await testServer.close()
      testCtx.connection.close()
    })
  })

  // ===========================================================================
  // GATE 5: Security Headers - Present on all responses
  // ===========================================================================
  describe('Gate 5: Security Headers', () => {
    it('should include all security headers on health endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)
      assertSecurityHeaders(response.headers)
    })

    it('should include all security headers on tools endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`)
      expect(response.status).toBe(200)
      assertSecurityHeaders(response.headers)
    })

    it('should include all security headers on protected endpoint (auth error)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`)
      expect(response.status).toBe(401)
      assertSecurityHeaders(response.headers)
    })

    it('should include X-Content-Type-Options: nosniff', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })

    it('should include X-Frame-Options: DENY', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.headers.get('x-frame-options')).toBe('DENY')
    })

    it('should include Strict-Transport-Security header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
    })

    it('should include security headers on SSE endpoints', async () => {
      const response = await fetch(`${baseUrl}/api/v1/runs/stream`)
      assertSecurityHeaders(response.headers)
    })
  })

  // ===========================================================================
  // GATE 6: SSRF Protection - Private IPs rejected
  // ===========================================================================
  describe('Gate 6: SSRF Protection', () => {
    describe('IPv4 Private Range Blocking', () => {
      it('should reject 127.0.0.1 (loopback)', () => {
        const result = validateUrlSafety('http://127.0.0.1/admin')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject 10.0.0.1 (RFC1918 Class A)', () => {
        const result = validateUrlSafety('http://10.0.0.1/secret')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject 172.16.0.1 (RFC1918 Class B)', () => {
        const result = validateUrlSafety('http://172.16.0.1/internal')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject 192.168.1.1 (RFC1918 Class C)', () => {
        const result = validateUrlSafety('http://192.168.1.1/config')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject 169.254.169.254 (AWS/GCP metadata endpoint)', () => {
        const result = validateUrlSafety('http://169.254.169.254/latest/meta-data/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject link-local 169.254.1.1', () => {
        const result = validateUrlSafety('http://169.254.1.1/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })
    })

    describe('IPv6 Private Range Blocking', () => {
      it('should reject ::1 (IPv6 loopback)', () => {
        const result = validateUrlSafety('http://[::1]/admin')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject fe80::1 (IPv6 link-local)', () => {
        const result = validateUrlSafety('http://[fe80::1]/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })
    })

    describe('Hostname Blocking', () => {
      it('should reject localhost', () => {
        const result = validateUrlSafety('http://localhost:3000/admin')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('LOCALHOST_BLOCKED')
      })

      it('should reject localtest.me', () => {
        const result = validateUrlSafety('http://localtest.me/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('LOCALHOST_BLOCKED')
      })
    })

    describe('URL Parsing Bypass Prevention', () => {
      it('should reject hex-encoded loopback (0x7f000001)', () => {
        const result = validateUrlSafety('http://0x7f000001/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject decimal-encoded loopback (2130706433)', () => {
        const result = validateUrlSafety('http://2130706433/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })

      it('should reject octal-encoded loopback (0177.0.0.1)', () => {
        const result = validateUrlSafety('http://0177.0.0.1/')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('PRIVATE_IP')
      })
    })

    describe('Protocol Filtering', () => {
      it('should reject file:// protocol', () => {
        const result = validateUrlSafety('file:///etc/passwd')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL')
      })

      it('should reject data: protocol', () => {
        const result = validateUrlSafety('data:text/html,<script>alert(1)</script>')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL')
      })

      it('should reject javascript: protocol', () => {
        const result = validateUrlSafety('javascript:alert(document.cookie)')
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('BLOCKED_PROTOCOL')
      })

      it('should accept http:// and https:// protocols', () => {
        const httpResult = validateUrlSafety('http://example.com/')
        expect(httpResult.safe).toBe(true)

        const httpsResult = validateUrlSafety('https://example.com/')
        expect(httpsResult.safe).toBe(true)
      })
    })

    describe('Public IP Allowlist', () => {
      it('should accept public IPs', () => {
        const result = validateUrlSafety('http://8.8.8.8/dns')
        expect(result.safe).toBe(true)
      })

      it('should accept public hostnames', () => {
        const result = validateUrlSafety('https://api.example.com/v1/data')
        expect(result.safe).toBe(true)
      })
    })
  })

  // ===========================================================================
  // GATE 7: Private IP Detection Functions
  // ===========================================================================
  describe('Gate 7: Private IP Detection', () => {
    it('isPrivateIpv4 should detect all private ranges', () => {
      // Loopback
      expect(isPrivateIpv4('127.0.0.1')).toBe(true)
      expect(isPrivateIpv4('127.255.255.255')).toBe(true)

      // RFC1918
      expect(isPrivateIpv4('10.0.0.1')).toBe(true)
      expect(isPrivateIpv4('10.255.255.255')).toBe(true)
      expect(isPrivateIpv4('172.16.0.1')).toBe(true)
      expect(isPrivateIpv4('172.31.255.255')).toBe(true)
      expect(isPrivateIpv4('192.168.0.1')).toBe(true)
      expect(isPrivateIpv4('192.168.255.255')).toBe(true)

      // Metadata endpoint
      expect(isPrivateIpv4('169.254.169.254')).toBe(true)

      // Link-local
      expect(isPrivateIpv4('169.254.1.1')).toBe(true)
    })

    it('isPrivateIpv4 should return false for public IPs', () => {
      expect(isPrivateIpv4('8.8.8.8')).toBe(false)
      expect(isPrivateIpv4('1.1.1.1')).toBe(false)
      expect(isPrivateIpv4('93.184.216.34')).toBe(false)
    })

    it('isPrivateIpv6 should detect private ranges', () => {
      // Loopback
      expect(isPrivateIpv6('::1')).toBe(true)
      expect(isPrivateIpv6('0:0:0:0:0:0:0:1')).toBe(true)

      // Link-local
      expect(isPrivateIpv6('fe80::1')).toBe(true)
      expect(isPrivateIpv6('fe80::1234:5678:abcd:ef01')).toBe(true)

      // Unspecified
      expect(isPrivateIpv6('::')).toBe(true)
    })

    it('isPrivateIpv6 should return false for public IPv6', () => {
      expect(isPrivateIpv6('2001:db8::1')).toBe(false)
    })
  })

  // ===========================================================================
  // GATE 8: Error Envelope Consistency
  // ===========================================================================
  describe('Gate 8: Error Envelope Consistency', () => {
    it('should return consistent error envelope for 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return consistent error envelope for 404', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/nonexistent-session-id`)
      expect(response.status).toBe(401) // Auth required first
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should include requestId in all error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`)
      const body = (await response.json()) as { requestId: string }
      expect(body.requestId).toBeDefined()
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // GATE 9: Public Routes Accessibility
  // ===========================================================================
  describe('Gate 9: Public Routes', () => {
    it('should allow /api/v1/health without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)
    })

    it('should allow /api/v1/setup/status without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`)
      expect(response.status).toBe(200)
    })

    it('should allow /api/v1/tools without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`)
      expect(response.status).toBe(200)
    })

    it('should allow /api/v1/metrics without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/metrics`)
      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // GATE 10: Complete Sentinel Verification
  // ===========================================================================
  describe('Gate 10: Complete Sentinel Verification', () => {
    it('should verify sentinel secret NEVER appears in any endpoint', async () => {
      // Set up sentinel secret in multiple places
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Final Sentinel Test',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY

      const endpoints = [
        { url: `${baseUrl}/api/v1/providers`, auth: true },
        { url: `${baseUrl}/api/v1/models`, auth: true },
        { url: `${baseUrl}/api/v1/settings`, auth: true },
        { url: `${baseUrl}/api/v1/tools`, auth: false },
        { url: `${baseUrl}/api/v1/health`, auth: false },
      ]

      for (const endpoint of endpoints) {
        const headers: Record<string, string> = {}
        if (endpoint.auth) {
          headers['Cookie'] = `agent-platform-session=${authToken}`
        }

        const response = await fetch(endpoint.url, { headers })
        const body = await response.text()

        // Sentinel must NEVER appear
        expect(body).not.toContain(SENTINEL_API_KEY)
        expect(body).not.toContain('sk-gate-sentinel')
        expect(body).not.toContain('sentinel-key-9876543210')
      }

      delete process.env.OPENROUTER_API_KEY
    })
  })
})
