import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js';
import { createLongTermMemoryStore, type LongTermMemoryStore, type LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';
import { createMemoryRetrieveTool, type MemoryRetrieveParams } from '../../../src/tools/builtins/memory-retrieve.js';
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js';

describe('memory.retrieve tool', () => {
  let connection: ConnectionManager;
  let summaryStore: SummaryStore;
  let longTermMemoryStore: LongTermMemoryStore;
  let tool: ToolDefinition;

  const createTestMemory = (overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord => ({
    memoryId: `mem-${Date.now()}-${Math.random()}`,
    userId: 'user-123',
    memoryType: 'user_preference',
    content: {
      text: 'User prefers dark mode',
    },
    sourceRefs: {
      transcriptRefs: ['trans-001'],
    },
    scope: {
      visibility: 'private_user',
    },
    confidence: 0.95,
    importance: 'high',
    sensitivity: 'low',
    lifecycle: {
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    retrieval: {
      keywords: ['dark', 'mode'],
      recallCount: 0,
    },
    ...overrides,
  });

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'memory.retrieve',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-001',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
    ...overrides,
  });

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    summaryStore = createSummaryStore(connection);
    longTermMemoryStore = createLongTermMemoryStore(connection);
    tool = createMemoryRetrieveTool(summaryStore, longTermMemoryStore);
  });

  afterEach(() => {
    connection.close();
  });

  describe('Session Memory', () => {
    it('should retrieve session memory when sessionId is provided', async () => {
      summaryStore.save({
        summaryId: 'session-001',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        summary: 'Session summary text',
        sourceRefs: { transcriptRefs: ['trans-001'] },
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const params: MemoryRetrieveParams = {
        sessionId: 'session-001',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(1);
      expect(data.memories[0]?.source).toBe('session');
    });

    it('should return empty array when session memory does not exist', async () => {
      const params: MemoryRetrieveParams = {
        sessionId: 'session-nonexistent',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(0);
    });
  });

  describe('Long-term Memory', () => {
    it('should retrieve long-term memories when userId is provided', async () => {
      const mem = createTestMemory({ memoryId: 'mem-001' });
      longTermMemoryStore.save(mem);

      const params: MemoryRetrieveParams = {
        userId: 'user-123',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(1);
      expect(data.memories[0]?.source).toBe('long_term');
    });

    it('should use context.userId when userId param is not provided', async () => {
      const mem = createTestMemory({ memoryId: 'mem-001', userId: 'user-123' });
      longTermMemoryStore.save(mem);

      const params: MemoryRetrieveParams = {};

      const context = createToolContext({ userId: 'user-123' });

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(1);
    });

    it('should return USER_MISMATCH error when userId param differs from context.userId', async () => {
      const params: MemoryRetrieveParams = {
        userId: 'user-456',
      };

      const context = createToolContext({ userId: 'user-123' });

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('USER_MISMATCH');
    });

    it('should support query parameter for lexical search', async () => {
      const mem1 = createTestMemory({
        memoryId: 'mem-001',
        content: { text: 'User prefers dark mode' },
      });
      const mem2 = createTestMemory({
        memoryId: 'mem-002',
        content: { text: 'User likes Python' },
        retrieval: { keywords: ['python'], recallCount: 0 },
      });

      longTermMemoryStore.save(mem1);
      longTermMemoryStore.save(mem2);

      const params: MemoryRetrieveParams = {
        userId: 'user-123',
        query: 'dark',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ memoryId: string }> };
      expect(data.memories).toHaveLength(1);
      expect(data.memories[0]?.memoryId).toBe('mem-001');
    });

    it('should support limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        const mem = createTestMemory({ memoryId: `mem-${i}` });
        longTermMemoryStore.save(mem);
      }

      const params: MemoryRetrieveParams = {
        userId: 'user-123',
        limit: 2,
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(2);
    });
  });

  describe('Combined Retrieval', () => {
    it('should retrieve both session and long-term memories', async () => {
      summaryStore.save({
        summaryId: 'session-001',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        summary: 'Session summary',
        sourceRefs: { transcriptRefs: ['trans-001'] },
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const mem = createTestMemory({ memoryId: 'mem-001' });
      longTermMemoryStore.save(mem);

      const params: MemoryRetrieveParams = {
        sessionId: 'session-001',
        userId: 'user-123',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      expect(data.memories).toHaveLength(2);
      const sources = data.memories.map(m => m.source);
      expect(sources).toContain('session');
      expect(sources).toContain('long_term');
    });

    it('should return memories with explicit source field', async () => {
      summaryStore.save({
        summaryId: 'session-001',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        summary: 'Session summary',
        sourceRefs: { transcriptRefs: ['trans-001'] },
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const mem = createTestMemory({ memoryId: 'mem-001' });
      longTermMemoryStore.save(mem);

      const params: MemoryRetrieveParams = {
        sessionId: 'session-001',
        userId: 'user-123',
      };

      const context = createToolContext();

      const result = await tool.handler(params, context);

      expect(result.success).toBe(true);
      const data = result.data as { memories: Array<{ source: string }> };
      for (const memory of data.memories) {
        expect(memory.source).toBeDefined();
        expect(['session', 'long_term']).toContain(memory.source);
      }
    });
  });

  describe('Error Handling', () => {
    it('should return MISSING_PARAMETERS error when neither sessionId nor userId is provided', async () => {
      const params: MemoryRetrieveParams = {};

      const context = createToolContext({ userId: undefined as unknown as string });

      const result = await tool.handler(params, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAMETERS');
    });
  });
});