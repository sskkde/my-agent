/**
 * Production Rate Limit Hardening Tests
 *
 * Validates that:
 * 1. Localhost exemption is removed in production (NODE_ENV=production)
 * 2. Localhost exemption works in non-production environments
 * 3. TRUST_PROXY support works correctly for X-Forwarded-For
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import { registerRateLimitMiddleware } from '../../src/api/middleware/rate-limit.js'

describe('Rate Limit Production Hardening', () => {
  let originalNodeEnv: string | undefined
  let originalTrustProxy: string | undefined

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    originalTrustProxy = process.env.TRUST_PROXY
  })

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv
    process.env.TRUST_PROXY = originalTrustProxy
    vi.restoreAllMocks()
  })

  describe('Localhost exemption in non-production', () => {
    it('should exempt localhost (127.0.0.1) in development mode', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      for (let i = 0; i < 10; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '127.0.0.1',
        })
        expect(response.statusCode).toBe(200)
      }

      await server.close()
    })

    it('should exempt localhost (::1 IPv6) in development mode', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      for (let i = 0; i < 10; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '::1',
        })
        expect(response.statusCode).toBe(200)
      }

      await server.close()
    })

    it('should still rate limit non-localhost IPs in development', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const remoteAddress = '10.0.0.50'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress,
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress,
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })
  })

  describe('Localhost NOT exempt in production', () => {
    it('should rate limit localhost (127.0.0.1) in production mode', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '127.0.0.1',
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: '127.0.0.1',
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })

    it('should rate limit localhost (::1 IPv6) in production mode', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '::1',
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: '::1',
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })

    it('should still rate limit external IPs in production', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const remoteAddress = '203.0.113.50'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress,
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress,
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })
  })

  describe('TRUST_PROXY support', () => {
    it('should use X-Forwarded-For when TRUST_PROXY is enabled', async () => {
      process.env.NODE_ENV = 'production'
      process.env.TRUST_PROXY = 'true'

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const clientIp = '192.168.1.100'
      const proxyIp = '10.0.0.1'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: proxyIp,
          headers: {
            'x-forwarded-for': clientIp,
          },
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: proxyIp,
        headers: {
          'x-forwarded-for': clientIp,
        },
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })

    it('should rate limit different clients separately with TRUST_PROXY', async () => {
      process.env.NODE_ENV = 'production'
      process.env.TRUST_PROXY = '1'

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const proxyIp = '10.0.0.1'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: proxyIp,
          headers: {
            'x-forwarded-for': '192.168.1.100',
          },
        })
        expect(response.statusCode).toBe(200)
      }

      const client2Response = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: proxyIp,
        headers: {
          'x-forwarded-for': '192.168.1.200',
        },
      })
      expect(client2Response.statusCode).toBe(200)

      const client1Exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: proxyIp,
        headers: {
          'x-forwarded-for': '192.168.1.100',
        },
      })
      expect(client1Exceeded.statusCode).toBe(429)

      await server.close()
    })

    it('should handle X-Forwarded-For with multiple proxies', async () => {
      process.env.NODE_ENV = 'production'
      process.env.TRUST_PROXY = 'yes'

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const originalClient = '203.0.113.50'
      const proxyChain = '10.0.0.1, 10.0.0.2'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: '10.0.0.2',
          headers: {
            'x-forwarded-for': `${originalClient}, ${proxyChain}`,
          },
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: '10.0.0.2',
        headers: {
          'x-forwarded-for': `${originalClient}, ${proxyChain}`,
        },
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })

    it('should not use X-Forwarded-For when TRUST_PROXY is not set', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 })
      server.get('/test', async () => ({ ok: true }))
      await server.ready()

      const proxyIp = '10.0.0.1'

      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/test',
          remoteAddress: proxyIp,
          headers: {
            'x-forwarded-for': `192.168.1.${i}`,
          },
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'GET',
        url: '/test',
        remoteAddress: proxyIp,
        headers: {
          'x-forwarded-for': '192.168.1.999',
        },
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })
  })

  describe('SSE endpoints remain exempt', () => {
    it('should exempt SSE endpoints in production', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 2, authMax: 1 })
      server.get('/api/v1/sessions/test/timeline/stream', async () => ({ type: 'sse' }))
      server.get('/api/v1/runs/stream', async () => ({ type: 'sse' }))
      await server.ready()

      for (let i = 0; i < 10; i++) {
        const r1 = await server.inject({ method: 'GET', url: '/api/v1/sessions/test/timeline/stream' })
        expect(r1.statusCode).toBe(200)

        const r2 = await server.inject({ method: 'GET', url: '/api/v1/runs/stream' })
        expect(r2.statusCode).toBe(200)
      }

      await server.close()
    })
  })

  describe('Auth endpoint stricter limits', () => {
    it('should apply auth limit (5) instead of global limit in production', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.TRUST_PROXY

      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, { globalMax: 100, authMax: 2 })
      server.post('/api/v1/auth/login', async () => ({ token: 'test' }))
      await server.ready()

      const remoteAddress = '203.0.113.50'

      for (let i = 0; i < 2; i++) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {},
          remoteAddress,
        })
        expect(response.statusCode).toBe(200)
      }

      const exceeded = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {},
        remoteAddress,
      })
      expect(exceeded.statusCode).toBe(429)

      await server.close()
    })
  })
})
