import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

interface EnvelopeError {
  ok: boolean;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

describe('Request Validation', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  function expectEnvelopeError(body: EnvelopeError, expectedCode: string): void {
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(expectedCode);
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
  }

  describe('POST /api/auth/login', () => {
    it('returns 400 when username is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('returns 400 when password is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('returns 400 when body is empty object', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('returns 401 when credentials are invalid', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
      });
      expect(response.status).toBe(401);
      const body = await response.json() as EnvelopeError;
      expect(body.ok).toBe(false);
    });
  });

  describe('POST /api/providers', () => {
    it('returns 400 when providerType is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ displayName: 'test' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('should create provider when required fields are present', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({
          providerType: 'ollama',
          displayName: 'Test Ollama',
          baseUrl: 'http://localhost:11434',
        }),
      });
      expect(response.status).toBe(201);
    });
  });

  describe('POST /api/sessions/:sessionId/messages', () => {
    it('returns 400 when text is missing', async () => {
      const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionRes.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('returns 400 when text is empty string', async () => {
      const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionRes.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ text: '' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });

  describe('PATCH /api/sessions/:sessionId/model', () => {
    it('returns 400 when providerId is missing', async () => {
      const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionRes.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/model`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ model: 'test-model' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });

    it('returns 400 when model is missing', async () => {
      const sessionRes = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionRes.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/model`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ providerId: 'ollama' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/workflows/drafts', () => {
    it('returns 400 when name is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ steps: [] }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/triggers/schedules', () => {
    it('returns 400 when name is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ schedulePattern: '0 * * * *' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/triggers/webhooks', () => {
    it('returns 400 when name is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/memory/debug/extract', () => {
    it('returns 400 when sessionId is missing', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': authCookie,
        },
        body: JSON.stringify({ turnId: 'turn-1' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as EnvelopeError;
      expectEnvelopeError(body, 'VALIDATION_ERROR');
    });
  });
});
