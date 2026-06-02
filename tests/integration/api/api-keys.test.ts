import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

describe('API Key Routes', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let baseUrl: string;
  let cookie: string;

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

    // Create user and login to get session cookie
    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    expect(setupResponse.status).toBe(201);
    cookie = setupResponse.headers.get('set-cookie')!;
  });

  afterEach(async () => {
    // Force close all connections to prevent keep-alive hangs
    if (server.server.closeAllConnections) {
      server.server.closeAllConnections();
    }
    await server.close();
    context.connection.close();
  });

  describe('POST /api/api-keys', () => {
    it('creates an API key and returns the full key once', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { ok: boolean; data: { id: string; name: string; key: string; prefix: string; role: string; createdAt: string } };
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('Test Key');
      expect(body.data.role).toBe('user');
      expect(body.data.key).toMatch(/^ak_/);
      expect(body.data.key.length).toBeGreaterThanOrEqual(32);
      expect(body.data.prefix).toBe(body.data.key.slice(0, 8));
      expect(body.data.id).toBeDefined();
      expect(body.data.createdAt).toBeDefined();
    });

    it('creates an admin key with expiration', async () => {
      const expiresAt = '2030-12-31T23:59:59.000Z';
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Admin Key', role: 'admin', expiresAt }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { ok: boolean; data: { key: string; role: string } };
      expect(body.ok).toBe(true);
      expect(body.data.role).toBe('admin');
    });

    it('returns 400 for missing name', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ role: 'user' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid role', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Bad Key', role: 'superadmin' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Key', role: 'user' }),
      });

      expect(response.status).toBe(401);
      await response.arrayBuffer();
    });
  });

  describe('GET /api/api-keys', () => {
    it('returns list of API keys without full key or hash', async () => {
      // Create a key first
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'List Test Key', role: 'user' }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { id: string; key: string; prefix: string } };

      // List keys
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Cookie': cookie },
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: Array<{ id: string; name: string; prefix: string; role: string; userId: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; isActive: boolean }> };
      expect(body.ok).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const listedKey = body.data.find(k => k.id === createBody.data.id);
      expect(listedKey).toBeDefined();
      expect(listedKey!.name).toBe('List Test Key');
      expect(listedKey!.prefix).toBe(createBody.data.prefix);
      expect(listedKey!.isActive).toBe(true);
      // Ensure no full key or hash in listing
      expect((listedKey as any).key).toBeUndefined();
      expect((listedKey as any).keyHash).toBeUndefined();
    });

    it('returns 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`);
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    });
  });

  describe('DELETE /api/api-keys/:id', () => {
    it('revokes an API key by setting is_active to false', async () => {
      // Create a key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Revoke Test Key', role: 'user' }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { id: string } };

      // Revoke the key
      const deleteResponse = await fetch(`${baseUrl}/api/v1/api-keys/${createBody.data.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': cookie },
      });

      expect(deleteResponse.status).toBe(200);
      await deleteResponse.arrayBuffer();

      // Verify it's revoked in the list
      const listResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Cookie': cookie },
      });
      const listBody = await listResponse.json() as { ok: boolean; data: Array<{ id: string; isActive: boolean }> };
      const revokedKey = listBody.data.find(k => k.id === createBody.data.id);
      expect(revokedKey!.isActive).toBe(false);
    });

    it('returns 404 for non-existent key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys/nonexistent-key-id`, {
        method: 'DELETE',
        headers: { 'Cookie': cookie },
      });

      expect(response.status).toBe(404);
      await response.arrayBuffer();
    });

    it('returns 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys/some-id`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    });
  });

  describe('API Key Auth Middleware', () => {
    it('authenticates using a valid API key via Authorization header', async () => {
      // Create a key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Auth Test Key', role: 'admin' }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { key: string } };

      // Use the key to access a protected endpoint
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': `Bearer ${createBody.data.key}` },
      });

      expect(response.status).toBe(200);
      await response.arrayBuffer();
    });

    it('rejects an invalid API key', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': 'Bearer ak_invalid_key_12345' },
      });

      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a revoked API key', async () => {
      // Create a key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Revoke Auth Key', role: 'user' }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { id: string; key: string } };

      // Revoke the key
      const revokeResponse = await fetch(`${baseUrl}/api/v1/api-keys/${createBody.data.id}`, {
        method: 'DELETE',
        headers: { 'Cookie': cookie },
      });
      expect(revokeResponse.status).toBe(200);
      await revokeResponse.arrayBuffer();

      // Try to use the revoked key
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': `Bearer ${createBody.data.key}` },
      });

      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an expired API key', async () => {
      // Create a key that's already expired
      const pastDate = '2020-01-01T00:00:00.000Z';
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Expired Key', role: 'user', expiresAt: pastDate }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { key: string } };

      // Try to use the expired key
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': `Bearer ${createBody.data.key}` },
      });

      expect(response.status).toBe(401);
      const body = await response.json() as { ok: boolean; error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects Authorization header with non-ak_ prefix', async () => {
      // Regular session tokens should not be treated as API keys
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { 'Authorization': 'Bearer some_regular_token' },
      });

      // Should still be 401 because the token isn't a valid API key
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    });

    it('API key can be used instead of session cookie', async () => {
      // Create a key
      const createResponse = await fetch(`${baseUrl}/api/v1/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
        body: JSON.stringify({ name: 'Service Key', role: 'service' }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json() as { ok: boolean; data: { key: string } };

      // Use the API key on /api/sessions (a protected endpoint)
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Authorization': `Bearer ${createBody.data.key}` },
      });

      expect(response.status).toBe(200);
      await response.arrayBuffer();
    });
  });
});
