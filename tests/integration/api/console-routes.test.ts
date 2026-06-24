import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

describe('Console Routes API', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string
  const originalEnv = { ...process.env }

  beforeAll(async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434'

    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie
  }, 30000)

  afterAll(async () => {
    process.env = originalEnv
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  describe('GET /api/instances', () => {
    it('should return instance summary with correct structure', async () => {
      const response = await fetch(`${baseUrl}/api/v1/instances`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          instances: Array<{
            type: string
            status: string
            uptime: number
            apiPort: number
            storeStatus: string
          }>
        }
      }

      expect(body.data).toBeDefined()
      expect(body.data.instances).toBeDefined()
      expect(Array.isArray(body.data.instances)).toBe(true)
      expect(body.data.instances.length).toBeGreaterThan(0)

      const instance = body.data.instances[0]
      expect(instance.type).toBe('local')
      expect(instance.status).toBe('healthy')
      expect(typeof instance.uptime).toBe('number')
      expect(instance.uptime).toBeGreaterThan(0)
      expect(typeof instance.apiPort).toBe('number')
      expect(instance.storeStatus).toBe('connected')
    })
  })

  describe('GET /api/channels', () => {
    it('should return registered channels including webui', async () => {
      const response = await fetch(`${baseUrl}/api/v1/channels`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: { channels: Array<{ connectorId: string; type: string; status: string; configured: boolean }> }
      }
      expect(body.data).toBeDefined()
      expect(body.data.channels).toBeDefined()
      expect(Array.isArray(body.data.channels)).toBe(true)

      const webuiChannel = body.data.channels.find((c) => c.connectorId === 'webui')
      expect(webuiChannel).toBeDefined()
      expect(webuiChannel?.type).toBe('webui')
      expect(webuiChannel?.status).toBe('active')
      expect(webuiChannel?.configured).toBe(true)

      const fakeChannels = body.data.channels.filter(
        (c) =>
          c.connectorId.includes('slack') ||
          c.connectorId.includes('discord') ||
          c.connectorId.includes('telegram') ||
          c.type === 'external',
      )
      expect(fakeChannels.length).toBe(0)
    })
  })

  describe('GET /api/skills', () => {
    it('should return builtin skills list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/skills`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          skills: Array<{
            skillId: string
            name: string
            type: string
            enabled: boolean
            source: string
          }>
        }
      }

      expect(body.data).toBeDefined()
      expect(body.data.skills).toBeDefined()
      expect(Array.isArray(body.data.skills)).toBe(true)
      expect(body.data.skills.length).toBeGreaterThan(0)

      const skill = body.data.skills[0]
      expect(skill.skillId).toBeDefined()
      expect(skill.name).toBeDefined()
      expect(skill.source).toBe('builtin')
      expect(skill.enabled).toBeDefined()

      const skillIds = body.data.skills.map((s) => s.skillId)
      expect(skillIds).toContain('artifact_create')
      expect(skillIds).toContain('ask_user')
      expect(skillIds).toContain('status_query')
      expect(skillIds).toContain('web_search')
    })
  })

  describe('GET /api/settings', () => {
    it('should return settings without exposing API keys', async () => {
      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          settings: {
            localOnly: boolean
            providers: Record<string, { configured: boolean }>
            retentionDays: number
          }
        }
      }

      expect(body.data).toBeDefined()
      expect(body.data.settings.localOnly).toBe(true)
      expect(typeof body.data.settings.providers).toBe('object')
      expect(body.data.settings.providers.openrouter).toBeDefined()
      expect(body.data.settings.providers.openrouter.configured).toBe(true)
      expect(body.data.settings.providers.ollama).toBeDefined()
      expect(body.data.settings.providers.ollama.configured).toBe(true)
      expect(body.data.settings.retentionDays).toBe(30)
    })

    it('should not include raw API key values', async () => {
      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: authCookie },
      })
      const body = (await response.json()) as {
        data: {
          providers: Record<string, unknown>
        }
      }

      const bodyStr = JSON.stringify(body)
      expect(bodyStr).not.toContain('test-key')
      expect(bodyStr).not.toContain('OPENROUTER_API_KEY')
      expect(bodyStr).not.toContain('OLLAMA_BASE_URL')
    })
  })

  describe('GET /api/settings without env vars', () => {
    it('should return configured: false when env vars are not set', async () => {
      delete process.env.OPENROUTER_API_KEY
      delete process.env.OLLAMA_BASE_URL

      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          settings: {
            providers: Record<string, { configured: boolean }>
          }
        }
      }

      expect(body.data.settings.providers.openrouter.configured).toBe(false)
      expect(body.data.settings.providers.ollama.configured).toBe(false)
    })
  })
})
