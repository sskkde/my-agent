import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

async function closeSseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stream may already be closed or aborted by the test timeout controller.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore already-released locks.
    }
  }
}
import type { TranscriptTurn } from '../../../src/api/types.js';
import type { ForegroundDecision } from '../../../src/foreground/types.js';

async function waitForCondition(
  assertion: () => void,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Condition was not met before timeout');
}

/**
 * Task 9: End-to-End Backend Full-Flow Integration Tests
 *
 * These tests verify the complete message flow:
 * POST /messages (202) -> async processing -> transcript persistence -> timeline -> SSE delivery
 *
 * Key verifications:
 * - POST returns 202 with correlationId/envelopeId, no assistant body
 * - Transcript contains user + assistant for success, user + error for failure
 * - SSE stream receives relevant timeline events
 * - Rapid message succession works with distinct correlation IDs
 * - Processing failures are visible and don't break subsequent messages
 */
describe('Task 9: Full-Flow Backend Integration Tests', () => {
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(() => {
    process.env.OPENROUTER_API_KEY ??= 'full-flow-test-key';
  });

  afterAll(() => {
    if (originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    }
  });

  describe('Full Flow: POST -> Processing -> Transcript -> Timeline -> SSE', () => {
    it('should complete full flow: 202 response -> transcript with user+assistant -> SSE event', async () => {
      // Create base context
      const baseCtx = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(baseCtx)) {
        throw new Error(`Failed to create base context: ${baseCtx.message}`);
      }

      const mockDecision: ForegroundDecision = {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question detected',
        userVisibleResponse: 'Assistant response to: Full flow test message',
      };

      const stubbedForegroundAgent = {
        processMessage: vi.fn().mockReturnValue(mockDecision),
      };

      const testCtx = createApiContext({
        dbPath: ':memory:',
        existingStores: baseCtx.stores,
        foregroundAgent: stubbedForegroundAgent as unknown as ApiContext['foregroundAgent'],
        timelineBroadcaster: baseCtx.timelineBroadcaster,
        channelRegistry: baseCtx.channelRegistry,
        llmAdapter: {
          providers: [{ providerId: 'test-provider' }],
          complete: vi.fn(),
          getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
        } as unknown as ApiContext['llmAdapter'],
      });

      if (isApiContextError(testCtx)) {
        throw new Error(`Failed to create test context: ${testCtx.message}`);
      }

      const testServer = await createApiServer(testCtx);
      await testServer.listen();
      const address = testServer.server.address();
      const testBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${testBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'fullflowuser', password: 'password123' }),
      });
      const testAuthCookie = setupResponse.headers.get('set-cookie')!;

      const createResponse = await fetch(`${testBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({}),
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      // Open SSE stream BEFORE sending message
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let receivedUserEvent = false;
      let receivedAssistantEvent = false;
      let sseChunks = '';

      try {
        const sseResponse = await fetch(
          `${testBaseUrl}/api/v1/sessions/${sessionId}/timeline/stream`,
          { headers: { 'Cookie': testAuthCookie }, signal: controller.signal }
        );

        expect(sseResponse.status).toBe(200);
        expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');

        const reader = sseResponse.body!.getReader();
        const decoder = new TextDecoder();

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sseChunks += decoder.decode(value, { stream: true });
            if (sseChunks.includes('"eventType":"user_message"')) {
              receivedUserEvent = true;
            }
            if (sseChunks.includes('"eventType":"assistant_message"')) {
              receivedAssistantEvent = true;
            }
            if (receivedUserEvent && receivedAssistantEvent) break;
          }
        })();

        // POST message - should return 202 with correlationId
        const postResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
          body: JSON.stringify({ text: 'Full flow test message' }),
        });

        expect(postResponse.status).toBe(202);
        const postBody = await postResponse.json() as {
          data: { accepted: boolean; status: string; correlationId: string; envelopeId: string }
        };
        expect(postBody.data.accepted).toBe(true);
        expect(postBody.data.status).toBe('accepted');
        expect(postBody.data.correlationId).toBeDefined();
        expect(postBody.data.envelopeId).toBeDefined();
        expect(postBody.data.correlationId).toBe(postBody.data.envelopeId);
        // Verify NO assistant content in response (properties should not exist)
        const responseData = postBody.data as Record<string, unknown>;
        expect(responseData.message).toBeUndefined();
        expect(responseData.assistantContent).toBeUndefined();

        const correlationId = postBody.data.correlationId;

        // Wait for SSE events with longer timeout
        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
        ]);

        // Verify SSE received both user_message and assistant_message
        expect(receivedUserEvent).toBe(true);
        expect(receivedAssistantEvent).toBe(true);
        expect(sseChunks).toContain('event: timeline_event');
        expect(sseChunks).toContain('"eventType":"user_message"');
        expect(sseChunks).toContain('"eventType":"assistant_message"');
        expect(sseChunks).toContain('Full flow test message');

          await closeSseReader(reader);

        // Verify transcript contains user + assistant
        const transcriptsResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/transcripts`, {
          headers: { 'Cookie': testAuthCookie },
        });
        const transcriptsBody = await transcriptsResponse.json() as { data: { transcripts: TranscriptTurn[] } };

        expect(transcriptsBody.data.transcripts.length).toBeGreaterThan(0);
        const turn = transcriptsBody.data.transcripts.find(t => t.turnId === correlationId);
        expect(turn).toBeDefined();
        expect(turn!.input.userMessageSummary).toBe('Full flow test message');
        expect(turn!.output.visibleMessages.length).toBeGreaterThan(0);
        expect(turn!.output.visibleMessages[0].role).toBe('assistant');
        expect(turn!.output.visibleMessages[0].content).toContain('Assistant response to');

        // Verify timeline contains user + assistant events
        const timelineResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/timeline`, {
          headers: { 'Cookie': testAuthCookie },
        });
        const timelineBody = await timelineResponse.json() as {
          data: { items: Array<{ eventType: string; content: string; correlationId?: string }> }
        };

        const userEvent = timelineBody.data.items.find(e => e.eventType === 'user_message');
        const assistantEvent = timelineBody.data.items.find(e => e.eventType === 'assistant_message');

        expect(userEvent).toBeDefined();
        expect(assistantEvent).toBeDefined();
        expect(userEvent!.content).toBe('Full flow test message');
        expect(assistantEvent!.content).toContain('Assistant response to');

      } finally {
        clearTimeout(timeout);
        controller.abort();
      }

      await testServer.close();
      (testCtx as any).connection.close();
      (baseCtx as any).connection.close();
    }, 15000);
  });

  describe('Rapid 3-Message Succession', () => {
    it('should handle 3 rapid messages with distinct correlation IDs and no duplicates', async () => {
      const baseCtx = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(baseCtx)) {
        throw new Error(`Failed to create base context: ${baseCtx.message}`);
      }

      const stubbedForegroundAgent = {
        processMessage: vi.fn().mockImplementation((input) => ({
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question',
          userVisibleResponse: `Response to: ${input.message}`,
        }) as ForegroundDecision),
      };

      const testCtx = createApiContext({
        dbPath: ':memory:',
        existingStores: baseCtx.stores,
        foregroundAgent: stubbedForegroundAgent as unknown as ApiContext['foregroundAgent'],
        timelineBroadcaster: baseCtx.timelineBroadcaster,
        channelRegistry: baseCtx.channelRegistry,
        llmAdapter: {
          providers: [{ providerId: 'test-provider' }],
          complete: vi.fn(),
          getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
        } as unknown as ApiContext['llmAdapter'],
      });

      if (isApiContextError(testCtx)) {
        throw new Error(`Failed to create test context: ${testCtx.message}`);
      }

      const testServer = await createApiServer(testCtx);
      await testServer.listen();
      const address = testServer.server.address();
      const testBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${testBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rapiduser', password: 'password123' }),
      });
      const testAuthCookie = setupResponse.headers.get('set-cookie')!;

      const createResponse = await fetch(`${testBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({}),
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      // Send 3 messages rapidly (almost simultaneously)
      const messages = ['First rapid message', 'Second rapid message', 'Third rapid message'];
      const correlationIds: string[] = [];

      const postPromises = messages.map((text) =>
        fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
          body: JSON.stringify({ text }),
        }).then(async (res) => {
          const body = await res.json() as { data: { correlationId: string } };
          return { correlationId: body.data.correlationId, status: res.status };
        })
      );

      const results = await Promise.all(postPromises);

      // All should return 202
      results.forEach(result => {
        expect(result.status).toBe(202);
        expect(result.correlationId).toBeDefined();
        correlationIds.push(result.correlationId);
      });

      // Verify distinct correlation IDs
      const uniqueCorrelationIds = new Set(correlationIds);
      expect(uniqueCorrelationIds.size).toBe(3);

      await waitForCondition(() => {
        expect(baseCtx.stores.transcriptStore.findBySession(sessionId).length).toBe(3);
      });

      const transcripts = baseCtx.stores.transcriptStore.findBySession(sessionId);

      correlationIds.forEach((corrId, index) => {
        const turn = transcripts.find((t: TranscriptTurn) => t.turnId === corrId);
        expect(turn).toBeDefined();
        expect(turn!.input.userMessageSummary).toBe(messages[index]);
        expect(turn!.output.visibleMessages[0].content).toBe(`Response to: ${messages[index]}`);
      });

      // Verify timeline has all 6 events (3 user + 3 assistant)
      const timelineResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/timeline`, {
        headers: { 'Cookie': testAuthCookie },
      });
      const timelineBody = await timelineResponse.json() as {
        data: { items: Array<{ eventType: string; content: string }> }
      };

      const userEvents = timelineBody.data.items.filter(e => e.eventType === 'user_message');
      const assistantEvents = timelineBody.data.items.filter(e => e.eventType === 'assistant_message');

      expect(userEvents.length).toBe(3);
      expect(assistantEvents.length).toBe(3);

      await testServer.close();
      (testCtx as any).connection.close();
      (baseCtx as any).connection.close();
    }, 15000);
  });

  describe('Processing Failure and Recovery', () => {
    it('should show error in timeline/transcript when processing fails, and still work for next message', async () => {
      const baseCtx = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(baseCtx)) {
        throw new Error(`Failed to create base context: ${baseCtx.message}`);
      }

      let shouldFail = true;

      const stubbedForegroundAgent = {
        processMessage: vi.fn().mockImplementation((_input) => {
          if (shouldFail) {
            throw new Error('Simulated processing failure');
          }
          return {
            route: 'answer_directly',
            requiresPlanner: false,
            reason: 'Recovery test',
            userVisibleResponse: 'Recovery response: This will succeed',
          } as ForegroundDecision;
        }),
      };

      const testCtx = createApiContext({
        dbPath: ':memory:',
        existingStores: baseCtx.stores,
        foregroundAgent: stubbedForegroundAgent as unknown as ApiContext['foregroundAgent'],
        timelineBroadcaster: baseCtx.timelineBroadcaster,
        channelRegistry: baseCtx.channelRegistry,
        llmAdapter: {
          providers: [{ providerId: 'test-provider' }],
          complete: vi.fn(),
          getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
        } as unknown as ApiContext['llmAdapter'],
      });

      if (isApiContextError(testCtx)) {
        throw new Error(`Failed to create test context: ${testCtx.message}`);
      }

      const testServer = await createApiServer(testCtx);
      await testServer.listen();
      const address = testServer.server.address();
      const testBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${testBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'failuser', password: 'password123' }),
      });
      const testAuthCookie = setupResponse.headers.get('set-cookie')!;

      const createResponse = await fetch(`${testBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({}),
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      // Send first message (will fail)
      const failResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({ text: 'This will fail' }),
      });

      expect(failResponse.status).toBe(202);
      const failBody = await failResponse.json() as { data: { correlationId: string } };
      const failCorrelationId = failBody.data.correlationId;

      let failTurn: TranscriptTurn | undefined;
      await waitForCondition(() => {
        const transcripts = baseCtx.stores.transcriptStore.findBySession(sessionId);
        failTurn = transcripts.find((t: TranscriptTurn) => t.turnId === failCorrelationId);
        expect(failTurn).toBeDefined();
        expect(failTurn!.output.visibleMessages.length).toBeGreaterThan(0);
      });

      expect(failTurn).toBeDefined();
      expect(failTurn!.input.userMessageSummary).toBe('This will fail');
      expect(failTurn!.output.visibleMessages.length).toBeGreaterThan(0);
      expect(failTurn!.output.visibleMessages[0].role).toBe('error');
      expect(failTurn!.output.visibleMessages[0].content).toContain('PROCESSING_ERROR');

      // Verify timeline contains user_message and error for failed turn
      const timelineResponse1 = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/timeline`, {
        headers: { 'Cookie': testAuthCookie },
      });
      const timelineBody1 = await timelineResponse1.json() as {
        data: { items: Array<{ eventType: string; content?: string }> }
      };

      const userEvent = timelineBody1.data.items.find(e => e.eventType === 'user_message');
      const errorEvent = timelineBody1.data.items.find(e => e.eventType === 'error');
      expect(userEvent).toBeDefined();
      expect(errorEvent).toBeDefined();
      expect(userEvent!.content).toBe('This will fail');

      // Now enable success
      shouldFail = false;

      // Send second message (will succeed)
      const successResponse = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({ text: 'This will succeed' }),
      });

      expect(successResponse.status).toBe(202);
      const successBody = await successResponse.json() as { data: { correlationId: string } };
      const successCorrelationId = successBody.data.correlationId;

      // Verify distinct correlation IDs for fail and success
      expect(failCorrelationId).not.toBe(successCorrelationId);

      await waitForCondition(() => {
        const finalTranscripts = baseCtx.stores.transcriptStore.findBySession(sessionId);
        const successTurn = finalTranscripts.find((t: TranscriptTurn) => t.turnId === successCorrelationId);
        expect(successTurn).toBeDefined();
        expect(successTurn!.output.visibleMessages[0].content).toBe('Recovery response: This will succeed');
      });

      // Verify timeline has assistant_message for successful response
      const timelineResponse2 = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/timeline`, {
        headers: { 'Cookie': testAuthCookie },
      });
      const timelineBody2 = await timelineResponse2.json() as {
        data: { items: Array<{ eventType: string; content?: string }> }
      };

      const assistantEvents = timelineBody2.data.items.filter(e => e.eventType === 'assistant_message');
      expect(assistantEvents.length).toBeGreaterThan(0);

      const finalTranscripts = baseCtx.stores.transcriptStore.findBySession(sessionId);
      const successTurn = finalTranscripts.find((t: TranscriptTurn) => t.turnId === successCorrelationId);
      expect(successTurn).toBeDefined();
      expect(successTurn!.output.visibleMessages[0].content).toBe('Recovery response: This will succeed');

      await testServer.close();
      (testCtx as any).connection.close();
      (baseCtx as any).connection.close();
    }, 15000);
  });

  describe('Preflight Validation', () => {
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

    it('should reject invalid messages with 400 before enqueue', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      // Test empty text
      const emptyResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: '' }),
      });
      expect(emptyResponse.status).toBe(400);

      // Test whitespace-only text
      const whitespaceResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: '   ' }),
      });
      expect(whitespaceResponse.status).toBe(400);

      // Test missing text field
      const missingResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      expect(missingResponse.status).toBe(400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session-id/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ text: 'Test message' }),
      });

      expect(response.status).toBe(404);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Session not found');
    });
  });

  describe('Correlation ID Determinism', () => {
    it('should use envelopeId as correlationId consistently', async () => {
      const baseCtx = createApiContext({ dbPath: ':memory:' });
      if (isApiContextError(baseCtx)) {
        throw new Error(`Failed to create base context: ${baseCtx.message}`);
      }

      const stubbedForegroundAgent = {
        processMessage: vi.fn().mockReturnValue({
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Correlation test',
          userVisibleResponse: 'Correlation test response',
        } as ForegroundDecision),
      };

      const testCtx = createApiContext({
        dbPath: ':memory:',
        existingStores: baseCtx.stores,
        foregroundAgent: stubbedForegroundAgent as unknown as ApiContext['foregroundAgent'],
        timelineBroadcaster: baseCtx.timelineBroadcaster,
        channelRegistry: baseCtx.channelRegistry,
        llmAdapter: {
          providers: [{ providerId: 'test-provider' }],
          complete: vi.fn(),
          getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
        } as unknown as ApiContext['llmAdapter'],
      });

      if (isApiContextError(testCtx)) {
        throw new Error(`Failed to create test context: ${testCtx.message}`);
      }

      const testServer = await createApiServer(testCtx);
      await testServer.listen();
      const address = testServer.server.address();
      const testBaseUrl = `http://localhost:${(address as any).port}`;

      const setupResponse = await fetch(`${testBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'correlationuser', password: 'password123' }),
      });
      const testAuthCookie = setupResponse.headers.get('set-cookie')!;

      const createResponse = await fetch(`${testBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({}),
      });
      const { data: { session: { sessionId } } } = await createResponse.json() as any;

      const response = await fetch(`${testBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': testAuthCookie },
        body: JSON.stringify({ text: 'Correlation determinism test' }),
      });

      const body = await response.json() as {
        data: { correlationId: string; envelopeId: string }
      };

      expect(body.data.correlationId).toBe(body.data.envelopeId);
      expect(body.data.correlationId).toMatch(/^\d+-[a-z0-9]+$/);

      await testServer.close();
      (testCtx as any).connection.close();
      (baseCtx as any).connection.close();
    });
  });
});
