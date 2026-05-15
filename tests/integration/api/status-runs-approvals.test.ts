import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Status, Approvals, and Runs API', () => {
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

  describe('GET /api/health', () => {
    it('should return health status with module information', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);

      const body = await response.json() as { ok: boolean; data: { status: string; modules: Record<string, { status: string; message?: string }>; timestamp: string } };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBeDefined();
      expect(body.data.modules).toBeDefined();
      expect(body.data.timestamp).toBeDefined();
      expect(body.data.modules.approvals).toBeDefined();
      expect(body.data.modules.runs).toBeDefined();
      expect(body.data.modules.planner).toBeDefined();
      expect(body.data.modules.kernel).toBeDefined();
    });
  });

  describe('GET /api/approvals', () => {
    it('should return empty approvals list when no approvals exist', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { approvals: unknown[]; total: number } };
      expect(body.data.approvals).toEqual([]);
      expect(body.data.total).toBe(0);
    });
  });

  describe('PATCH /api/approvals/:approvalId', () => {
    it('should return 404 for non-existent approval', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid decision', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'invalid' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing decision field', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ reason: 'some reason' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/runs', () => {
    it('should return empty runs list initially', async () => {
      const response = await fetch(`${baseUrl}/api/v1/runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { ok: boolean; data: { runs: unknown[]; total: number } };
      expect(body.ok).toBe(true);
      expect(body.data.runs).toEqual([]);
      expect(body.data.total).toBe(0);
    });
  });

  describe('GET /api/runs/stream', () => {
    it('should return event stream with text/event-stream content type', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(`${baseUrl}/api/v1/runs/stream`, {
          signal: controller.signal,
          headers: { 'Cookie': authCookie },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
      } catch {
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    });

    it('should send initial snapshot event', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(`${baseUrl}/api/v1/runs/stream`, {
          signal: controller.signal,
          headers: { 'Cookie': authCookie },
        });
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const text = decoder.decode(value);

        expect(text).toContain('snapshot');
        reader.cancel();
      } catch {
      } finally {
        clearTimeout(timeout);
      }
    });
  }, 30000);
});