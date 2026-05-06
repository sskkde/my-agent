import type { LongTermMemoryStore, LongTermMemoryRecord, MemoryType } from '../storage/long-term-memory-store.js';

export type RecallQuery = {
  userId: string;
  query?: string;
  limit?: number;
  memoryTypes?: MemoryType[];
};

export type RecallMemoryResult = LongTermMemoryRecord & {
  source: 'long_term';
};

export type RecallResult = {
  memories: RecallMemoryResult[];
  total: number;
};

const IMPORTANCE_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface LongTermMemoryRecallService {
  recall(query: RecallQuery): Promise<RecallResult>;
}

class LongTermMemoryRecallServiceImpl implements LongTermMemoryRecallService {
  private store: LongTermMemoryStore;

  constructor(store: LongTermMemoryStore) {
    this.store = store;
  }

  async recall(query: RecallQuery): Promise<RecallResult> {
    const { userId, query: searchQuery, limit = 10, memoryTypes } = query;

    const allMemories = this.store.getByUserId(userId);

    const filtered = allMemories.filter(mem => {
      if (mem.lifecycle.status !== 'active' && mem.lifecycle.status !== 'low_priority') {
        return false;
      }

      if (mem.scope.visibility !== 'private_user') {
        return false;
      }

      if (memoryTypes && memoryTypes.length > 0 && !memoryTypes.includes(mem.memoryType)) {
        return false;
      }

      return true;
    });

    const withLexicalMatch = filtered.map(mem => {
      let hasLexicalMatch = true;

      if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        const contentMatch = mem.content.text.toLowerCase().includes(queryLower);
        const keywordMatch = mem.retrieval.keywords.some(kw => kw.toLowerCase().includes(queryLower));
        hasLexicalMatch = contentMatch || keywordMatch;
      }

      return { ...mem, hasLexicalMatch };
    });

    const matchingOnly = withLexicalMatch.filter(mem => mem.hasLexicalMatch);

    const sorted = matchingOnly.sort((a, b) => {
      if (searchQuery && a.hasLexicalMatch !== b.hasLexicalMatch) {
        return b.hasLexicalMatch ? 1 : -1;
      }

      const importanceA = IMPORTANCE_ORDER[a.importance] ?? 0;
      const importanceB = IMPORTANCE_ORDER[b.importance] ?? 0;
      if (importanceA !== importanceB) {
        return importanceB - importanceA;
      }

      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence;
      }

      const dateA = new Date(a.lifecycle.updatedAt).getTime();
      const dateB = new Date(b.lifecycle.updatedAt).getTime();
      return dateB - dateA;
    });

    const limited = sorted.slice(0, limit);

    for (const mem of limited) {
      const current = this.store.getByMemoryId(mem.memoryId);
      if (current) {
        this.store.applyPatch(mem.memoryId, {
          retrieval: {
            ...current.retrieval,
            recallCount: current.retrieval.recallCount + 1,
            lastRecalledAt: new Date().toISOString(),
          },
        });
      }
    }

    const resultMemories: RecallMemoryResult[] = limited.map(mem => ({
      ...mem,
      source: 'long_term' as const,
    }));

    return {
      memories: resultMemories,
      total: matchingOnly.length,
    };
  }
}

export function createLongTermMemoryRecallService(store: LongTermMemoryStore): LongTermMemoryRecallService {
  return new LongTermMemoryRecallServiceImpl(store);
}