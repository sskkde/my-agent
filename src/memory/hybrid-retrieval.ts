import type { LongTermMemoryRecallService, RecallQuery } from './long-term-memory-recall.js';
import type { LongTermMemoryStore, LongTermMemoryRecord, Importance } from '../storage/long-term-memory-store.js';
import type {
  RetrievalStrategyType,
  HybridRecallQuery,
  HybridRecallItem,
  HybridRecallResult,
} from './hybrid-retrieval-types.js';

const IMPORTANCE_SCORE: Record<Importance, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
};

const ENTITY_MATCH_BOOST = 0.1;

export function isHybridRetrievalEnabled(): boolean {
  return process.env.HYBRID_RETRIEVAL_ENABLED === 'true';
}

export interface VectorRetrievalBackend {
  query(userId: string, embedding: Float32Array | number[], limit?: number, tenantId?: string): Promise<{ memoryId: string; score: number }[]>;
  index(record: LongTermMemoryRecord, embedding?: Float32Array | number[]): Promise<void>;
  delete(memoryId: string): Promise<void>;
}

export class NoOpVectorBackend implements VectorRetrievalBackend {
  async query(_userId: string, _embedding: Float32Array | number[], _limit?: number, _tenantId?: string): Promise<{ memoryId: string; score: number }[]> { return []; }
  async index(_record: LongTermMemoryRecord, _embedding?: Float32Array | number[]): Promise<void> {}
  async delete(_memoryId: string): Promise<void> {}
}

export interface RetrievalStrategy {
  readonly type: RetrievalStrategyType;
  recall(query: HybridRecallQuery): Promise<HybridRecallResult>;
}

export class LexicalRetrievalStrategy implements RetrievalStrategy {
  readonly type = 'lexical' as const;

  constructor(private recallService: LongTermMemoryRecallService) {}

  async recall(query: HybridRecallQuery): Promise<HybridRecallResult> {
    const recallQuery: RecallQuery = {
      userId: query.userId,
      query: query.query,
      limit: query.limit,
      memoryTypes: query.memoryTypes,
      filters: query.filters,
    };

    const result = await this.recallService.recall(recallQuery);

    const items: HybridRecallItem[] = result.memories.map(mem => ({
      memory: mem,
      source: 'lexical' as const,
      relevanceScore: IMPORTANCE_SCORE[mem.importance] ?? 0.3,
      fingerprint: mem.fingerprint ?? mem.memoryId,
    }));

    return {
      items,
      total: result.total,
      sources: items.length > 0 ? ['lexical'] : [],
    };
  }
}

export class VectorRetrievalStrategy implements RetrievalStrategy {
  readonly type = 'vector' as const;

  async recall(_query: HybridRecallQuery): Promise<HybridRecallResult> {
    return { items: [], total: 0, sources: [] };
  }
}

const DEFAULT_MIN_RESULTS = 5;
const DEFAULT_LIMIT = 10;

export class HybridRetrievalOrchestrator {
  constructor(
    private strategies: RetrievalStrategy[],
    private store?: LongTermMemoryStore,
  ) {}

  async recall(query: HybridRecallQuery): Promise<HybridRecallResult> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const minResults = query.minResults ?? DEFAULT_MIN_RESULTS;

    const lexical = this.strategies.find(s => s.type === 'lexical');
    const vector = this.strategies.find(s => s.type === 'vector');

    if (!lexical) {
      return { items: [], total: 0, sources: [] };
    }

    const lexicalResult = await lexical.recall(query);

    const indexItems = isHybridRetrievalEnabled()
      ? this.queryEntityTimeIndexes(query)
      : [];

    const mergedWithIndex = mergeResults(lexicalResult.items, indexItems);

    if (mergedWithIndex.length >= minResults || !vector) {
      const limited = mergedWithIndex
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
      return {
        items: limited,
        total: limited.length,
        sources: buildSources(mergedWithIndex),
      };
    }

    const vectorResult = await vector.recall(query);

    const merged = mergeResults(mergedWithIndex, vectorResult.items);
    const limited = merged
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    return {
      items: limited,
      total: limited.length,
      sources: buildSources(merged),
    };
  }

  private queryEntityTimeIndexes(query: HybridRecallQuery): HybridRecallItem[] {
    if (!this.store) return [];

    const indexItems: HybridRecallItem[] = [];
    const seenFingerprints = new Set<string>();

    const addIndexRecords = (records: LongTermMemoryRecord[], source: 'entity' | 'time') => {
      for (const record of records) {
        const fp = record.fingerprint ?? record.memoryId;
        if (seenFingerprints.has(fp)) continue;
        seenFingerprints.add(fp);

        const baseScore = IMPORTANCE_SCORE[record.importance] ?? 0.3;
        indexItems.push({
          memory: record,
          source: source === 'entity' ? 'lexical' : 'lexical',
          relevanceScore: baseScore + ENTITY_MATCH_BOOST,
          fingerprint: fp,
        });
      }
    };

    if (query.entityNames && query.entityNames.length > 0) {
      for (const entityName of query.entityNames) {
        const records = this.store.getByEntityName(entityName);
        addIndexRecords(records, 'entity');
      }
    }

    if (query.startDate && query.endDate) {
      const records = this.store.getByDateRange(query.startDate, query.endDate);
      addIndexRecords(records, 'time');
    }

    return indexItems;
  }
}

function mergeResults(
  primaryItems: HybridRecallItem[],
  secondaryItems: HybridRecallItem[],
): HybridRecallItem[] {
  const seen = new Map<string, HybridRecallItem>();

  for (const item of primaryItems) {
    seen.set(item.fingerprint, item);
  }

  for (const item of secondaryItems) {
    if (!seen.has(item.fingerprint)) {
      seen.set(item.fingerprint, item);
    }
  }

  return [...seen.values()];
}

function buildSources(items: HybridRecallItem[]): RetrievalStrategyType[] {
  const sources: RetrievalStrategyType[] = [];
  if (items.some(i => i.source === 'lexical')) sources.push('lexical');
  if (items.some(i => i.source === 'vector')) sources.push('vector');
  return sources;
}
