import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Agent Config Search LLM Fields API', () => {
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
    const global = context.agentConfigStore.getGlobalDefault();
    if (global) {
      context.agentConfigStore.remove(global.agentConfigId);
    }
    const userOverride = context.agentConfigStore.getByUser(userId);
    if (userOverride && userOverride.userId === userId) {
      context.agentConfigStore.remove(userOverride.agentConfigId);
    }
  });

  describe('acceptance tests', () => {
    it('persists and merges search llm fields', async () => {
      const globalProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Global Search Provider',
        apiKey: 'sk-globalsearch1234567890',
        enabled: true,
      });

      const userProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'User Search Provider',
        apiKey: 'sk-usersearch1234567890',
        enabled: true,
      });

      const globalResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: globalProvider.providerId,
          searchLlmModel: 'gpt-4.1-mini',
        },
      });

      expect(globalResponse.statusCode).toBe(200);
      const globalBody = JSON.parse(globalResponse.body);
      expect(globalBody.data.searchLlmProviderId).toBe(globalProvider.providerId);
      expect(globalBody.data.searchLlmModel).toBe('gpt-4.1-mini');

      const userResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: userProvider.providerId,
          searchLlmModel: 'gpt-4.1-nano',
        },
      });

      expect(userResponse.statusCode).toBe(200);
      const userBody = JSON.parse(userResponse.body);
      expect(userBody.data.searchLlmProviderId).toBe(userProvider.providerId);
      expect(userBody.data.searchLlmModel).toBe('gpt-4.1-nano');

      const effectiveResponse = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(effectiveResponse.statusCode).toBe(200);
      const effectiveBody = JSON.parse(effectiveResponse.body);
      expect(effectiveBody.data.global.searchLlmProviderId).toBe(globalProvider.providerId);
      expect(effectiveBody.data.global.searchLlmModel).toBe('gpt-4.1-mini');
      expect(effectiveBody.data.userOverride.searchLlmProviderId).toBe(userProvider.providerId);
      expect(effectiveBody.data.userOverride.searchLlmModel).toBe('gpt-4.1-nano');
      expect(effectiveBody.data.effective.searchLlmProviderId).toBe(userProvider.providerId);
      expect(effectiveBody.data.effective.searchLlmModel).toBe('gpt-4.1-nano');

      const clearResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: null,
          searchLlmModel: null,
        },
      });

      expect(clearResponse.statusCode).toBe(200);

      const inheritedResponse = await server.inject({
        method: 'GET',
        url: '/api/agents/foreground.default/config',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(inheritedResponse.statusCode).toBe(200);
      const inheritedBody = JSON.parse(inheritedResponse.body);
      expect(inheritedBody.data.effective.searchLlmProviderId).toBe(globalProvider.providerId);
      expect(inheritedBody.data.effective.searchLlmModel).toBe('gpt-4.1-mini');
    });

    it('rejects foreign search provider', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'foreignuser',
        passwordHash: await hashPassword('password'),
      });

      const foreignProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openai',
        displayName: 'Foreign Provider',
        apiKey: 'sk-foreign1234567890',
        enabled: true,
      });

      const userOverrideResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: foreignProvider.providerId,
        },
      });

      expect(userOverrideResponse.statusCode).toBe(400);
      const userOverrideBody = JSON.parse(userOverrideResponse.body);
      expect(userOverrideBody.error.code).toBe('PROVIDER_ACCESS_DENIED');

      const globalResponse = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: foreignProvider.providerId,
        },
      });

      expect(globalResponse.statusCode).toBe(400);
      const globalBody = JSON.parse(globalResponse.body);
      expect(globalBody.error.code).toBe('PROVIDER_ACCESS_DENIED');

      const configAfter = context.agentConfigStore.getGlobalDefault();
      expect(configAfter?.searchLlmProviderId).not.toBe(foreignProvider.providerId);
    });
  });

  describe('searchLlmProviderId and searchLlmModel persistence', () => {
    it('persists search llm fields in global config', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Search Provider',
        apiKey: 'sk-search1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: provider.providerId,
          searchLlmModel: 'gpt-4.1-mini',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.searchLlmProviderId).toBe(provider.providerId);
      expect(body.data.searchLlmModel).toBe('gpt-4.1-mini');
    });

    it('persists search llm fields in user override', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'User Search Provider',
        apiKey: 'sk-usersearch1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: provider.providerId,
          searchLlmModel: 'gpt-4.1-nano',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.searchLlmProviderId).toBe(provider.providerId);
      expect(body.data.searchLlmModel).toBe('gpt-4.1-nano');
    });

    it('returns search llm fields in GET config', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
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
      expect(body.data.global.searchLlmProviderId).toBe('provider-search');
      expect(body.data.global.searchLlmModel).toBe('gpt-4.1-mini');
    });
  });

  describe('search llm fields merge/inheritance', () => {
    it('inherits search llm fields from global when user override has null', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        searchLlmProviderId: null,
        searchLlmModel: null,
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
      expect(body.data.effective.searchLlmProviderId).toBe('provider-search');
      expect(body.data.effective.searchLlmModel).toBe('gpt-4.1-mini');
    });

    it('uses explicit user override search llm fields', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Config',
        searchLlmProviderId: 'provider-global-search',
        searchLlmModel: 'gpt-4.1-mini',
      });

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        searchLlmProviderId: 'provider-user-search',
        searchLlmModel: 'gpt-4.1-nano',
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
      expect(body.data.effective.searchLlmProviderId).toBe('provider-user-search');
      expect(body.data.effective.searchLlmModel).toBe('gpt-4.1-nano');
    });

    it('inherits search llm fields when user override omits them', async () => {
      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'global',
        displayName: 'Global Config',
        searchLlmProviderId: 'provider-search',
        searchLlmModel: 'gpt-4.1-mini',
      });

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
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
      expect(body.data.effective.searchLlmProviderId).toBe('provider-search');
      expect(body.data.effective.searchLlmModel).toBe('gpt-4.1-mini');
    });
  });

  describe('foreign provider rejection', () => {
    it('rejects searchLlmProviderId from another user', async () => {
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
          searchLlmProviderId: otherProvider.providerId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PROVIDER_ACCESS_DENIED');
    });

    it('rejects searchLlmProviderId in global config from another user', async () => {
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
        displayName: 'Other Provider 2',
        apiKey: 'sk-other2234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: otherProvider.providerId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PROVIDER_ACCESS_DENIED');
    });

    it('accepts own provider as searchLlmProviderId', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'My Search Provider',
        apiKey: 'sk-mysearch1234567890',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: provider.providerId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.searchLlmProviderId).toBe(provider.providerId);
    });
  });

  describe('validation', () => {
    it('rejects nonexistent searchLlmProviderId for global config', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: 'nonexistent-provider',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_PROVIDER_ID');
    });

    it('rejects nonexistent searchLlmProviderId for user override', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: 'nonexistent-provider',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_PROVIDER_ID');
    });

    it('validates searchLlmModel is a string when provided', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/global',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmModel: 123,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('allows null searchLlmProviderId to clear inheritance', async () => {
      const provider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId,
        providerType: 'openai',
        displayName: 'Old Search Provider',
        apiKey: 'sk-oldsearch1234567890',
        enabled: true,
      });

      context.agentConfigStore.upsert({
        agentId: 'foreground.default',
        scope: 'user',
        userId,
        displayName: 'User Override',
        searchLlmProviderId: provider.providerId,
        searchLlmModel: 'old-model',
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/agents/foreground.default/config/override',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          searchLlmProviderId: null,
          searchLlmModel: null,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.searchLlmProviderId).toBeNull();
      expect(body.data.searchLlmModel).toBeNull();
    });
  });
});
