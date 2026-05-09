import { vi, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { createApiServer } from '../../../src/api/server.js';
import type { ForegroundDecision } from '../../../src/foreground/types.js';
import type { LLMAdapter } from '../../../src/llm/adapter.js';

export interface SmokeHarness {
  baseCtx: ApiContext;
  testCtx: ApiContext;
  server: FastifyInstance;
  baseUrl: string;
  authCookie: string;
  userId: string;
}

function createSafeEventStore(eventStore: ApiContext['stores']['eventStore']): ApiContext['stores']['eventStore'] {
  return {
    append: (eventOrEvents) => {
      const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents];
      const normalized = events.map(event => ({
        ...event,
        payload: event.payload ?? {},
      }));
      eventStore.append(Array.isArray(eventOrEvents) ? normalized : normalized[0]!);
    },
    query: filters => eventStore.query(filters),
    findByCorrelationId: correlationId => eventStore.findByCorrelationId(correlationId),
    findByCausationId: causationId => eventStore.findByCausationId(causationId),
    updateUserIdForSession: (sessionId, newUserId) => eventStore.updateUserIdForSession(sessionId, newUserId),
  };
}

export function createStubbedForegroundAgent(decision: ForegroundDecision): ApiContext['foregroundAgent'] {
  return {
    processMessage: vi.fn().mockResolvedValue(decision),
  } as unknown as ApiContext['foregroundAgent'];
}

export function createMockLlmAdapter(): LLMAdapter {
  return {
    providers: [{ providerId: 'smoke-provider' }],
    complete: vi.fn().mockResolvedValue({
      success: true,
      response: {
        id: 'smoke-llm-response',
        content: 'Smoke kernel response',
        finishReason: 'stop',
      },
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    }),
    getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
  } as unknown as LLMAdapter;
}

export async function createSmokeHarness(options: {
  username: string;
  foregroundDecision?: ForegroundDecision;
}): Promise<SmokeHarness> {
  const baseCtx = createApiContext({ dbPath: ':memory:' });
  if (isApiContextError(baseCtx)) {
    throw new Error(`Failed to create base context: ${baseCtx.message}`);
  }

  const testCtx = createApiContext({
    dbPath: ':memory:',
    existingStores: {
      ...baseCtx.stores,
      eventStore: createSafeEventStore(baseCtx.stores.eventStore),
    },
    foregroundAgent: options.foregroundDecision
      ? createStubbedForegroundAgent(options.foregroundDecision)
      : undefined,
    timelineBroadcaster: baseCtx.timelineBroadcaster,
    channelRegistry: baseCtx.channelRegistry,
    llmAdapter: createMockLlmAdapter(),
  });
  if (isApiContextError(testCtx)) {
    throw new Error(`Failed to create test context: ${testCtx.message}`);
  }

  const server = await createApiServer(testCtx);
  await server.listen();
  const address = server.server.address();
  const baseUrl = `http://localhost:${(address as { port: number }).port}`;

  const setupResponse = await fetch(`${baseUrl}/api/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: options.username, password: 'password123' }),
  });
  expect(setupResponse.status).toBe(201);
  const authCookie = setupResponse.headers.get('set-cookie');
  expect(authCookie).toBeTruthy();

  const users = baseCtx.stores.userStore.list();
  const user = users.find(candidate => candidate.username === options.username);
  expect(user).toBeDefined();

  return {
    baseCtx,
    testCtx,
    server,
    baseUrl,
    authCookie: authCookie!,
    userId: user!.userId,
  };
}

export async function closeSmokeHarness(harness: SmokeHarness): Promise<void> {
  await harness.server.close();
  harness.testCtx.connection.close();
  harness.baseCtx.connection.close();
}

export async function createSession(harness: SmokeHarness): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { data: { session: { sessionId: string } } };
  return body.data.session.sessionId;
}

export async function waitForCondition(
  assertion: () => void,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 3000;
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
