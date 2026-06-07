/**
 * Secret Redaction GA Gate Test Suite
 *
 * This is the P8 "secret redaction GA gate" - comprehensive tests ensuring
 * secrets are properly redacted across all system outputs.
 *
 * Coverage:
 * 1. API Key (ak_ prefix) shows only first 8 chars in responses
 * 2. Provider API keys are completely hidden in error messages
 * 3. Audit events do not contain full API keys
 * 4. Connector error responses don't leak secrets
 * 5. Debug endpoint responses don't expose full keys
 * 6. Backup metadata doesn't include plaintext secrets
 * 7. Settings response doesn't expose env-based API keys
 * 8. Complete sentinel verification across all endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'

// Sentinel secrets for leak detection - unique patterns to detect leaks
const SENTINEL_API_KEY = 'sk-ga-sentinel-key-abcdefghijklmnop1234567890'
const SENTINEL_PROVIDER_KEY = 'sk-provider-sentinel-xyz987654321'
const SENTINEL_PASSWORD = 'ga-sentinel-pwd-xyz123'

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-secret-redaction-ga-testing-only'

/**
 * Assert that a sentinel key does NOT appear in the response body
 */
function assertNoSentinelInBody(body: string, sentinel: string, context: string) {
  expect(body, `${context}: Full sentinel should not appear`).not.toContain(sentinel)
  // Also check for partial leaks of significant portions
  const sentinelMiddle = sentinel.slice(4, -4)
  expect(body, `${context}: Middle portion of sentinel should not appear`).not.toContain(sentinelMiddle)
}

