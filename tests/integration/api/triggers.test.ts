import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';

describe('Trigger API Integration', () => {
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

  describe('Schedule Triggers', () => {
    describe('POST /api/triggers/schedules', () => {
      it('should return 401 without authentication', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          payload: {
            name: 'Test Schedule',
            schedulePattern: '0 * * * *',
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should create a schedule trigger', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Test Schedule',
            schedulePattern: '0 * * * *',
          },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.data).toMatchObject({
          name: 'Test Schedule',
          schedulePattern: '0 * * * *',
          status: 'active',
          runCount: 0,
        });
        expect(body.data.scheduleId).toBeDefined();
      });

      it('should return 400 when name is missing', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            schedulePattern: '0 * * * *',
          },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should return 400 when schedulePattern is missing', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Test Schedule',
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/triggers/schedules', () => {
      it('should return 401 without authentication', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/triggers/schedules',
        });

        expect(response.statusCode).toBe(401);
      });

      it('should return list of schedule triggers for authenticated user', async () => {
        await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'List Test Schedule',
            schedulePattern: '*/5 * * * *',
          },
        });

        const response = await server.inject({
          method: 'GET',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
      });
    });

    describe('PATCH /api/triggers/schedules/:scheduleId', () => {
      it('should update schedule trigger status', async () => {
        const createResponse = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Update Test Schedule',
            schedulePattern: '0 0 * * *',
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const scheduleId = createBody.data.scheduleId;

        const response = await server.inject({
          method: 'PATCH',
          url: `/api/triggers/schedules/${scheduleId}`,
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            status: 'paused',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.status).toBe('paused');
      });

      it('should return 404 for non-existent schedule', async () => {
        const response = await server.inject({
          method: 'PATCH',
          url: '/api/triggers/schedules/non-existent-id',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            status: 'paused',
          },
        });

        expect(response.statusCode).toBe(404);
      });
    });

    describe('DELETE /api/triggers/schedules/:scheduleId', () => {
      it('should delete schedule trigger', async () => {
        const createResponse = await server.inject({
          method: 'POST',
          url: '/api/triggers/schedules',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Delete Test Schedule',
            schedulePattern: '0 0 * * *',
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const scheduleId = createBody.data.scheduleId;

        const response = await server.inject({
          method: 'DELETE',
          url: `/api/triggers/schedules/${scheduleId}`,
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
        });

        expect(response.statusCode).toBe(204);

        const getResponse = await server.inject({
          method: 'GET',
          url: `/api/triggers/schedules/${scheduleId}`,
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
        });

        expect(getResponse.statusCode).toBe(404);
      });
    });
  });

  describe('Webhook Triggers', () => {
    describe('POST /api/triggers/webhooks', () => {
      it('should return 401 without authentication', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/webhooks',
          payload: {
            name: 'Test Webhook',
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should create a webhook trigger with secret', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/webhooks',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Test Webhook',
          },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.data).toMatchObject({
          name: 'Test Webhook',
          status: 'active',
        });
        expect(body.data.webhookId).toBeDefined();
        expect(body.data.secret).toBeDefined();
        expect(body.data.secret.length).toBe(64);
        expect(body.data.secretLast4).toBeDefined();
      });

      it('should return 400 when name is missing', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/triggers/webhooks',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {},
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/triggers/webhooks', () => {
      it('should return list of webhook triggers without secrets', async () => {
        await server.inject({
          method: 'POST',
          url: '/api/triggers/webhooks',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'List Test Webhook',
          },
        });

        const response = await server.inject({
          method: 'GET',
          url: '/api/triggers/webhooks',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.data[0].secret).toBeUndefined();
        expect(body.data[0].secretLast4).toBeDefined();
      });
    });

    describe('PATCH /api/triggers/webhooks/:webhookId', () => {
      it('should update webhook trigger status', async () => {
        const createResponse = await server.inject({
          method: 'POST',
          url: '/api/triggers/webhooks',
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            name: 'Update Test Webhook',
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const webhookId = createBody.data.webhookId;

        const response = await server.inject({
          method: 'PATCH',
          url: `/api/triggers/webhooks/${webhookId}`,
          headers: {
            cookie: `agent-platform-session=${authToken}`,
          },
          payload: {
            status: 'paused',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.status).toBe('paused');
      });
    });
  });

  describe('Webhook Delivery', () => {
    let webhookId: string;
    let secret: string;

    beforeAll(async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/triggers/webhooks',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Delivery Test Webhook',
        },
      });

      const createBody = JSON.parse(createResponse.body);
      webhookId = createBody.data.webhookId;
      secret = createBody.data.secret;
    });

    it('should return 401 when signature is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        payload: { test: 'data' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 when signature is invalid', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-hub-signature-256': 'sha256=invalidsignature',
        },
        payload: { test: 'data' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should accept delivery with valid HMAC signature', async () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload: { test: 'data' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('accepted');
      expect(body.data.eventId).toBeDefined();
    });

    it('should accept delivery with X-Signature-256 header', async () => {
      const payload = JSON.stringify({ test: 'data2' });
      const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-signature-256': signature,
          'content-type': 'application/json',
        },
        payload: { test: 'data2' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('accepted');
    });

    it('should return duplicate status for repeated delivery-id', async () => {
      const payload = JSON.stringify({ test: 'duplicate' });
      const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      const deliveryId = 'delivery-' + Date.now();

      const firstResponse = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-hub-signature-256': signature,
          'x-delivery-id': deliveryId,
        },
        payload: { test: 'duplicate' },
      });

      expect(firstResponse.statusCode).toBe(200);
      const firstBody = JSON.parse(firstResponse.body);
      expect(firstBody.data.status).toBe('accepted');

      const secondResponse = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-hub-signature-256': signature,
          'x-delivery-id': deliveryId,
        },
        payload: { test: 'duplicate' },
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondBody = JSON.parse(secondResponse.body);
      expect(secondBody.data.status).toBe('duplicate');
    });

    it('should return 403 when webhook is paused', async () => {
      await server.inject({
        method: 'PATCH',
        url: `/api/triggers/webhooks/${webhookId}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          status: 'paused',
        },
      });

      const payload = JSON.stringify({ test: 'paused' });
      const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: `/api/webhooks/${webhookId}/deliver`,
        headers: {
          'x-hub-signature-256': signature,
        },
        payload: { test: 'paused' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent webhook', async () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = 'sha256=' + createHmac('sha256', 'anysecret').update(payload).digest('hex');

      const response = await server.inject({
        method: 'POST',
        url: '/api/webhooks/non-existent-id/deliver',
        headers: {
          'x-hub-signature-256': signature,
        },
        payload: { test: 'data' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Cross-user access', () => {
    let otherUserId: string;
    let otherAuthToken: string;

    beforeAll(async () => {
      otherUserId = randomUUID();
      context.stores.userStore.create({
        userId: otherUserId,
        username: 'otheruser',
        passwordHash: await hashPassword('password'),
      });

      otherAuthToken = generateSessionToken();
      const tokenHash = hashToken(otherAuthToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      context.stores.authTokenStore.create({
        tokenHash,
        userId: otherUserId,
        expiresAt,
      });
    });

    it('rejects cross-user schedule trigger access', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/triggers/schedules',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Schedule',
          schedulePattern: '0 * * * *',
        },
      });

      const createBody = JSON.parse(createResponse.body);
      const scheduleId = createBody.data.scheduleId;

      const response = await server.inject({
        method: 'GET',
        url: `/api/triggers/schedules/${scheduleId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects cross-user webhook trigger access', async () => {
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/triggers/webhooks',
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
        payload: {
          name: 'Owner Webhook',
        },
      });

      const createBody = JSON.parse(createResponse.body);
      const webhookId = createBody.data.webhookId;

      const response = await server.inject({
        method: 'GET',
        url: `/api/triggers/webhooks/${webhookId}`,
        headers: {
          cookie: `agent-platform-session=${otherAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
