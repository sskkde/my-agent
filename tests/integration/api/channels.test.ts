import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

describe('Channels API', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let apiContext: ApiContext;
  let authCookie: string;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    server = await createApiServer(apiContext);
    await server.listen();
    const address = server.server.address();
    baseUrl = `http://localhost:${(address as any).port}`;

    const setupResponse = await fetch(`${baseUrl}/api/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    });

    expect(setupResponse.status).toBe(201);
    authCookie = setupResponse.headers.get('set-cookie')!;
  });

  afterAll(async () => {
    await server.close();
    if (apiContext && 'connection' in apiContext) {
      (apiContext as any).connection.close();
    }
  });

  describe('GET /api/channels', () => {
    it('should return registered channels including webui', async () => {
      const response = await fetch(`${baseUrl}/api/channels`, {
        headers: { 'Cookie': authCookie },
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { data: { channels: Array<{ connectorId: string; type: string; status: string; configured: boolean }> } };

      expect(body.data.channels).toBeDefined();
      expect(Array.isArray(body.data.channels)).toBe(true);

      const webuiChannel = body.data.channels.find(c => c.connectorId === 'webui');
      expect(webuiChannel).toBeDefined();
      expect(webuiChannel?.type).toBe('webui');
      expect(webuiChannel?.status).toBe('active');
      expect(webuiChannel?.configured).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/channels`);
      expect(response.status).toBe(401);
    });

    it('should not include fake external connectors', async () => {
      const response = await fetch(`${baseUrl}/api/channels`, {
        headers: { 'Cookie': authCookie },
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { data: { channels: Array<{ connectorId: string; type: string }> } };

      const fakeChannels = body.data.channels.filter(c =>
        c.connectorId.includes('slack') ||
        c.connectorId.includes('discord') ||
        c.connectorId.includes('telegram') ||
        c.type === 'external'
      );
      expect(fakeChannels.length).toBe(0);
    });
  });
});
