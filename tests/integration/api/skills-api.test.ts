import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ApiContext } from '../../../src/api/context.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'crypto'

describe('Skills API Integration', () => {
  let server: FastifyInstance
  let context: ApiContext
  let authToken: string
  let userId: string
  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production'

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY

    const contextResult = createApiContext({ dbPath: ':memory:' })
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`)
    }
    context = contextResult

    server = await createApiServer(context)

    userId = randomUUID()
    context.stores.userStore.create({
      userId,
      username: 'testuser',
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
  })

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY
    await server.close()
    context.connection.close()
  })

  describe('GET /api/v1/skills', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return registry-backed skill list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)

      expect(body.ok).toBe(true)
      expect(body.data.skills).toBeDefined()
      expect(Array.isArray(body.data.skills)).toBe(true)
      expect(body.data.total).toBe(body.data.skills.length)
    })

    it('should include active built-in skills', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)
      const skillIds = body.data.skills.map((s: { skillId: string }) => s.skillId)

      expect(skillIds).toContain('artifact_workflow')
      expect(skillIds).toContain('memory_research')
      expect(skillIds).toContain('session_status')
      expect(skillIds).toContain('documentation_search')
      expect(skillIds).toContain('web_research_guidance')
    })

    it('should include deprecated alias skills', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)
      const skillIds = body.data.skills.map((s: { skillId: string }) => s.skillId)

      expect(skillIds).toContain('artifact_create')
      expect(skillIds).toContain('ask_user')
      expect(skillIds).toContain('web_search')
    })

    it('should return skills with correct metadata fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)
      const skill = body.data.skills.find((s: { skillId: string }) => s.skillId === 'artifact_workflow')

      expect(skill).toBeDefined()
      expect(skill).toMatchObject({
        skillId: 'artifact_workflow',
        name: 'Artifact Workflow',
        category: 'write',
        sensitivity: 'medium',
        enabled: true,
        source: 'builtin',
      })
      expect(typeof skill.description).toBe('string')
    })

    it('should return skills sorted by skillId', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)
      const skillIds = body.data.skills.map((s: { skillId: string }) => s.skillId)
      const sortedIds = [...skillIds].sort()

      expect(skillIds).toEqual(sortedIds)
    })

    it('should mark deprecated aliases as disabled', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)
      const aliasSkill = body.data.skills.find((s: { skillId: string }) => s.skillId === 'artifact_create')

      expect(aliasSkill).toBeDefined()
      expect(aliasSkill.enabled).toBe(false)
    })

    it('should include no POST/PATCH/DELETE mutation endpoints', async () => {
      const postResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/skills',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { skillId: 'test' },
      })

      expect(postResponse.statusCode).toBe(404)

      const patchResponse = await server.inject({
        method: 'PATCH',
        url: '/api/v1/skills/artifact_workflow',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { name: 'Updated' },
      })

      expect(patchResponse.statusCode).toBe(404)

      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: '/api/v1/skills/artifact_workflow',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(deleteResponse.statusCode).toBe(404)
    })
  })

  describe('GET /api/v1/skills/:skillId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills/artifact_workflow',
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return skill detail for valid skill ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills/artifact_workflow',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)

      expect(body.ok).toBe(true)
      expect(body.data).toMatchObject({
        skillId: 'artifact_workflow',
        name: 'Artifact Workflow',
        category: 'write',
        sensitivity: 'medium',
        enabled: true,
        source: 'builtin',
      })
      expect(Array.isArray(body.data.allowedAgentTypes)).toBe(true)
      expect(Array.isArray(body.data.defaultAgentProfiles)).toBe(true)
    })

    it('should return 404 for non-existent skill ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills/non_existent_skill',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(404)
      const body = JSON.parse(response.body)
      expect(body.error.code).toBe('SKILL_NOT_FOUND')
    })

    it('should return detail for deprecated alias skills', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills/artifact_create',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)

      expect(body.data.skillId).toBe('artifact_create')
      expect(body.data.enabled).toBe(false)
      expect(body.data.tags).toContain('deprecated')
    })

    it('should include optional fields when present', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/skills/artifact_workflow',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      })

      const body = JSON.parse(response.body)

      expect(body.data.summary).toBeDefined()
      expect(typeof body.data.summary).toBe('string')
      expect(body.data.tags).toBeDefined()
      expect(Array.isArray(body.data.tags)).toBe(true)
    })
  })
})
