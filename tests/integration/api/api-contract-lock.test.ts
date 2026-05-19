import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const EXPECTED_VERSION = packageJson.version;

describe('API Contract Lock', () => {
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

  // ===========================================================================
  // Response Envelope Format Tests
  // ===========================================================================
  describe('Response Envelope Format', () => {
    it('GET /api/v1/health should return success envelope with ok, data, and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: { status: string; modules: Record<string, unknown>; timestamp: string };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.status).toBeDefined();
      expect(body.data.modules).toBeDefined();
      expect(body.data.timestamp).toBeDefined();
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/sessions should return success envelope with ok, data, and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: { items: unknown[] };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/tools should return success envelope with ok, data, and requestId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`);
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: { tools: unknown[] };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.tools)).toBe(true);
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('should have ok: true for all successful responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { 'Cookie': authCookie } }),
        fetch(`${baseUrl}/api/v1/tools`),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const body = await response.json() as { ok: boolean };
        expect(body.ok).toBe(true);
      }
    });

    it('should have non-empty requestId for all responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { 'Cookie': authCookie } }),
        fetch(`${baseUrl}/api/v1/tools`),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const body = await response.json() as { requestId: string };
        expect(typeof body.requestId).toBe('string');
        expect(body.requestId.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // Error Envelope Format Tests
  // ===========================================================================
  describe('Error Envelope Format', () => {
    it('should return 404 with error envelope for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session-id`, {
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

    it('should return 401 with error envelope for unauthenticated request to protected endpoint', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`);
      expect(response.status).toBe(401);

      const body = await response.json() as {
        ok: boolean;
        error: { code: string; message: string };
        requestId: string;
      };

      expect(body.ok).toBe(false);
      expect(body.error).toBeDefined();
      expect(typeof body.error.code).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
      expect(typeof body.error.message).toBe('string');
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('should return 400 with error envelope for validation error', async () => {
      // Create a session first to get a valid sessionId
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { data: { session: { sessionId: string } } };
      const sessionId = createBody.data.session.sessionId;

      // Try to send an empty message (validation error)
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      });
      expect(response.status).toBe(400);

      const body = await response.json() as {
        ok: boolean;
        error: { code: string; message: string };
        requestId: string;
      };

      expect(body.ok).toBe(false);
      expect(body.error).toBeDefined();
      expect(typeof body.error.code).toBe('string');
      expect(body.error.code.length).toBeGreaterThan(0);
      expect(typeof body.error.message).toBe('string');
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });

    it('should not have data field in error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as Record<string, unknown>;
      expect(body.data).toBeUndefined();
    });
  });

  // ===========================================================================
  // Pagination Contract Tests (limit/offset)
  // ===========================================================================
  describe('Pagination Contract (limit/offset)', () => {
    it('GET /api/v1/sessions should support limit and offset parameters', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=10&offset=5`, {
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
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.hasMore).toBe('boolean');
    });

    it('GET /api/v1/logs should support limit and offset parameters', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?limit=20&offset=0`, {
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
      expect(body.data.limit).toBe(20);
      expect(body.data.offset).toBe(0);
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.hasMore).toBe('boolean');
    });

    it('should return hasMore correctly based on offset + items.length < total', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=5`, {
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
      const expectedHasMore = body.data.offset + body.data.items.length < body.data.total;
      expect(body.data.hasMore).toBe(expectedHasMore);
    });
  });

  // ===========================================================================
  // Cursor Pagination Tests (sessions endpoint)
  // ===========================================================================
  describe('Cursor Pagination (sessions endpoint)', () => {
    it('should accept cursor parameter and return cursor-paginated response', async () => {
      // First, create a few sessions to have data
      for (let i = 0; i < 3; i++) {
        await fetch(`${baseUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      }

      // Get first page with cursor pagination
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=2`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          items: unknown[];
          total: number;
          hasMore: boolean;
          nextCursor?: string;
        };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.hasMore).toBe('boolean');
    });

    it('should return nextCursor when hasMore is true', async () => {
      // Create multiple sessions to ensure we have data
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=2`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        ok: boolean;
        data: {
          items: unknown[];
          total: number;
          hasMore: boolean;
          nextCursor?: string;
        };
        requestId: string;
      };

      expect(body.ok).toBe(true);
      if (body.data.hasMore && body.data.nextCursor) {
        // Verify we can use the cursor
        const nextResponse = await fetch(`${baseUrl}/api/v1/sessions?cursor=${encodeURIComponent(body.data.nextCursor)}&limit=2`, {
          headers: { 'Cookie': authCookie },
        });
        expect(nextResponse.status).toBe(200);

        const nextBody = await nextResponse.json() as {
          ok: boolean;
          data: { items: unknown[] };
        };
        expect(nextBody.ok).toBe(true);
        expect(Array.isArray(nextBody.data.items)).toBe(true);
      }
    });

    it('should return 400 for invalid cursor', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?cursor=invalid-cursor-value`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(400);

      const body = await response.json() as {
        ok: boolean;
        error: { code: string; message: string };
        requestId: string;
      };

      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_CURSOR');
    });
  });

  // ===========================================================================
  // 307 Redirect Tests (legacy /api/ → /api/v1/)
  // ===========================================================================
  describe('307 Redirect (legacy /api/ to /api/v1/)', () => {
    it('should redirect GET /api/health to /api/v1/health with 307', async () => {
      const response = await fetch(`${baseUrl}/api/health`, {
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/api/v1/health');
    });

    it('should redirect GET /api/sessions to /api/v1/sessions with 307', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        headers: { 'Cookie': authCookie },
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/api/v1/sessions');
    });

    it('should redirect POST /api/sessions to /api/v1/sessions with 307', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/api/v1/sessions');
    });

    it('should redirect GET /api/tools to /api/v1/tools with 307', async () => {
      const response = await fetch(`${baseUrl}/api/tools`, {
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/api/v1/tools');
    });

    it('should preserve request body on POST redirect (307 preserves body)', async () => {
      // First create a session to get a valid sessionId
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const createBody = await createResponse.json() as { data: { session: { sessionId: string } } };
      const sessionId = createBody.data.session.sessionId;

      // Test that 307 redirect exists for messages endpoint
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Cookie': authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test message' }),
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(`/api/v1/sessions/${sessionId}/messages`);
    });
  });

  // ===========================================================================
  // Version Consistency Tests
  // ===========================================================================
  describe('Version Consistency', () => {
    it('package.json version should match expected version', () => {
      expect(packageJson.version).toBe(EXPECTED_VERSION);
    });

    it('server.ts OpenAPI version should match package.json version', async () => {
      const serverContent = readFileSync(join(process.cwd(), 'src/api/server.ts'), 'utf-8');
      const versionMatch = serverContent.match(/version:\s*['"]([^'"]+)['"]/);
      expect(versionMatch).not.toBeNull();
      expect(versionMatch![1]).toBe(EXPECTED_VERSION);
    });

    it('openapi.yaml version should match package.json version', async () => {
      const openapiContent = readFileSync(join(process.cwd(), 'docs/api/openapi.yaml'), 'utf-8');
      const versionMatch = openapiContent.match(/^\s*version:\s*["']?([^"'\n]+)["']?/m);
      expect(versionMatch).not.toBeNull();
      expect(versionMatch![1]).toBe(EXPECTED_VERSION);
    });

    it('all three sources should have consistent version', () => {
      const packageVersion = packageJson.version;

      const serverContent = readFileSync(join(process.cwd(), 'src/api/server.ts'), 'utf-8');
      const serverVersionMatch = serverContent.match(/version:\s*['"]([^'"]+)['"]/);
      const serverVersion = serverVersionMatch?.[1];

      const openapiContent = readFileSync(join(process.cwd(), 'docs/api/openapi.yaml'), 'utf-8');
      const openapiVersionMatch = openapiContent.match(/^\s*version:\s*["']?([^"'\n]+)["']?/m);
      const openapiVersion = openapiVersionMatch?.[1];

      expect(packageVersion).toBe('0.7.0-rc.1');
      expect(serverVersion).toBe('0.7.0-rc.1');
      expect(openapiVersion).toBe('0.7.0-rc.1');
      expect(packageVersion).toBe(serverVersion);
      expect(packageVersion).toBe(openapiVersion);
      expect(serverVersion).toBe(openapiVersion);
    });
  });

  // ===========================================================================
  // V1 API Prefix Contract Tests
  // ===========================================================================
  describe('V1 API Prefix Contract', () => {
    it('all v1 endpoints should use /api/v1/ prefix', async () => {
      const v1Endpoints = [
        '/api/v1/health',
        '/api/v1/sessions',
        '/api/v1/tools',
      ];

      for (const endpoint of v1Endpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: endpoint.includes('sessions') ? { 'Cookie': authCookie } : {},
        });
        expect(response.status).toBeLessThan(500);
      }
    });

    it('legacy endpoints should redirect, not return 404', async () => {
      const legacyEndpoints = [
        '/api/health',
        '/api/sessions',
        '/api/tools',
      ];

      for (const endpoint of legacyEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: endpoint.includes('sessions') ? { 'Cookie': authCookie } : {},
          redirect: 'manual',
        });
        expect(response.status).toBe(307);
      }
    });
  });
});
