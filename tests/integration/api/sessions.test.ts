import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

type CreateSessionResponseBody = { data: { session: { sessionId: string } } };

describe('Sessions API', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let apiContext: ApiContext;
  let authCookie: string;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    server = await createApiServer(apiContext);
    await server.listen();
    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }
    baseUrl = `http://localhost:${address.port}`;

    const setupResponse = await fetch(`${baseUrl}/api/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    });

    expect(setupResponse.status).toBe(201);
    authCookie = setupResponse.headers.get('set-cookie')!;
  });

  afterAll(async () => {
    await server.close();
    apiContext.connection.close();
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string } } };
      expect(body.data.session.sessionId).toBeDefined();
      expect(body.data.session.userId).toBeDefined();
    });

    it('should create session under authenticated user', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string } } };
      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Cookie': authCookie },
      });
      const meBody = await meResponse.json() as { data: { user: { userId: string } } };
      expect(body.data.session.userId).toBe(meBody.data.user.userId);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/sessions/:sessionId', () => {
    it('should return session info for existing session', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const createBody = await createResponse.json() as { data: { session: { sessionId: string } } };
      const { sessionId } = createBody.data.session;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string; messageCount: number } } };
      expect(body.data.session.sessionId).toBe(sessionId);
      expect(body.data.session.messageCount).toBe(0);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/test-session`);
      expect(response.status).toBe(401);
    });

    it('should deny access to sessions owned by another user', async () => {
      const sessionId = `foreign-session-${Date.now()}`;
      apiContext.stores.sessionStore.create({
        sessionId,
        userId: 'foreign-user',
        title: 'Foreign Session',
        status: 'active',
        messageCount: 0,
      });

      const sessionResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(sessionResponse.status).toBe(403);

      const transcriptsResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcripts`, {
        headers: { 'Cookie': authCookie },
      });
      expect(transcriptsResponse.status).toBe(403);

      const timelineResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/timeline`, {
        headers: { 'Cookie': authCookie },
      });
      expect(timelineResponse.status).toBe(403);

      const streamResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/timeline/stream`, {
        headers: { 'Cookie': authCookie },
      });
      expect(streamResponse.status).toBe(403);

      const messageResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'unauthorized message' }),
      });
      expect(messageResponse.status).toBe(403);
    });
  });

  describe('GET /api/sessions/:sessionId/transcripts', () => {
    it('should return empty transcripts for new session', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcripts`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { transcripts: unknown[]; total: number } };
      expect(body.data.transcripts).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('should return 404 for non-existent session transcripts', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/non-existent-id/transcripts`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/test-session/transcripts`);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/sessions/:sessionId/messages', () => {
    it('should accept valid message', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Hello, world!' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { accepted: boolean; status: string } };
      expect(body.data.accepted).toBe(true);
    });

    it('should reject blank message with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: '' })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject whitespace-only message with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: '   ' })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject missing text field with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject malformed body with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: 'not valid json'
      });

      expect(response.status).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/test-session/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello' })
      });

      expect(response.status).toBe(401);
    });

    it('should return correlationId and envelopeId in response', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Hello, world!' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { accepted: boolean; status: string; correlationId: string; envelopeId: string } };
      expect(body.data.accepted).toBe(true);
      expect(body.data.status).toBe('accepted');
      expect(body.data.correlationId).toBeDefined();
      expect(body.data.correlationId.length).toBeGreaterThan(0);
      expect(body.data.envelopeId).toBeDefined();
      expect(body.data.envelopeId.length).toBeGreaterThan(0);
      expect(body.data.correlationId).toBe(body.data.envelopeId);
    });

    it('should start async processing and not block on completion', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Test async processing' })
      });
      const endTime = Date.now();

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { accepted: boolean; correlationId: string } };
      expect(body.data.accepted).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should update last_activity_at when message is accepted', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as CreateSessionResponseBody;

      const beforeResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      const beforeBody = await beforeResponse.json() as { data: { session: { lastActivityAt: string } } };
      const beforeActivity = beforeBody.data.session.lastActivityAt;

      await new Promise(resolve => setTimeout(resolve, 50));

      await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Activity update test' })
      });

      const afterResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      const afterBody = await afterResponse.json() as { data: { session: { lastActivityAt: string } } };
      const afterActivity = afterBody.data.session.lastActivityAt;

      expect(new Date(afterActivity).getTime()).toBeGreaterThan(new Date(beforeActivity).getTime());
    });
  });

  describe('GET /api/sessions', () => {
    it('should list sessions for authenticated user', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        headers: { 'Cookie': authCookie },
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { data: { items: unknown[]; total: number } };
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(typeof body.data.total).toBe('number');
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`);
      expect(response.status).toBe(401);
    });
  });
});
