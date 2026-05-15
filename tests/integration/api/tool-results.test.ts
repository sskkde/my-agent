import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Tool Results API Integration', () => {
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

  describe('GET /api/tool-results/:resultId', () => {
    it('should return 401 without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tool-results/test-result-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return result for owner', async () => {
      const resultRef = randomUUID();
      const toolCallId = randomUUID();

      const blob = context.stores.toolResultStore.create({
        resultRef,
        toolCallId,
        toolName: 'test.tool',
        userId,
        sessionId: undefined,
        preview: 'test preview',
        structuredContent: { data: 'test content' },
        sensitivity: 'low',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tool-results/${blob.id}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toMatchObject({
        resultId: blob.id,
        toolExecutionId: toolCallId,
        toolName: 'test.tool',
        userId,
        preview: 'test preview',
        sensitivity: 'low',
      });
      expect(body.data.sizeBytes).toBeGreaterThan(0);
      expect(body.data.contentType).toBe('application/json');
      expect(body.data.createdAt).toBeDefined();
    });

    it('should return 404 for non-owner', async () => {
      const otherUserId = randomUUID();
      const resultRef = randomUUID();

      const blob = context.stores.toolResultStore.create({
        resultRef,
        toolCallId: randomUUID(),
        toolName: 'test.tool',
        userId: otherUserId,
        sessionId: undefined,
        preview: 'other user preview',
        structuredContent: { data: 'other content' },
        sensitivity: 'low',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tool-results/${blob.id}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 404 for non-existent result', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tool-results/${randomUUID()}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return result with session info when available', async () => {
      const resultRef = randomUUID();
      const sessionId = randomUUID();

      const blob = context.stores.toolResultStore.create({
        resultRef,
        toolCallId: randomUUID(),
        toolName: 'test.tool',
        userId,
        sessionId,
        preview: 'with session',
        structuredContent: { data: 'test' },
        sensitivity: 'medium',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tool-results/${blob.id}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.sessionId).toBe(sessionId);
    });

    it('should calculate sizeBytes correctly', async () => {
      const resultRef = randomUUID();
      const content = { largeArray: Array(100).fill('test-data-item') };

      const blob = context.stores.toolResultStore.create({
        resultRef,
        toolCallId: randomUUID(),
        toolName: 'test.tool',
        userId,
        sessionId: undefined,
        preview: 'size test',
        structuredContent: content,
        sensitivity: 'low',
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/tool-results/${blob.id}`,
        headers: {
          cookie: `agent-platform-session=${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const expectedSize = Buffer.byteLength(JSON.stringify(content), 'utf-8');
      expect(body.data.sizeBytes).toBe(expectedSize);
    });
  });
});