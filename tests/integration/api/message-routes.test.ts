import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { MessageProcessor, MessageProcessorInput, MessageProcessorOutput } from '../../../src/processing/types.js';

describe('Message Routes - Envelope/Correlation Preservation', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let apiContext: ApiContext;
  let authCookie: string;
  let processorCalls: Array<{ input: MessageProcessorInput; timestamp: number }>;
  let mockProcessor: MessageProcessor;

  beforeAll(async () => {
    processorCalls = [];

    mockProcessor = {
      process: async (input: MessageProcessorInput): Promise<MessageProcessorOutput> => {
        processorCalls.push({ input, timestamp: Date.now() });
        return {
          correlationId: input.correlationId,
          success: true,
          result: {
            text: 'Mock response',
            route: 'test',
          },
          timestamp: new Date().toISOString(),
        };
      },
    };

    const ctx = createApiContext({
      dbPath: ':memory:',
      messageProcessor: mockProcessor,
    });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    server = await createApiServer(apiContext);
    await server.listen();
    const address = server.server.address();
    baseUrl = `http://localhost:${(address as any).port}`;

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
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

  describe('POST /api/sessions/:sessionId/messages', () => {
    it('should call processor exactly once with converted envelope input', async () => {
      processorCalls = [];

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Test message' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { accepted: boolean; correlationId: string; envelopeId: string } };
      expect(body.data.accepted).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processorCalls.length).toBe(1);
      expect(processorCalls[0].input.text).toBe('Test message');
      expect(processorCalls[0].input.sessionId).toBe(sessionId);
      expect(processorCalls[0].input.correlationId).toBe(body.data.correlationId);
    });

    it('should pass sourceChannel webui via envelope to processor metadata', async () => {
      processorCalls = [];

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Channel test' })
      });

      expect(response.status).toBe(202);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processorCalls.length).toBe(1);
      const input = processorCalls[0].input;

      expect(input.metadata).toBeDefined();
      expect(input.metadata?.envelopeEventType).toBe('human_message');

      expect(input.metadata?.sourceChannel).toBeUndefined();
      expect(input.metadata?.channel).toBeUndefined();
    });

    it('should not call processor for invalid messages', async () => {
      processorCalls = [];

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: '' })
      });

      expect(response.status).toBe(400);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processorCalls.length).toBe(0);
    });

    it('should return 202 without assistant content in response', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'No content test' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: Record<string, unknown> };

      expect(body.data.accepted).toBe(true);
      expect(body.data.status).toBe('accepted');
      expect(body.data.correlationId).toBeDefined();
      expect(body.data.envelopeId).toBeDefined();

      expect(body.data.message).toBeUndefined();
      expect(body.data.turnId).toBeUndefined();
      expect(body.data.assistantContent).toBeUndefined();
      expect(body.data.response).toBeUndefined();
    });

    it('should preserve correlationId matching envelopeId', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Correlation test' })
      });

      expect(response.status).toBe(202);
      const body = await response.json() as { data: { correlationId: string; envelopeId: string } };

      expect(body.data.correlationId).toBe(body.data.envelopeId);
      expect(body.data.correlationId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('should handle processor errors without blocking response', { timeout: 15_000 }, async () => {
      const errorProcessor: MessageProcessor = {
        process: async (): Promise<MessageProcessorOutput> => {
          throw new Error('Simulated processor error');
        },
      };

      const errorCtx = createApiContext({
        dbPath: ':memory:',
        messageProcessor: errorProcessor,
      });
      if (isApiContextError(errorCtx)) {
        throw new Error(`Failed to create API context: ${errorCtx.message}`);
      }

      const errorServer = await createApiServer(errorCtx);
      await errorServer.listen();
      const address = errorServer.server.address();
      const errorBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${errorBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'erroruser', password: 'password123' }),
      });
      const errorAuthCookie = setupResponse.headers.get('set-cookie')!;

      const createResponse = await fetch(`${errorBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': errorAuthCookie },
        body: JSON.stringify({})
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const startTime = Date.now();
      const response = await fetch(`${errorBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': errorAuthCookie },
        body: JSON.stringify({ text: 'Error test' })
      });
      const endTime = Date.now();

      expect(response.status).toBe(202);
      expect(endTime - startTime).toBeLessThan(500);

      await errorServer.close();
      (errorCtx as any).connection.close();
    });
  });
});
