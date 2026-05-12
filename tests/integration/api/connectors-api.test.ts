import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

const MOCK_CONNECTOR_TYPES = [
  { connectorId: 'gmail', name: 'Gmail', connectorType: 'api' as const, version: '1.0.0', capabilities: ['email.read', 'email.send'], status: 'active' as const },
  { connectorId: 'calendar', name: 'Google Calendar', connectorType: 'api' as const, version: '1.0.0', capabilities: ['calendar.read', 'calendar.write'], status: 'active' as const },
  { connectorId: 'contacts', name: 'Google Contacts', connectorType: 'api' as const, version: '1.0.0', capabilities: ['contacts.read'], status: 'active' as const },
  { connectorId: 'docs', name: 'Google Docs', connectorType: 'api' as const, version: '1.0.0', capabilities: ['docs.read', 'docs.write'], status: 'active' as const },
  { connectorId: 'web', name: 'Web Connector', connectorType: 'messaging' as const, version: '1.0.0', capabilities: ['web.fetch', 'web.search'], status: 'active' as const },
  { connectorId: 'search', name: 'Search Connector', connectorType: 'messaging' as const, version: '1.0.0', capabilities: ['search.query'], status: 'active' as const },
];

describe('Connectors API Integration', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;
  let connectorDefIds: string[] = [];

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
      username: 'connectortest',
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

    // Seed connector definitions
    for (const def of MOCK_CONNECTOR_TYPES) {
      const created = context.stores.connectorStore.createDefinition({
        connectorId: def.connectorId,
        name: def.name,
        connectorType: def.connectorType,
        version: def.version,
        capabilities: def.capabilities,
        status: def.status,
      });
      connectorDefIds.push(created.id);
    }
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    await server.close();
    context.connection.close();
  });

  describe('GET /api/connectors', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/connectors',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return all connector definitions', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/connectors',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(6);
    });

    it('should return definitions with manifest info', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/connectors',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      const body = JSON.parse(response.body);
      const gmailDef = body.data.find((d: { connectorId: string }) => d.connectorId === 'gmail');
      expect(gmailDef).toBeDefined();
      expect(gmailDef.name).toBe('Gmail');
      expect(gmailDef.connectorType).toBe('api');
      expect(gmailDef.version).toBe('1.0.0');
      expect(gmailDef.capabilities).toContain('email.read');
      expect(gmailDef.capabilities).toContain('email.send');
      expect(gmailDef.status).toBe('active');
      expect(gmailDef.createdAt).toBeDefined();
      expect(gmailDef.updatedAt).toBeDefined();
    });
  });

  describe('GET /api/connectors/:id', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${connectorDefIds[0]}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown connector definition', async () => {
      const fakeId = randomUUID();
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${fakeId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return connector definition detail', async () => {
      const gmailDefId = connectorDefIds[0]!; // gmail is first
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${gmailDefId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.connectorId).toBe('gmail');
      expect(body.data.name).toBe('Gmail');
      expect(body.data.connectorType).toBe('api');
      expect(body.data.capabilities).toEqual(['email.read', 'email.send']);
    });
  });

  describe('GET /api/connectors/:id/instances', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${connectorDefIds[0]}/instances`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown connector definition', async () => {
      const fakeId = randomUUID();
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${fakeId}/instances`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return empty array when no instances exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${connectorDefIds[0]}/instances`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
    });

    it('should return instances for a connector', async () => {
      // Create an instance for the gmail connector
      const instance = context.stores.connectorStore.createInstance({
        connectorInstanceId: crypto.randomUUID(),
        connectorDefinitionId: connectorDefIds[0]!,
        userId,
        name: 'My Gmail',
        authStateRef: 'auth-ref-1',
        status: 'active',
        config: { label: 'work' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/connectors/${connectorDefIds[0]}/instances`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.length).toBe(1);
      expect(body.data[0].id).toBe(instance.id);
      expect(body.data[0].name).toBe('My Gmail');
      expect(body.data[0].config).toEqual({ label: 'work' });
    });
  });

  describe('PATCH /api/connectors/:id/instances/:iid/config', () => {
    let instanceId: string;

    beforeAll(() => {
      // Create an instance for the gmail connector
      const instance = context.stores.connectorStore.createInstance({
        connectorInstanceId: crypto.randomUUID(),
        connectorDefinitionId: connectorDefIds[0]!,
        userId,
        name: 'Config Test Gmail',
        authStateRef: 'auth-ref-config-test',
        status: 'active',
        config: { label: 'personal' },
      });
      instanceId = instance.id;
    });

    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/connectors/${connectorDefIds[0]}/instances/${instanceId}/config`,
        payload: { config: { label: 'updated' } },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for unknown instance', async () => {
      const fakeIid = randomUUID();
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/connectors/${connectorDefIds[0]}/instances/${fakeIid}/config`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { config: { label: 'updated' } },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should update instance config and return updated instance', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/connectors/${connectorDefIds[0]}/instances/${instanceId}/config`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: { config: { label: 'work', priority: 'high' } },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe(instanceId);
      expect(body.data.config).toEqual({ label: 'work', priority: 'high' });
    });

    it('should persist the config update', async () => {
      // Verify the update persisted by checking the store directly
      const instance = context.stores.connectorStore.findInstanceById(instanceId);
      expect(instance).toBeDefined();
      expect(instance!.config).toEqual({ label: 'work', priority: 'high' });
    });
  });
});
