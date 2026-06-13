import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import type { FastifyInstance } from 'fastify'

describe('API Server', () => {
  let server: FastifyInstance
  let baseUrl: string

  beforeAll(async () => {
    server = await createApiServer()
    server.get('/api/v1/test/internal-error', async () => {
      throw new Error('/internal/path secret=abc')
    })
    await server.listen()
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as any).port}`
  })

  afterAll(async () => {
    await server.close()
  })

  describe('GET /api/health', () => {
    it('should return 200 with health status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as { status: string; modules: Record<string, unknown>; timestamp: string }
      expect(body.status).toBe('healthy')
      expect(body.modules).toEqual({})
      expect(body.timestamp).toBeDefined()
    })
  })

  describe('404 handling', () => {
    it('should return 404 with structured error for unknown routes', async () => {
      const response = await fetch(`${baseUrl}/api/v1/unknown`)
      expect(response.status).toBe(404)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBeDefined()
    })
  })

  describe('500 handling', () => {
    it('should not leak internal error details and should include a stable code and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/test/internal-error`)
      expect(response.status).toBe(500)

      const responseText = await response.text()
      expect(responseText).not.toContain('/internal/path')
      expect(responseText).not.toContain('secret=abc')

      const body = JSON.parse(responseText) as { error: { code: string; message: string }; requestId: string }
      expect(body.error.code).toBe('INTERNAL_ERROR')
      expect(body.error.message).toBe('Internal server error')
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  })

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const origin = 'http://localhost:5173'
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
        },
      })

      const allowOrigin = response.headers.get('access-control-allow-origin')
      expect(allowOrigin === '*' || allowOrigin === origin).toBe(true)
      expect(response.headers.get('access-control-allow-methods')).toBeDefined()
    })
  })
})
