import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'

type HttpHeaders = Record<string, string | number | string[] | undefined>

function assertSecurityHeaders(headers: HttpHeaders) {
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
}

function assertDocsCspHeader(headers: HttpHeaders) {
  expect(headers['content-security-policy']).toBe(
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
  )
}

describe('Security Headers Middleware', () => {
  let server: FastifyInstance
  let context: ApiContext

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) throw new Error(ctx.message)
    context = ctx
    server = await createApiServer(context)
  }, 30000)

  afterAll(async () => {
    await server.close()
    context.connection.close()
  })

  describe('Health endpoint', () => {
    it('should include X-Content-Type-Options: nosniff', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      expect(response.headers['x-content-type-options']).toBe('nosniff')
    })

    it('should include X-Frame-Options: DENY', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      expect(response.headers['x-frame-options']).toBe('DENY')
    })

    it('should include Strict-Transport-Security header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    })
  })

  describe('Tools endpoint', () => {
    it('should include all security headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      })
      assertSecurityHeaders(response.headers)
    })
  })

  describe('Swagger UI docs endpoint', () => {
    it('should include all security headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/docs',
      })
      assertSecurityHeaders(response.headers)
    })

    it('should include CSP with unsafe-inline for scripts', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/docs',
      })
      assertDocsCspHeader(response.headers)
    })

    it('should include CSP with unsafe-inline for styles', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/docs',
      })
      const csp = response.headers['content-security-policy']
      expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    })
  })

  describe('Sessions endpoint', () => {
    it('should include all security headers on session creation', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {},
      })
      assertSecurityHeaders(response.headers)
    })
  })

  describe('Error responses', () => {
    it('should include security headers on auth error (401)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {},
      })
      expect(response.statusCode).toBe(401)
      assertSecurityHeaders(response.headers)
    })

    it('should include security headers on unauthorized access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/nonexistent-route-12345',
      })
      expect(response.statusCode).toBe(401)
      assertSecurityHeaders(response.headers)
    })
  })

  describe('SSE/Streaming endpoints', () => {
    it('should include security headers on logs stream endpoint', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/logs/stream',
      })
      assertSecurityHeaders(response.headers)
    })

    it('should include security headers on runs stream endpoint', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/runs/stream',
      })
      assertSecurityHeaders(response.headers)
    })
  })

  describe('CSP header isolation', () => {
    it('should NOT include CSP header on non-docs endpoints', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      expect(response.headers['content-security-policy']).toBeUndefined()
    })

    it('should include CSP header only on /api/v1/docs path', async () => {
      const docsResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/docs',
      })
      const healthResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })

      expect(docsResponse.headers['content-security-policy']).toBeDefined()
      expect(healthResponse.headers['content-security-policy']).toBeUndefined()
    })
  })
})
