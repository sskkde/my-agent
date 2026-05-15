import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { registerAuthToken, isAuthRequired } from '../../../src/api/middleware/auth-token.js';
import type { FastifyInstance } from 'fastify';

describe('API Auth Token Middleware', () => {
  describe('isAuthRequired', () => {
    it('should return false when no token is provided and enabled is not set', () => {
      const originalEnv = process.env.API_AUTH_TOKEN;
      delete process.env.API_AUTH_TOKEN;
      expect(isAuthRequired({})).toBe(false);
      if (originalEnv !== undefined) process.env.API_AUTH_TOKEN = originalEnv;
    });

    it('should return true when token is provided', () => {
      expect(isAuthRequired({ token: 'test-token' })).toBe(true);
    });

    it('should return true when enabled is explicitly true', () => {
      expect(isAuthRequired({ enabled: true })).toBe(true);
    });

    it('should return false when enabled is explicitly false even with token', () => {
      expect(isAuthRequired({ token: 'test-token', enabled: false })).toBe(false);
    });

    it('should return true when API_AUTH_TOKEN env var is set', () => {
      const originalEnv = process.env.API_AUTH_TOKEN;
      process.env.API_AUTH_TOKEN = 'env-token';
      expect(isAuthRequired({})).toBe(true);
      if (originalEnv !== undefined) process.env.API_AUTH_TOKEN = originalEnv;
      else delete process.env.API_AUTH_TOKEN;
    });
  });

  describe('middleware behavior', () => {
    describe('when auth is disabled (default)', () => {
      let server: FastifyInstance;
      let context: ApiContext;

      beforeAll(async () => {
        const ctx = createApiContext({ dbPath: ':memory:' });
        if (isApiContextError(ctx)) throw new Error(ctx.message);
        context = ctx;
        server = await createApiServer(context);
      }, 30000);

      afterAll(async () => {
        await server.close();
        context.connection.close();
      });

      it('should allow requests without Authorization header', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/health',
        });
        expect(response.statusCode).toBe(200);
      });
    });

    describe('when auth is enabled via options', () => {
      let server: FastifyInstance;

      beforeAll(async () => {
        const Fastify = (await import('fastify')).default;
        server = Fastify({ logger: false });

        await registerAuthToken(server, { token: 'test-secret-token', enabled: true });

        server.get('/api/v1/health', async () => ({ ok: true, data: { status: 'alive' }, requestId: 'test' }));
        server.get('/api/v1/health/ready', async () => ({ ok: true, data: { status: 'ready' }, requestId: 'test' }));
        server.get('/api/v1/docs', async () => ({ ok: true, data: {}, requestId: 'test' }));
        server.get('/api/v1/docs/json', async () => ({ ok: true, data: {}, requestId: 'test' }));
        server.get('/api/v1/tools', async () => ({ ok: true, data: [], requestId: 'test' }));
        server.get('/api/v1/protected', async () => ({ ok: true, data: { secret: 'data' }, requestId: 'test' }));
        server.get('/api/v1/webhooks/test', async () => ({ ok: true, data: {}, requestId: 'test' }));

        await server.ready();
      });

      afterAll(async () => {
        await server.close();
      });

      it('should return 401 when no Authorization header is provided', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
        });
        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as { ok: boolean; error: { code: string; message: string }; requestId: string };
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(body.requestId).toBeDefined();
      });

      it('should return 401 when wrong token is provided', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
          headers: { authorization: 'Bearer wrong-token' },
        });
        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
      });

      it('should return 401 when Authorization header has wrong format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
        });
        expect(response.statusCode).toBe(401);
      });

      it('should allow request with correct Bearer token', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
          headers: { authorization: 'Bearer test-secret-token' },
        });
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { ok: boolean; data: { secret: string } };
        expect(body.ok).toBe(true);
        expect(body.data.secret).toBe('data');
      });

      it('should exempt /api/health from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/health',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should exempt /api/health/ready from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/health/ready',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should exempt /api/docs from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/docs',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should exempt /api/docs/json from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/docs/json',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should exempt /api/tools from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/tools',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should exempt /api/webhooks/* from auth', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/webhooks/test',
        });
        expect(response.statusCode).toBe(200);
      });
    });

    describe('when auth is disabled via options', () => {
      let server: FastifyInstance;

      beforeAll(async () => {
        const Fastify = (await import('fastify')).default;
        server = Fastify({ logger: false });

        await registerAuthToken(server, { enabled: false });

        server.get('/api/v1/protected', async () => ({ ok: true, data: { secret: 'data' }, requestId: 'test' }));

        await server.ready();
      });

      afterAll(async () => {
        await server.close();
      });

      it('should allow requests without Authorization header when disabled', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
        });
        expect(response.statusCode).toBe(200);
      });
    });

    describe('custom exempt paths', () => {
      let server: FastifyInstance;

      beforeAll(async () => {
        const Fastify = (await import('fastify')).default;
        server = Fastify({ logger: false });

        await registerAuthToken(server, {
          token: 'custom-token',
          enabled: true,
          exemptPaths: ['/api/v1/health', '/api/v1/custom-public'],
        });

        server.get('/api/v1/health', async () => ({ ok: true, data: { status: 'alive' }, requestId: 'test' }));
        server.get('/api/v1/custom-public', async () => ({ ok: true, data: {}, requestId: 'test' }));
        server.get('/api/v1/protected', async () => ({ ok: true, data: { secret: 'data' }, requestId: 'test' }));

        await server.ready();
      });

      afterAll(async () => {
        await server.close();
      });

      it('should use custom exempt paths', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/custom-public',
        });
        expect(response.statusCode).toBe(200);
      });

      it('should still protect non-exempt paths', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/protected',
        });
        expect(response.statusCode).toBe(401);
      });
    });
  });
});
