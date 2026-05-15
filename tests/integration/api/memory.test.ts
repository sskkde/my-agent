import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import type { LongTermMemoryRecord, MemoryType } from '../../../src/storage/long-term-memory-store.js';
import type { MemoryExtractionRun } from '../../../src/storage/memory-extraction-run-store.js';
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js';

describe('Memory Management API', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let apiContext: ApiContext;
  let authCookie: string;
  let userId: string;
  let rawTranscriptStore: TranscriptStore;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    server = await createApiServer(apiContext);
    rawTranscriptStore = createTranscriptStore(apiContext.connection);
    await server.listen();
    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port');
    }
    baseUrl = `http://localhost:${address.port}`;

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    });

    expect(setupResponse.status).toBe(201);
    authCookie = setupResponse.headers.get('set-cookie')!;

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Cookie': authCookie },
    });
    const meBody = await meResponse.json() as { data: { user: { userId: string } } };
    userId = meBody.data.user.userId;
  });

  beforeEach(() => {
    // Clean up memories between tests to avoid state leakage
    const memories = apiContext.stores.longTermMemoryStore.getByUserId(userId);
    for (const mem of memories) {
      apiContext.stores.longTermMemoryStore.delete(mem.memoryId);
    }
  });

  afterAll(async () => {
    await server.close();
    apiContext.connection.close();
  });

  // Helper to create a memory
  function createTestMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
    const memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    return {
      memoryId,
      userId,
      memoryType: 'user_preference' as MemoryType,
      content: { text: 'Test memory content' },
      sourceRefs: { transcriptRefs: ['turn-1'] },
      scope: { visibility: 'private_user' },
      confidence: 0.85,
      importance: 'medium',
      sensitivity: 'low',
      lifecycle: {
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      retrieval: {
        keywords: ['test'],
        recallCount: 0,
      },
      ...overrides,
    };
  }

  // Helper to create an extraction run
  function createTestExtractionRun(overrides: Partial<MemoryExtractionRun> = {}): MemoryExtractionRun {
    const windowHash = `hash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    return {
      runId: `run-${userId}-${windowHash}`,
      userId,
      sessionId: 'session-1',
      triggerTurnId: 'turn-1',
      windowHash,
      includedTurnIds: ['turn-1'],
      status: 'succeeded',
      attempts: 0,
      sourceRefs: {},
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  describe('GET /api/memory', () => {
    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`);
      expect(response.status).toBe(401);
    });

    it('should return empty list when no memories exist', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: unknown[]; total: number } };
      expect(body.data.memories).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('should return active and low_priority memories only', async () => {
      const activeMemory = createTestMemory({ lifecycle: { status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      const lowPriorityMemory = createTestMemory({ memoryId: 'mem-low', lifecycle: { status: 'low_priority', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      const archivedMemory = createTestMemory({ memoryId: 'mem-archived', lifecycle: { status: 'archived', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });

      apiContext.stores.longTermMemoryStore.save(activeMemory);
      apiContext.stores.longTermMemoryStore.save(lowPriorityMemory);
      apiContext.stores.longTermMemoryStore.save(archivedMemory);

      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: LongTermMemoryRecord[]; total: number } };
      expect(body.data.memories.length).toBe(2);
      expect(body.data.memories.map(m => m.memoryId)).toContain(activeMemory.memoryId);
      expect(body.data.memories.map(m => m.memoryId)).toContain(lowPriorityMemory.memoryId);
      expect(body.data.memories.map(m => m.memoryId)).not.toContain(archivedMemory.memoryId);
    });

    it('should filter by query string', async () => {
      const memory1 = createTestMemory({ content: { text: 'I prefer dark mode' } });
      const memory2 = createTestMemory({ memoryId: 'mem-2', content: { text: 'I like light colors' } });
      apiContext.stores.longTermMemoryStore.save(memory1);
      apiContext.stores.longTermMemoryStore.save(memory2);

      const response = await fetch(`${baseUrl}/api/v1/memory?query=dark`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: LongTermMemoryRecord[]; total: number } };
      expect(body.data.memories.length).toBe(1);
      expect(body.data.memories[0].memoryId).toBe(memory1.memoryId);
    });

    it('should filter by memory type', async () => {
      const preferenceMemory = createTestMemory({ memoryType: 'user_preference', content: { text: 'Preference for type filter test' } });
      const profileMemory = createTestMemory({ memoryId: 'mem-profile-type-test', memoryType: 'user_profile', content: { text: 'Profile for type filter test' } });
      apiContext.stores.longTermMemoryStore.save(preferenceMemory);
      apiContext.stores.longTermMemoryStore.save(profileMemory);

      const response = await fetch(`${baseUrl}/api/v1/memory?type=user_preference`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: LongTermMemoryRecord[]; total: number } };
      const preferenceMemories = body.data.memories.filter(m => m.memoryId === preferenceMemory.memoryId);
      expect(preferenceMemories.length).toBe(1);
      expect(preferenceMemories[0].memoryType).toBe('user_preference');
      expect(body.data.memories.find(m => m.memoryId === profileMemory.memoryId)).toBeUndefined();
    });

    it('should respect limit parameter', async () => {
      const testMemoryIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const memory = createTestMemory({ memoryId: `mem-limit-test-${Date.now()}-${i}`, content: { text: `Limit test memory ${i}` } });
        apiContext.stores.longTermMemoryStore.save(memory);
        testMemoryIds.push(memory.memoryId);
      }

      const response = await fetch(`${baseUrl}/api/v1/memory?limit=2`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: LongTermMemoryRecord[]; total: number } };
      expect(body.data.memories.length).toBe(2);
      const foundTestMemories = body.data.memories.filter(m => testMemoryIds.includes(m.memoryId));
      expect(foundTestMemories.length).toBeLessThanOrEqual(2);
    });

    it('should return 400 for invalid type', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory?type=invalid_type`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for invalid limit', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory?limit=abc`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('should not return other users memories', async () => {
      const otherUserMemory = createTestMemory({ userId: 'other-user', memoryId: 'mem-other' });
      apiContext.stores.longTermMemoryStore.save(otherUserMemory);

      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memories: LongTermMemoryRecord[]; total: number } };
      expect(body.data.memories.find(m => m.memoryId === 'mem-other')).toBeUndefined();
    });
  });

  describe('GET /api/memory/:memoryId', () => {
    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/mem-123`);
      expect(response.status).toBe(401);
    });

    it('should return memory detail for existing memory', async () => {
      const memory = createTestMemory();
      apiContext.stores.longTermMemoryStore.save(memory);

      const response = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { memory: LongTermMemoryRecord } };
      expect(body.data.memory.memoryId).toBe(memory.memoryId);
      expect(body.data.memory.userId).toBe(userId);
      expect(body.data.memory.content.text).toBe('Test memory content');
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/nonexistent-mem`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for other users memory', async () => {
      const otherUserMemory = createTestMemory({ userId: 'other-user', memoryId: 'mem-other-user' });
      apiContext.stores.longTermMemoryStore.save(otherUserMemory);

      const response = await fetch(`${baseUrl}/api/v1/memory/mem-other-user`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for deleted memory', async () => {
      const memory = createTestMemory();
      memory.lifecycle.status = 'deleted';
      apiContext.stores.longTermMemoryStore.save(memory);

      const response = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/memory/:memoryId', () => {
    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/mem-123`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
    });

    it('should delete memory and return success', async () => {
      const memory = createTestMemory({ fingerprint: 'fp-test', sourceWindowHash: 'hash-test' });
      apiContext.stores.longTermMemoryStore.save(memory);

      const response = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { deleted: boolean; memoryId: string } };
      expect(body.data.deleted).toBe(true);
      expect(body.data.memoryId).toBe(memory.memoryId);

      // Verify memory is marked as deleted
      const deletedMemory = apiContext.stores.longTermMemoryStore.getByMemoryId(memory.memoryId);
      expect(deletedMemory?.lifecycle.status).toBe('deleted');
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/nonexistent-mem`, {
        method: 'DELETE',
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should return 404 for other users memory', async () => {
      const otherUserMemory = createTestMemory({ userId: 'other-user', memoryId: 'mem-other-user' });
      apiContext.stores.longTermMemoryStore.save(otherUserMemory);

      const response = await fetch(`${baseUrl}/api/v1/memory/mem-other-user`, {
        method: 'DELETE',
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should create tombstone on delete', async () => {
      const memory = createTestMemory({ fingerprint: 'fp-tombstone', sourceWindowHash: 'hash-tombstone' });
      apiContext.stores.longTermMemoryStore.save(memory);

      const response = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      // Verify tombstone exists
      const hasTombstone = apiContext.stores.longTermMemoryStore.hasTombstone(userId, 'fp-tombstone', 'hash-tombstone');
      expect(hasTombstone).toBe(true);
    });
  });

  describe('GET /api/memory/debug/extraction-runs', () => {
    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs`);
      expect(response.status).toBe(401);
    });

    it('should return extraction runs for current user', async () => {
      const run = createTestExtractionRun();
      apiContext.stores.memoryExtractionRunStore.createPending({
        userId,
        sessionId: run.sessionId,
        triggerTurnId: run.triggerTurnId,
        windowHash: run.windowHash,
        includedTurnIds: run.includedTurnIds,
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { runs: MemoryExtractionRun[]; total: number } };
      expect(body.data.runs.length).toBeGreaterThanOrEqual(1);
      expect(body.data.runs[0].userId).toBe(userId);
    });

    it('should filter by sessionId', async () => {
      // Create a session first
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionResponse.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const windowHash = `hash-session-${sessionId}`;
      apiContext.stores.memoryExtractionRunStore.createPending({
        userId,
        sessionId,
        triggerTurnId: 'turn-1',
        windowHash,
        includedTurnIds: ['turn-1'],
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs?sessionId=${sessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        const windowHash = `hash-limit-${i}-${Date.now()}`;
        apiContext.stores.memoryExtractionRunStore.createPending({
          userId,
          sessionId: 'session-1',
          triggerTurnId: `turn-${i}`,
          windowHash,
          includedTurnIds: [`turn-${i}`],
        });
      }

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs?limit=2`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { runs: MemoryExtractionRun[]; total: number } };
      expect(body.data.runs.length).toBe(2);
    });

    it('should return 400 for invalid limit', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs?limit=abc`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(400);
    });

    it('should not return other users runs', async () => {
      const otherUserRun = createTestExtractionRun({ userId: 'other-user', runId: 'run-other-user-hash' });
      apiContext.stores.memoryExtractionRunStore.createPending({
        userId: 'other-user',
        sessionId: otherUserRun.sessionId,
        triggerTurnId: otherUserRun.triggerTurnId,
        windowHash: otherUserRun.windowHash,
        includedTurnIds: otherUserRun.includedTurnIds,
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { runs: MemoryExtractionRun[] } };
      expect(body.data.runs.find(r => r.userId === 'other-user')).toBeUndefined();
    });

    it('should return metadata only (no raw prompts or transcript content)', async () => {
      const run = createTestExtractionRun();
      apiContext.stores.memoryExtractionRunStore.createPending({
        userId,
        sessionId: run.sessionId,
        triggerTurnId: run.triggerTurnId,
        windowHash: run.windowHash,
        includedTurnIds: run.includedTurnIds,
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { runs: unknown[] } };
      
      // Verify response structure has only metadata fields
      const runData = body.data.runs[0] as Record<string, unknown>;
      expect(runData).toHaveProperty('runId');
      expect(runData).toHaveProperty('userId');
      expect(runData).toHaveProperty('windowHash');
      expect(runData).toHaveProperty('status');
      expect(runData).not.toHaveProperty('rawPrompt');
      expect(runData).not.toHaveProperty('transcriptContent');
    });
  });

  describe('POST /api/memory/debug/extract', () => {
    it('should require authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'session-1', turnId: 'turn-1' }),
      });
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing sessionId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ turnId: 'turn-1' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for missing turnId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ sessionId: 'session-1' }),
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ sessionId: 'nonexistent-session', turnId: 'turn-1' }),
      });
      expect(response.status).toBe(404);
    });

    it('should return 404 for other users session', async () => {
      // Create session for other user
      const otherSessionId = 'session-other-user';
      apiContext.stores.sessionStore.create({
        sessionId: otherSessionId,
        userId: 'other-user',
        title: 'Other user session',
        status: 'active',
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ sessionId: otherSessionId, turnId: 'turn-1' }),
      });
      expect(response.status).toBe(404);
    });

it('should trigger extraction for valid session', async () => {
      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({}),
      });
      const sessionBody = await sessionResponse.json() as { data: { session: { sessionId: string } } };
      const sessionId = sessionBody.data.session.sessionId;

      const turnId = `turn-${Date.now()}`;
      rawTranscriptStore.saveTurn({
        turnId,
        sessionId,
        userId,
        input: {
          userMessageSummary: 'Hello world',
        },
        output: {
          visibleMessages: [{ messageId: 'msg-1', role: 'user', content: 'Hello world' }],
        },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      });

      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ sessionId, turnId }),
      });
      
      expect(response.status).toBeLessThan(500);
      
      if (response.status === 200) {
        const body = await response.json() as { data: { status: string; runId?: string } };
        expect(body.data.status).toBeDefined();
      }
    });
  });

  describe('Route ordering: debug routes before :memoryId', () => {
    it('should not treat "debug" as memoryId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extraction-runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('should not treat "extract" as memoryId under debug', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory/debug/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ sessionId: 'test', turnId: 'test' }),
      });
      expect(response.status).toBe(404);
    });
  });
});