import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

describe('Response Envelope Contract', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  describe('GET /api/health (unauthenticated)', () => {
    it('should return success envelope with ok, data, and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { status: string; modules: Record<string, unknown>; timestamp: string }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data).toBeDefined()
      expect(body.data.status).toBeDefined()
      expect(body.data.modules).toBeDefined()
      expect(body.data.timestamp).toBeDefined()
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  })

  describe('GET /api/sessions (authenticated)', () => {
    it('should return success envelope with ok, data, and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { items: unknown[] }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  })

  describe('Envelope requirements across endpoints', () => {
    it('should have ok: true for successful responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { Cookie: authCookie } }),
      ])

      for (const response of responses) {
        expect(response.status).toBe(200)
        const body = (await response.json()) as { ok: boolean }
        expect(body.ok).toBe(true)
      }
    })

    it('should have non-empty requestId for all responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { Cookie: authCookie } }),
      ])

      for (const response of responses) {
        expect(response.status).toBe(200)
        const body = (await response.json()) as { requestId: string }
        expect(typeof body.requestId).toBe('string')
        expect(body.requestId.length).toBeGreaterThan(0)
      }
    })
  })
})
