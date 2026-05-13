import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { registerRateLimitMiddleware } from '../../../src/api/middleware/rate-limit.js';

function make429Error(_request: unknown, context: { max: number; after: string }) {
  const msg = `Rate limit exceeded. Max ${context.max} requests per ${context.after}.`;
  const err = new Error(msg) as Error & { statusCode: number };
  err.statusCode = 429;
  return err;
}

async function setupBasicServer(opts: {
  max?: number | ((req: { url: string }) => number);
  timeWindow?: string;
  allowList?: (req: { url: string }) => boolean;
} = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  await server.register(rateLimit, {
    global: true,
    max: opts.max ?? 3,
    timeWindow: opts.timeWindow ?? '1 minute',
    allowList: opts.allowList,
    errorResponseBuilder: make429Error,
  });

  return server;
}

describe('Rate Limit Middleware', () => {
  describe('basic rate limiting', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
      server = await setupBasicServer({ max: 3 });
      server.get('/test', async () => ({ ok: true }));
      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    it('should allow requests within the rate limit', async () => {
      for (let i = 0; i < 3; i++) {
        const response = await server.inject({ method: 'GET', url: '/test' });
        expect(response.statusCode).toBe(200);
      }
    });

    it('should return 429 when rate limit is exceeded', async () => {
      for (let i = 0; i < 3; i++) {
        await server.inject({ method: 'GET', url: '/test' });
      }

      const response = await server.inject({ method: 'GET', url: '/test' });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    });
  });

  describe('SSE endpoint exemption', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
      server = await setupBasicServer({
        max: 2,
        allowList: (request) => {
          const url = request.url;
          return url.includes('/timeline/stream') || url === '/api/runs/stream';
        },
      });

      server.get('/api/sessions/test/timeline/stream', async () => ({ type: 'sse-timeline' }));
      server.get('/api/runs/stream', async () => ({ type: 'sse-runs' }));
      server.get('/api/normal', async () => ({ type: 'normal' }));

      await server.ready();
    });

    afterAll(async () => {
      await server.close();
    });

    it('should exempt SSE timeline stream from rate limiting', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/api/sessions/test/timeline/stream',
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('should exempt SSE runs stream from rate limiting', async () => {
      for (let i = 0; i < 10; i++) {
        const response = await server.inject({
          method: 'GET',
          url: '/api/runs/stream',
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('should still rate-limit normal endpoints', async () => {
      for (let i = 0; i < 2; i++) {
        const r = await server.inject({ method: 'GET', url: '/api/normal' });
        expect(r.statusCode).toBe(200);
      }

      const exceeded = await server.inject({ method: 'GET', url: '/api/normal' });
      expect(exceeded.statusCode).toBe(429);
    });
  });

  describe('auth endpoint stricter limits', () => {
    it('should apply stricter limit of 2 to auth endpoints', async () => {
      const server = await setupBasicServer({
        max: (request) => (request.url.startsWith('/api/auth/') ? 2 : 10),
      });

      server.post('/api/auth/login', async () => ({ token: 'test' }));
      await server.ready();

      for (let i = 0; i < 2; i++) {
        const r = await server.inject({
          method: 'POST', url: '/api/auth/login',
          payload: { username: 'test', password: 'test' },
        });
        expect(r.statusCode).toBe(200);
      }

      const exceeded = await server.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'test', password: 'test' },
      });
      expect(exceeded.statusCode).toBe(429);

      await server.close();
    });

    it('should use higher limit for non-auth endpoints', async () => {
      const server = await setupBasicServer({
        max: (request) => (request.url.startsWith('/api/auth/') ? 2 : 10),
      });

      server.get('/api/other', async () => ({ data: 'ok' }));
      await server.ready();

      for (let i = 0; i < 10; i++) {
        const r = await server.inject({ method: 'GET', url: '/api/other' });
        expect(r.statusCode).toBe(200);
      }

      await server.close();
    });
  });

  describe('registerRateLimitMiddleware defaults', () => {
    it('should return 429 after exceeding default global max', async () => {
      const server = Fastify({ logger: false });
      await registerRateLimitMiddleware(server, { globalMax: 3, authMax: 1 });
      server.get('/test', async () => ({ ok: true }));
      await server.ready();

      const remoteAddress = '10.0.0.200';
      for (let i = 0; i < 3; i++) {
        const r = await server.inject({ method: 'GET', url: '/test', remoteAddress });
        expect(r.statusCode).toBe(200);
      }
      const exceeded = await server.inject({ method: 'GET', url: '/test', remoteAddress });
      expect(exceeded.statusCode).toBe(429);

      await server.close();
    });

    it('should apply stricter auth limit', async () => {
      const server = Fastify({ logger: false });
      await registerRateLimitMiddleware(server, { globalMax: 10, authMax: 1, timeWindow: '1 minute' });
      server.post('/api/auth/login', async () => ({ token: 'test' }));
      await server.ready();

      const remoteAddress = '10.0.0.201';
      const first = await server.inject({ method: 'POST', url: '/api/auth/login', payload: {}, remoteAddress });
      expect(first.statusCode).toBe(200);

      const second = await server.inject({ method: 'POST', url: '/api/auth/login', payload: {}, remoteAddress });
      expect(second.statusCode).toBe(429);

      await server.close();
    });

    it('should exempt SSE endpoints', async () => {
      const server = Fastify({ logger: false });
      await registerRateLimitMiddleware(server, { globalMax: 2, authMax: 1 });
      server.get('/api/sessions/test/timeline/stream', async () => ({ type: 'sse' }));
      server.get('/api/runs/stream', async () => ({ type: 'sse' }));
      await server.ready();

      for (let i = 0; i < 10; i++) {
        const r = await server.inject({ method: 'GET', url: '/api/sessions/test/timeline/stream' });
        expect(r.statusCode).toBe(200);
      }
      for (let i = 0; i < 10; i++) {
        const r = await server.inject({ method: 'GET', url: '/api/runs/stream' });
        expect(r.statusCode).toBe(200);
      }

      await server.close();
    });
  });

  describe('envelope error format on 429', () => {
    it('should return ApiEnvelope error format with code and requestId', async () => {
      const server = Fastify({ logger: false });

      await server.register(rateLimit, {
        global: true,
        max: 2,
        timeWindow: '1 minute',
        errorResponseBuilder: make429Error,
      });

      server.get('/burst', async () => ({ ok: true }));

      server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
        if (error.statusCode === 429) {
          reply.header('retry-after', '60');
          return reply.code(429).send({
            ok: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: error.message },
            requestId: 'test-req-id',
          });
        }
        return reply.code(500).send({ ok: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
      });

      await server.ready();

      await server.inject({ method: 'GET', url: '/burst' });
      await server.inject({ method: 'GET', url: '/burst' });

      const exceeded = await server.inject({ method: 'GET', url: '/burst' });
      expect(exceeded.statusCode).toBe(429);

      const body = JSON.parse(exceeded.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.message).toMatch(/Max \d+ requests per/);
      expect(body.requestId).toBe('test-req-id');
      expect(exceeded.headers['retry-after']).toBe('60');

      await server.close();
    });
  });

  describe('full integration with createApiServer', () => {
    let server: FastifyInstance;
    let context: ApiContext;

    beforeAll(async () => {
      const ctxResult = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(ctxResult)) {
        throw new Error(`Failed to create context: ${ctxResult.message}`);
      }
      context = ctxResult;
      server = await createApiServer(context);
      await server.ready();
    });

    afterAll(async () => {
      await server.close();
      context.connection.close();
    });

    it('should pass health check with rate limit headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: '10.0.0.1',
      });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.requestId).toBeDefined();
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });
});
