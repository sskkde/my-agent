import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Error Format Contract', () => {
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

  describe('GET /api/approvals/:approvalId (non-existent)', () => {
    it('should return 404 with error envelope', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as {
        ok: boolean;
        error: { code: string; message: string; details?: unknown };
        requestId: string;
      };

      expect(body.ok).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('should not have data field in error response', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as Record<string, unknown>;
      expect(body.data).toBeUndefined();
    });
  });

  describe('Error envelope structure', () => {
    it('should have ok: false in all error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { ok: boolean };
      expect(body.ok).toBe(false);
    });

    it('should have error.code as a non-empty string', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as {
        ok: boolean;
        error: { code: string };
        requestId: string;
      };

      expect(typeof body.error.code).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
    });

    it('should include requestId in error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { requestId: string };
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });
  });
});
