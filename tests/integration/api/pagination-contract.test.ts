import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Pagination Contract', () => {
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

  describe('GET /api/sessions', () => {
    it('should return paginated response with hasMore in envelope', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          items: unknown[];
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
        requestId: string;
      };

      // Envelope structure
      expect(body.ok).toBe(true);
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);

      // Paginated response fields
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.limit).toBe('number');
      expect(typeof body.data.offset).toBe('number');
      expect(typeof body.data.hasMore).toBe('boolean');

      // hasMore should be false when offset + items.length >= total
      expect(body.data.hasMore).toBe(body.data.offset + body.data.items.length < body.data.total);
    });

    it('should set hasMore to false when no sessions exist (empty result)', async () => {
      const response = await fetch(`${baseUrl}/api/sessions?limit=5`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          items: unknown[];
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
      expect(body.data.hasMore).toBe(false);
    });

    it('should return correct limit and offset values', async () => {
      const response = await fetch(`${baseUrl}/api/sessions?limit=10&offset=5`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          items: unknown[];
          total: number;
          limit: number;
          offset: number;
          hasMore: boolean;
        };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(body.data.limit).toBe(10);
      expect(body.data.offset).toBe(5);
    });
  });
});
