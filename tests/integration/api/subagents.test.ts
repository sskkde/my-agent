import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';
import type { SubagentDefinition } from '../../../src/subagents/registry.js';

describe('Subagent API Integration', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;
  let providerId: string;
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

    const provider = context.providerConfigStore.create({
      providerId: randomUUID(),
      userId,
      providerType: 'openrouter',
      displayName: 'Test Provider',
      apiKey: 'sk-test-key',
      enabled: true,
    });
    providerId = provider.providerId;
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    await server.close();
    context.connection.close();
  });

  beforeEach(() => {
    const prefs = context.subagentProviderPreferenceStore.getByUser(userId);
    for (const pref of prefs) {
      context.subagentProviderPreferenceStore.delete(userId, pref.agentType);
    }
  });

  const authHeader = () => ({ cookie: `agent-platform-session=${authToken}` });

  describe('GET /api/v1/subagents', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return all built-in subagent definitions', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(7);

      const agentTypes = body.data.map((s: { agentType: string }) => s.agentType);
      expect(agentTypes).toContain('document_processor');
      expect(agentTypes).toContain('image_processor');
      expect(agentTypes).toContain('data_processor');
      expect(agentTypes).toContain('audio_processor');
      expect(agentTypes).toContain('code_processor');
      expect(agentTypes).toContain('research_processor');
      expect(agentTypes).toContain('search_processor');
    });

    it('should include provider policy in each summary', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents',
        headers: authHeader(),
      });

      const body = JSON.parse(response.body);
      const docProcessor = body.data.find((s: { agentType: string }) => s.agentType === 'document_processor');
      expect(docProcessor).toBeDefined();
      expect(docProcessor.providerPolicy).toBeDefined();
      expect(docProcessor.providerPolicy.fallbackMode).toBe('any_compatible');
      expect(docProcessor.providerPolicy.requiredCapabilities).toContain('text');
    });
  });

  describe('GET /api/v1/subagents/:agentType', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/document_processor',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown agent type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/nonexistent_agent',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return a specific subagent definition', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/code_processor',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.agentType).toBe('code_processor');
      expect(body.data.displayName).toBe('代码处理');
      expect(body.data.modality).toBe('code');
      expect(body.data.providerPolicy.fallbackMode).toBe('any_compatible');
    });
  });

  describe('GET /api/v1/subagents/:agentType/preference', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/document_processor/preference',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown agent type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/nonexistent/preference',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return null preference when none is set', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.agentType).toBe('document_processor');
      expect(body.data.preference).toBeNull();
      expect(body.data.providerPolicy).toBeDefined();
    });

    it('should return saved preference after setting it', async () => {
      context.subagentProviderPreferenceStore.set(userId, 'document_processor', {
        providerId,
        model: 'anthropic/claude-3-opus',
        fallbackMode: 'same_provider',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.preference).toEqual({
        providerId,
        model: 'anthropic/claude-3-opus',
        fallbackMode: 'same_provider',
      });
    });
  });

  describe('PUT /api/v1/subagents/:agentType/preference', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        payload: { fallbackMode: 'any_compatible' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown agent type', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/nonexistent/preference',
        headers: authHeader(),
        payload: { fallbackMode: 'any_compatible' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should set a preference with all fields', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: {
          providerId,
          model: 'anthropic/claude-3-opus',
          fallbackMode: 'same_provider',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.agentType).toBe('document_processor');
      expect(body.data.preference.providerId).toBe(providerId);
      expect(body.data.preference.model).toBe('anthropic/claude-3-opus');
      expect(body.data.preference.fallbackMode).toBe('same_provider');
    });

    it('should default fallbackMode to definition fallbackMode when omitted', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/search_processor/preference',
        headers: authHeader(),
        payload: { providerId },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.preference.fallbackMode).toBe('any_compatible');
    });

    it('should reject invalid providerId', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: { providerId: 'nonexistent-provider' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_PROVIDER_ID');
    });

    it('should reject empty model string', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: { model: '  ' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_MODEL');
    });

    it('should reject invalid fallbackMode', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: { fallbackMode: 'invalid_mode' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_FALLBACK_MODE');
    });

    it('should allow null providerId and model to clear fields', async () => {
      context.subagentProviderPreferenceStore.set(userId, 'document_processor', {
        providerId,
        model: 'some-model',
        fallbackMode: 'any_compatible',
      });

      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: { providerId: null, model: null, fallbackMode: 'none' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.preference.providerId).toBeUndefined();
      expect(body.data.preference.model).toBeUndefined();
      expect(body.data.preference.fallbackMode).toBe('none');
    });
  });

  describe('DELETE /api/v1/subagents/:agentType/preference', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/subagents/document_processor/preference',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown agent type', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/subagents/nonexistent/preference',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should delete an existing preference', async () => {
      context.subagentProviderPreferenceStore.set(userId, 'document_processor', {
        providerId,
        model: 'some-model',
        fallbackMode: 'any_compatible',
      });

      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
      });

      expect(deleteResponse.statusCode).toBe(204);

      const getResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
      });

      const body = JSON.parse(getResponse.body);
      expect(body.data.preference).toBeNull();
    });

    it('should succeed even when no preference exists', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('Security: Cross-user provider access', () => {
    it('should reject provider owned by another user', async () => {
      const otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser',
        passwordHash: await hashPassword('otherpassword'),
      });

      const otherProvider = context.providerConfigStore.create({
        providerId: randomUUID(),
        userId: otherUserId,
        providerType: 'openrouter',
        displayName: 'Other User Provider',
        apiKey: 'sk-other-key',
        enabled: true,
      });

      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/subagents/document_processor/preference',
        headers: authHeader(),
        payload: {
          providerId: otherProvider.providerId,
          model: 'anthropic/claude-3-opus',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('PROVIDER_ACCESS_DENIED');
    });
  });

  describe('Security: Policy validation', () => {
    it('should reject provider not in allowedProviderIds', async () => {
      const restrictedAgentType = 'restricted_processor_test';
      const restrictedDefinition: SubagentDefinition = {
        agentType: restrictedAgentType,
        displayName: 'Restricted Processor',
        description: 'Test agent with provider restrictions',
        modality: 'text',
        promptId: 'subagent.restricted_processor',
        allowedToolIds: [],
        defaultMaxIterations: 5,
        defaultTimeoutMs: 60000,
        supportedExecutionModes: ['sync'],
        canRunInBackground: false,
        providerPolicy: {
          allowedProviderIds: ['allowed-provider-1', 'allowed-provider-2'],
          fallbackMode: 'none',
        },
        permissionProfile: 'read_only',
        summaryPolicy: {
          returnMode: 'summary_only',
          maxSummaryTokens: 500,
        },
      };

      context.subagentRegistry.register(restrictedDefinition);

      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/subagents/${restrictedAgentType}/preference`,
        headers: authHeader(),
        payload: {
          providerId,
          model: 'test-model',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('PROVIDER_NOT_ALLOWED');
    });

    it('should reject model not in allowedModelIds', async () => {
      const restrictedAgentType = 'restricted_model_processor_test';
      const restrictedDefinition: SubagentDefinition = {
        agentType: restrictedAgentType,
        displayName: 'Restricted Model Processor',
        description: 'Test agent with model restrictions',
        modality: 'text',
        promptId: 'subagent.restricted_model_processor',
        allowedToolIds: [],
        defaultMaxIterations: 5,
        defaultTimeoutMs: 60000,
        supportedExecutionModes: ['sync'],
        canRunInBackground: false,
        providerPolicy: {
          allowedModelIds: ['allowed-model-1', 'allowed-model-2'],
          fallbackMode: 'none',
        },
        permissionProfile: 'read_only',
        summaryPolicy: {
          returnMode: 'summary_only',
          maxSummaryTokens: 500,
        },
      };

      context.subagentRegistry.register(restrictedDefinition);

      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/subagents/${restrictedAgentType}/preference`,
        headers: authHeader(),
        payload: {
          providerId,
          model: 'unauthorized-model',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('MODEL_NOT_ALLOWED');
    });
  });
});
