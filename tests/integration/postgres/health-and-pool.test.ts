import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { PostgresAdapter } from '../../../src/storage/adapters/postgres/postgres-adapter.js';
import type { FastifyInstance } from 'fastify';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDatabase = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;

interface TestContext {
  server: FastifyInstance;
  baseUrl: string;
  apiContext: ApiContext;
  pgAdapter: PostgresAdapter;
  authCookie: string;
}

async function createPgTestContext(): Promise<TestContext> {
  const pgAdapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
  await pgAdapter.getConnection().open();

  const ctx = createApiContext({ dbPath: ':memory:' });
  if (isApiContextError(ctx)) {
    await pgAdapter.getConnection().close();
    throw new Error(`Failed to create API context: ${ctx.message}`);
  }

  ctx.postgresAdapter = pgAdapter;

  const apiContext = ctx;
  const server = await createApiServer(apiContext);
  await server.listen({ port: 0 });
  const address = server.server.address();
  const baseUrl = `http://localhost:${(address as any).port}`;

  const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
  });

  if (setupResponse.status !== 201) {
    await server.close();
    await pgAdapter.getConnection().close();
    throw new Error(`Failed to create test user: ${setupResponse.status}`);
  }

  const authCookie = setupResponse.headers.get('set-cookie');
  if (!authCookie) {
    await server.close();
    await pgAdapter.getConnection().close();
    throw new Error('No set-cookie header received from setup');
  }

  return { server, baseUrl, apiContext, pgAdapter, authCookie };
}

async function closePgTestContext(context: TestContext): Promise<void> {
  await context.server.close();
  await context.pgAdapter.getConnection().close();
  if (context.apiContext && 'connection' in context.apiContext) {
    (context.apiContext as any).connection.close();
  }
}

describe.skipIf(!hasDatabase)('PostgreSQL Health and Pool', () => {
  let ctx: TestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createPgTestContext();
    baseUrl = ctx.baseUrl;
  }, 30000);

  afterAll(async () => {
    await closePgTestContext(ctx);
  }, 30000);

  describe('Health endpoint', () => {
    it('GET /api/v1/health includes postgres module when PG adapter is configured', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          status: string;
          timestamp: string;
          modules: Record<string, { status: string; message?: string }>;
        };
      };

      expect(body.ok).toBe(true);
      expect(body.data.modules).toHaveProperty('postgres');
      expect(body.data.modules.postgres.status).toBe('healthy');
      expect(body.data.modules.postgres.message).toBe('PostgreSQL connected');
    });

    it('GET /api/v1/health returns degraded when postgres is unhealthy', async () => {
      const pgAdapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
      await pgAdapter.getConnection().open();
      await pgAdapter.getConnection().close();

      const apiCtx = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(apiCtx)) {
        throw new Error(`Failed to create API context: ${apiCtx.message}`);
      }
      apiCtx.postgresAdapter = pgAdapter;

      const server = await createApiServer(apiCtx);
      await server.listen({ port: 0 });
      const address = server.server.address();
      const localBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${localBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser2', password: 'testpassword123' }),
      });
      const localAuthCookie = setupResponse.headers.get('set-cookie');

      try {
        const response = await fetch(`${localBaseUrl}/api/v1/health`, {
          headers: { Cookie: localAuthCookie! },
        });
        expect(response.status).toBe(200);

        const body = await response.json() as {
          ok: boolean;
          data: {
            status: string;
            modules: Record<string, { status: string; message?: string }>;
          };
        };

        expect(body.data.modules).toHaveProperty('postgres');
        expect(body.data.modules.postgres.status).toBe('unhealthy');
        expect(body.data.status).toBe('degraded');
      } finally {
        await server.close();
        (apiCtx as any).connection.close();
      }
    });
  });

  describe('Pool metrics', () => {
    it('getPoolMetrics returns expected structure', () => {
      const metrics = ctx.pgAdapter.getPoolMetrics();
      expect(metrics).toHaveProperty('totalCount');
      expect(metrics).toHaveProperty('idleCount');
      expect(metrics).toHaveProperty('waitingCount');
      expect(typeof metrics.totalCount).toBe('number');
      expect(typeof metrics.idleCount).toBe('number');
      expect(typeof metrics.waitingCount).toBe('number');
    });

    it('getPoolMetrics shows at least one connection after queries', async () => {
      await ctx.pgAdapter.asyncQuery('SELECT 1');
      const metrics = ctx.pgAdapter.getPoolMetrics();
      expect(metrics.totalCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('healthCheck method', () => {
    it('healthCheck returns true when connected', async () => {
      const healthy = await ctx.pgAdapter.healthCheck();
      expect(healthy).toBe(true);
    });

    it('healthCheck returns false after close', async () => {
      const localAdapter = new PostgresAdapter({ connectionString: DATABASE_URL! });
      await localAdapter.getConnection().open();
      await localAdapter.getConnection().close();

      const healthy = await localAdapter.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});

describe('PostgreSQL Health (without database)', () => {
  it('health endpoint works without postgresAdapter', async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }

    const apiContext = ctx;
    const server = await createApiServer(apiContext);
    await server.listen({ port: 0 });
    const address = server.server.address();
    const baseUrl = `http://localhost:${(address as any).port}`;

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
    });
    const authCookie = setupResponse.headers.get('set-cookie');

    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, {
        headers: { Cookie: authCookie! },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          status: string;
          modules: Record<string, { status: string; message?: string }>;
        };
      };

      expect(body.ok).toBe(true);
      expect(body.data.modules).not.toHaveProperty('postgres');
    } finally {
      await server.close();
      (apiContext as any).connection.close();
    }
  });
});
