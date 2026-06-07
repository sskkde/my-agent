import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'

describe('OAuth API Integration', () => {
  let server: FastifyInstance
  let context: ApiContext
  let authToken: string
  let userId: string
  let originalFetch: typeof globalThis.fetch

  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production'
  const TEST_GOOGLE_CLIENT_ID = 'test-google-client-id'
  const TEST_GOOGLE_CLIENT_SECRET = 'test-google-client-secret'

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY
    process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_SECRET = TEST_GOOGLE_CLIENT_SECRET
    process.env.PUBLIC_BASE_URL = 'http://localhost:3003'

    const contextResult = createApiContext({ dbPath: ':memory:' })
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`)
    }
    context = contextResult

    server = await createApiServer(context)

    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'oauth-test-user',
      passwordHash: await hashPassword('testpassword'),
    })

    authToken = generateSessionToken()
    const tokenHash = hashToken(authToken)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    context.stores.authTokenStore.create({
      tokenHash,
      userId,
      expiresAt,
    })

    originalFetch = globalThis.fetch
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    delete process.env.APP_SECRET_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.PUBLIC_BASE_URL
    await server.close()
    context.connection.close()
  })

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('GET /api/v1/connectors/:type/oauth/authorize', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return authorize URL for calendar', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(true)
      expect(body.data.authorizeUrl).toBeDefined()
      expect(body.data.authorizeUrl).toContain('accounts.google.com')
      expect(body.data.authorizeUrl).toContain('client_id=')
      expect(body.data.stateId).toBeDefined()
      expect(body.data.codeVerifier).toBeDefined()
      expect(body.data.expiresAt).toBeDefined()
    })

    it('should return authorize URL for contacts', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/contacts/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(true)
      expect(body.data.authorizeUrl).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcontacts')
    })

    it('should return authorize URL for docs', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/docs/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(true)
      expect(body.data.authorizeUrl).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdocuments')
    })

    it('should return 400 for unsupported connector type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/unsupported/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.error.message).toContain('Unsupported connector type')
    })

    it('should return 503 when OAuth not configured', async () => {
      const savedClientId = process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_ID

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      process.env.GOOGLE_CLIENT_ID = savedClientId

      expect(response.statusCode).toBe(503)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    })
  })

  describe('POST /api/v1/connectors/:type/oauth/callback', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        payload: { code: 'test-code', state: 'test-state', codeVerifier: 'test-verifier' },
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 400 for missing fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code' },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.error.message).toContain('Missing required fields')
    })

    it('should return 400 for invalid state', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code', state: 'invalid-state', codeVerifier: 'test-verifier' },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('OAUTH_ERROR')
    })

    it('should complete OAuth flow with valid state', async () => {
      const authorizeResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const authBody = JSON.parse(authorizeResponse.body)
      const { stateId, codeVerifier } = authBody.data

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const callbackResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code', state: stateId, codeVerifier },
      })

      expect(callbackResponse.statusCode).toBe(200)
      const body = JSON.parse(callbackResponse.body)
      expect(body.ok).toBe(true)
      expect(body.data.instanceId).toBeDefined()
      expect(body.data.connectorType).toBe('calendar')
      expect(body.data.providerId).toBe('google')
    })

    it('should return 400 for unsupported connector type in callback', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/unsupported/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code', state: 'test-state', codeVerifier: 'test-verifier' },
      })

      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
    })
  })

  describe('POST /api/v1/connectors/:instanceId/oauth/revoke', () => {
    let instanceId: string

    beforeEach(async () => {
      const authorizeResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const authBody = JSON.parse(authorizeResponse.body)
      const { stateId, codeVerifier } = authBody.data

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const callbackResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code', state: stateId, codeVerifier },
      })

      const body = JSON.parse(callbackResponse.body)
      instanceId = body.data.instanceId
    })

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/connectors/${instanceId}/oauth/revoke`,
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 404 for unknown instance', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/connectors/${randomUUID()}/oauth/revoke`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should revoke token for valid instance', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/connectors/${instanceId}/oauth/revoke`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(true)
      expect(body.data.revoked).toBe(true)
      expect(body.data.instanceId).toBe(instanceId)
    })

    it('should return 500 when revocation fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
      })

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/connectors/${instanceId}/oauth/revoke`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(500)
      const body = JSON.parse(response.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('REVOKE_FAILED')
    })
  })

  describe('OAuth State Expiration', () => {
    it('should return error for expired state', async () => {
      const authorizeResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/calendar/oauth/authorize',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const authBody = JSON.parse(authorizeResponse.body)
      const { codeVerifier } = authBody.data

      await new Promise((resolve) => setTimeout(resolve, 100))

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })

      const callbackResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/connectors/calendar/oauth/callback',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { code: 'test-code', state: 'expired-state-id', codeVerifier },
      })

      expect(callbackResponse.statusCode).toBe(400)
      const body = JSON.parse(callbackResponse.body)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('OAUTH_ERROR')
    })
  })
})
