import { describe, it, expect, vi } from 'vitest';
import type { LongTermMemoryRecallService, RecallResult, RecallMemoryResult } from '../../../src/memory/long-term-memory-recall.js';
import type { LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';
import {
  LexicalRetrievalStrategy,
  VectorRetrievalStrategy,
  HybridRetrievalOrchestrator,
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

describe('LexicalRetrievalStrategy', () => {
  it('returns items with correct source and relevanceScore', async () => {
    const mem = makeMemory({ importance: 'high', fingerprint: 'fp-1' });
    const service = makeRecallService([mem]);
    const strategy = new LexicalRetrievalStrategy(service);

    const result = await strategy.recall({ userId: 'user-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source).toBe('lexical');
    expect(result.items[0]?.relevanceScore).toBe(0.8);
    expect(result.items[0]?.fingerprint).toBe('fp-1');
    expect(result.items[0]?.memory.memoryId).toBe('mem-1');
    expect(result.sources).toEqual(['lexical']);
  });

  it('maps importance to relevanceScore correctly', async () => {
    const cases: Array<{ importance: LongTermMemoryRecord['importance']; expected: number }> = [
      { importance: 'critical', expected: 1.0 },
      { importance: 'high', expected: 0.8 },
      { importance: 'medium', expected: 0.5 },
      { importance: 'low', expected: 0.3 },
    ];

    for (const { importance, expected } of cases) {
      const mem = makeMemory({ memoryId: `mem-${importance}`, importance });
      const service = makeRecallService([mem]);
      const strategy = new LexicalRetrievalStrategy(service);

      const result = await strategy.recall({ userId: 'user-1' });
      expect(result.items[0]?.relevanceScore).toBe(expected);
    }
  });

  it('uses memoryId as fingerprint when fingerprint is undefined', async () => {
    const mem = makeMemory({ fingerprint: undefined });
    const service = makeRecallService([mem]);
    const strategy = new LexicalRetrievalStrategy(service);

    const result = await strategy.recall({ userId: 'user-1' });
    expect(result.items[0]?.fingerprint).toBe('mem-1');
  });

  it('returns empty sources when no items found', async () => {
    const service = makeRecallService([]);
    const strategy = new LexicalRetrievalStrategy(service);

    const result = await strategy.recall({ userId: 'user-1' });
    expect(result.items).toHaveLength(0);
    expect(result.sources).toEqual([]);
  });

  it('passes query fields to recallService', async () => {
    const service = makeRecallService([]);
    const strategy = new LexicalRetrievalStrategy(service);

    await strategy.recall({ userId: 'user-1', query: 'dark', limit: 5, memoryTypes: ['user_preference'] });

    expect(service.recall).toHaveBeenCalledWith({
      userId: 'user-1',
      query: 'dark',
      limit: 5,
      memoryTypes: ['user_preference'],
      filters: undefined,
    });
  });
});

describe('VectorRetrievalStrategy', () => {
  it('returns empty results (NoOp)', async () => {
    const strategy = new VectorRetrievalStrategy();
    const result = await strategy.recall({ userId: 'user-1' });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.sources).toEqual([]);
  });

  it('has type "vector"', () => {
    const strategy = new VectorRetrievalStrategy();
    expect(strategy.type).toBe('vector');
  });
});

describe('HybridRetrievalOrchestrator', () => {
  it('returns empty when no lexical strategy provided', async () => {
    const orchestrator = new HybridRetrievalOrchestrator([]);
    const result = await orchestrator.recall({ userId: 'user-1' });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.sources).toEqual([]);
  });

  it('returns lexical-only results when enough items found', async () => {
    const memories = Array.from({ length: 6 }, (_, i) =>
      makeMemory({ memoryId: `mem-${i}`, fingerprint: `fp-${i}`, importance: 'high' })
    );
    const service = makeRecallService(memories, 6);
    const lexical = new LexicalRetrievalStrategy(service);
    const vector = new VectorRetrievalStrategy();
    const orchestrator = new HybridRetrievalOrchestrator([lexical, vector]);

    const result = await orchestrator.recall({ userId: 'user-1', minResults: 5 });

    expect(result.items).toHaveLength(6);
    expect(result.sources).toEqual(['lexical']);
  });

  it('falls back to vector when lexical returns fewer than minResults', async () => {
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

  it('deduplicates by fingerprint — lexical takes priority', async () => {
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

  it('sorts results by relevanceScore descending', async () => {
    const low = makeMemory({ memoryId: 'mem-low', fingerprint: 'fp-low', importance: 'low' });
    const critical = makeMemory({ memoryId: 'mem-crit', fingerprint: 'fp-crit', importance: 'critical' });
    const service = makeRecallService([low, critical], 2);
    const lexical = new LexicalRetrievalStrategy(service);
    const orchestrator = new HybridRetrievalOrchestrator([lexical]);

    const result = await orchestrator.recall({ userId: 'user-1' });

    expect(result.items[0]?.fingerprint).toBe('fp-crit');
    expect(result.items[1]?.fingerprint).toBe('fp-low');
  });

  it('applies limit to results', async () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ memoryId: `mem-${i}`, fingerprint: `fp-${i}`, importance: 'high' })
    );
    const service = makeRecallService(memories, 10);
    const lexical = new LexicalRetrievalStrategy(service);
    const orchestrator = new HybridRetrievalOrchestrator([lexical]);

    const result = await orchestrator.recall({ userId: 'user-1', limit: 3 });

    expect(result.items).toHaveLength(3);
  });

  it('defaults limit to 10 when not specified', async () => {
    const memories = Array.from({ length: 15 }, (_, i) =>
      makeMemory({ memoryId: `mem-${i}`, fingerprint: `fp-${i}`, importance: 'high' })
    );
    const service = makeRecallService(memories, 15);
    const lexical = new LexicalRetrievalStrategy(service);
    const orchestrator = new HybridRetrievalOrchestrator([lexical]);

    const result = await orchestrator.recall({ userId: 'user-1' });

    expect(result.items).toHaveLength(10);
  });

  it('does not call vector when lexical meets minResults', async () => {
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

    await orchestrator.recall({ userId: 'user-1', minResults: 5 });

    expect(mockVector.recall).not.toHaveBeenCalled();
  });
});
