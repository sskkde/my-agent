/**
 * Tenant Isolation Security Tests
 *
 * Comprehensive cross-tenant isolation tests verifying that data created
 * under one tenant is invisible to another tenant at the store layer.
 *
 * Since the current middleware always resolves to DEFAULT_TENANT_ID ('org_default'),
 * these tests directly manipulate tenantId at the store layer to validate isolation.
 * API-level tests cover organization CRUD and membership scoping.
 *
 * Test Scenarios:
 * 1. Session store — cross-tenant isolation
 * 2. Workflow definition store — cross-tenant isolation
 * 3. Connector store — cross-tenant isolation (definitions + instances)
 * 4. API key store — cross-tenant isolation
 * 5. Event store — cross-tenant isolation
 * 6. Organization API — cross-tenant access via user membership
 * 7. Default tenant behavior — backward compatibility
 * 8. Admin cross-tenant access — boundary test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { DEFAULT_TENANT_ID } from '../../src/tenancy/tenant-context.js'
import { randomUUID } from 'crypto'

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-tenant-isolation'
const TENANT_A = 'org_tenant_a'
const TENANT_B = 'org_tenant_b'

// =============================================================================
// TENANT ISOLATION SECURITY TESTS
// =============================================================================

describe('Tenant Isolation Security Tests', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string
  let adminAuthToken: string
  let adminUserId: string

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

    // Create admin user under default tenant
    adminUserId = randomUUID()
    context.stores.userStore.create({
      userId: adminUserId,
      username: 'tenantadmin',
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
  // SCENARIO 1: Session store — cross-tenant isolation
  // ===========================================================================
  describe('Scenario 1: Session store tenant isolation', () => {
    it('should isolate sessions by tenantId', () => {
      const sessionIdA = randomUUID()
      const sessionIdB = randomUUID()
      const userId = 'user-session-test'

      // Create sessions under different tenants
      context.stores.sessionStore.create({ sessionId: sessionIdA, userId, title: 'Tenant A Session' }, TENANT_A)
      context.stores.sessionStore.create({ sessionId: sessionIdB, userId, title: 'Tenant B Session' }, TENANT_B)

      // Query by tenant A — should only see A's session
      const tenantASessions = context.stores.sessionStore.list({ userId }, TENANT_A)
      expect(tenantASessions).toHaveLength(1)
      expect(tenantASessions[0].sessionId).toBe(sessionIdA)
      expect(tenantASessions[0].title).toBe('Tenant A Session')

      // Query by tenant B — should only see B's session
      const tenantBSessions = context.stores.sessionStore.list({ userId }, TENANT_B)
      expect(tenantBSessions).toHaveLength(1)
      expect(tenantBSessions[0].sessionId).toBe(sessionIdB)
      expect(tenantBSessions[0].title).toBe('Tenant B Session')
    })

    it('should return null when getting session from wrong tenant', () => {
      const sessionId = randomUUID()
      const userId = 'user-cross-tenant-session'

      context.stores.sessionStore.create({ sessionId, userId, title: 'Private Session' }, TENANT_A)

      // GetById from correct tenant
      const found = context.stores.sessionStore.getById(sessionId, TENANT_A)
      expect(found).not.toBeNull()
      expect(found!.sessionId).toBe(sessionId)

      // GetById from wrong tenant
      const notFound = context.stores.sessionStore.getById(sessionId, TENANT_B)
      expect(notFound).toBeNull()
    })

    it('should not update sessions across tenants', () => {
      const sessionId = randomUUID()
      const userId = 'user-session-update'

      context.stores.sessionStore.create({ sessionId, userId, title: 'Original Title' }, TENANT_A)

      // SQLite UPDATE with 0 matching rows doesn't throw — verify data isolation instead
      context.stores.sessionStore.updateTitle(sessionId, 'Hacked Title', TENANT_B)

      const session = context.stores.sessionStore.getById(sessionId, TENANT_A)
      expect(session!.title).toBe('Original Title')

      const crossTenant = context.stores.sessionStore.getById(sessionId, TENANT_B)
      expect(crossTenant).toBeNull()
    })

    it('should isolate session counts by tenant', () => {
      const userId = 'user-session-count'

      context.stores.sessionStore.create({ sessionId: randomUUID(), userId, title: 'A1' }, TENANT_A)
      context.stores.sessionStore.create({ sessionId: randomUUID(), userId, title: 'A2' }, TENANT_A)
      context.stores.sessionStore.create({ sessionId: randomUUID(), userId, title: 'B1' }, TENANT_B)

      const countA = context.stores.sessionStore.getCount({ userId }, TENANT_A)
      expect(countA).toBe(2)

      const countB = context.stores.sessionStore.getCount({ userId }, TENANT_B)
      expect(countB).toBe(1)
    })
  })

  // ===========================================================================
  // SCENARIO 2: Workflow definition store — cross-tenant isolation
  // ===========================================================================
  describe('Scenario 2: Workflow definition store tenant isolation', () => {
    it('should isolate workflow definitions by tenantId', () => {
      const ownerA = 'wf-owner-a'
      const ownerB = 'wf-owner-b'

      const defA = context.stores.workflowDefinitionStore.createDefinition(
        {
          workflowId: randomUUID(),
          name: 'tenant-a-workflow',
          version: 1,
          steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step A', config: {} }],
          ownerUserId: ownerA,
          status: 'published',
        },
        TENANT_A,
      )

      const defB = context.stores.workflowDefinitionStore.createDefinition(
        {
          workflowId: randomUUID(),
          name: 'tenant-b-workflow',
          version: 1,
          steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step B', config: {} }],
          ownerUserId: ownerB,
          status: 'published',
        },
        TENANT_B,
      )

      // Query by owner in tenant A
      const tenantADefs = context.stores.workflowDefinitionStore.getDefinitionsByOwner(ownerA, TENANT_A)
      expect(tenantADefs).toHaveLength(1)
      expect(tenantADefs[0].workflowId).toBe(defA.workflowId)

      // Query by owner in tenant B
      const tenantBDefs = context.stores.workflowDefinitionStore.getDefinitionsByOwner(ownerB, TENANT_B)
      expect(tenantBDefs).toHaveLength(1)
      expect(tenantBDefs[0].workflowId).toBe(defB.workflowId)
    })

    it('should return null when getting definition from wrong tenant', () => {
      const def = context.stores.workflowDefinitionStore.createDefinition(
        {
          workflowId: randomUUID(),
          name: 'private-workflow',
          version: 1,
          steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step', config: {} }],
          ownerUserId: 'owner-x',
          status: 'published',
        },
        TENANT_A,
      )

      // GetById from correct tenant
      const found = context.stores.workflowDefinitionStore.getDefinitionById(def.workflowId, TENANT_A)
      expect(found).not.toBeNull()

      // GetById from wrong tenant
      const notFound = context.stores.workflowDefinitionStore.getDefinitionById(def.workflowId, TENANT_B)
      expect(notFound).toBeNull()
    })

    it('should not update definitions across tenants', () => {
      const def = context.stores.workflowDefinitionStore.createDefinition(
        {
          workflowId: randomUUID(),
          name: 'update-test-wf',
          version: 1,
          steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step', config: {} }],
          ownerUserId: 'owner-y',
          status: 'published',
        },
        TENANT_A,
      )

      // Try to update from wrong tenant
      const result = context.stores.workflowDefinitionStore.updateDefinition(
        def.workflowId,
        { name: 'Hacked Workflow' },
        TENANT_B,
      )
      expect(result).toBeNull()

      // Verify original is unchanged
      const original = context.stores.workflowDefinitionStore.getDefinitionById(def.workflowId, TENANT_A)
      expect(original!.name).toBe('update-test-wf')
    })

    it('should isolate version numbers by tenant', () => {
      const name = `versioned-wf-${randomUUID().slice(0, 8)}`

      // Create v1 in tenant A
      context.stores.workflowDefinitionStore.createDefinition(
        {
          workflowId: randomUUID(),
          name,
          version: 1,
          steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step', config: {} }],
          ownerUserId: 'owner-v',
          status: 'published',
        },
        TENANT_A,
      )

      // Next version in tenant A should be 2
      const nextA = context.stores.workflowDefinitionStore.getNextVersionNumber(name, TENANT_A)
      expect(nextA).toBe(2)

      // Next version in tenant B should be 1 (no versions there)
      const nextB = context.stores.workflowDefinitionStore.getNextVersionNumber(name, TENANT_B)
      expect(nextB).toBe(1)
    })
  })

  // ===========================================================================
  // SCENARIO 3: Connector store — cross-tenant isolation
  // ===========================================================================
  describe('Scenario 3: Connector store tenant isolation', () => {
    it('should isolate connector definitions by tenantId', () => {
      const defA = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-def-a-${randomUUID().slice(0, 8)}`,
          name: 'Tenant A Connector',
          connectorType: 'api',
          version: '1.0.0',
          capabilities: ['read'],
          status: 'active',
        },
        TENANT_A,
      )

      const defB = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-def-b-${randomUUID().slice(0, 8)}`,
          name: 'Tenant B Connector',
          connectorType: 'api',
          version: '1.0.0',
          capabilities: ['write'],
          status: 'active',
        },
        TENANT_B,
      )

      // Find by type in tenant A — should only see A's definition
      const tenantADefs = context.stores.connectorStore.findDefinitionsByType('api', TENANT_A)
      const tenantAIds = tenantADefs.map((d) => d.id)
      expect(tenantAIds).toContain(defA.id)
      expect(tenantAIds).not.toContain(defB.id)

      // Find by type in tenant B — should only see B's definition
      const tenantBDefs = context.stores.connectorStore.findDefinitionsByType('api', TENANT_B)
      const tenantBIds = tenantBDefs.map((d) => d.id)
      expect(tenantBIds).toContain(defB.id)
      expect(tenantBIds).not.toContain(defA.id)
    })

    it('should return undefined when finding definition from wrong tenant', () => {
      const def = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-private-${randomUUID().slice(0, 8)}`,
          name: 'Private Connector',
          connectorType: 'database',
          version: '1.0.0',
          capabilities: ['query'],
          status: 'active',
        },
        TENANT_A,
      )

      // FindById from correct tenant
      const found = context.stores.connectorStore.findDefinitionById(def.id, TENANT_A)
      expect(found).toBeDefined()

      // FindById from wrong tenant
      const notFound = context.stores.connectorStore.findDefinitionById(def.id, TENANT_B)
      expect(notFound).toBeUndefined()
    })

    it('should isolate connector instances by tenantId', () => {
      // Create a definition in tenant A first
      const defA = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-inst-a-${randomUUID().slice(0, 8)}`,
          name: 'Instance Test Def A',
          connectorType: 'api',
          version: '1.0.0',
          capabilities: ['read'],
          status: 'active',
        },
        TENANT_A,
      )

      const instA = context.stores.connectorStore.createInstance(
        {
          connectorInstanceId: `inst-a-${randomUUID().slice(0, 8)}`,
          connectorDefinitionId: defA.id,
          userId: 'user-inst-a',
          name: 'Tenant A Instance',
          authStateRef: 'ref-a',
          status: 'active',
        },
        TENANT_A,
      )

      // Find instance from correct tenant
      const found = context.stores.connectorStore.findInstanceById(instA.id, TENANT_A)
      expect(found).toBeDefined()

      // Find instance from wrong tenant
      const notFound = context.stores.connectorStore.findInstanceById(instA.id, TENANT_B)
      expect(notFound).toBeUndefined()
    })

    it('should not update connector definitions across tenants', () => {
      const def = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-update-${randomUUID().slice(0, 8)}`,
          name: 'Original Name',
          connectorType: 'custom',
          version: '1.0.0',
          capabilities: ['execute'],
          status: 'active',
        },
        TENANT_A,
      )

      // Try to update from wrong tenant
      const result = context.stores.connectorStore.updateDefinition(def.id, { name: 'Hacked Name' }, TENANT_B)
      expect(result).toBeUndefined()

      // Verify original is unchanged
      const original = context.stores.connectorStore.findDefinitionById(def.id, TENANT_A)
      expect(original!.name).toBe('Original Name')
    })

    it('should not delete connector instances across tenants', () => {
      const def = context.stores.connectorStore.createDefinition(
        {
          connectorId: `conn-del-${randomUUID().slice(0, 8)}`,
          name: 'Delete Test Def',
          connectorType: 'api',
          version: '1.0.0',
          capabilities: ['read'],
          status: 'active',
        },
        TENANT_A,
      )

      const inst = context.stores.connectorStore.createInstance(
        {
          connectorInstanceId: `inst-del-${randomUUID().slice(0, 8)}`,
          connectorDefinitionId: def.id,
          userId: 'user-del',
          name: 'Delete Test Instance',
          authStateRef: 'ref-del',
          status: 'active',
        },
        TENANT_A,
      )

      // Try to delete from wrong tenant
      const deleted = context.stores.connectorStore.deleteInstance(inst.id, TENANT_B)
      expect(deleted).toBe(false)

      // Verify instance still exists in correct tenant
      const stillExists = context.stores.connectorStore.findInstanceById(inst.id, TENANT_A)
      expect(stillExists).toBeDefined()
    })
  })

  // ===========================================================================
  // SCENARIO 4: API key store — cross-tenant isolation
  // ===========================================================================
  describe('Scenario 4: API key store tenant isolation', () => {
    let apikeyUserId: string

    beforeEach(() => {
      apikeyUserId = randomUUID()
      context.stores.userStore.create({
        userId: apikeyUserId,
        username: `apikey-test-${randomUUID().slice(0, 8)}`,
        passwordHash: 'hash',
        role: 'user',
      })
    })

    it('should isolate API keys by tenantId', () => {
      const keyA = `ak_a_${randomUUID().replace(/-/g, '')}`
      const keyB = `ak_b_${randomUUID().replace(/-/g, '')}`

      context.stores.apiKeyStore.createKey(
        { id: randomUUID(), name: 'Tenant A Key', key: keyA, role: 'user', userId: apikeyUserId },
        TENANT_A,
      )
      context.stores.apiKeyStore.createKey(
        { id: randomUUID(), name: 'Tenant B Key', key: keyB, role: 'user', userId: apikeyUserId },
        TENANT_B,
      )

      const keysA = context.stores.apiKeyStore.listKeysByUser(apikeyUserId, TENANT_A)
      expect(keysA).toHaveLength(1)
      expect(keysA[0].name).toBe('Tenant A Key')

      const keysB = context.stores.apiKeyStore.listKeysByUser(apikeyUserId, TENANT_B)
      expect(keysB).toHaveLength(1)
      expect(keysB[0].name).toBe('Tenant B Key')
    })

    it('should return null when looking up key hash from wrong tenant', async () => {
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `apikey-lookup-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'admin',
      })
      const key = `ak_lookup_${randomUUID().replace(/-/g, '')}`
      const created = context.stores.apiKeyStore.createKey(
        { id: randomUUID(), name: 'Isolated Key', key, role: 'admin', userId },
        TENANT_A,
      )

      const found = context.stores.apiKeyStore.getKeyByHash(created.keyHash, TENANT_A)
      expect(found).not.toBeNull()

      const notFound = context.stores.apiKeyStore.getKeyByHash(created.keyHash, TENANT_B)
      expect(notFound).toBeNull()
    })

    it('should not revoke keys across tenants', async () => {
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `apikey-revoke-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })
      const key = `ak_revoke_${randomUUID().replace(/-/g, '')}`
      const created = context.stores.apiKeyStore.createKey(
        { id: randomUUID(), name: 'Revoke Test Key', key, role: 'user', userId },
        TENANT_A,
      )

      const revoked = context.stores.apiKeyStore.revokeKey(created.id, TENANT_B)
      expect(revoked).toBe(false)

      // Verify key is still active in correct tenant
      const stillActive = context.stores.apiKeyStore.getKeyByHash(created.keyHash, TENANT_A)
      expect(stillActive).not.toBeNull()
      expect(stillActive!.isActive).toBe(true)
    })
  })

  // ===========================================================================
  // SCENARIO 5: Event store — cross-tenant isolation
  // ===========================================================================
  describe('Scenario 5: Event store tenant isolation', () => {
    it('should isolate events by tenantId', () => {
      const sessionId = `evt-session-${randomUUID().slice(0, 8)}`

      context.stores.eventStore.append(
        {
          eventId: randomUUID(),
          eventType: 'test.event.a',
          sourceModule: 'gateway',
          userId: 'user-evt-a',
          sessionId,
          payload: { tenant: 'A' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date().toISOString(),
        },
        TENANT_A,
      )

      context.stores.eventStore.append(
        {
          eventId: randomUUID(),
          eventType: 'test.event.b',
          sourceModule: 'gateway',
          userId: 'user-evt-b',
          sessionId,
          payload: { tenant: 'B' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date().toISOString(),
        },
        TENANT_B,
      )

      // Query events in tenant A
      const eventsA = context.stores.eventStore.query({ sessionId }, TENANT_A)
      expect(eventsA).toHaveLength(1)
      expect(eventsA[0].eventType).toBe('test.event.a')

      // Query events in tenant B
      const eventsB = context.stores.eventStore.query({ sessionId }, TENANT_B)
      expect(eventsB).toHaveLength(1)
      expect(eventsB[0].eventType).toBe('test.event.b')
    })

    it('should isolate findByCorrelationId by tenantId', () => {
      const correlationId = `corr-${randomUUID().slice(0, 8)}`

      context.stores.eventStore.append(
        {
          eventId: randomUUID(),
          eventType: 'corr.event.a',
          sourceModule: 'kernel',
          correlationId,
          payload: {},
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: new Date().toISOString(),
        },
        TENANT_A,
      )

      context.stores.eventStore.append(
        {
          eventId: randomUUID(),
          eventType: 'corr.event.b',
          sourceModule: 'kernel',
          correlationId,
          payload: {},
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: new Date().toISOString(),
        },
        TENANT_B,
      )

      const eventsA = context.stores.eventStore.findByCorrelationId(correlationId, TENANT_A)
      expect(eventsA).toHaveLength(1)
      expect(eventsA[0].eventType).toBe('corr.event.a')

      const eventsB = context.stores.eventStore.findByCorrelationId(correlationId, TENANT_B)
      expect(eventsB).toHaveLength(1)
      expect(eventsB[0].eventType).toBe('corr.event.b')
    })

    it('should isolate findByCausationId by tenantId', () => {
      const causationId = `caus-${randomUUID().slice(0, 8)}`

      context.stores.eventStore.append(
        {
          eventId: randomUUID(),
          eventType: 'caus.event.a',
          sourceModule: 'tool',
          causationId,
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date().toISOString(),
        },
        TENANT_A,
      )

      const eventsA = context.stores.eventStore.findByCausationId(causationId, TENANT_A)
      expect(eventsA).toHaveLength(1)

      const eventsB = context.stores.eventStore.findByCausationId(causationId, TENANT_B)
      expect(eventsB).toHaveLength(0)
    })
  })

  // ===========================================================================
  // SCENARIO 6: Organization API — cross-tenant access via user membership
  // ===========================================================================
  describe('Scenario 6: Organization API — cross-tenant access via membership', () => {
    it('should allow admin to create and list organizations', async () => {
      // Create Org A
      const createAResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Tenant Isolation Org A', slug: `iso-org-a-${randomUUID().slice(0, 8)}` }),
      })
      expect(createAResponse.status).toBe(201)
      const createABody = (await createAResponse.json()) as { ok: boolean; data: { orgId: string } }
      const orgAId = createABody.data.orgId

      // Create Org B
      const createBResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Tenant Isolation Org B', slug: `iso-org-b-${randomUUID().slice(0, 8)}` }),
      })
      expect(createBResponse.status).toBe(201)
      const createBBody = (await createBResponse.json()) as { ok: boolean; data: { orgId: string } }
      const orgBId = createBBody.data.orgId

      // Create User A and add to Org A only
      const userAId = randomUUID()
      context.stores.userStore.create({
        userId: userAId,
        username: `iso-user-a-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })
      context.stores.organizationStore.addUser(userAId, orgAId, 'member')

      // Create User B and add to Org B only
      const userBId = randomUUID()
      context.stores.userStore.create({
        userId: userBId,
        username: `iso-user-b-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })
      context.stores.organizationStore.addUser(userBId, orgBId, 'member')

      // User A should see Org A in their organizations
      const userAOrgs = context.stores.organizationStore.getUserOrganizations(userAId)
      const userAOrgIds = userAOrgs.map((o) => o.orgId)
      expect(userAOrgIds).toContain(orgAId)
      expect(userAOrgIds).not.toContain(orgBId)

      // User B should see Org B in their organizations
      const userBOrgs = context.stores.organizationStore.getUserOrganizations(userBId)
      const userBOrgIds = userBOrgs.map((o) => o.orgId)
      expect(userBOrgIds).toContain(orgBId)
      expect(userBOrgIds).not.toContain(orgAId)
    })

    it('should deny regular user from creating organizations', async () => {
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `iso-regular-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      const userAuthToken = generateSessionToken()
      context.stores.authTokenStore.create({
        tokenHash: hashToken(userAuthToken),
        userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${userAuthToken}` },
        body: JSON.stringify({ name: 'Unauthorized Org', slug: `unauth-${randomUUID().slice(0, 8)}` }),
      })

      expect(response.status).toBe(403)
    })
  })

  // ===========================================================================
  // SCENARIO 7: Default tenant behavior — backward compatibility
  // ===========================================================================
  describe('Scenario 7: Default tenant behavior (backward compatibility)', () => {
    it('should use DEFAULT_TENANT_ID when no tenantId specified', () => {
      const sessionId = randomUUID()
      const userId = 'user-default-tenant'

      // Create without explicit tenantId
      context.stores.sessionStore.create({
        sessionId,
        userId,
        title: 'Default Tenant Session',
      })

      // Should be findable with DEFAULT_TENANT_ID
      const found = context.stores.sessionStore.getById(sessionId, DEFAULT_TENANT_ID)
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Default Tenant Session')

      // Should NOT be findable with a different tenant
      const notFound = context.stores.sessionStore.getById(sessionId, TENANT_A)
      expect(notFound).toBeNull()
    })

    it('should work with default tenant for API keys', async () => {
      const key = `ak_default_${randomUUID().replace(/-/g, '')}`
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `default-apikey-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      const created = context.stores.apiKeyStore.createKey({
        id: randomUUID(),
        name: 'Default Tenant Key',
        key,
        role: 'user',
        userId,
      })

      // Should be findable with DEFAULT_TENANT_ID
      const found = context.stores.apiKeyStore.getKeyByHash(created.keyHash, DEFAULT_TENANT_ID)
      expect(found).not.toBeNull()

      // Should NOT be findable with a different tenant
      const notFound = context.stores.apiKeyStore.getKeyByHash(created.keyHash, TENANT_B)
      expect(notFound).toBeNull()
    })

    it('should work with default tenant for workflow definitions', () => {
      const workflowId = randomUUID()

      // Create without explicit tenantId
      context.stores.workflowDefinitionStore.createDefinition({
        workflowId,
        name: `default-wf-${randomUUID().slice(0, 8)}`,
        version: 1,
        steps: [{ stepId: 's1', stepType: 'tool_call', name: 'Step', config: {} }],
        ownerUserId: 'owner-default',
        status: 'published',
      })

      // Should be findable with DEFAULT_TENANT_ID
      const found = context.stores.workflowDefinitionStore.getDefinitionById(workflowId, DEFAULT_TENANT_ID)
      expect(found).not.toBeNull()

      // Should NOT be findable with a different tenant
      const notFound = context.stores.workflowDefinitionStore.getDefinitionById(workflowId, TENANT_A)
      expect(notFound).toBeNull()
    })

    it('should work with default tenant for events', () => {
      const sessionId = `default-evt-${randomUUID().slice(0, 8)}`

      // Create without explicit tenantId
      context.stores.eventStore.append({
        eventId: randomUUID(),
        eventType: 'default.tenant.event',
        sourceModule: 'system',
        sessionId,
        payload: { test: true },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      })

      // Should be findable with DEFAULT_TENANT_ID
      const found = context.stores.eventStore.query({ sessionId }, DEFAULT_TENANT_ID)
      expect(found).toHaveLength(1)

      // Should NOT be findable with a different tenant
      const notFound = context.stores.eventStore.query({ sessionId }, TENANT_A)
      expect(notFound).toHaveLength(0)
    })

    it('should work with default tenant for connector definitions', () => {
      // Create without explicit tenantId
      const def = context.stores.connectorStore.createDefinition({
        connectorId: `conn-default-${randomUUID().slice(0, 8)}`,
        name: 'Default Tenant Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['read'],
        status: 'active',
      })

      // Should be findable with DEFAULT_TENANT_ID
      const found = context.stores.connectorStore.findDefinitionById(def.id, DEFAULT_TENANT_ID)
      expect(found).toBeDefined()

      // Should NOT be findable with a different tenant
      const notFound = context.stores.connectorStore.findDefinitionById(def.id, TENANT_A)
      expect(notFound).toBeUndefined()
    })
  })

  // ===========================================================================
  // SCENARIO 8: Admin cross-tenant access — boundary test
  // ===========================================================================
  describe('Scenario 8: Admin cross-tenant access (boundary)', () => {
    it('should allow admin to list all organizations via API', async () => {
      // Create an org as admin
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Admin Access Org', slug: `admin-access-${randomUUID().slice(0, 8)}` }),
      })
      expect(createResponse.status).toBe(201)

      // Admin should be able to list all orgs
      const listResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        headers: { Cookie: `agent-platform-session=${adminAuthToken}` },
      })
      expect(listResponse.status).toBe(200)
      const body = (await listResponse.json()) as { ok: boolean; data: Array<{ orgId: string }> }
      expect(body.ok).toBe(true)
      expect(body.data.length).toBeGreaterThanOrEqual(2) // At least org_default + the one we created
    })

    it('should allow admin to read any organization via API', async () => {
      // Create an org
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Admin Read Org', slug: `admin-read-${randomUUID().slice(0, 8)}` }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      // Admin should be able to read it
      const getResponse = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}`, {
        headers: { Cookie: `agent-platform-session=${adminAuthToken}` },
      })
      expect(getResponse.status).toBe(200)
    })

    it('should allow admin to manage organization members', async () => {
      // Create an org
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Admin Member Org', slug: `admin-member-${randomUUID().slice(0, 8)}` }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }
      const orgId = createBody.data.orgId

      // Create a user
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `admin-member-user-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      // Admin adds member
      const addResponse = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ userId, role: 'member' }),
      })
      expect(addResponse.status).toBe(201)

      // Verify member was added
      const members = context.stores.organizationStore.getOrganizationUsers(orgId)
      const memberUserIds = members.map((m) => m.userId)
      expect(memberUserIds).toContain(userId)
    })

    it('should prevent regular user from accessing other orgs data', async () => {
      // Create an org as admin
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${adminAuthToken}` },
        body: JSON.stringify({ name: 'Protected Org', slug: `protected-${randomUUID().slice(0, 8)}` }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }
      const orgId = createBody.data.orgId

      // Create a regular user NOT in that org
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `outsider-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      const userAuthToken = generateSessionToken()
      context.stores.authTokenStore.create({
        tokenHash: hashToken(userAuthToken),
        userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })

      // Regular user should NOT be able to update the org
      const patchResponse = await fetch(`${baseUrl}/api/v1/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${userAuthToken}` },
        body: JSON.stringify({ name: 'Hacked Org' }),
      })
      expect(patchResponse.status).toBe(403)

      // Regular user should NOT be able to add members
      const addMemberResponse = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `agent-platform-session=${userAuthToken}` },
        body: JSON.stringify({ userId: 'intruder', role: 'admin' }),
      })
      expect(addMemberResponse.status).toBe(403)

      // Regular user should NOT be able to delete the org
      const deleteResponse = await fetch(`${baseUrl}/api/v1/organizations/${orgId}`, {
        method: 'DELETE',
        headers: { Cookie: `agent-platform-session=${userAuthToken}` },
      })
      expect(deleteResponse.status).toBe(403)
    })
  })

  // ===========================================================================
  // SCENARIO 9 (Bonus): Organization switching — multi-org membership
  // ===========================================================================
  describe('Scenario 9: Organization switching — multi-org membership', () => {
    it('should allow user to be member of multiple organizations', async () => {
      const userId = randomUUID()
      context.stores.userStore.create({
        userId,
        username: `multiorg-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      // Add user to org_default
      context.stores.organizationStore.addUser(userId, 'org_default', 'member')

      // Create another org and add user
      const org2 = context.stores.organizationStore.create({
        orgId: `org-multi-${randomUUID().slice(0, 8)}`,
        name: 'Multi-Org Test',
        slug: `multi-org-${randomUUID().slice(0, 8)}`,
      })
      context.stores.organizationStore.addUser(userId, org2.orgId, 'admin')

      // User should see both organizations
      const userOrgs = context.stores.organizationStore.getUserOrganizations(userId)
      expect(userOrgs.length).toBeGreaterThanOrEqual(2)
      const orgIds = userOrgs.map((o) => o.orgId)
      expect(orgIds).toContain('org_default')
      expect(orgIds).toContain(org2.orgId)
    })

    it('should correctly scope operations per organization', async () => {
      const orgA = context.stores.organizationStore.create({
        orgId: `org-scope-a-${randomUUID().slice(0, 8)}`,
        name: 'Scope Org A',
        slug: `scope-a-${randomUUID().slice(0, 8)}`,
      })
      const orgB = context.stores.organizationStore.create({
        orgId: `org-scope-b-${randomUUID().slice(0, 8)}`,
        name: 'Scope Org B',
        slug: `scope-b-${randomUUID().slice(0, 8)}`,
      })

      const userA = randomUUID()
      const userB = randomUUID()

      context.stores.userStore.create({
        userId: userA,
        username: `scope-a-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })
      context.stores.userStore.create({
        userId: userB,
        username: `scope-b-${randomUUID().slice(0, 8)}`,
        passwordHash: await hashPassword('password'),
        role: 'user',
      })

      context.stores.organizationStore.addUser(userA, orgA.orgId, 'member')
      context.stores.organizationStore.addUser(userB, orgB.orgId, 'member')

      const orgAMembers = context.stores.organizationStore.getOrganizationUsers(orgA.orgId)
      const orgAMemberIds = orgAMembers.map((m) => m.userId)
      expect(orgAMemberIds).toContain(userA)
      expect(orgAMemberIds).not.toContain(userB)

      const orgBMembers = context.stores.organizationStore.getOrganizationUsers(orgB.orgId)
      const orgBMemberIds = orgBMembers.map((m) => m.userId)
      expect(orgBMemberIds).toContain(userB)
      expect(orgBMemberIds).not.toContain(userA)
    })
  })
})