describe('Secret Redaction GA Gate', () => {
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
      username: 'redactiongateuser',
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
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
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
  // SCENARIO 1: API Key (ak_ prefix) shows only first 8 chars in responses
  // ===========================================================================
  describe('Scenario 1: API Key First 8 Chars Only', () => {
    it('should show only first 8 chars of API key in create response', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      })

      expect(response.status).toBe(201)
      const body = await response.text()
      const json = JSON.parse(body)

      // The full key is returned once on creation, but should follow ak_ format
      const key = json.data.key
      expect(key).toMatch(/^ak_[a-f0-9]{64}$/)

      // Verify the prefix is stored correctly (first 8 chars)
      expect(json.data.prefix).toBe(key.slice(0, 8))
      expect(json.data.prefix).toMatch(/^ak_[a-f0-9]{5}$/)
    })

    it('should NOT expose full API key in list response', async () => {
      // Create an API key first
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({ name: 'List Test Key', role: 'user' }),
      })

      const createBody = (await createResponse.json()) as { data: { key: string } }
      const fullKey = createBody.data.key

      // List API keys
      const listResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      expect(listResponse.status).toBe(200)
      const listBody = await listResponse.text()

      // Full key should NOT appear in list
      assertNoSentinelInBody(listBody, fullKey, 'API key list')
    })
  })

  // ===========================================================================
  // SCENARIO 2: Provider API keys are completely hidden in error messages
  // ===========================================================================
  describe('Scenario 2: Provider API Key Hidden in Errors', () => {
    it('should not expose provider API key in test connection error', async () => {
      // Create provider with sentinel key
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'Error Test Provider',
        apiKey: SENTINEL_PROVIDER_KEY,
        enabled: true,
      })

      // List providers to get the ID
      const listResponse = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const listBody = (await listResponse.json()) as { data: Array<{ providerId: string }> }
      const providerId = listBody.data[0]?.providerId

      if (providerId) {
        // Test the provider (will likely fail due to invalid key)
        const testResponse = await fetch(`${baseUrl}/api/v1/providers/${providerId}/test`, {
          method: 'POST',
          headers: { Cookie: `agent-platform-session=${authToken}` },
        })

        const testBody = await testResponse.text()
        assertNoSentinelInBody(testBody, SENTINEL_PROVIDER_KEY, 'Provider test error')
      }
    })

    it('should not expose provider API key in update error', async () => {
      const providerId = randomUUID()
      context.providerConfigStore.create({
        providerId,
        userId,
        providerType: 'openai',
        displayName: 'Update Error Test',
        apiKey: SENTINEL_PROVIDER_KEY,
        enabled: true,
      })

      // Attempt update with invalid data
      const response = await fetch(`${baseUrl}/api/v1/providers/${providerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({ displayName: '' }), // Invalid empty name
      })

      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_PROVIDER_KEY, 'Provider update error')
    })
  })

  // ===========================================================================
  // SCENARIO 3: Audit events do not contain full API keys
  // ===========================================================================
  describe('Scenario 3: Audit Events Redaction', () => {
    it('should not expose API key in audit event payload', async () => {
      // Create a provider to trigger audit event
      const createResponse = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `agent-platform-session=${authToken}`,
        },
        body: JSON.stringify({
          providerType: 'openrouter',
          displayName: 'Audit Test Provider',
          apiKey: SENTINEL_API_KEY,
        }),
      })

      expect(createResponse.status).toBe(201)

      // Check audit records directly
      const auditStore = context.auditRecorder.getStore()
      const allRecords = auditStore.findByUser(userId)

      // Verify no audit record contains the sentinel key
      for (const record of allRecords) {
        const recordJson = JSON.stringify(record.payload)
        assertNoSentinelInBody(recordJson, SENTINEL_API_KEY, `Audit record ${record.auditId}`)
      }
    })
  })

  // ===========================================================================
  // SCENARIO 4: Connector error responses don't leak secrets
  // ===========================================================================
  describe('Scenario 4: Connector Error Redaction', () => {
    it('should not expose secrets in connector list response', async () => {
      const response = await fetch(`${baseUrl}/api/v1/connectors`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      expect(response.status).toBe(200)
      const body = await response.text()

      // No sentinel should appear
      assertNoSentinelInBody(body, SENTINEL_API_KEY, 'Connector list')
      assertNoSentinelInBody(body, SENTINEL_PROVIDER_KEY, 'Connector list')
    })

    it('should not expose secrets in connector instance config', async () => {
      // Get any connector definition
      const listResponse = await fetch(`${baseUrl}/api/v1/connectors`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const listBody = (await listResponse.json()) as { data: Array<{ id: string }> }
      const connectorId = listBody.data[0]?.id

      if (connectorId) {
        const instancesResponse = await fetch(`${baseUrl}/api/v1/connectors/${connectorId}/instances`, {
          headers: { Cookie: `agent-platform-session=${authToken}` },
        })

        const instancesBody = await instancesResponse.text()
        assertNoSentinelInBody(instancesBody, SENTINEL_API_KEY, 'Connector instances')
      }
    })
  })

  // ===========================================================================
  // SCENARIO 5: Debug endpoint responses don't expose full keys
  // ===========================================================================
  describe('Scenario 5: Debug Endpoint Redaction', () => {
    it('should not expose secrets in debug replay response', async () => {
      // Create a session with events
      const sessionId = randomUUID()
      context.stores.sessionStore.create({
        sessionId,
        userId,
        title: 'Debug Test Session',
        status: 'active',
      })

      // Create an event with sensitive data in payload
      context.stores.eventStore.append({
        eventId: randomUUID(),
        sessionId,
        eventType: 'test_event',
        sourceModule: 'connector',
        payload: { apiKey: SENTINEL_API_KEY, message: 'test' },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/debug/replay/${sessionId}`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      // The debug endpoint should redact sensitive fields
      assertNoSentinelInBody(body, SENTINEL_API_KEY, 'Debug replay')
    })

    it('should redact sensitive fields in event payload preview', async () => {
      const sessionId = randomUUID()
      context.stores.sessionStore.create({
        sessionId,
        userId,
        title: 'Low Sensitivity Test Session',
        status: 'active',
      })

      // Create event with low sensitivity (should show preview but redacted)
      context.stores.eventStore.append({
        eventId: randomUUID(),
        sessionId,
        eventType: 'low_sensitivity_event',
        sourceModule: 'connector',
        payload: { apiKey: SENTINEL_API_KEY, data: 'visible' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/debug/replay/${sessionId}`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      // Even low sensitivity events should have apiKey redacted
      assertNoSentinelInBody(body, SENTINEL_API_KEY, 'Debug replay low sensitivity')
    })
  })

  // ===========================================================================
  // SCENARIO 6: Backup metadata doesn't include plaintext secrets
  // ===========================================================================
  describe('Scenario 6: Backup Metadata Redaction', () => {
    it('should not include plaintext API keys in provider data', async () => {
      // Create provider with sentinel key
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Backup Test Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      // Get the provider data (simulating what would be in backup)
      const providers = context.providerConfigStore.listByUser(userId)

      for (const provider of providers) {
        // Sanitized response should not have full key
        const providerJson = JSON.stringify(provider)
        assertNoSentinelInBody(providerJson, SENTINEL_API_KEY, 'Provider backup data')

        // Should only have last 4 chars
        expect(provider.apiKeyLast4).toBeDefined()
        expect(provider.apiKeyLast4?.length).toBeLessThanOrEqual(4)
      }
    })

    it('should not expose encrypted API key field in backup', async () => {
      const providers = context.providerConfigStore.listByUser(userId)

      for (const provider of providers) {
        const providerJson = JSON.stringify(provider)
        // encryptedApiKey field should not be exposed
        expect(providerJson).not.toContain('encryptedApiKey')
        expect(providerJson).not.toContain('encrypted_api_key')
      }
    })
  })

  // ===========================================================================
  // SCENARIO 7: Settings response doesn't expose env-based API keys
  // ===========================================================================
  describe('Scenario 7: Settings Response Redaction', () => {
    it('should not expose OPENROUTER_API_KEY value in settings', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY

      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      expect(response.status).toBe(200)
      const body = await response.text()

      // Settings should show "configured: true" but NOT the actual key
      assertNoSentinelInBody(body, SENTINEL_API_KEY, 'Settings response')

      const json = JSON.parse(body)
      expect(json.data.settings.providers.openrouter.configured).toBe(true)

      delete process.env.OPENROUTER_API_KEY
    })

    it('should not expose OPENAI_API_KEY value in settings', async () => {
      process.env.OPENAI_API_KEY = SENTINEL_PROVIDER_KEY

      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_PROVIDER_KEY, 'Settings response OpenAI')

      delete process.env.OPENAI_API_KEY
    })

    it('should only show boolean configured status, never key values', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY
      process.env.OLLAMA_BASE_URL = 'http://localhost:11434'

      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const json = (await response.json()) as { data: { settings: { providers: Record<string, unknown> } } }

      // Provider config should only have 'configured' boolean
      for (const [, config] of Object.entries(json.data.settings.providers)) {
        const configObj = config as Record<string, unknown>
        expect(configObj).toHaveProperty('configured')
        expect(typeof configObj.configured).toBe('boolean')

        // Should NOT have any key-related fields
        expect(configObj).not.toHaveProperty('apiKey')
        expect(configObj).not.toHaveProperty('api_key')
        expect(configObj).not.toHaveProperty('key')
      }

      delete process.env.OPENROUTER_API_KEY
      delete process.env.OLLAMA_BASE_URL
    })
  })

  // ===========================================================================
  // SCENARIO 8: Complete sentinel verification across all endpoints
  // ===========================================================================
  describe('Scenario 8: Complete Sentinel Verification', () => {
    it('should never expose sentinel key in any major endpoint', async () => {
      // Set up sentinel in multiple places
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'Final Sentinel Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY

      const endpoints = [
        { url: `${baseUrl}/api/v1/providers`, auth: true, name: 'Providers' },
        { url: `${baseUrl}/api/v1/settings`, auth: true, name: 'Settings' },
        { url: `${baseUrl}/api/v1/tools`, auth: false, name: 'Tools' },
        { url: `${baseUrl}/api/v1/health`, auth: false, name: 'Health' },
        { url: `${baseUrl}/api/v1/connectors`, auth: true, name: 'Connectors' },
        { url: `${baseUrl}/api/v1/api-keys`, auth: true, name: 'API Keys' },
      ]

      for (const endpoint of endpoints) {
        const headers: Record<string, string> = {}
        if (endpoint.auth) {
          headers['Cookie'] = `agent-platform-session=${authToken}`
        }

        const response = await fetch(endpoint.url, { headers })
        const body = await response.text()

        // Sentinel must NEVER appear in any endpoint
        assertNoSentinelInBody(body, SENTINEL_API_KEY, endpoint.name)
      }

      delete process.env.OPENROUTER_API_KEY
    })

    it('should redact sentinel in error responses', async () => {
      // Trigger an error with sentinel in context
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY

      // Request non-existent resource
      const response = await fetch(`${baseUrl}/api/v1/providers/non-existent-id`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_API_KEY, '404 error response')

      delete process.env.OPENROUTER_API_KEY
    })

    it('should not leak sentinel in logs endpoint', async () => {
      // Create event that might contain sensitive reference
      const sessionId = randomUUID()
      context.stores.sessionStore.create({
        sessionId,
        userId,
        title: 'Logs Test Session',
        status: 'active',
      })

      context.stores.eventStore.append({
        eventId: randomUUID(),
        sessionId,
        eventType: 'provider_call',
        sourceModule: 'kernel',
        payload: { provider: 'openrouter', status: 'success' },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/logs?sessionId=${sessionId}`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_API_KEY, 'Logs endpoint')
    })

    it('should not leak sentinel in observability endpoints', async () => {
      const endpoints = [
        `${baseUrl}/api/v1/observability/runs`,
        `${baseUrl}/api/v1/alerts/rules`,
        `${baseUrl}/api/v1/alerts/state`,
      ]

      for (const url of endpoints) {
        const response = await fetch(url, {
          headers: { Cookie: `agent-platform-session=${authToken}` },
        })

        const body = await response.text()
        assertNoSentinelInBody(body, SENTINEL_API_KEY, `Observability: ${url}`)
      }
    })
  })

  // ===========================================================================
  // ADDITIONAL: Password redaction verification
  // ===========================================================================
  describe('Password Redaction', () => {
    it('should never expose password in login response', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'redactiongateuser',
          password: SENTINEL_PASSWORD,
        }),
      })

      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_PASSWORD, 'Login response')
    })

    it('should not echo password in failed login', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nonexistent',
          password: SENTINEL_PASSWORD,
        }),
      })

      expect(response.status).toBe(401)
      const body = await response.text()
      assertNoSentinelInBody(body, SENTINEL_PASSWORD, 'Failed login response')
    })
  })

  // ===========================================================================
  // ADDITIONAL: Response body structure verification
  // ===========================================================================
  describe('Response Structure', () => {
    it('should use apiKeyLast4 instead of apiKey in provider responses', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Structure Test Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const json = (await response.json()) as { data: Array<Record<string, unknown>> }

      expect(json.data.length).toBeGreaterThan(0)
      const provider = json.data[0]

      // Should have apiKeyLast4
      expect(provider).toHaveProperty('apiKeyLast4')
      // Should NOT have apiKey or encryptedApiKey
      expect(provider).not.toHaveProperty('apiKey')
      expect(provider).not.toHaveProperty('encryptedApiKey')
    })

    it('should only expose last 4 characters of API key', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'Last4 Test Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      })

      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: `agent-platform-session=${authToken}` },
      })

      const json = (await response.json()) as { data: Array<{ apiKeyLast4: string | null }> }
      const provider = json.data[0]

      // apiKeyLast4 should be exactly 4 characters
      expect(provider.apiKeyLast4).toBeDefined()
      expect(provider.apiKeyLast4?.length).toBe(4)

      // Should match the last 4 of the sentinel
      expect(provider.apiKeyLast4).toBe(SENTINEL_API_KEY.slice(-4))
    })
  })
})
