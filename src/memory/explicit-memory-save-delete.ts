import { randomUUID } from 'crypto';
import type {
  Importance,
  LongTermMemoryRecord,
  LongTermMemoryStore,
  MemoryEntity,
  MemorySourceRefs,
  MemoryStatus,
  MemoryTombstone,
  MemoryType,
  Sensitivity,
} from '../storage/long-term-memory-store.js';
import { stableJsonHash } from './long-term-memory-extraction.js';

export type TimeAnchor = {
  label: string;
  value: string;
};

export type ExplicitMemoryMetadata = {
  memoryType?: MemoryType;
  structured?: Record<string, unknown>;
  confidence?: number;
  importance?: Importance;
  sensitivity?: Sensitivity;
  keywords?: string[];
  entities?: MemoryEntity[];
  timeAnchors?: TimeAnchor[];
  sourceFingerprint?: string;
  sourceWindowHash?: string;
  expiresAt?: string;
};

export type ExplicitMemoryService = {
  saveMemory(
    userId: string,
    content: string,
    metadata: ExplicitMemoryMetadata,
    sourceRefs: MemorySourceRefs
  ): LongTermMemoryRecord;
  deleteMemory(memoryId: string): void;
  getTombstone(memoryId: string): MemoryTombstone | null;
};

export function createExplicitMemoryService(store: LongTermMemoryStore): ExplicitMemoryService {
  return {
    saveMemory(userId, content, metadata, sourceRefs) {
      validateSourceRefs(sourceRefs);

      const sourceWindowHash = metadata.sourceWindowHash ?? computeSourceWindowHash(userId, sourceRefs);
      const fingerprint = metadata.sourceFingerprint ?? computeExplicitFingerprint(userId, content, sourceRefs);

      if (store.hasTombstone(userId, fingerprint, sourceWindowHash) || store.hasTombstoneForSource(userId, sourceWindowHash)) {
        throw new Error('Memory source is tombstoned and cannot be re-ingested');
      }

      const now = new Date().toISOString();
      const keywords = normalizeKeywords(metadata.keywords ?? extractKeywords(content));

      const record: LongTermMemoryRecord = {
        memoryId: `mem-${randomUUID()}`,
        userId,
        memoryType: metadata.memoryType ?? 'user_preference',
        content: {
          text: content,
          structured: {
            ...(metadata.structured ?? {}),
            ...(metadata.timeAnchors ? { timeAnchors: metadata.timeAnchors } : {}),
          },
        },
        entities: metadata.entities,
        sourceRefs,
        scope: { visibility: 'private_user' },
        confidence: metadata.confidence ?? 1,
        importance: metadata.importance ?? 'medium',
        sensitivity: metadata.sensitivity ?? 'low',
        lifecycle: {
          status: 'active',
          createdAt: now,
          updatedAt: now,
          expiresAt: metadata.expiresAt,
        },
        retrieval: {
          keywords,
          recallCount: 0,
        },
        fingerprint,
        sourceWindowHash,
      };

      store.save(record);
      return record;
    },

    deleteMemory(memoryId) {
      store.delete(memoryId);
    },

    getTombstone(memoryId) {
      return store.getTombstone(memoryId);
    },
  };
}

export type LifecyclePolicyConfig = {
  activeTtlMs: number;
  lowPriorityTtlMs: number;
  lowPriorityTarget: Extract<MemoryStatus, 'compressed' | 'archived' | 'deleted'>;
  now?: Date;
};

export type LifecycleTransition = {
  memoryId: string;
  from: MemoryStatus;
  to: MemoryStatus;
};

export function applyDeterministicLifecyclePolicy(
  store: LongTermMemoryStore,
  userId: string,
  config: LifecyclePolicyConfig
): LifecycleTransition[] {
  const nowMs = config.now?.getTime() ?? Date.now();
  const transitions: LifecycleTransition[] = [];

  for (const memory of store.getByUserId(userId)) {
    const basis = memory.lifecycle.lastAccessedAt ?? memory.lifecycle.updatedAt ?? memory.lifecycle.createdAt;
    const ageMs = nowMs - new Date(basis).getTime();
    let nextStatus: MemoryStatus | null = null;

    if (memory.lifecycle.status === 'active' && ageMs >= config.activeTtlMs) {
      nextStatus = 'low_priority';
    } else if (memory.lifecycle.status === 'low_priority' && ageMs >= config.lowPriorityTtlMs) {
      nextStatus = config.lowPriorityTarget;
    }

    if (!nextStatus) continue;

    store.applyPatch(memory.memoryId, {
      lifecycle: {
        ...memory.lifecycle,
        status: nextStatus,
        updatedAt: config.now?.toISOString() ?? new Date().toISOString(),
      },
    });

    transitions.push({ memoryId: memory.memoryId, from: memory.lifecycle.status, to: nextStatus });
  }

  return transitions.sort((a, b) => a.memoryId.localeCompare(b.memoryId));
}

function validateSourceRefs(sourceRefs: MemorySourceRefs): void {
  const hasTranscriptRefs = Array.isArray(sourceRefs.transcriptRefs) && sourceRefs.transcriptRefs.length > 0;
  const hasSummaryRefs = Array.isArray(sourceRefs.summaryRefs) && sourceRefs.summaryRefs.length > 0;
  const hasEventRange = Boolean(sourceRefs.eventRange?.startEventId && sourceRefs.eventRange.endEventId);
  const hasOtherRef = Boolean(sourceRefs.workflowRunId || sourceRefs.backgroundRunId || sourceRefs.artifactId || sourceRefs.extraction?.windowHash);

  if (!hasTranscriptRefs && !hasSummaryRefs && !hasEventRange && !hasOtherRef) {
    throw new Error('sourceRefs must contain at least one concrete source reference');
  }
}

function computeSourceWindowHash(userId: string, sourceRefs: MemorySourceRefs): string {
  return stableJsonHash({ userId, sourceRefs });
}

function computeExplicitFingerprint(userId: string, content: string, sourceRefs: MemorySourceRefs): string {
  return stableJsonHash({ userId, content: content.trim().toLowerCase(), sourceRefs });
}

function extractKeywords(content: string): string[] {
  return content
    .split(/[^\p{L}\p{N}]+/u)
    .map(token => token.trim())
    .filter(token => token.length > 2);
}

function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}
