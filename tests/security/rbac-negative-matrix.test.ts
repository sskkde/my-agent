/**
 * RBAC Negative Test Matrix
 *
 * Comprehensive negative test scenarios for Role-Based Access Control.
 * Tests verify that roles are properly restricted from unauthorized actions.
 *
 * Test Scenarios:
 * 1. User cannot modify agent global config (requires manage permission)
 * 2. Service cannot access user admin routes
 * 3. Revoked API Key cannot access any route
 * 4. User cannot create providers (requires create permission)
 * 5. Cross-owner resource access denied
 * 6. Service cannot create sessions (only has read permission)
 * 7. Expired session token returns 401
 * 8. No-auth request to protected route returns 401
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-rbac-matrix-testing-only'

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
// RBAC NEGATIVE TEST MATRIX
// =============================================================================

describe('RBAC Negative Test Matrix', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string
  let adminAuthToken: string
  let adminUserId: string
  let userAuthToken: string
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

    adminUserId = randomUUID()
    context.stores.userStore.create({
      userId: adminUserId,
      username: 'rbacadmin',
      passwordHash: await hashPassword('adminpassword'),
      role: 'admin',
    })

    adminAuthToken = generateSessionToken()
    const adminTokenHash = hashToken(adminAuthToken)
    const adminExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    context.stores.authTokenStore.create({
      tokenHash: adminTokenHash,
      userId: adminUserId,
      expiresAt: adminExpiresAt,
    })

    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'rbacuser',
      passwordHash: await hashPassword('userpassword'),
      role: 'user',
    })

    userAuthToken = generateSessionToken()
    const userTokenHash = hashToken(userAuthToken)
    const userExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    context.stores.authTokenStore.create({
      tokenHash: userTokenHash,
      userId,
      expiresAt: userExpiresAt,
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

  // ===========================================================================
  // SCENARIO 1: User cannot modify agent global config
  // ===========================================================================
  describe('Scenario 1: User cannot modify agent global config', () => {
    it('should return 403 when user role tries to PATCH agent global config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ displayName: 'Hacked Config' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when user role tries to PATCH agent global config via API key', async () => {
      // Create user API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ name: 'User Key', role: 'user' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string } }
      const userApiKey = createKeyBody.data.key

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userApiKey}`,
        },
        body: JSON.stringify({ displayName: 'Hacked Config' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })
  })

  // ===========================================================================
  // SCENARIO 2: Service cannot access user admin routes
  // ===========================================================================
  describe('Scenario 2: Service cannot access user admin routes', () => {
    let serviceApiKey: string

    beforeEach(async () => {
      // Create service API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ name: 'Service Key', role: 'service' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string } }
      serviceApiKey = createKeyBody.data.key
    })

    it('should return 403 when service role tries to PATCH agent global config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({ displayName: 'Service Hack' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when service role tries to create a provider', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({
          providerType: 'openai',
          displayName: 'Service Provider',
          apiKey: 'sk-test',
        }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when service role tries to list API keys', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: {
          Authorization: `Bearer ${serviceApiKey}`,
        },
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })
  })

  // ===========================================================================
  // SCENARIO 3: Revoked API Key cannot access any route
  // ===========================================================================
  describe('Scenario 3: Revoked API Key cannot access any route', () => {
    it('should return 401 when using a revoked API key', async () => {
      // Create an API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ name: 'Key To Revoke', role: 'user' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string; id: string } }
      const apiKey = createKeyBody.data.key
      const keyId = createKeyBody.data.id

      // Revoke the key
      const revokeResponse = await fetch(`${baseUrl}/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })
      expect(revokeResponse.status).toBe(200)

      // Try to use the revoked key
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 when using revoked key on protected endpoint', async () => {
      // Create an API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ name: 'Another Key To Revoke', role: 'user' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string; id: string } }
      const apiKey = createKeyBody.data.key
      const keyId = createKeyBody.data.id

      // Revoke the key
      await fetch(`${baseUrl}/api/v1/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })

      // Try to access providers with revoked key
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })
  })

  // ===========================================================================
  // SCENARIO 4: User cannot create providers
  // ===========================================================================
  describe('Scenario 4: User cannot create providers', () => {
    it('should return 403 when user role tries to POST provider', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({
          providerType: 'openai',
          displayName: 'User Provider',
          apiKey: 'sk-test-key',
        }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when user role tries to DELETE provider', async () => {
      // First create a provider as admin
      const createResponse = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({
          providerType: 'openai',
          displayName: 'Admin Provider',
          apiKey: 'sk-admin-key',
        }),
      })
      const createBody = (await createResponse.json()) as { data: { providerId: string } }
      const providerId = createBody.data.providerId

      // Try to delete as user
      const response = await fetch(`${baseUrl}/api/v1/providers/${providerId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when user role tries to test provider', async () => {
      // First create a provider as admin
      const createResponse = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({
          providerType: 'openai',
          displayName: 'Admin Provider 2',
          apiKey: 'sk-admin-key-2',
        }),
      })
      const createBody = (await createResponse.json()) as { data: { providerId: string } }
      const providerId = createBody.data.providerId

      // Try to test as user
      const response = await fetch(`${baseUrl}/api/v1/providers/${providerId}/test`, {
        method: 'POST',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })
  })

  // ===========================================================================
  // SCENARIO 5: Cross-owner resource access denied
  // ===========================================================================
  describe('Scenario 5: Cross-owner resource access denied', () => {
    it('should deny user A from accessing user B sessions', async () => {
      // Create session as user B (admin)
      const createSessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({}),
      })
      const sessionBody = (await createSessionResponse.json()) as { data: { id: string } }
      const sessionId = sessionBody.data.id

      // Try to access as user A (regular user)
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      // Should return 404 (not found) or 403 (forbidden)
      expect([403, 404]).toContain(response.status)
    })

    it('should deny user A from modifying user B workflow', async () => {
      const createDraftResponse = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({
          name: 'Admin Workflow',
          steps: [{ stepId: 'step-1', stepType: 'task', name: 'First Step' }],
        }),
      })

      if (createDraftResponse.status === 201) {
        const draftBody = (await createDraftResponse.json()) as { data: { draftId: string } }
        const draftId = draftBody.data.draftId

        const response = await fetch(`${baseUrl}/api/v1/workflows/drafts/${draftId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `agent-platform-session=${userAuthToken}`,
          },
          body: JSON.stringify({ name: 'Hacked Workflow' }),
        })

        expect([403, 404]).toContain(response.status)
      }
    })
  })

  // ===========================================================================
  // SCENARIO 6: Service cannot create sessions
  // ===========================================================================
  describe('Scenario 6: Service cannot create sessions', () => {
    let serviceApiKey: string

    beforeEach(async () => {
      // Create service API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ name: 'Service Key for Sessions', role: 'service' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string } }
      serviceApiKey = createKeyBody.data.key
    })

    it('should return 403 when service role tries to create session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should return 403 when service role tries to create workflow', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({
          name: 'Service Workflow',
          steps: [{ stepId: 'step-1', stepType: 'task', name: 'First Step' }],
        }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })
  })

  // ===========================================================================
  // SCENARIO 7: Expired session token returns 401
  // ===========================================================================
  describe('Scenario 7: Expired session token returns 401', () => {
    it('should return 401 when using expired session token', async () => {
      // Create a user
      const expiredUserId = randomUUID()
      context.stores.userStore.create({
        userId: expiredUserId,
        username: 'expireduser',
        passwordHash: await hashPassword('password'),
      })

      // Create an expired token
      const expiredToken = generateSessionToken()
      const expiredTokenHash = hashToken(expiredToken)
      const pastExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Expired 24h ago
      context.stores.authTokenStore.create({
        tokenHash: expiredTokenHash,
        userId: expiredUserId,
        expiresAt: pastExpiresAt,
      })

      // Try to use expired token
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          Cookie: `agent-platform-session=${expiredToken}`,
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })
  })

  // ===========================================================================
  // SCENARIO 8: No-auth request to protected route returns 401
  // ===========================================================================
  describe('Scenario 8: No-auth request to protected route returns 401', () => {
    it('should return 401 when no auth provided to protected endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`)

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 when no auth provided to providers endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`)

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 when no auth provided to workflows endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`)

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 when invalid Bearer token provided', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          Authorization: 'Bearer invalid-token-xyz',
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 when malformed session cookie provided', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          Cookie: 'agent-platform-session=malformed-session-value',
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })
  })

  // ===========================================================================
  // ADDITIONAL: Admin can perform all actions
  // ===========================================================================
  describe('Additional: Admin can perform privileged actions', () => {
    it('should allow admin to create API keys', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ name: 'Admin Key', role: 'admin' }),
      })

      expect(response.status).toBe(201)
    })

    it('should allow admin to create providers', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({
          providerType: 'openai',
          displayName: 'Admin Test Provider',
          apiKey: 'sk-admin-test',
        }),
      })

      expect(response.status).toBe(201)
    })

    it('should allow admin to modify agent global config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ displayName: 'Admin Config' }),
      })

      expect(response.status).toBe(200)
    })
  })
})
