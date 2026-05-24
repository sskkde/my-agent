import type { SummaryStore, SummaryRecord, SourceRefs, SummaryPatch } from '../storage/summary-store.js';
import type {
  SessionMemory,
  SessionMemoryPatch
} from './types.js';
import type { PlannerStatePatch } from '../planner/types.js';
import type { CacheLayer, CacheStats } from './cache-layer.js';
import type { CacheConfig } from './limit-types.js';
import { createCacheLayer } from './cache-layer.js';
import { plannerStateToSessionPatch } from './planner-state-bridge.js';

export type { SessionMemoryManager } from './types.js';

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSizeMb: 64,
  ttlSeconds: 300,
  evictionPolicy: 'lru'
};

const SYSTEM_OWNED_FIELDS = ['summaryId', 'sessionId', 'userId', 'createdAt', 'sourceRefs'] as const;

type SystemOwnedField = typeof SYSTEM_OWNED_FIELDS[number];

type SessionMemoryManagerType = {
  createSessionMemory(sessionId: string, userId: string, sourceRefs: SourceRefs): SessionMemory;
  getSessionMemory(sessionId: string): SessionMemory | null;
  patchSessionMemory(sessionId: string, patch: SessionMemoryPatch): SessionMemory;
  applyPlannerStatePatch(sessionId: string, patch: PlannerStatePatch): SessionMemory;
  invalidateCache(sessionId: string): void;
  getCacheStats(): CacheStats;
};

export function createSessionMemoryManager(
  summaryStore: SummaryStore,
  cacheConfig?: CacheConfig
): SessionMemoryManagerType {
  const cache: CacheLayer = createCacheLayer(cacheConfig ?? DEFAULT_CACHE_CONFIG);

  function sessionKey(sessionId: string): string {
    return `memory:${sessionId}:memory`;
  }

  return {
    createSessionMemory,
    getSessionMemory,
    patchSessionMemory,
    applyPlannerStatePatch,
    invalidateCache,
    getCacheStats
  };

  function createSessionMemory(
    sessionId: string,
    userId: string,
    sourceRefs: SourceRefs
  ): SessionMemory {
    const summaryId = `sm-${sessionId}-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const memory: SessionMemory = {
      summaryId,
      summaryType: 'session_memory',
      userId,
      sessionId,
      sourceRefs,
      summary: '',
      status: 'active',
      createdAt
    };

    summaryStore.save({
      summaryId: memory.summaryId,
      summaryType: memory.summaryType,
      userId: memory.userId,
      sessionId: memory.sessionId,
      sourceRefs: memory.sourceRefs,
      summary: memory.summary,
      status: memory.status,
      createdAt: memory.createdAt
    });

    cache.set(sessionKey(sessionId), memory);

    return memory;
  }

  function getSessionMemory(sessionId: string): SessionMemory | null {
    const cached = cache.get<SessionMemory>(sessionKey(sessionId));
    if (cached) {
      return cached;
    }

    const record = summaryStore.getSessionMemory(sessionId);

    if (!record) {
      return null;
    }

    const memory = recordToSessionMemory(record);
    cache.set(sessionKey(sessionId), memory);
    return memory;
  }

  function patchSessionMemory(
    sessionId: string,
    patch: SessionMemoryPatch
  ): SessionMemory {
    const existing = summaryStore.getSessionMemory(sessionId);

    if (!existing) {
      throw new Error(`Session memory with sessionId "${sessionId}" not found`);
    }

    const sanitizedPatch = sanitizePatch(patch);

    const summaryPatch: SummaryPatch = {
      ...sanitizedPatch,
      updatedAt: new Date().toISOString()
    };

    const updated = summaryStore.applyPatch(existing.summaryId, summaryPatch);

    const memory = recordToSessionMemory(updated);
    cache.set(sessionKey(sessionId), memory);
    return memory;
  }

  function applyPlannerStatePatch(sessionId: string, patch: PlannerStatePatch): SessionMemory {
    const sessionPatch = plannerStateToSessionPatch(patch);
    return patchSessionMemory(sessionId, sessionPatch);
  }

  function invalidateCache(sessionId: string): void {
    cache.delete(sessionKey(sessionId));
  }

  function getCacheStats(): CacheStats {
    return cache.stats();
  }

  function sanitizePatch(patch: SessionMemoryPatch): SummaryPatch {
    const sanitized: SummaryPatch = {};

    for (const [key, value] of Object.entries(patch)) {
      if (!isSystemOwnedField(key)) {
        (sanitized as Record<string, unknown>)[key] = value;
      }
    }

    return sanitized;
  }

  function isSystemOwnedField(field: string): field is SystemOwnedField {
    return SYSTEM_OWNED_FIELDS.includes(field as SystemOwnedField);
  }

  function recordToSessionMemory(record: SummaryRecord): SessionMemory {
    return {
      summaryId: record.summaryId,
      summaryType: 'session_memory',
      userId: record.userId,
      sessionId: record.sessionId!,
      relatedRefs: record.relatedRefs,
      sourceRefs: record.sourceRefs,
      summary: record.summary,
      structuredState: record.structuredState,
      status: record.status,
      retrieval: record.retrieval,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}
