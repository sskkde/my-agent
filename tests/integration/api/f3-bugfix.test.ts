import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../../../src/api/context.js';
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

describe('Provider API: GET /:id and headersConfigured (F3 bugs)', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = 'test-encryption-key-for-testing-only-do-not-use-in-production';
    process.env.ALLOWED_ORIGINS = 'http://localhost';

    const contextResult = createApiContext({ dbPath: ':memory:' });
    if ('code' in contextResult) throw new Error('no context');
    context = contextResult;
    server = await createApiServer(context);
    userId = randomUUID();
    context.stores.userStore.create({ userId, username: 'f3bug', passwordHash: await hashPassword('p') });
    authToken = generateSessionToken();
    const tokenHash = hashToken(authToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    context.stores.authTokenStore.create({ tokenHash, userId, expiresAt });
  });

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    delete process.env.ALLOWED_ORIGINS;
    await server.close();
    context.connection.close();
  });

  const authed = () => ({ cookie: `agent-platform-session=${authToken}`, 'content-type': 'application/json' });

  it('GET /api/v1/providers/:id returns 404 for non-existent', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/providers/nonexistent-id', headers: { cookie: `agent-platform-session=${authToken}` } });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/providers/:id returns 200 with provider data', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/providers', headers: authed(), payload: { providerType: 'openai', displayName: 'F3A', apiKey: 'sk-a', baseUrl: 'https://x', selectedModel: 'g' } });
    const id = JSON.parse(create.body).data.providerId;
    const get = await server.inject({ method: 'GET', url: `/api/v1/providers/${id}`, headers: { cookie: `agent-platform-session=${authToken}` } });
    expect(get.statusCode).toBe(200);
    const data = JSON.parse(get.body).data;
    expect(data.providerId).toBe(id);
    expect(data.headersConfigured).toBe(false);
  });

  it('headersConfigured flips to true after PATCH with non-empty headers', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/providers', headers: authed(), payload: { providerType: 'openai', displayName: 'F3B', apiKey: 'sk-b', baseUrl: 'https://x', selectedModel: 'g' } });
    const id = JSON.parse(create.body).data.providerId;
    await server.inject({ method: 'PATCH', url: `/api/v1/providers/${id}`, headers: authed(), payload: { headers: { 'X-Custom': 'foo' } } });
    const get = await server.inject({ method: 'GET', url: `/api/v1/providers/${id}`, headers: { cookie: `agent-platform-session=${authToken}` } });
    expect(JSON.parse(get.body).data.headersConfigured).toBe(true);
  });

  it('headersConfigured flips to false after PATCH with empty headers', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/providers', headers: authed(), payload: { providerType: 'openai', displayName: 'F3C', apiKey: 'sk-c', baseUrl: 'https://x', selectedModel: 'g' } });
    const id = JSON.parse(create.body).data.providerId;
    await server.inject({ method: 'PATCH', url: `/api/v1/providers/${id}`, headers: authed(), payload: { headers: { 'X-Custom': 'foo' } } });
    await server.inject({ method: 'PATCH', url: `/api/v1/providers/${id}`, headers: authed(), payload: { headers: {} } });
    const get = await server.inject({ method: 'GET', url: `/api/v1/providers/${id}`, headers: { cookie: `agent-platform-session=${authToken}` } });
    expect(JSON.parse(get.body).data.headersConfigured).toBe(false);
  });
});
