/**
 * Todo RBAC Security Tests (TDD RED Phase)
 *
 * Security contract tests for Todo resource access control.
 * Tests verify RBAC permissions, session ownership, and tenant isolation.
 *
 * Security Requirements:
 * 1. Unauthorized access rejection (401)
 * 2. Wrong session owner rejection (403/404)
 * 3. Wrong tenant rejection (404)
 * 4. RBAC permission checks (403 for insufficient role)
 *
 * Expected to FAIL until routes are implemented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'


const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-todo-rbac-testing-only'

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
// TODO RBAC SECURITY TESTS
// =============================================================================

describe('Todo RBAC Security Tests', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string
  let adminAuthToken: string
  let adminUserId: string
  let userAuthToken: string
  let userId: string
  let serviceApiKey: string

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

    // Create admin user
    adminUserId = randomUUID()
    context.stores.userStore.create({
      userId: adminUserId,
      username: 'todoadmin',
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

    // Create regular user
    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'todouser',
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

    // Create service API key
    const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `agent-platform-session=${adminAuthToken}`,
      },
      body: JSON.stringify({ name: 'Todo Service Key', role: 'service' }),
    })
    const createKeyBody = (await createKeyResponse.json()) as { data: { key: string } }
    serviceApiKey = createKeyBody.data.key
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
  // SCENARIO 1: Unauthorized access rejection
  // ===========================================================================
  describe('Scenario 1: Unauthorized access rejection', () => {
    let sessionId: string

    beforeEach(async () => {
      // Create session for tests
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      sessionId = sessionBody.data.session.sessionId
    })

    it('should return 401 for POST todos without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Unauthorized todo' }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for GET todos without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`)

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for PATCH todo without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/some-todo-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for DELETE todo without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/some-todo-id`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for invalid Bearer token', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Authorization: 'Bearer invalid-token-xyz',
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })

    it('should return 401 for expired session token', async () => {
      // Create an expired token
      const expiredUserId = randomUUID()
      context.stores.userStore.create({
        userId: expiredUserId,
        username: 'expireduser',
        passwordHash: await hashPassword('password'),
      })

      const expiredToken = generateSessionToken()
      const expiredTokenHash = hashToken(expiredToken)
      const pastExpiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      context.stores.authTokenStore.create({
        tokenHash: expiredTokenHash,
        userId: expiredUserId,
        expiresAt: pastExpiresAt,
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
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
  // SCENARIO 2: Wrong session owner rejection
  // ===========================================================================
  describe('Scenario 2: Wrong session owner rejection', () => {
    let adminSessionId: string
    let userSessionId: string

    beforeEach(async () => {
      // Create session owned by admin
      const adminSessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })
      const adminSessionBody = (await adminSessionResponse.json()) as { data: { session: { sessionId: string } } }
      adminSessionId = adminSessionBody.data.session.sessionId

      // Create session owned by regular user
      const userSessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })
      const userSessionBody = (await userSessionResponse.json()) as { data: { session: { sessionId: string } } }
      userSessionId = userSessionBody.data.session.sessionId
    })

    it('should deny user from creating todo in admin session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Unauthorized todo' }),
      })

      // Should return 403 (forbidden) or 404 (not found) to not leak session existence
      expect([403, 404]).toContain(response.status)
    })

    it('should deny user from listing todos in admin session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos`, {
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect([403, 404]).toContain(response.status)
    })

    it('should deny user from updating todo in admin session', async () => {
      // Create a todo in admin session
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ content: 'Admin todo' }),
      })
      const createBody = (await createResponse.json()) as { data: { todo: { todoId: string } } }
      const todoId = createBody.data.todo.todoId

      // Try to update as regular user
      const response = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos/${todoId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect([403, 404]).toContain(response.status)
    })

    it('should deny user from deleting todo in admin session', async () => {
      // Create a todo in admin session
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
        body: JSON.stringify({ content: 'Admin todo to delete' }),
      })
      const createBody = (await createResponse.json()) as { data: { todo: { todoId: string } } }
      const todoId = createBody.data.todo.todoId

      // Try to delete as regular user
      const response = await fetch(`${baseUrl}/api/v1/sessions/${adminSessionId}/todos/${todoId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect([403, 404]).toContain(response.status)
    })

    it('should allow owner to create todo in their own session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${userSessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'User todo' }),
      })

      expect(response.status).toBe(201)
    })

    it('should allow admin to access any session todos', async () => {
      // User creates a todo
      await fetch(`${baseUrl}/api/v1/sessions/${userSessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'User todo' }),
      })

      // Admin should be able to list
      const response = await fetch(`${baseUrl}/api/v1/sessions/${userSessionId}/todos`, {
        headers: {
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })

      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // SCENARIO 3: RBAC permission checks - Service role
  // ===========================================================================
  describe('Scenario 3: Service role cannot access todos', () => {
    let sessionId: string

    beforeEach(async () => {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${adminAuthToken}`,
        },
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      sessionId = sessionBody.data.session.sessionId
    })

    it('should deny service role from creating todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({ content: 'Service todo' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should deny service role from listing todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Authorization: `Bearer ${serviceApiKey}`,
        },
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should deny service role from updating todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/some-id`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceApiKey}`,
        },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(403)
      const body = await response.json()
      assertErrorEnvelope(body, 'FORBIDDEN')
    })

    it('should deny service role from deleting todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/some-id`, {
        method: 'DELETE',
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
  // SCENARIO 4: Cross-session isolation
  // ===========================================================================
  describe('Scenario 4: Cross-session isolation', () => {
    let sessionA: string
    let sessionB: string
    let todoInA: string

    beforeEach(async () => {
      // Create two sessions for the same user
      const sessionAResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })
      const sessionABody = (await sessionAResponse.json()) as { data: { session: { sessionId: string } } }
      sessionA = sessionABody.data.session.sessionId

      const sessionBResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })
      const sessionBBody = (await sessionBResponse.json()) as { data: { session: { sessionId: string } } }
      sessionB = sessionBBody.data.session.sessionId

      // Create todo in session A
      const todoResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionA}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Todo in session A' }),
      })
      const todoBody = (await todoResponse.json()) as { data: { todo: { todoId: string } } }
      todoInA = todoBody.data.todo.todoId
    })

    it('should not allow updating todo from different session', async () => {
      // Try to update todo from session A using session B's route
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionB}/todos/${todoInA}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      assertErrorEnvelope(body, 'NOT_FOUND')
    })

    it('should not allow deleting todo from different session', async () => {
      // Try to delete todo from session A using session B's route
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionB}/todos/${todoInA}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect(response.status).toBe(404)
      const body = await response.json()
      assertErrorEnvelope(body, 'NOT_FOUND')
    })

    it('should list only todos from the correct session', async () => {
      // Create todo in session B
      await fetch(`${baseUrl}/api/v1/sessions/${sessionB}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Todo in session B' }),
      })

      // List todos in session A
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionA}/todos`, {
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      const body = (await response.json()) as { data: { todos: Array<{ todoId: string }> } }
      const todoIds = body.data.todos.map((t) => t.todoId)

      // Should only contain todos from session A
      expect(todoIds).toContain(todoInA)
      // Session B's todo should NOT be visible
      expect(body.data.todos.filter((t) => t.todoId !== todoInA)).toHaveLength(0)
    })
  })

  // ===========================================================================
  // SCENARIO 5: Resource type permission checks
  // ===========================================================================
  describe('Scenario 5: Resource type permission checks', () => {
    let sessionId: string

    beforeEach(async () => {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      sessionId = sessionBody.data.session.sessionId
    })

    it('should require sessions.create permission for POST', async () => {
      // Regular user has sessions.create, should succeed
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Test todo' }),
      })

      expect(response.status).toBe(201)
    })

    it('should require sessions.read permission for GET', async () => {
      // Regular user has sessions.read, should succeed
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect(response.status).toBe(200)
    })

    it('should require sessions.update permission for PATCH', async () => {
      // Create a todo first
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Todo to update' }),
      })
      const createBody = (await createResponse.json()) as { data: { todo: { todoId: string } } }
      const todoId = createBody.data.todo.todoId

      // Regular user has sessions.update, should succeed
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${todoId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(200)
    })

    it('should require sessions.delete permission for DELETE', async () => {
      // Create a todo first
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ content: 'Todo to delete' }),
      })
      const createBody = (await createResponse.json()) as { data: { todo: { todoId: string } } }
      const todoId = createBody.data.todo.todoId

      // Regular user has sessions.delete, should succeed
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${todoId}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // SCENARIO 6: API Key authentication
  // ===========================================================================
  describe('Scenario 6: API Key authentication', () => {
    let userApiKey: string
    let sessionId: string

    beforeEach(async () => {
      // Create user API key
      const createKeyResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
        body: JSON.stringify({ name: 'User Todo Key', role: 'user' }),
      })
      const createKeyBody = (await createKeyResponse.json()) as { data: { key: string } }
      userApiKey = createKeyBody.data.key

      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userApiKey}`,
        },
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      sessionId = sessionBody.data.session.sessionId
    })

    it('should allow user API key to create todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userApiKey}`,
        },
        body: JSON.stringify({ content: 'API Key todo' }),
      })

      expect(response.status).toBe(201)
    })

    it('should allow user API key to list todos', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Authorization: `Bearer ${userApiKey}`,
        },
      })

      expect(response.status).toBe(200)
    })

    it('should deny revoked API key', async () => {
      // Get the key ID from the list endpoint
      const listResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })
      const listBody = (await listResponse.json()) as { data: Array<{ id: string; prefix: string }> }
      // The list returns an array directly at data (not wrapped in { keys: [...] })
      // Match by prefix since the raw key is not returned in the list
      const keyPrefix = userApiKey.slice(0, 8)
      const keyEntry = listBody.data.find((k) => k.prefix === keyPrefix || userApiKey.startsWith(k.prefix))

      // Revoke the key
      await fetch(`${baseUrl}/api/v1/api-keys/${keyEntry!.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: `agent-platform-session=${userAuthToken}`,
        },
      })

      // Try to use revoked key
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Authorization: `Bearer ${userApiKey}`,
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })
  })

  // ===========================================================================
  // SCENARIO 7: Revoked session token
  // ===========================================================================
  describe('Scenario 7: Revoked session token', () => {
    it('should deny access with revoked session token', async () => {
      // Create a user with session
      const tempUserId = randomUUID()
      context.stores.userStore.create({
        userId: tempUserId,
        username: `revoked-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      const tempToken = generateSessionToken()
      context.stores.authTokenStore.create({
        tokenHash: hashToken(tempToken),
        userId: tempUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })

      // Create session
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${tempToken}`,
        },
      })
      const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = sessionBody.data.session.sessionId

      // Revoke the auth token (simulate logout)
      context.stores.authTokenStore.revoke(hashToken(tempToken))

      // Try to access todos with revoked token
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: {
          Cookie: `agent-platform-session=${tempToken}`,
        },
      })

      expect(response.status).toBe(401)
      const body = await response.json()
      assertErrorEnvelope(body, 'UNAUTHORIZED')
    })
  })
})
