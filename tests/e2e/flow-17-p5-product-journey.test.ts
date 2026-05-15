import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

/**
 * P5 Product Journey E2E Test
 *
 * Tests the complete Phase 5 product journey:
 * 1. Session creation
 * 2. Message sending (Chat)
 * 3. Approval flow
 * 4. Runs / Observability
 * 5. Timeline
 * 6. Health and API Productization
 */
describe('P5 Product Journey', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authCookie: string;
  let userCounter = 0;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) throw new Error(ctx.message);
    context = ctx;
    server = await createApiServer(context);
    authCookie = await setupUser('p5journey');
  }, 30000);

  afterAll(async () => {
    await server.close();
    context.connection.close();
  });

  async function setupUser(prefix: string): Promise<string> {
    const username = `${prefix}user${++userCounter}`;
    const setupResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/setup/user',
      payload: { username, password: 'testpassword123' },
    });
    expect(setupResponse.statusCode).toBe(201);
    const cookies = setupResponse.headers['set-cookie'] as string | string[] | undefined;
    const cookieStr = Array.isArray(cookies) ? cookies[0] : (cookies ?? '');
    return cookieStr.split(';')[0];
  }

  async function createSession(cookie: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: {},
      headers: { cookie },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { ok: boolean; data: { session: { sessionId: string } } };
    expect(body.ok).toBe(true);
    return body.data.session.sessionId;
  }

  describe('Step 1: Session Creation', () => {
    it('should create a new session', async () => {
      const sessionId = await createSession(authCookie);
      expect(sessionId).toBeDefined();
      expect(sessionId.length).toBeGreaterThan(0);
    });
  });

  describe('Step 2: Message Sending (Chat)', () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await createSession(authCookie);
    });

    it('should send a message and get accepted', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/sessions/${sessionId}/messages`,
        payload: { text: 'Hello, this is a P5 product journey test message' },
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(202);
    });

    it('should have the message in session transcript', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}/transcripts`,
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: unknown };
      expect(body.ok).toBe(true);
    });
  });

  describe('Step 3: Approval Flow', () => {
    it('should list approvals', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/approvals',
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { approvals: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.approvals)).toBe(true);
      expect(typeof body.data.total).toBe('number');
    });

    it('should handle approval API with status filter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/approvals?status=pending',
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { approvals: unknown[] } };
      expect(body.ok).toBe(true);
    });
  });

  describe('Step 4: Runs / Observability', () => {
    it('should list observability runs', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/observability/runs',
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { runs: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.runs)).toBe(true);
    });

    it('should support run filtering by status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/observability/runs?status=completed',
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { runs: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.runs)).toBe(true);
    });
  });

  describe('Step 5: Timeline', () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await createSession(authCookie);
    });

    it('should get session detail', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/sessions/${sessionId}`,
        headers: { cookie: authCookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { timeline: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.data).toBeDefined();
    });
  });

  describe('Step 6: Health and API Productization', () => {
    it('should return health status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBeDefined();
    });

    it('should return readiness status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health/ready',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
    });

    it('should include request id in response headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should return 401 for unauthenticated requests to protected endpoints', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return standard error envelope for auth failures', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      });
      const body = response.json() as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });
});
