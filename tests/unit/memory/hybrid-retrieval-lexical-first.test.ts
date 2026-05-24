import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LongTermMemoryRecallService, RecallResult, RecallMemoryResult } from '../../../src/memory/long-term-memory-recall.js';
import type { LongTermMemoryStore, LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';
import {
  LexicalRetrievalStrategy,
  HybridRetrievalOrchestrator,
  NoOpVectorBackend,
  isHybridRetrievalEnabled,
  type RetrievalStrategy,
} from '../../../src/memory/hybrid-retrieval.js';
import type { HybridRecallItem } from '../../../src/memory/hybrid-retrieval-types.js';

function makeMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  return {
    memoryId: 'mem-1',
    userId: 'user-1',
    memoryType: 'user_preference',
    content: { text: 'prefers dark mode' },
    sourceRefs: { transcriptRefs: ['t-1'] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    retrieval: { keywords: ['dark mode'], recallCount: 0 },
    ...overrides,
  };
}

function makeRecallService(memories: LongTermMemoryRecord[] = [], total?: number): LongTermMemoryRecallService {
  const recallMemories: RecallMemoryResult[] = memories.map(m => ({ ...m, source: 'long_term' as const }));
  return {
    recall: vi.fn().mockResolvedValue({
      memories: recallMemories,
      total: total ?? memories.length,
    } satisfies RecallResult),
    recallByMetadata: vi.fn().mockResolvedValue(recallMemories),
  };
}

function makeMockStore(overrides: Partial<LongTermMemoryStore> = {}): LongTermMemoryStore {
  return {
    save: vi.fn(),
    getByMemoryId: vi.fn().mockReturnValue(null),
    getByUserId: vi.fn().mockReturnValue([]),
    getByType: vi.fn().mockReturnValue([]),
    search: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
    applyPatch: vi.fn(),
    findCurrentByFingerprint: vi.fn().mockReturnValue(null),
    upsertExtracted: vi.fn(),
    createTombstone: vi.fn(),
    getTombstone: vi.fn().mockReturnValue(null),
    hasTombstone: vi.fn().mockReturnValue(false),
    hasTombstoneForSource: vi.fn().mockReturnValue(false),
    searchActive: vi.fn().mockReturnValue([]),
    getByEntityName: vi.fn().mockReturnValue([]),
    getByDateRange: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

describe('PM-18: Lexical-first + Vector Fallback + Entity/Time Index', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.HYBRID_RETRIEVAL_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HYBRID_RETRIEVAL_ENABLED;
    } else {
      process.env.HYBRID_RETRIEVAL_ENABLED = originalEnv;
    }
  });

  describe('Lexical-first returns results when lexical sufficient', () => {
    it('returns all lexical items without calling vector when minResults met', async () => {
      const memories = Array.from({ length: 6 }, (_, i) =>
        makeMemory({ memoryId: `mem-${i}`, fingerprint: `fp-${i}`, importance: 'high' })
      );
      const service = makeRecallService(memories, 6);
      const lexical = new LexicalRetrievalStrategy(service);

      const mockVector: RetrievalStrategy = {
        type: 'vector',
        recall: vi.fn(),
      };

      const orchestrator = new HybridRetrievalOrchestrator([lexical, mockVector]);

      const result = await orchestrator.recall({ userId: 'user-1', minResults: 5 });

      expect(result.items).toHaveLength(6);
      expect(result.sources).toEqual(['lexical']);
      expect(mockVector.recall).not.toHaveBeenCalled();
    });
  });

  describe('Vector fallback when lexical insufficient', () => {
    it('queries vector backend and merges results when lexical < minResults', async () => {
      const mem = makeMemory({ fingerprint: 'fp-1', importance: 'high' });
      const service = makeRecallService([mem], 1);
      const lexical = new LexicalRetrievalStrategy(service);

      const vectorItem: HybridRecallItem = {
        memory: makeMemory({ memoryId: 'mem-v1', fingerprint: 'fp-v1', importance: 'medium' }),
        source: 'vector',
        relevanceScore: 0.5,
        fingerprint: 'fp-v1',
      };
      const mockVector: RetrievalStrategy = {
        type: 'vector',
        recall: vi.fn().mockResolvedValue({ items: [vectorItem], total: 1, sources: ['vector'] }),
      };

      const orchestrator = new HybridRetrievalOrchestrator([lexical, mockVector]);

      const result = await orchestrator.recall({ userId: 'user-1', minResults: 5 });

      expect(mockVector.recall).toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
      expect(result.sources).toContain('lexical');
      expect(result.sources).toContain('vector');
    });

    it('deduplicates by fingerprint — lexical takes priority over vector', async () => {
      const mem = makeMemory({ fingerprint: 'fp-dup', importance: 'high' });
      const service = makeRecallService([mem], 1);
      const lexical = new LexicalRetrievalStrategy(service);

      const vectorItem: HybridRecallItem = {
        memory: makeMemory({ memoryId: 'mem-v-dup', fingerprint: 'fp-dup', importance: 'low' }),
        source: 'vector',
        relevanceScore: 0.3,
        fingerprint: 'fp-dup',
      };
      const mockVector: RetrievalStrategy = {
        type: 'vector',
        recall: vi.fn().mockResolvedValue({ items: [vectorItem], total: 1, sources: ['vector'] }),
      };

      const orchestrator = new HybridRetrievalOrchestrator([lexical, mockVector]);

      const result = await orchestrator.recall({ userId: 'user-1', minResults: 5 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.source).toBe('lexical');
      expect(result.items[0]?.relevanceScore).toBe(0.8);
    });
  });

  describe('NoOpVectorBackend', () => {
    it('returns empty array from query', async () => {
      const backend = new NoOpVectorBackend();
      const result = await backend.query('user-1', []);
      expect(result).toEqual([]);
    });

    it('index and delete are no-ops', async () => {
      const backend = new NoOpVectorBackend();
      await expect(backend.index(makeMemory())).resolves.toBeUndefined();
      await expect(backend.delete('mem-1')).resolves.toBeUndefined();
    });
  });

  describe('Entity name query via store', () => {
    it('merges entity index results with lexical results when flag ON', async () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';

      const lexicalMem = makeMemory({ memoryId: 'mem-lex', fingerprint: 'fp-lex', importance: 'high' });
      const service = makeRecallService([lexicalMem], 1);
      const lexical = new LexicalRetrievalStrategy(service);

      const entityMem = makeMemory({
        memoryId: 'mem-entity',
        fingerprint: 'fp-entity',
        importance: 'medium',
        entities: [{ entityType: 'person' as const, displayName: 'Alice' }],
      });

      const store = makeMockStore({
        getByEntityName: vi.fn().mockReturnValue([entityMem]),
      });

      const orchestrator = new HybridRetrievalOrchestrator([lexical], store);

      const result = await orchestrator.recall({
        userId: 'user-1',
        entityNames: ['Alice'],
        minResults: 5,
      });

      expect(store.getByEntityName).toHaveBeenCalledWith('Alice');
      expect(result.items).toHaveLength(2);
      const entityItem = result.items.find(i => i.fingerprint === 'fp-entity');
      expect(entityItem).toBeDefined();
    });
  });

  describe('Date range query via store', () => {
    it('merges date range results with lexical results when flag ON', async () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';

      const lexicalMem = makeMemory({ memoryId: 'mem-lex', fingerprint: 'fp-lex', importance: 'high' });
      const service = makeRecallService([lexicalMem], 1);
      const lexical = new LexicalRetrievalStrategy(service);

      const dateMem = makeMemory({
        memoryId: 'mem-date',
        fingerprint: 'fp-date',
        importance: 'low',
        lifecycle: { status: 'active', createdAt: '2025-03-15T00:00:00Z', updatedAt: '2025-03-15T00:00:00Z' },
      });

      const store = makeMockStore({
        getByDateRange: vi.fn().mockReturnValue([dateMem]),
      });

      const orchestrator = new HybridRetrievalOrchestrator([lexical], store);

      const result = await orchestrator.recall({
        userId: 'user-1',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        minResults: 5,
      });

      expect(store.getByDateRange).toHaveBeenCalledWith('2025-03-01T00:00:00Z', '2025-03-31T23:59:59Z');
      expect(result.items).toHaveLength(2);
      const dateItem = result.items.find(i => i.fingerprint === 'fp-date');
      expect(dateItem).toBeDefined();
    });
  });

  describe('Entity match boosts relevanceScore', () => {
    it('adds 0.1 boost to entity/time matched items', async () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';

      const service = makeRecallService([], 0);
      const lexical = new LexicalRetrievalStrategy(service);

      const entityMem = makeMemory({
        memoryId: 'mem-entity',
        fingerprint: 'fp-entity',
        importance: 'medium',
      });

      const store = makeMockStore({
        getByEntityName: vi.fn().mockReturnValue([entityMem]),
      });

      const orchestrator = new HybridRetrievalOrchestrator([lexical], store);

      const result = await orchestrator.recall({
        userId: 'user-1',
        entityNames: ['Alice'],
      });

      const entityItem = result.items.find(i => i.fingerprint === 'fp-entity');
      expect(entityItem?.relevanceScore).toBe(0.6);
    });
  });

  describe('Feature flag OFF behavior', () => {
    it('does not query entity/time indexes when HYBRID_RETRIEVAL_ENABLED is false', async () => {
      delete process.env.HYBRID_RETRIEVAL_ENABLED;

      const service = makeRecallService([], 0);
      const lexical = new LexicalRetrievalStrategy(service);

      const store = makeMockStore({
        getByEntityName: vi.fn().mockReturnValue([makeMemory()]),
        getByDateRange: vi.fn().mockReturnValue([makeMemory()]),
      });

      const orchestrator = new HybridRetrievalOrchestrator([lexical], store);

      await orchestrator.recall({
        userId: 'user-1',
        entityNames: ['Alice'],
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      });

      expect(store.getByEntityName).not.toHaveBeenCalled();
      expect(store.getByDateRange).not.toHaveBeenCalled();
    });

    it('isHybridRetrievalEnabled returns false by default', () => {
      delete process.env.HYBRID_RETRIEVAL_ENABLED;
      expect(isHybridRetrievalEnabled()).toBe(false);
    });

    it('isHybridRetrievalEnabled returns true when env set to "true"', () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';
      expect(isHybridRetrievalEnabled()).toBe(true);
    });
  });

  describe('Empty store gracefully handled', () => {
    it('works without store — no entity/time queries', async () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';

      const memories = Array.from({ length: 3 }, (_, i) =>
        makeMemory({ memoryId: `mem-${i}`, fingerprint: `fp-${i}`, importance: 'high' })
      );
      const service = makeRecallService(memories, 3);
      const lexical = new LexicalRetrievalStrategy(service);

      const orchestrator = new HybridRetrievalOrchestrator([lexical]);

      const result = await orchestrator.recall({
        userId: 'user-1',
        entityNames: ['Alice'],
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      });

      expect(result.items).toHaveLength(3);
      expect(result.sources).toEqual(['lexical']);
    });

    it('works with undefined store — no crash', async () => {
      process.env.HYBRID_RETRIEVAL_ENABLED = 'true';

      const service = makeRecallService([], 0);
      const lexical = new LexicalRetrievalStrategy(service);

      const orchestrator = new HybridRetrievalOrchestrator([lexical], undefined);

      const result = await orchestrator.recall({
        userId: 'user-1',
        entityNames: ['Alice'],
      });

      expect(result.items).toHaveLength(0);
    });
  });
});
