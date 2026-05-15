import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Tools and Models API Integration', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;
  let originalEnv: Record<string, string | undefined>;
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

    originalEnv = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    
    process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
    process.env.OLLAMA_BASE_URL = originalEnv.OLLAMA_BASE_URL;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    
    await server.close();
    context.connection.close();
  });

  beforeEach(() => {
    const providers = context.providerConfigStore.listByUser(userId);
    for (const provider of providers) {
      context.providerConfigStore.remove(provider.providerId);
    }
    
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  describe('GET /api/tools', () => {
    it('should return all built-in tools without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.tools).toBeDefined();
      expect(body.data.total).toBe(21);
      expect(body.data.tools).toHaveLength(21);
    });

    it('should return tools with correct structure', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const tools = body.data.tools;

      // Verify each tool has required fields
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('category');
        expect(tool).toHaveProperty('sensitivity');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.category).toBe('string');
        expect(typeof tool.sensitivity).toBe('string');
      }
    });

    it('should not expose handler or schema in response', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const tools = body.data.tools;

      for (const tool of tools) {
        expect(tool).not.toHaveProperty('handler');
        expect(tool).not.toHaveProperty('schema');
      }
    });

    it('should include all 15 built-in tools', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const toolNames = body.data.tools.map((t: { name: string }) => t.name);

      expect(toolNames).toContain('artifact.create');
      expect(toolNames).toContain('artifact.update');
      expect(toolNames).toContain('ask_user');
      expect(toolNames).toContain('status.query');
      expect(toolNames).toContain('memory.retrieve');
      expect(toolNames).toContain('transcript.search');
      expect(toolNames).toContain('plan.patch');
      expect(toolNames).toContain('docs.search');
      expect(toolNames).toContain('file.read');
      expect(toolNames).toContain('file.glob');
      expect(toolNames).toContain('file.grep');
      expect(toolNames).toContain('session.list');
      expect(toolNames).toContain('session.history');
      expect(toolNames).toContain('web.fetch');
      expect(toolNames).toContain('web.search');
    });

    it('should return correct metadata for web.search', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const webSearch = body.data.tools.find((t: { name: string }) => t.name === 'web.search');

      expect(webSearch).toBeDefined();
      expect(webSearch.description).toBe('Search the public web for information using an external search provider');
      expect(webSearch.category).toBe('search');
      expect(webSearch.sensitivity).toBe('medium');
    });

    it('should return correct metadata for artifact.create', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const artifactCreate = body.data.tools.find((t: { name: string }) => t.name === 'artifact.create');

      expect(artifactCreate).toBeDefined();
      expect(artifactCreate.description).toBe('Create a new artifact with the given title and content');
      expect(artifactCreate.category).toBe('write');
      expect(artifactCreate.sensitivity).toBe('medium');
    });
  });

  describe('GET /api/models', () => {
    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return env providers when env vars are set', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.providers).toBeDefined();
      
      expect(body.data.providers).toHaveLength(3);

      for (const provider of body.data.providers) {
        expect(provider.source).toBe('env');
        expect(provider).toHaveProperty('providerId');
        expect(provider).toHaveProperty('providerType');
        expect(provider).toHaveProperty('displayName');
        expect(provider).toHaveProperty('enabled');
        expect(provider).toHaveProperty('configured');
        expect(provider).not.toHaveProperty('apiKey');
      }
    });

    it('should return database providers with source label', async () => {
      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test Database Provider',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.providers).toHaveLength(1);

      const provider = body.data.providers[0];
      expect(provider.source).toBe('database');
      expect(provider.displayName).toBe('Test Database Provider');
      expect(provider.providerType).toBe('openai');
      expect(provider.enabled).toBe(true);
      expect(provider.configured).toBe(true);
      expect(provider.apiKeyLast4).toBe('7890');
    });

    it('should combine env and database providers', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';

      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Database Provider',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.providers).toHaveLength(2);

      const sources = body.data.providers.map((p: { source: string }) => p.source);
      expect(sources).toContain('env');
      expect(sources).toContain('database');
    });

    it('should never expose secrets in response', async () => {
      process.env.OPENROUTER_API_KEY = 'super-secret-key';

      context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Secret Provider',
        apiKey: 'sk-secretapikey123',
        enabled: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/models',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const responseBody = response.body;

      expect(responseBody).not.toContain('super-secret-key');
      expect(responseBody).not.toContain('sk-secretapikey123');
      expect(responseBody).not.toContain('secretapikey');
    });
  });
});
