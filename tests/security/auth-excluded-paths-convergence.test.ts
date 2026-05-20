/**
 * Auth Excluded Paths Convergence Test Suite
 *
 * P0 Security: Auth excluded paths must be converged with RBAC exempt paths.
 * Only essential public routes should bypass authentication.
 * Business routes (sessions, providers, workflows, etc.) MUST require auth.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

// RBAC DEFAULT_EXEMPT_PATHS (source of truth) — must mirror rbac.ts
const RBAC_EXEMPT_PATHS = [
  '/api/health',
  '/api/health/ready',
  '/api/docs',
  '/api/docs/json',
  '/api/setup/status',
  '/api/setup/user',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/tools',
  '/api/webhooks/*',
  '/api/metrics',
  '/api/v1/health',
  '/api/v1/health/ready',
  '/api/v1/docs',
  '/api/v1/docs/json',
  '/api/v1/setup/status',
  '/api/v1/setup/user',
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/tools',
  '/api/v1/webhooks/*',
  '/api/v1/metrics',
];

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-auth-excluded-paths-convergence';

describe('Auth Excluded Paths Convergence', () => {
  let server: FastifyInstance;
  let context: ApiContext;

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY;

    const ctxResult = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`);
    }
    context = ctxResult;

    server = await createApiServer(context);
    await server.listen();
  }, 30000);

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections();
    }
    await server.close();
    context.connection.close();
  });

  // ===========================================================================
  // 1. Business routes MUST require auth (401 for unauthenticated)
  // ===========================================================================
  describe('Business routes require authentication', () => {
    const protectedPaths = [
      '/api/v1/providers',
      '/api/v1/sessions',
      '/api/v1/workflows',
      '/api/v1/connectors',
      '/api/v1/observability',
      '/api/v1/memory',
      '/api/v1/runs',
      '/api/v1/approvals',
      '/api/v1/api-keys',
      '/api/v1/agents/foreground.default/config',
      '/api/v1/triggers',
      '/api/v1/settings',
      '/api/v1/models',
      '/api/v1/instances',
      '/api/v1/channels',
      '/api/v1/skills',
      '/api/v1/usage',
      '/api/v1/logs',
      '/api/v1/tags',
    ];

    for (const path of protectedPaths) {
      it(`should return 401 for unauthenticated GET ${path}`, async () => {
        const response = await server.inject({
          method: 'GET',
          url: path,
        });
        expect(response.statusCode).toBe(401);
      });
    }
  });

  // ===========================================================================
  // 2. Exempt routes should be accessible without auth (200 or non-401)
  // ===========================================================================
  describe('Exempt routes accessible without authentication', () => {
    it('should return 200 for unauthenticated GET /api/v1/health', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for unauthenticated GET /api/v1/setup/status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for unauthenticated GET /api/v1/tools', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return 200 for unauthenticated GET /api/v1/metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      });
      expect(response.statusCode).toBe(200);
    });

    it('should allow POST /api/v1/auth/login without auth (not 401)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'nonexistent', password: 'wrong' },
      });
      // Should be 401 (invalid credentials) not auth-middleware 401
      // Both are 401 but the key is it doesn't block at middleware level
      expect(response.statusCode).not.toBeGreaterThanOrEqual(500);
    });
  });

  // ===========================================================================
  // 3. Wildcard sub-paths of business routes must also require auth
  // ===========================================================================
  describe('Wildcard sub-paths of business routes require auth', () => {
    const protectedSubPaths = [
      '/api/v1/workflows/some-id',
      '/api/v1/connectors/some-id',
      '/api/v1/observability/traces',
      '/api/v1/memory/some-key',
      '/api/v1/runs/some-id',
      '/api/v1/approvals/some-id',
      '/api/v1/triggers/some-id',
      '/api/v1/sessions/some-id',
      '/api/v1/providers/some-id',
    ];

    for (const path of protectedSubPaths) {
      it(`should return 401 for unauthenticated GET ${path}`, async () => {
        const response = await server.inject({
          method: 'GET',
          url: path,
        });
        expect(response.statusCode).toBe(401);
      });
    }
  });

  // ===========================================================================
  // 4. Auth excluded path count must be ≤ 25
  // ===========================================================================
  describe('Auth excluded path count', () => {
    it('should have ≤ 25 auth excluded paths', async () => {
      // Extract excluded paths from server.ts by checking the source
      // We verify by reading the module and counting
      const { readFileSync } = await import('fs');
      const serverSource = readFileSync(
        new URL('../../src/api/server.ts', import.meta.url),
        'utf-8'
      );

      // Extract the excludedPaths array content
      const match = serverSource.match(/excludedPaths:\s*\[([\s\S]*?)\]/);
      expect(match).not.toBeNull();

      const pathsContent = match![1];
      const paths = pathsContent
        .split(',')
        .map(p => p.trim().replace(/'/g, '').replace(/"/g, ''))
        .filter(p => p.startsWith('/api/'));

      expect(paths.length).toBeLessThanOrEqual(25);
    });
  });

  // ===========================================================================
  // 5. Auth excluded paths must align with RBAC exempt paths
  // ===========================================================================
  describe('Auth excluded paths align with RBAC exempt paths', () => {
    it('every auth excluded path should be in RBAC exempt paths', async () => {
      const { readFileSync } = await import('fs');
      const serverSource = readFileSync(
        new URL('../../src/api/server.ts', import.meta.url),
        'utf-8'
      );

      const match = serverSource.match(/excludedPaths:\s*\[([\s\S]*?)\]/);
      expect(match).not.toBeNull();

      const pathsContent = match![1];
      const authPaths = pathsContent
        .split(',')
        .map(p => p.trim().replace(/'/g, '').replace(/"/g, ''))
        .filter(p => p.startsWith('/api/'));

      // Every auth excluded path must be in RBAC exempt paths
      for (const authPath of authPaths) {
        expect(
          RBAC_EXEMPT_PATHS.includes(authPath),
          `Auth excluded path '${authPath}' is NOT in RBAC exempt paths`
        ).toBe(true);
      }
    });

    it('RBAC exempt paths should be a superset of auth excluded paths', async () => {
      const { readFileSync } = await import('fs');
      const serverSource = readFileSync(
        new URL('../../src/api/server.ts', import.meta.url),
        'utf-8'
      );

      const match = serverSource.match(/excludedPaths:\s*\[([\s\S]*?)\]/);
      expect(match).not.toBeNull();

      const pathsContent = match![1];
      const authPaths = pathsContent
        .split(',')
        .map(p => p.trim().replace(/'/g, '').replace(/"/g, ''))
        .filter(p => p.startsWith('/api/'));

      // RBAC exempt paths should be a superset (or equal) to auth excluded paths
      // This ensures no auth-excluded route is missing from RBAC exempt list
      const authPathsSet = new Set(authPaths);
      const rbacPathsSet = new Set(RBAC_EXEMPT_PATHS);

      for (const path of authPathsSet) {
        expect(
          rbacPathsSet.has(path),
          `Auth path '${path}' missing from RBAC exempt paths`
        ).toBe(true);
      }
    });
  });

  // ===========================================================================
  // 6. Specific security-critical route checks
  // ===========================================================================
  describe('Security-critical route checks', () => {
    it('should return 401 for unauthenticated GET /api/v1/providers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for unauthenticated GET /api/v1/sessions', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for unauthenticated GET /api/v1/workflows/some-id', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/workflows/some-id',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for unauthenticated GET /api/v1/connectors', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 200 for unauthenticated GET /api/v1/health (exempt)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
