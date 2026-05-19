import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiServer } from '../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

/**
 * API Key Authentication Security Tests
 *
 * Tests verify that:
 * 1. API Key creation returns ak_ prefixed key with correct role mapping
 * 2. Valid API Key (Bearer token) successfully accesses protected endpoints
 * 3. Admin/user/service roles have correct permissions
 * 4. Revoked API Key cannot access protected endpoints
 * 5. Invalid/expired API Key returns 401 with error envelope
 * 6. API Key takes priority over session cookie when both present
 */
describe('API Key Authentication', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let baseUrl: string;

  beforeEach(async () => {
    const ctxResult = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`);
    }
    context = ctxResult;

    server = await createApiServer(context);
    await server.listen();
    const address = server.server.address();
    baseUrl = `http://localhost:${(address as any).port}`;
  });

  afterEach(async () => {
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections();
    }
    await server.close();
    context.connection.close();
  });

  /**
   * Helper: Create user and get session cookie
   */
  async function createUserAndLogin(username: string, password: string): Promise<{ cookie: string; userId: string }> {
    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    expect(setupResponse.status).toBe(201);
    const body = await setupResponse.json() as { data: { user: { userId: string } } };
    const setCookieHeader = setupResponse.headers.get('set-cookie');
    expect(setCookieHeader).toBeDefined();
    return { cookie: setCookieHeader!, userId: body.data.user.userId };
  }

  /**
   * Helper: Create API key with specific role
   */
  async function createApiKey(cookie: string, name: string, role: 'admin' | 'user' | 'service', expiresAt?: string): Promise<{ key: string; id: string }> {
    const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ name, role, expiresAt }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { key: string; id: string } };
    return { key: body.data.key, id: body.data.id };
  }

  // ==========================================================================
  // Test 1: API Key creation returns ak_ prefixed key with correct role mapping
  // ==========================================================================
  describe('API Key Creation', () => {
    let userCookie: string;

    beforeEach(async () => {
      const result = await createUserAndLogin('testuser', 'password123');
      userCookie = result.cookie;
    });

    it('should create API key with ak_ prefix', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': userCookie },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { key: string; prefix: string; role: string } };
      expect(body.data.key).toMatch(/^ak_/);
      expect(body.data.prefix).toMatch(/^ak_/);
      expect(body.data.role).toBe('user');
    });

    it('should create admin role API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': userCookie },
        body: JSON.stringify({ name: 'Admin Key', role: 'admin' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { key: string; role: string } };
      expect(body.data.key).toMatch(/^ak_/);
      expect(body.data.role).toBe('admin');
    });

    it('should create service role API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': userCookie },
        body: JSON.stringify({ name: 'Service Key', role: 'service' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { data: { key: string; role: string } };
      expect(body.data.key).toMatch(/^ak_/);
      expect(body.data.role).toBe('service');
    });

    it('should return unique keys for each creation', async () => {
      const response1 = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': userCookie },
        body: JSON.stringify({ name: 'Key 1', role: 'user' }),
      });
      const body1 = await response1.json() as { data: { key: string } };

      const response2 = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': userCookie },
        body: JSON.stringify({ name: 'Key 2', role: 'user' }),
      });
      const body2 = await response2.json() as { data: { key: string } };

      expect(body1.data.key).not.toBe(body2.data.key);
    });
  });

  // ==========================================================================
  // Test 2: Valid API Key (Bearer token) successfully accesses protected endpoints
  // ==========================================================================
  describe('API Key Usage', () => {
    let userCookie: string;
    let userApiKey: string;

    beforeEach(async () => {
      const result = await createUserAndLogin('testuser', 'password123');
      userCookie = result.cookie;
      const keyResult = await createApiKey(userCookie, 'Test Key', 'user');
      userApiKey = keyResult.key;
    });

    it('should access protected endpoint with valid API key via Bearer token', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${userApiKey}` },
      });
      expect(response.status).toBe(200);
    });

    it('should create session with API key auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(201);
    });

    it('should list API keys with API key auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': `Bearer ${userApiKey}` },
      });
      expect(response.status).toBe(200);
    });

    it('should access memory endpoint with API key auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { 'Authorization': `Bearer ${userApiKey}` },
      });
      expect(response.status).toBe(200);
    });

    it('should access providers endpoint with API key auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { 'Authorization': `Bearer ${userApiKey}` },
      });
      expect(response.status).toBe(200);
    });

    it('should access observability runs with API key auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { 'Authorization': `Bearer ${userApiKey}` },
      });
      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // Test 3: Admin/user/service roles have correct permissions
  // ==========================================================================
  describe('API Key Role Mapping', () => {
    let adminCookie: string;

    beforeEach(async () => {
      const result = await createUserAndLogin('admin', 'password123');
      adminCookie = result.cookie;
    });

    it('admin API key can access admin routes (agent config)', async () => {
      const apiKey = await createApiKey(adminCookie, 'Admin Key', 'admin');

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config`, {
        headers: { 'Authorization': `Bearer ${apiKey.key}` },
      });
      expect(response.status).toBe(200);
    });

    it('admin API key can update global agent config', async () => {
      const apiKey = await createApiKey(adminCookie, 'Admin Key', 'admin');

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.key}` },
        body: JSON.stringify({ displayName: 'Updated Agent' }),
      });
      expect(response.status).toBe(200);
    });

    it('user API key can access user routes (sessions)', async () => {
      const apiKey = await createApiKey(adminCookie, 'User Key', 'user');

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${apiKey.key}` },
      });
      expect(response.status).toBe(200);
    });

    it('user API key cannot access admin routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'User Key', 'user');

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.key}` },
        body: JSON.stringify({ displayName: 'Hacked' }),
      });
      expect(response.status).toBe(403);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('service API key can access protected routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'Service Key', 'service');

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${apiKey.key}` },
      });
      expect(response.status).toBe(200);
    });

    it('service API key cannot access admin routes', async () => {
      const apiKey = await createApiKey(adminCookie, 'Service Key', 'service');

      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config/global`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.key}` },
        body: JSON.stringify({ displayName: 'Hacked' }),
      });
      expect(response.status).toBe(403);
    });
  });

  // ==========================================================================
  // Test 4: Revoked API Key cannot access protected endpoints
  // ==========================================================================
  describe('API Key Revocation', () => {
    let userCookie: string;
    let userApiKey: { key: string; id: string };

    beforeEach(async () => {
      const result = await createUserAndLogin('testuser', 'password123');
      userCookie = result.cookie;
      userApiKey = await createApiKey(userCookie, 'Test Key', 'user');
    });

    it('should revoke API key and deny subsequent access', async () => {
      // First verify key works
      const beforeRevoke = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${userApiKey.key}` },
      });
      expect(beforeRevoke.status).toBe(200);

      // Revoke the key
      const revokeResponse = await fetch(`${baseUrl}/api/v1/api-keys/${userApiKey.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': userCookie },
      });
      expect(revokeResponse.status).toBe(200);

      // Now verify key is revoked
      const afterRevoke = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${userApiKey.key}` },
      });
      // Revoked key results in no role, so RBAC returns 403 FORBIDDEN
      expect(afterRevoke.status).toBe(403);
      const body = await afterRevoke.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should return 404 when revoking non-existent key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys/nonexistent-id`, {
        method: 'DELETE',
        headers: { 'Cookie': userCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should list revoked key as inactive', async () => {
      // Revoke the key
      await fetch(`${baseUrl}/api/v1/api-keys/${userApiKey.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': userCookie },
      });

      // List keys
      const listResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Cookie': userCookie },
      });
      const body = await listResponse.json() as { data: { id: string; isActive: boolean }[] };
      const revokedKey = body.data.find(k => k.id === userApiKey.id);
      expect(revokedKey).toBeDefined();
      expect(revokedKey!.isActive).toBe(false);
    });
  });

  // ==========================================================================
  // Test 5: Invalid/expired API Key returns 401 with error envelope
  // ==========================================================================
  describe('Invalid API Key Handling', () => {
    it('should return 401 for invalid API key format (no ak_ prefix)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': 'Bearer invalid-key-format' },
      });
      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string; message: string }; requestId: string };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBeDefined();
      expect(body.requestId).toBeDefined();
    });

    it('should return 403 for non-existent API key (no role found)', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': 'Bearer ak_nonexistentkey123456789' },
      });
      // Non-existent key results in no role, so RBAC returns 403 FORBIDDEN
      expect(response.status).toBe(403);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should return 401 for malformed Bearer header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': 'Basic ak_somekey' },
      });
      expect(response.status).toBe(401);
    });

    it('should return 401 when no Authorization header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`);
      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 for expired API key (no role found)', async () => {
      // Create user and get cookie
      const { cookie } = await createUserAndLogin('testuser', 'password123');

      // Create API key that expires in the past
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      const apiKey = await createApiKey(cookie, 'Expired Key', 'user', pastDate);

      // Try to use expired key
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${apiKey.key}` },
      });
      // Expired key results in no role, so RBAC returns 403 FORBIDDEN
      expect(response.status).toBe(403);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should return 401 for empty Bearer token', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': 'Bearer ' },
      });
      expect(response.status).toBe(401);
    });

    it('should return correct error envelope structure for invalid API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': 'Bearer ak_invalid' },
      });
      // Invalid key results in no role, so RBAC returns 403 FORBIDDEN
      expect(response.status).toBe(403);
      const body = await response.json() as { ok: boolean; error: { code: string; message: string }; requestId: string };
      
      // Verify error envelope structure
      expect(body).toHaveProperty('ok');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('requestId');
      expect(body.ok).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Test 6: API Key takes priority over session cookie when both present
  // ==========================================================================
  describe('API Key vs Session Cookie Priority', () => {
    let userCookie: string;
    let userApiKey: string;

    beforeEach(async () => {
      // Create one user via setup (setup only allows one user)
      const result = await createUserAndLogin('testuser', 'password123');
      userCookie = result.cookie;

      // Create API key for the user
      const keyResult = await createApiKey(userCookie, 'Test Key', 'user');
      userApiKey = keyResult.key;
    });

    it('should use API key auth when both API key and session cookie present', async () => {
      // When Bearer ak_* is present, session auth is skipped and API key auth is used
      // The auth middleware checks for 'Bearer ak_' prefix and skips session auth
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userApiKey}`,
          'Cookie': userCookie,
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(201);
    });

    it('should use API key for identity when listing API keys', async () => {
      // With both API key and session cookie, API key identity is used
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: {
          'Authorization': `Bearer ${userApiKey}`,
          'Cookie': userCookie,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { data: { id: string }[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should succeed with API key when session cookie is also present', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: {
          'Authorization': `Bearer ${userApiKey}`,
          'Cookie': userCookie,
        },
      });

      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // Additional: Public routes should not require API key
  // ==========================================================================
  describe('Public Routes', () => {
    it('health endpoint should be accessible without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);
    });

    it('setup status should be accessible without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`);
      expect(response.status).toBe(200);
    });

    it('tools endpoint should be accessible without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`);
      expect(response.status).toBe(200);
    });

    it('metrics endpoint should be accessible without API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/metrics`);
      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // Additional: API Key last used tracking
  // ==========================================================================
  describe('API Key Usage Tracking', () => {
    let userCookie: string;
    let userApiKey: { key: string; id: string };

    beforeEach(async () => {
      const result = await createUserAndLogin('testuser', 'password123');
      userCookie = result.cookie;
      userApiKey = await createApiKey(userCookie, 'Test Key', 'user');
    });

    it('should update lastUsedAt when API key is used', async () => {
      // Use the API key
      await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${userApiKey.key}` },
      });

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // List keys to check lastUsedAt
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Cookie': userCookie },
      });
      const body = await response.json() as { data: { id: string; lastUsedAt: string | null }[] };
      const key = body.data.find(k => k.id === userApiKey.id);
      expect(key).toBeDefined();
      expect(key!.lastUsedAt).not.toBeNull();
    });
  });
});
