import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

const SENTINEL_API_KEY = 'sk-sentinel-test-key-1234567890';
const SENTINEL_PASSWORD = 'sentinel-password-12345';

describe('API Secret Redaction', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;
  const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production';

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY;

    const contextResult = createApiContext({ dbPath: ':memory:' });
    if ('code' in contextResult) {
      throw new Error(`Failed to create API context: ${contextResult.message}`);
    }
    context = contextResult;

    server = await createApiServer(context);

    userId = randomUUID();
    context.stores.userStore.create({
      userId,
      username: 'testuser',
      passwordHash: await hashPassword('testpassword'),
    });

    authToken = generateSessionToken();
    const tokenHash = hashToken(authToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    context.stores.authTokenStore.create({
      tokenHash,
      userId,
      expiresAt,
    });
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    await server.close();
    context.connection.close();
  });

  beforeEach(() => {
    const providers = context.providerConfigStore.listByUser(userId);
    for (const provider of providers) {
      context.providerConfigStore.remove(provider.providerId);
    }
  });

  describe('GET /api/providers - Secret Redaction', () => {
    it('should NEVER expose apiKey in provider list response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Secret Test Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = response.body;

      expect(responseBody).not.toContain(SENTINEL_API_KEY);
      expect(responseBody).not.toContain('sk-sentinel');
      expect(responseBody).not.toContain('sentinel-test-key');

      const body = JSON.parse(response.body);
      expect(body.data[0].apiKeyLast4).toBe('7890');
      expect(body.data[0].apiKey).toBeUndefined();
    });

    it('should NEVER expose encryptedApiKey in provider list response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'Encrypted Secret Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const responseBody = response.body;

      expect(responseBody).not.toContain('encryptedApiKey');
    });

    it('should only expose apiKeyLast4, never full key', async () => {
      const fullKey = 'sk-fullsecretkey1234567890';
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Full Key Test',
        apiKey: fullKey,
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const body = JSON.parse(response.body);
      const provider = body.data[0];

      expect(provider.apiKeyLast4).toBe('7890');
      expect(provider).not.toHaveProperty('apiKey');
      expect(provider).not.toHaveProperty('encryptedApiKey');
    });
  });

  describe('GET /api/models - Secret Redaction', () => {
    it('should NEVER expose env-based API keys in models response', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY;
      process.env.OPENAI_API_KEY = SENTINEL_API_KEY;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = response.body;

      expect(responseBody).not.toContain(SENTINEL_API_KEY);
      expect(responseBody).not.toContain('sk-sentinel');

      delete process.env.OPENROUTER_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    it('should NEVER expose database provider secrets in models response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'DB Secret Provider',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const responseBody = response.body;

      expect(responseBody).not.toContain(SENTINEL_API_KEY);
      expect(responseBody).not.toContain('sk-sentinel');
    });

    it('should combine env and db providers without exposing secrets', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY;

      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Combined Test',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const responseBody = response.body;
      const body = JSON.parse(response.body);

      expect(body.data.providers.length).toBeGreaterThanOrEqual(2);
      expect(responseBody).not.toContain(SENTINEL_API_KEY);

      delete process.env.OPENROUTER_API_KEY;
    });
  });

  describe('GET /api/settings - Secret Redaction', () => {
    it('should NEVER expose raw API key values in settings', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = response.body;

      expect(responseBody).not.toContain(SENTINEL_API_KEY);
      expect(responseBody).not.toContain('sk-sentinel');

      const body = JSON.parse(response.body);
      expect(body.data.settings.providers.openrouter.configured).toBe(true);

      delete process.env.OPENROUTER_API_KEY;
    });

    it('should ONLY return configured boolean, never actual values', async () => {
      process.env.OPENROUTER_API_KEY = 'any-secret-key-value';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const body = JSON.parse(response.body);

      expect(body.data.settings.providers.openrouter).toEqual({ configured: true });
      expect(body.data.settings.providers.openrouter).not.toHaveProperty('apiKey');
      expect(body.data.settings.providers.openrouter).not.toHaveProperty('key');

      delete process.env.OPENROUTER_API_KEY;
    });

    it('should not include env var names in response', async () => {
      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY;

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const responseBody = response.body;

      expect(responseBody).not.toContain('OPENROUTER_API_KEY');

      delete process.env.OPENROUTER_API_KEY;
    });
  });

  describe('POST /api/setup/user - Operator Creation', () => {
    it('should correctly create operator user with hashed password', async () => {
      const setupContextResult = createApiContext({ dbPath: ':memory:' });
      if ('code' in setupContextResult) {
        throw new Error('Failed to create context');
      }
      const setupContext = setupContextResult;
      const setupServer = await createApiServer(setupContext);

      const response = await setupServer.inject({
        method: 'POST',
        url: '/api/v1/setup/user',
        payload: {
          username: 'operator',
          password: SENTINEL_PASSWORD,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);

      expect(body.data.user.username).toBe('operator');
      expect(body.data.user.userId).toBeDefined();

      expect(response.body).not.toContain(SENTINEL_PASSWORD);
      expect(response.body).not.toContain('sentinel-password');

      const user = setupContext.stores.userStore.getByUsername('operator');
      expect(user).toBeDefined();
      expect(user?.passwordHash).not.toBe(SENTINEL_PASSWORD);
      expect(user?.passwordHash.length).toBeGreaterThan(20);

      await setupServer.close();
      setupContext.connection.close();
    });

    it('should return session cookie on successful operator creation', async () => {
      const setupContextResult = createApiContext({ dbPath: ':memory:' });
      if ('code' in setupContextResult) {
        throw new Error('Failed to create context');
      }
      const setupContext = setupContextResult;
      const setupServer = await createApiServer(setupContext);

      const response = await setupServer.inject({
        method: 'POST',
        url: '/api/v1/setup/user',
        payload: {
          username: 'admin',
          password: 'admin123',
        },
      });

      expect(response.statusCode).toBe(201);

      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('agent-platform-session');
      expect(setCookieHeader).toContain('HttpOnly');

      await setupServer.close();
      setupContext.connection.close();
    });

    it('should reject setup when users already exist', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/setup/user',
        payload: {
          username: 'another',
          password: 'pass123',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/auth/login - Authentication', () => {
    it('should reject invalid username with 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'nonexistentuser',
          password: 'anypassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid password with 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testuser',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return session cookie on valid login', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testuser',
          password: 'testpassword',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.user.username).toBe('testuser');

      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('agent-platform-session');
      expect(setCookieHeader).toContain('HttpOnly');
    });

    it('should NOT expose password in error messages', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testuser',
          password: SENTINEL_PASSWORD,
        },
      });

      expect(response.body).not.toContain(SENTINEL_PASSWORD);
      expect(response.body).not.toContain('sentinel-password');
    });

    it('should return 400 for missing username', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          password: 'somepassword',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'testuser',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Protected Routes - 401 Without Auth', () => {
    it('should return 401 for /api/providers without cookie', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for /api/models without cookie', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for /api/sessions without cookie', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for /api/auth/me without cookie', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid session cookie', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          cookie: 'agent-platform-session=invalid-token-value',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for POST /api/providers without cookie', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/providers',
        payload: {
          providerType: 'openai',
          apiKey: 'test-key',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for protected routes with malformed auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Public Routes - No Auth Required', () => {
    it('should allow /api/health without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow /api/setup/status without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should allow /api/tools without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Complete Sentinel Secret Verification', () => {
    it('should verify sentinel secret NEVER appears in any endpoint response', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Sentinel Test',
        apiKey: SENTINEL_API_KEY,
        enabled: true,
      });

      process.env.OPENROUTER_API_KEY = SENTINEL_API_KEY;

      const endpoints: Array<{ method: 'GET'; url: string; auth: boolean }> = [
        { method: 'GET', url: '/api/v1/providers', auth: true },
        { method: 'GET', url: '/api/v1/models', auth: true },
        { method: 'GET', url: '/api/v1/settings', auth: true },
        { method: 'GET', url: '/api/v1/tools', auth: false },
      ];

      for (const endpoint of endpoints) {
        const headers: Record<string, string> = {};
        if (endpoint.auth) {
          headers.cookie = `agent-platform-session=${authToken}`;
        }

        const response = await server.inject({
          method: endpoint.method,
          url: endpoint.url,
          headers,
        });

        const responseBody = response.body;

        expect(responseBody).not.toContain(SENTINEL_API_KEY);
        expect(responseBody).not.toContain('sk-sentinel');
        expect(responseBody).not.toContain('sentinel-test-key');
      }

      delete process.env.OPENROUTER_API_KEY;
    });
  });
});
