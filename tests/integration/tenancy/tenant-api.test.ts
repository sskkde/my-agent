import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import { hashPassword } from '../../../src/storage/auth-crypto.js'

async function createRegularUser(context: ApiContext, username: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password)
  const user = context.stores.userStore.create({
    userId: username,
    username,
    passwordHash,
    role: 'user',
  })
  return user.userId
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(response.status).toBe(200)
  return response.headers.get('set-cookie')!
}

describe('Organization API Routes', () => {
  let server: FastifyInstance
  let context: ApiContext
  let baseUrl: string
  let adminCookie: string

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

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    })
    expect(setupResponse.status).toBe(201)
    adminCookie = setupResponse.headers.get('set-cookie')!
  })

  afterEach(async () => {
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections()
    }
    await server.close()
    context.connection.close()
  })

  describe('POST /api/v1/organizations', () => {
    it('creates an organization as admin', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Test Org', slug: 'test-org' }),
      })

      expect(response.status).toBe(201)
      const body = (await response.json()) as {
        ok: boolean
        data: { orgId: string; name: string; slug: string; createdAt: string; updatedAt: string }
      }
      expect(body.ok).toBe(true)
      expect(body.data.name).toBe('Test Org')
      expect(body.data.slug).toBe('test-org')
      expect(body.data.orgId).toBeDefined()
      expect(body.data.createdAt).toBeDefined()
    })

    it('rejects duplicate slug', async () => {
      await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'First Org', slug: 'duplicate-slug' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Second Org', slug: 'duplicate-slug' }),
      })

      expect(response.status).toBe(409)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('CONFLICT')
    })

    it('rejects creation by regular user (403)', async () => {
      await createRegularUser(context, 'regularuser', 'password123')
      const userCookie = await login(baseUrl, 'regularuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: 'User Org', slug: 'user-org' }),
      })

      expect(response.status).toBe(403)
    })

    it('rejects unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Anon Org', slug: 'anon-org' }),
      })

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/v1/organizations', () => {
    it('lists all organizations for admin', async () => {
      await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'List Org', slug: 'list-org' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: Array<{ orgId: string; name: string }> }
      expect(body.ok).toBe(true)
      expect(body.data.length).toBeGreaterThanOrEqual(2)
    })

    it('lists only user organizations for regular user', async () => {
      const userId = await createRegularUser(context, 'listuser', 'password123')
      const userCookie = await login(baseUrl, 'listuser', 'password123')

      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'User Visible Org', slug: 'user-visible' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId, role: 'member' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        headers: { Cookie: userCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: Array<{ orgId: string }> }
      expect(body.ok).toBe(true)
      const orgIds = body.data.map((o) => o.orgId)
      expect(orgIds).toContain(createBody.data.orgId)
    })
  })

  describe('GET /api/v1/organizations/:orgId', () => {
    it('gets an organization by ID', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Get Org', slug: 'get-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}`, {
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: { orgId: string; name: string } }
      expect(body.ok).toBe(true)
      expect(body.data.name).toBe('Get Org')
    })

    it('returns 404 for non-existent organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/nonexistent`, {
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(404)
    })

    it('allows regular user to read organization', async () => {
      await createRegularUser(context, 'readuser', 'password123')
      const userCookie = await login(baseUrl, 'readuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default`, {
        headers: { Cookie: userCookie },
      })

      expect(response.status).toBe(200)
    })
  })

  describe('PATCH /api/v1/organizations/:orgId', () => {
    it('updates an organization as admin', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Update Org', slug: 'update-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Updated Org' }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: { name: string } }
      expect(body.ok).toBe(true)
      expect(body.data.name).toBe('Updated Org')
    })

    it('rejects update by regular user (403)', async () => {
      await createRegularUser(context, 'updateuser', 'password123')
      const userCookie = await login(baseUrl, 'updateuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ name: 'Hacked' }),
      })

      expect(response.status).toBe(403)
    })

    it('returns 404 for non-existent organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/nonexistent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Ghost' }),
      })

      expect(response.status).toBe(404)
    })

    it('rejects duplicate slug on update', async () => {
      await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Org A', slug: 'slug-a' }),
      })

      const createB = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Org B', slug: 'slug-b' }),
      })
      const bodyB = (await createB.json()) as { ok: boolean; data: { orgId: string } }

      const response = await fetch(`${baseUrl}/api/v1/organizations/${bodyB.data.orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ slug: 'slug-a' }),
      })

      expect(response.status).toBe(409)
    })
  })

  describe('DELETE /api/v1/organizations/:orgId', () => {
    it('deletes an organization as admin', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Delete Org', slug: 'delete-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: { orgId: string; deleted: boolean } }
      expect(body.ok).toBe(true)
      expect(body.data.deleted).toBe(true)
    })

    it('prevents deleting the default organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } }
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toContain('default')
    })

    it('rejects deletion by regular user (403)', async () => {
      await createRegularUser(context, 'deleteuser', 'password123')
      const userCookie = await login(baseUrl, 'deleteuser', 'password123')

      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'User Delete Org', slug: 'user-delete-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      })

      expect(response.status).toBe(403)
    })

    it('returns 404 for non-existent organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/nonexistent`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/v1/organizations/:orgId/members', () => {
    it('adds a member to an organization', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Member Org', slug: 'member-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const userId = await createRegularUser(context, 'memberuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId, role: 'member' }),
      })

      expect(response.status).toBe(201)
      const body = (await response.json()) as { ok: boolean; data: { userId: string; orgId: string; role: string } }
      expect(body.ok).toBe(true)
      expect(body.data.userId).toBe(userId)
      expect(body.data.role).toBe('member')
    })

    it('adds a member with default role when role not specified', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Default Role Org', slug: 'default-role-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const userId = await createRegularUser(context, 'defaultmember', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId }),
      })

      expect(response.status).toBe(201)
      const body = (await response.json()) as { ok: boolean; data: { role: string } }
      expect(body.data.role).toBe('member')
    })

    it('returns 404 for non-existent organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/nonexistent/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId: 'some-user' }),
      })

      expect(response.status).toBe(404)
    })

    it('rejects add member by regular user (403)', async () => {
      await createRegularUser(context, 'addmemberuser', 'password123')
      const userCookie = await login(baseUrl, 'addmemberuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ userId: 'another-user' }),
      })

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/v1/organizations/:orgId/members', () => {
    it('lists members of an organization', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'List Members Org', slug: 'list-members-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const userId = await createRegularUser(context, 'listmemberuser', 'password123')
      await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId, role: 'admin' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: Array<{ userId: string; role: string }> }
      expect(body.ok).toBe(true)
      expect(body.data.length).toBeGreaterThanOrEqual(1)
      const member = body.data.find((m) => m.userId === userId)
      expect(member).toBeDefined()
      expect(member!.role).toBe('admin')
    })

    it('returns 404 for non-existent organization', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/nonexistent/members`, {
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/v1/organizations/:orgId/members/:userId', () => {
    it('removes a member from an organization', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Remove Member Org', slug: 'remove-member-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const userId = await createRegularUser(context, 'removemember', 'password123')
      await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId, role: 'member' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members/${userId}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: { userId: string; removed: boolean } }
      expect(body.data.removed).toBe(true)
    })

    it('returns 404 for non-existent member', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default/members/nonexistent-user`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })

      expect(response.status).toBe(404)
    })

    it('rejects removal by regular user (403)', async () => {
      await createRegularUser(context, 'removememberuser', 'password123')
      const userCookie = await login(baseUrl, 'removememberuser', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default/members/some-user`, {
        method: 'DELETE',
        headers: { Cookie: userCookie },
      })

      expect(response.status).toBe(403)
    })
  })

  describe('PATCH /api/v1/organizations/:orgId/members/:userId/role', () => {
    it('changes a member role', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ name: 'Role Change Org', slug: 'role-change-org' }),
      })
      const createBody = (await createResponse.json()) as { ok: boolean; data: { orgId: string } }

      const userId = await createRegularUser(context, 'rolechangeuser', 'password123')
      await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ userId, role: 'member' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/organizations/${createBody.data.orgId}/members/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ role: 'admin' }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; data: { userId: string; role: string } }
      expect(body.data.role).toBe('admin')
    })

    it('returns 404 for non-existent member', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default/members/nonexistent-user/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ role: 'admin' }),
      })

      expect(response.status).toBe(404)
    })

    it('rejects role change by regular user (403)', async () => {
      await createRegularUser(context, 'rolechangeother', 'password123')
      const userCookie = await login(baseUrl, 'rolechangeother', 'password123')

      const response = await fetch(`${baseUrl}/api/v1/organizations/org_default/members/some-user/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: userCookie },
        body: JSON.stringify({ role: 'admin' }),
      })

      expect(response.status).toBe(403)
    })
  })
})
