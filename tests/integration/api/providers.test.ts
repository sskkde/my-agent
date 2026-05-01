import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Provider API Integration', () => {
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

    // Create a test user
    userId = randomUUID();
    context.stores.userStore.create({
      userId,
      username: 'testuser',
      passwordHash: await hashPassword('testpassword'),
    });

    // Create a session token for authentication
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
    // Clean up providers before each test
    const providers = context.providerConfigStore.listByUser(userId);
    for (const provider of providers) {
      context.providerConfigStore.remove(provider.providerId);
    }
  });

  describe('GET /api/providers', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/providers',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return empty array when no providers exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });

    it('should return list of providers for authenticated user', async () => {
      // Create a provider first
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test OpenAI',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        providerType: 'openai',
        displayName: 'Test OpenAI',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
      });
      expect(body.data[0].apiKey).toBeUndefined();
      expect(body.data[0].encryptedApiKey).toBeUndefined();
    });
  });

  describe('POST /api/providers', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        payload: {
          providerType: 'openai',
          apiKey: 'sk-test1234567890',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should create a new OpenAI provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'openai',
          displayName: 'My OpenAI',
          apiKey: 'sk-test1234567890',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        providerType: 'openai',
        displayName: 'My OpenAI',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
      });
      expect(body.data.providerId).toBeDefined();
      expect(body.data.apiKey).toBeUndefined();
    });

    it('should create a new Ollama provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'ollama',
          displayName: 'Local Ollama',
          baseUrl: 'http://localhost:11434',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        providerType: 'ollama',
        displayName: 'Local Ollama',
        enabled: true,
        baseUrl: 'http://localhost:11434',
      });
    });

    it('should create a new custom provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom Compatible API',
          apiKey: 'custom-key-1234567890',
          baseUrl: 'https://api.example.com/v1',
          selectedModel: 'custom-model',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        providerType: 'custom',
        displayName: 'Custom Compatible API',
        enabled: true,
        configured: true,
        apiKeyLast4: '7890',
        baseUrl: 'https://api.example.com/v1',
        selectedModel: 'custom-model',
      });
      expect(body.data.apiKey).toBeUndefined();
    });

    it('should return 400 for invalid provider type', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'invalid',
          apiKey: 'test',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_PROVIDER_TYPE');
    });

    it('should return 400 when OpenAI provider missing apiKey', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'openai',
          displayName: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('API_KEY_REQUIRED');
    });

    it('should return 400 when Ollama provider missing baseUrl', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'ollama',
          displayName: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('BASE_URL_REQUIRED');
    });

    it('should return 400 when custom provider missing apiKey', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom API',
          baseUrl: 'https://api.example.com/v1',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('API_KEY_REQUIRED');
    });

    it('should return 400 when custom provider missing baseUrl', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerType: 'custom',
          displayName: 'Custom API',
          apiKey: 'custom-key-1234567890',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('BASE_URL_REQUIRED');
    });
  });

  describe('PATCH /api/providers/:providerId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/providers/test-id',
        payload: {
          displayName: 'Updated',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should update provider display name', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Original Name',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/providers/${provider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated Name',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.displayName).toBe('Updated Name');
    });

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/providers/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when accessing other user provider', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser',
        passwordHash: await hashPassword('password'),
      });

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openai',
        displayName: 'Other Provider',
        apiKey: 'sk-other1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: `/api/providers/${otherProvider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Hacked',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/providers/:providerId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/providers/test-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should delete provider', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'To Delete',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/providers/${provider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(204);

      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/providers`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });
      const body = JSON.parse(getResponse.body);
      expect(body.data).toHaveLength(0);
    });

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/providers/non-existent-id',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when deleting other user provider', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser2',
        passwordHash: await hashPassword('password'),
      });

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openai',
        displayName: 'Other Provider',
        apiKey: 'sk-other1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/providers/${otherProvider.providerId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/providers/:providerId/test', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers/test-id/test',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should test connection and return result', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'ollama',
        displayName: 'Test Ollama',
        baseUrl: 'http://invalid-host:11434',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveProperty('success');
      expect(body.data).toHaveProperty('latencyMs');
      expect(typeof body.data.latencyMs).toBe('number');
    });

    it('should test custom provider connection and return result', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Custom API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'not-a-valid-url',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        success: false,
        latencyMs: 0,
        error: 'Invalid base URL format',
      });
    });

    it('should include network error details when custom provider connection fails', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Unreachable Custom API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.success).toBe(false);
      expect(body.data.error).toContain('Connection error:');
      expect(body.data.error).toContain('127.0.0.1:1');
      expect(body.data.error.length).toBeGreaterThan('Connection error:'.length);
    });

    it('should use configured OpenAI base URL when testing connection', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'OpenAI Compatible API',
        apiKey: 'sk-test1234567890',
        baseUrl: 'http://127.0.0.1:1/v1',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.success).toBe(false);
      expect(body.data.error).toContain('http://127.0.0.1:1/v1/models');
      expect(body.data.error).not.toContain('api.openai.com');
    });

    it('should use configured OpenRouter base URL when testing connection', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openrouter',
        displayName: 'OpenRouter Compatible API',
        apiKey: 'sk-or-test1234567890',
        baseUrl: 'http://127.0.0.1:1/api/v1',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.success).toBe(false);
      expect(body.data.error).toContain('http://127.0.0.1:1/api/v1/models');
      expect(body.data.error).not.toContain('openrouter.ai');
    });

    it('should append models directly for custom versioned API paths', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'custom',
        displayName: 'Volcengine Ark Coding API',
        apiKey: 'custom-key-1234567890',
        baseUrl: 'http://127.0.0.1:1/api/coding/v3',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.success).toBe(false);
      expect(body.data.error).toContain('http://127.0.0.1:1/api/coding/v3/models');
      expect(body.data.error).not.toContain('/api/coding/v3/v1/models');
    });

    it('should return 404 for non-existent provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/providers/non-existent-id/test',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 when testing other user provider', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser3',
        passwordHash: await hashPassword('password'),
      });

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'ollama',
        displayName: 'Other Ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${otherProvider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should not include API key in error messages', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test OpenAI',
        apiKey: 'sk-secretapikey123',
        enabled: true,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/api/providers/${provider.providerId}/test`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = response.body;
      expect(responseBody).not.toContain('sk-secretapikey123');
      expect(responseBody).not.toContain('secretapikey');
    });
  });
});
