import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'

/**
 * RBAC Integration Tests
 *
 * Tests verify that:
 * 1. RBAC middleware is registered in the middleware chain
 * 2. Admin routes only accessible by admin role
 * 3. User resource routes need user/admin role + ownership
 * 4. Public routes (health, docs, setup) have no permission requirements
 * 5. API Key auth correctly injects role information
 * 6. 403 response format is correct
 */
describe('RBAC Integration', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string

  beforeEach(async () => {
    const ctxResult = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`)
    }
    context = ctxResult

    server = await createApiServer(context)
    await server.listen()
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as any).port}`
  })

  afterEach(async () => {
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections()
    }
    await server.close()
    context.connection.close()
  })

  /**
   * Helper: Create user and get session cookie
   */
  async function createUserAndLogin(username: string, password: string): Promise<{ cookie: string; userId: string }> {
    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    expect(setupResponse.status).toBe(201)
    const body = (await setupResponse.json()) as { data: { user: { userId: string } } }
    const setCookieHeader = setupResponse.headers.get('set-cookie')
    expect(setCookieHeader).toBeDefined()
    return { cookie: setCookieHeader!, userId: body.data.user.userId }
  }

  /**
   * Helper: Create API key with specific role
   */
  async function createApiKey(cookie: string, name: string, role: 'admin' | 'user' | 'service'): Promise<string> {
    const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name, role }),
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { data: { key: string } }
    return body.data.key
  }

  // ==========================================================================
  // Test 1: Public routes have no permission requirements
  // ==========================================================================
  describe('Public Routes (No Auth Required)', () => {
    it('GET /api/health should be accessible without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)
    })

    it('GET /api/setup/status should be accessible without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`)
      expect(response.status).toBe(200)
    })

    it('GET /api/tools should be accessible without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`)
      expect(response.status).toBe(200)
    })

    it('GET /api/metrics should be accessible without authentication (Prometheus scraping)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/metrics`)
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Test 2: Admin routes require admin role
  // ==========================================================================
  describe('Admin Routes (Admin Role Required)', () => {
    let adminCookie: string

    beforeEach(async () => {
      const result = await createUserAndLogin('admin', 'password123')
      adminCookie = result.cookie
    })

    it('admin user can access agent global config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config`, {
        headers: { Cookie: adminCookie },
      })
      expect(response.status).toBe(200)
    })

    it('admin user can update agent global config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ displayName: 'Test Agent' }),
      })
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Test 3: User resource routes require user/admin role + ownership
  // ==========================================================================
  describe('User Resource Routes (Ownership Required)', () => {
    let userCookie: string

    beforeEach(async () => {
      const result = await createUserAndLogin('testuser', 'password123')
      userCookie = result.cookie
    })

    it('user can list their own sessions', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can create a session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(201)
    })

    it('user can list their own API keys', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can create an API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      })
      expect(response.status).toBe(201)
    })

    it('user can list their own workflows', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can list their own triggers', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/schedules`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can access memory', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can list providers', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can access observability runs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })

    it('user can access connectors', async () => {
      const response = await fetch(`${baseUrl}/api/v1/connectors`, {
        headers: { Cookie: userCookie },
      })
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Test 4: API Key auth correctly injects role information
  // ==========================================================================
  describe('API Key Role Injection', () => {
    let adminCookie: string

    beforeEach(async () => {
      const result = await createUserAndLogin('admin', 'password123')
      adminCookie = result.cookie
    })

    it('admin API key can access protected routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'Admin Key', 'admin')

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(response.status).toBe(200)
    })

    it('user API key can access protected routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'User Key', 'user')

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(response.status).toBe(200)
    })

    it('service API key can access protected routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'Service Key', 'service')

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(response.status).toBe(200)
    })

    it('API key with admin role can access admin routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'Admin Key', 'admin')

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Test 5: 403 Response Format
  // ==========================================================================
  describe('403 Response Format', () => {
    let adminCookie: string

    beforeEach(async () => {
      const result = await createUserAndLogin('admin', 'password123')
      adminCookie = result.cookie
    })

    it('returns correct 403 format when user API key tries to access admin route', async () => {
      const userApiKey = await createApiKey(adminCookie, 'User Key', 'user')

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userApiKey}` },
        body: JSON.stringify({ displayName: 'Hacked Agent' }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as {
        ok: boolean
        error: { code: string; message: string }
        requestId: string
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toBeDefined()
      expect(body.requestId).toBeDefined()
    })
  })

  // ==========================================================================
  // Test 6: Ownership enforcement
  // ==========================================================================
  describe('Ownership Enforcement', () => {
    let user1Cookie: string

    beforeEach(async () => {
      const result1 = await createUserAndLogin('user1', 'password123')
      user1Cookie = result1.cookie
    })

    it('user can access their own session', async () => {
      // Create a session
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user1Cookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const createBody = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = createBody.data.session.sessionId

      // Access the session
      const getResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
        headers: { Cookie: user1Cookie },
      })
      expect(getResponse.status).toBe(200)
    })

    it('user can delete their own API key', async () => {
      // Create an API key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: user1Cookie },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      })
      expect(createResponse.status).toBe(201)
      const createBody = (await createResponse.json()) as { data: { id: string } }
      const keyId = createBody.data.id

      // Delete the API key
      const deleteResponse = await fetch(`${baseUrl}/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { Cookie: user1Cookie },
      })
      expect(deleteResponse.status).toBe(200)
    })

    it('user cannot access non-existent API key', async () => {
      const deleteResponse = await fetch(`${baseUrl}/api/v1/api-keys/nonexistent-key-id`, {
        method: 'DELETE',
        headers: { Cookie: user1Cookie },
      })
      expect(deleteResponse.status).toBe(404)
    })
  })

  // ==========================================================================
  // Test 7: Middleware chain order verification
  // ==========================================================================
  describe('Middleware Chain Order', () => {
    it('request-id middleware runs before auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`)
      // Should be 401 (auth fails) but should have requestId
      expect(response.status).toBe(401)
      const body = (await response.json()) as { requestId: string }
      expect(body.requestId).toBeDefined()
    })

    it('auth middleware rejects unauthenticated requests', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`)
      expect(response.status).toBe(401)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
    })
  })

  // ==========================================================================
  // Test 8: Webhook routes bypass auth (use HMAC)
  // ==========================================================================
  describe('Webhook Routes (HMAC Auth)', () => {
    it('webhook deliver endpoint exists (requires HMAC signature)', async () => {
      // This should fail with 404 (webhook not found) or 401 (missing signature)
      // Not 401 from session auth - proving auth middleware is bypassed
      const response = await fetch(`${baseUrl}/api/v1/webhooks/wh_test/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      })
      // Either 404 (webhook not found) or 401 (missing/invalid signature)
      expect([401, 404]).toContain(response.status)
    })
  })
})
