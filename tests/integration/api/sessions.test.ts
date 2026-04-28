import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

describe('Sessions API', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let apiContext: ApiContext;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    server = await createApiServer(apiContext);
    await server.listen();
    const address = server.server.address();
    baseUrl = `http://localhost:${(address as any).port}`;
  });

  afterAll(async () => {
    await server.close();
    if (apiContext && 'connection' in apiContext) {
      (apiContext as any).connection.close();
    }
  });

  describe('POST /api/sessions', () => {
    it('should create a new session', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string } } };
      expect(body.data.session.sessionId).toBeDefined();
      expect(body.data.session.userId).toBe('local-user');
    });

    it('should create session with custom userId', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'test-user' })
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string } } };
      expect(body.data.session.userId).toBe('test-user');
    });
  });

  describe('GET /api/sessions/:sessionId', () => {
    it('should return session info for existing session', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { session: { sessionId: string; userId: string; messageCount: number } } };
      expect(body.data.session.sessionId).toBe(sessionId);
      expect(body.data.session.messageCount).toBe(0);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/non-existent-id`);
      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/sessions/:sessionId/transcripts', () => {
    it('should return empty transcripts for new session', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/transcripts`);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { transcripts: unknown[]; total: number } };
      expect(body.data.transcripts).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('should return 404 for non-existent session transcripts', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/non-existent-id/transcripts`);
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/sessions/:sessionId/messages', () => {
    it('should accept valid message', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello, world!' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { accepted: boolean; status: string } };
      expect(body.data.accepted).toBe(true);
    });

    it('should reject blank message with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject whitespace-only message with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' })
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject missing text field with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_MESSAGE_TEXT');
    });

    it('should reject malformed body with 400', async () => {
      const createResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json'
      });

      expect(response.status).toBe(400);
    });
  });
});