import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createLongTermMemoryStore, type LongTermMemoryStore, type LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';
import { createLongTermMemoryRecallService, type LongTermMemoryRecallService, type RecallQuery } from '../../../src/memory/long-term-memory-recall.js';

describe('Long-term Memory Recall Service', () => {
  let connection: ConnectionManager;
  let store: LongTermMemoryStore;
  let recallService: LongTermMemoryRecallService;

  const createTestMemory = (overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord => ({
    memoryId: `mem-${Date.now()}-${Math.random()}`,
    userId: 'user-123',
    memoryType: 'user_preference',
    content: {
      text: 'User prefers dark mode in all applications',
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
      keywords: ['dark mode', 'preference', 'theme'],
      recallCount: 0,
    },
    ...overrides,
  });

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    store = createLongTermMemoryStore(connection);
    recallService = createLongTermMemoryRecallService(store);
  });

  afterEach(() => {
    connection.close();
  });

  describe('Recall Query', () => {
    it('should return empty array when no memories exist', async () => {
      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should only return memories for the specified user', async () => {
      const mem1 = createTestMemory({ memoryId: 'mem-1', userId: 'user-123' });
      const mem2 = createTestMemory({ memoryId: 'mem-2', userId: 'user-456' });

      store.save(mem1);
      store.save(mem2);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.memoryId).toBe('mem-1');
    });

    it('should only return active and low_priority memories', async () => {
      const active = createTestMemory({
        memoryId: 'mem-active',
        lifecycle: { status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const lowPriority = createTestMemory({
        memoryId: 'mem-low',
        lifecycle: { status: 'low_priority', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const archived = createTestMemory({
        memoryId: 'mem-archived',
        lifecycle: { status: 'archived', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const expired = createTestMemory({
        memoryId: 'mem-expired',
        lifecycle: { status: 'expired', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const superseded = createTestMemory({
        memoryId: 'mem-superseded',
        lifecycle: { status: 'superseded', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });
      const deleted = createTestMemory({
        memoryId: 'mem-deleted',
        lifecycle: { status: 'deleted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      });

      store.save(active);
      store.save(lowPriority);
      store.save(archived);
      store.save(expired);
      store.save(superseded);
      store.save(deleted);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(2);
      const ids = result.memories.map(m => m.memoryId);
      expect(ids).toContain('mem-active');
      expect(ids).toContain('mem-low');
    });

    it('should only return private_user visibility memories', async () => {
      const privateUser = createTestMemory({
        memoryId: 'mem-private',
        scope: { visibility: 'private_user' },
      });
      const workspace = createTestMemory({
        memoryId: 'mem-workspace',
        scope: { visibility: 'workspace' },
      });
      const project = createTestMemory({
        memoryId: 'mem-project',
        scope: { visibility: 'project' },
      });

      store.save(privateUser);
      store.save(workspace);
      store.save(project);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.memoryId).toBe('mem-private');
    });

    it('should filter by memoryTypes when specified', async () => {
      const preference = createTestMemory({
        memoryId: 'mem-pref',
        memoryType: 'user_preference',
      });
      const profile = createTestMemory({
        memoryId: 'mem-profile',
        memoryType: 'user_profile',
      });
      const safety = createTestMemory({
        memoryId: 'mem-safety',
        memoryType: 'user_safety_rule',
      });

      store.save(preference);
      store.save(profile);
      store.save(safety);

      const query: RecallQuery = {
        userId: 'user-123',
        memoryTypes: ['user_preference', 'user_profile'],
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(2);
      const types = result.memories.map(m => m.memoryType);
      expect(types).toContain('user_preference');
      expect(types).toContain('user_profile');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        const mem = createTestMemory({
          memoryId: `mem-${i}`,
          content: { text: `Memory ${i}` },
        });
        store.save(mem);
      }

      const query: RecallQuery = {
        userId: 'user-123',
        limit: 5,
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(5);
      expect(result.total).toBe(10);
    });
  });

  describe('Lexical Search', () => {
    it('should match query against content text', async () => {
      const mem1 = createTestMemory({
        memoryId: 'mem-1',
        content: { text: 'User prefers dark mode for coding' },
      });
      const mem2 = createTestMemory({
        memoryId: 'mem-2',
        content: { text: 'User likes Python programming' },
        retrieval: {
          keywords: ['python', 'programming'],
          recallCount: 0,
        },
      });

      store.save(mem1);
      store.save(mem2);

      const query: RecallQuery = {
        userId: 'user-123',
        query: 'dark mode',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.memoryId).toBe('mem-1');
    });

    it('should match query against retrieval keywords', async () => {
      const mem1 = createTestMemory({
        memoryId: 'mem-1',
        content: { text: 'Some content' },
        retrieval: {
          keywords: ['theme', 'appearance', 'dark'],
          recallCount: 0,
        },
      });
      const mem2 = createTestMemory({
        memoryId: 'mem-2',
        content: { text: 'Other content' },
        retrieval: {
          keywords: ['language', 'python'],
          recallCount: 0,
        },
      });

      store.save(mem1);
      store.save(mem2);

      const query: RecallQuery = {
        userId: 'user-123',
        query: 'theme',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.memoryId).toBe('mem-1');
    });

    it('should return all memories when query is not provided', async () => {
      const mem1 = createTestMemory({ memoryId: 'mem-1' });
      const mem2 = createTestMemory({ memoryId: 'mem-2' });

      store.save(mem1);
      store.save(mem2);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories).toHaveLength(2);
    });
  });

  describe('Sorting', () => {
    it('should sort by lexical match presence first', async () => {
      const matching = createTestMemory({
        memoryId: 'mem-match',
        content: { text: 'User prefers dark mode' },
        importance: 'low',
        confidence: 0.7,
      });
      const nonMatching = createTestMemory({
        memoryId: 'mem-no-match',
        content: { text: 'User likes Python' },
        importance: 'critical',
        confidence: 1.0,
        retrieval: {
          keywords: ['python', 'programming'],
          recallCount: 0,
        },
      });

      store.save(matching);
      store.save(nonMatching);

      const query: RecallQuery = {
        userId: 'user-123',
        query: 'dark mode',
      };

      const result = await recallService.recall(query);

      // Lexical search should only return matching records
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]?.memoryId).toBe('mem-match');
    });

    it('should sort by importance (critical > high > medium > low)', async () => {
      const critical = createTestMemory({
        memoryId: 'mem-critical',
        importance: 'critical',
        confidence: 0.8,
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const high = createTestMemory({
        memoryId: 'mem-high',
        importance: 'high',
        confidence: 0.8,
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const medium = createTestMemory({
        memoryId: 'mem-medium',
        importance: 'medium',
        confidence: 0.8,
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const low = createTestMemory({
        memoryId: 'mem-low',
        importance: 'low',
        confidence: 0.8,
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });

      store.save(critical);
      store.save(high);
      store.save(medium);
      store.save(low);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories[0]?.importance).toBe('critical');
      expect(result.memories[1]?.importance).toBe('high');
      expect(result.memories[2]?.importance).toBe('medium');
      expect(result.memories[3]?.importance).toBe('low');
    });

    it('should sort by confidence when importance is equal', async () => {
      const highConf = createTestMemory({
        memoryId: 'mem-high-conf',
        importance: 'high',
        confidence: 0.95,
      });
      const lowConf = createTestMemory({
        memoryId: 'mem-low-conf',
        importance: 'high',
        confidence: 0.75,
      });

      store.save(highConf);
      store.save(lowConf);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories[0]?.memoryId).toBe('mem-high-conf');
      expect(result.memories[1]?.memoryId).toBe('mem-low-conf');
    });

    it('should sort by updatedAt desc when importance and confidence are equal', async () => {
      const older = createTestMemory({
        memoryId: 'mem-older',
        importance: 'high',
        confidence: 0.9,
        lifecycle: {
          status: 'active',
          createdAt: new Date(Date.now() - 2000).toISOString(),
          updatedAt: new Date(Date.now() - 2000).toISOString(),
        },
      });
      const newer = createTestMemory({
        memoryId: 'mem-newer',
        importance: 'high',
        confidence: 0.9,
        lifecycle: {
          status: 'active',
          createdAt: new Date(Date.now() - 1000).toISOString(),
          updatedAt: new Date(Date.now() - 1000).toISOString(),
        },
      });

      store.save(older);
      store.save(newer);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result.memories[0]?.memoryId).toBe('mem-newer');
      expect(result.memories[1]?.memoryId).toBe('mem-older');
    });
  });

  describe('Recall Metadata Update', () => {
    it('should increment recallCount for returned memories', async () => {
      const mem = createTestMemory({
        memoryId: 'mem-1',
        retrieval: {
          keywords: ['test'],
          recallCount: 5,
        },
      });

      store.save(mem);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      await recallService.recall(query);

      const updated = store.getByMemoryId('mem-1');
      expect(updated?.retrieval.recallCount).toBe(6);
    });

    it('should set lastRecalledAt for returned memories', async () => {
      const mem = createTestMemory({
        memoryId: 'mem-1',
        retrieval: {
          keywords: ['test'],
          recallCount: 0,
        },
      });

      store.save(mem);

      const before = new Date().toISOString();

      const query: RecallQuery = {
        userId: 'user-123',
      };

      await recallService.recall(query);

      const updated = store.getByMemoryId('mem-1');
      expect(updated?.retrieval.lastRecalledAt).toBeDefined();
      expect(new Date(updated!.retrieval.lastRecalledAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it('should update recall metadata for all returned memories', async () => {
      const mem1 = createTestMemory({
        memoryId: 'mem-1',
        retrieval: { keywords: ['test'], recallCount: 0 },
      });
      const mem2 = createTestMemory({
        memoryId: 'mem-2',
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      store.save(mem1);
      store.save(mem2);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      await recallService.recall(query);

      const updated1 = store.getByMemoryId('mem-1');
      const updated2 = store.getByMemoryId('mem-2');

      expect(updated1?.retrieval.recallCount).toBe(1);
      expect(updated1?.retrieval.lastRecalledAt).toBeDefined();
      expect(updated2?.retrieval.recallCount).toBe(1);
      expect(updated2?.retrieval.lastRecalledAt).toBeDefined();
    });
  });

  describe('Result Structure', () => {
    it('should return correct result structure', async () => {
      const mem = createTestMemory({
        memoryId: 'mem-1',
        content: { text: 'Test content' },
      });

      store.save(mem);

      const query: RecallQuery = {
        userId: 'user-123',
      };

      const result = await recallService.recall(query);

      expect(result).toHaveProperty('memories');
      expect(result).toHaveProperty('total');
      expect(result.total).toBe(1);
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]).toHaveProperty('memoryId');
      expect(result.memories[0]).toHaveProperty('userId');
      expect(result.memories[0]).toHaveProperty('memoryType');
      expect(result.memories[0]).toHaveProperty('content');
      expect(result.memories[0]).toHaveProperty('source');
      expect(result.memories[0]?.source).toBe('long_term');
    });
  });
});
