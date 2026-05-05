import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Agent Config API Integration', () => {
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
    // Clean up agent configs before each test
    const global = context.agentConfigStore.getGlobalDefault();
    if (global) {
      context.agentConfigStore.remove(global.agentConfigId);
    }
    const userOverride = context.agentConfigStore.getByUser(userId);
    if (userOverride && userOverride.userId === userId) {
      context.agentConfigStore.remove(userOverride.agentConfigId);
    }
  });

  describe('GET /api/agents/foreground.default/config', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return null configs when no configs exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual({
        global: null,
        userOverride: null,
        effective: null,
      });
    });

    it('should return global config when only global exists', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global system prompt',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.global).toMatchObject({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global system prompt',
      });
      expect(body.data.userOverride).toBeNull();
      expect(body.data.effective).toMatchObject({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global system prompt',
      });
    });

    it('should return both configs when global and override exist', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global system prompt',
      });

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        systemPrompt: 'User system prompt',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.global).toMatchObject({
        displayName: 'Global Default',
        systemPrompt: 'Global system prompt',
      });
      expect(body.data.userOverride).toMatchObject({
        displayName: 'User Override',
        systemPrompt: 'User system prompt',
      });
      expect(body.data.effective).toMatchObject({
        displayName: 'User Override',
        systemPrompt: 'User system prompt',
      });
    });

    it('should resolve inherited timeout and repair fields to defaults when no global exists', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        systemPrompt: 'User system prompt',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.global).toBeNull();
      expect(body.data.userOverride.routingTimeoutMs).toBeUndefined();
      expect(body.data.userOverride.repairAttempts).toBeUndefined();
      expect(body.data.effective.routingTimeoutMs).toBe(60000);
      expect(body.data.effective.repairAttempts).toBe(1);
    });

    it('should return 400 for invalid agent ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/agents/invalid.agent/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_AGENT_ID');
    });
  });

  describe('PATCH /api/agents/foreground.default/config/global', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        payload: {
          displayName: 'Updated Global',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should create global config when none exists', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'New Global Config',
          systemPrompt: 'New system prompt',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'New Global Config',
        systemPrompt: 'New system prompt',
        enabled: true,
      });
    });

    it('should reject global config updates from non-owner users', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'nonowner',
        passwordHash: await hashPassword('password'),
      });
      const otherToken = generateSessionToken();
      context.stores.authTokenStore.create({
        tokenHash: hashToken(otherToken),
        userId: otherUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${otherToken}`,
        },
        payload: {
          displayName: 'Unauthorized Global Config',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('should update existing global config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Original Global',
        systemPrompt: 'Original prompt',
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated Global',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        displayName: 'Updated Global',
        systemPrompt: 'Original prompt',
      });
    });

    it('should validate displayName length', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'a'.repeat(101),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('DISPLAY_NAME_TOO_LONG');
    });

    it('should validate systemPrompt length', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          systemPrompt: 'a'.repeat(10001),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SYSTEM_PROMPT_TOO_LONG');
    });

    it('should validate timeout range', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          routingTimeoutMs: 500,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('TIMEOUT_OUT_OF_RANGE');
    });

    it('should validate repairAttempts is 0 or 1', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          repairAttempts: 5,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('REPAIR_ATTEMPTS_OUT_OF_RANGE');
    });

    it('should validate providerId exists', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerId: 'non-existent-provider',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_PROVIDER_ID');
    });

    it('should accept valid providerId', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Test Provider',
        apiKey: 'sk-test1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerId: provider.providerId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.providerId).toBe(provider.providerId);
    });

    it('should validate tool IDs', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          allowedToolIds: ['invalid.tool', 'ask_user'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_TOOL_ID');
    });

    it('should accept valid tool IDs', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          allowedToolIds: ['ask_user', 'status.query'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.allowedToolIds).toEqual(['ask_user', 'status.query']);
    });

    it('should validate skill IDs', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          allowedSkillIds: ['invalid.skill', 'ask_user'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_SKILL_ID');
    });

    it('should accept valid skill IDs', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          allowedSkillIds: ['ask_user', 'artifact.create'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.allowedSkillIds).toEqual(['ask_user', 'artifact.create']);
    });

    it('should return 400 for invalid agent ID', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/invalid.agent/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_AGENT_ID');
    });
  });

  describe('PATCH /api/agents/foreground.default/config/override', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        payload: {
          displayName: 'User Override',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should create user override config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global prompt',
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'My Override',
          systemPrompt: 'My custom prompt',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        agentId: 'foreground.default',
        scope: 'user',
        displayName: 'My Override',
        systemPrompt: 'My custom prompt',
      });
    });

    it('should keep omitted timeout and repair fields inherited from global config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global prompt',
        routingTimeoutMs: 30000,
        repairAttempts: 0,
      });

      const createResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'My Override',
          systemPrompt: 'My custom prompt',
        },
      });

      expect(createResponse.statusCode).toBe(200);
      const createBody = JSON.parse(createResponse.body);
      expect(createBody.data.routingTimeoutMs).toBeUndefined();
      expect(createBody.data.repairAttempts).toBeUndefined();

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Default',
        systemPrompt: 'Global prompt',
        routingTimeoutMs: 50000,
        repairAttempts: 1,
      });

      const getResponse = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body);
      expect(getBody.data.userOverride.routingTimeoutMs).toBeUndefined();
      expect(getBody.data.userOverride.repairAttempts).toBeUndefined();
      expect(getBody.data.effective.routingTimeoutMs).toBe(50000);
      expect(getBody.data.effective.repairAttempts).toBe(1);
    });

    it('should preserve explicit timeout and repair values equal to defaults', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'My Override',
          systemPrompt: 'My custom prompt',
          routingTimeoutMs: 60000,
          repairAttempts: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.routingTimeoutMs).toBe(60000);
      expect(body.data.repairAttempts).toBe(1);
    });

    it('should update existing user override config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'Original Override',
        systemPrompt: 'Original prompt',
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          displayName: 'Updated Override',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        displayName: 'Updated Override',
        systemPrompt: 'Original prompt',
      });
    });

    it('should validate provider ownership for user override', async () => {
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
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerId: otherProvider.providerId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PROVIDER_ACCESS_DENIED');
    });

    it('should allow using own provider in override', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'My Provider',
        apiKey: 'sk-my1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          providerId: provider.providerId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.providerId).toBe(provider.providerId);
    });
  });

  describe('DELETE /api/agents/foreground.default/config/override', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/agents/foreground.default/config/override',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should delete user override config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        systemPrompt: 'User prompt',
      });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify it's deleted
      const getResponse = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });
      const body = JSON.parse(getResponse.body);
      expect(body.data.userOverride).toBeNull();
    });

    it('should return 204 when no override exists', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it('should return 400 for invalid agent ID', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/agents/invalid.agent/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_AGENT_ID');
    });
  });
});
