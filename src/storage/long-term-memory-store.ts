import type { ConnectionManager } from './connection.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

/**
 * Long-term Memory Types
 * Based on architecture doc: LongTermMemoryRecord with lifecycle management
 */

export type MemoryType =
  | 'user_profile'
  | 'user_preference'
  | 'user_safety_rule'
  | 'relationship'
  | 'project_state'
  | 'routine'
  | 'workflow_preference'
  | 'durable_fact'
  | 'episodic_summary'
  | 'long_term_fact';

export type MemoryStatus =
  | 'active'
  | 'low_priority'
  | 'compressed'
  | 'archived'
  | 'expired'
  | 'superseded'
  | 'deleted';

export type Importance = 'low' | 'medium' | 'high' | 'critical';
export type Sensitivity = 'low' | 'medium' | 'high' | 'restricted';
export type Visibility = 'private_user' | 'workspace' | 'project' | 'workflow';

export type MemoryScope = {
  visibility: Visibility;
  projectId?: string;
  workflowId?: string;
  connector?: string;
};

export type MemoryEntity = {
  entityType: 'person' | 'project' | 'workflow' | 'artifact' | 'organization' | 'connector_resource';
  entityId?: string;
  displayName: string;
};

export type MemorySourceRefs = {
  transcriptRefs?: string[];
  summaryRefs?: string[];
  eventRange?: {
    startEventId: string;
    endEventId: string;
  };
  workflowRunId?: string;
  backgroundRunId?: string;
  artifactId?: string;
  extraction?: {
    windowHash: string;
    triggerTurnId: string;
    includedTurnIds: string[];
  };
};

export type MemoryLifecycle = {
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  expiresAt?: string;
  supersededBy?: string;
};

export type MemoryRetrieval = {
  keywords: string[];
  embeddingRef?: string;
  entityIndexRefs?: string[];
  recallCount: number;
  lastRecalledAt?: string;
};

export type LongTermMemoryRecord = {
  memoryId: string;
  userId: string;
  memoryType: MemoryType;
  content: {
    text: string;
    structured?: Record<string, unknown>;
  };
  entities?: MemoryEntity[];
  entityNames?: string[];
  sourceRefs: MemorySourceRefs;
  scope: MemoryScope;
  confidence: number;
  importance: Importance;
  sensitivity: Sensitivity;
  lifecycle: MemoryLifecycle;
  retrieval: MemoryRetrieval;
  fingerprint?: string;
  sourceWindowHash?: string;
};

export type LongTermMemoryPatch = Partial<
  Omit<LongTermMemoryRecord, 'memoryId' | 'userId' | 'createdAt'>
>;

export type TombstoneInput = {
  userId: string;
  fingerprint: string;
  sourceWindowHash: string;
  memoryId?: string;
  reason?: string;
};

export type MemoryTombstone = {
  tombstoneId: string;
  userId: string;
  memoryId: string;
  fingerprint: string;
  sourceWindowHash: string;
  reason: string;
  createdAt: string;
};

export interface LongTermMemoryStore {
  save(record: LongTermMemoryRecord, tenantId?: string): void;
  getByMemoryId(memoryId: string, tenantId?: string): LongTermMemoryRecord | null;
  getByUserId(userId: string, tenantId?: string): LongTermMemoryRecord[];
  getByType(memoryType: MemoryType, tenantId?: string): LongTermMemoryRecord[];
  search(query: string, userId: string, limit?: number, tenantId?: string): LongTermMemoryRecord[];
  delete(memoryId: string, tenantId?: string): void;
  applyPatch(memoryId: string, patch: LongTermMemoryPatch, tenantId?: string): LongTermMemoryRecord;
  findCurrentByFingerprint(userId: string, fingerprint: string, tenantId?: string): LongTermMemoryRecord | null;
  upsertExtracted(record: LongTermMemoryRecord, tenantId?: string): void;
  createTombstone(input: TombstoneInput, tenantId?: string): void;
  getTombstone(memoryId: string, tenantId?: string): MemoryTombstone | null;
  hasTombstone(userId: string, fingerprint: string, sourceWindowHash: string, tenantId?: string): boolean;
  hasTombstoneForSource(userId: string, sourceWindowHash: string, tenantId?: string): boolean;
  searchActive(query: string, userId: string, limit: number, tenantId?: string): LongTermMemoryRecord[];
  getByEntityName(entityName: string, limit?: number, tenantId?: string): LongTermMemoryRecord[];
  getByDateRange(startDate: string, endDate: string, limit?: number, tenantId?: string): LongTermMemoryRecord[];
}

class LongTermMemoryStoreImpl implements LongTermMemoryStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  save(record: LongTermMemoryRecord, tenantId: string = DEFAULT_TENANT_ID): void {
    const lifecycleStatus = record.lifecycle.status;
    const entityNames = record.entities 
      ? JSON.stringify(record.entities.map(e => e.displayName))
      : null;
    
    const sql = `
      INSERT INTO long_term_memories (
        memory_id, user_id, memory_type, content, entities, entity_names, source_refs,
        scope, confidence, importance, sensitivity, lifecycle, retrieval,
        fingerprint, source_window_hash, lifecycle_status, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        user_id = excluded.user_id,
        memory_type = excluded.memory_type,
        content = excluded.content,
        entities = excluded.entities,
        entity_names = excluded.entity_names,
        source_refs = excluded.source_refs,
        scope = excluded.scope,
        confidence = excluded.confidence,
        importance = excluded.importance,
        sensitivity = excluded.sensitivity,
        lifecycle = excluded.lifecycle,
        retrieval = excluded.retrieval,
        fingerprint = excluded.fingerprint,
        source_window_hash = excluded.source_window_hash,
        lifecycle_status = excluded.lifecycle_status,
        tenant_id = excluded.tenant_id
    `;

    this.connection.exec(sql, [
      record.memoryId,
      record.userId,
      record.memoryType,
      JSON.stringify(record.content),
      record.entities ? JSON.stringify(record.entities) : null,
      entityNames,
      JSON.stringify(record.sourceRefs),
      JSON.stringify(record.scope),
      record.confidence,
      record.importance,
      record.sensitivity,
      JSON.stringify(record.lifecycle),
      JSON.stringify(record.retrieval),
      record.fingerprint ?? null,
      record.sourceWindowHash ?? null,
      lifecycleStatus,
      tenantId
    ]);
  }

  getByMemoryId(memoryId: string, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord | null {
    const sql = 'SELECT * FROM long_term_memories WHERE memory_id = ? AND tenant_id = ?';
    const rows = this.connection.query<MemoryRow>(sql, [memoryId, tenantId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  getByUserId(userId: string, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? AND lifecycle_status != 'deleted' AND tenant_id = ?
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
    `;
    const rows = this.connection.query<MemoryRow>(sql, [userId, tenantId]);
    return rows.map(r => this.rowToRecord(r));
  }

  getByType(memoryType: MemoryType, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE memory_type = ? AND lifecycle_status != 'deleted' AND tenant_id = ?
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
    `;
    const rows = this.connection.query<MemoryRow>(sql, [memoryType, tenantId]);
    return rows.map(r => this.rowToRecord(r));
  }

  search(query: string, userId: string, limit: number = 10, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND lifecycle_status != 'deleted'
        AND tenant_id = ?
        AND (
          content LIKE ? 
          OR retrieval LIKE ?
        )
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
      LIMIT ?
    `;
    
    const searchPattern = `%${query}%`;
    const rows = this.connection.query<MemoryRow>(sql, [userId, tenantId, searchPattern, searchPattern, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  delete(memoryId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const existing = this.getByMemoryId(memoryId, tenantId);
    
    if (!existing) {
      throw new Error(`Memory with id "${memoryId}" not found`);
    }

    const updated: LongTermMemoryRecord = {
      ...existing,
      lifecycle: {
        ...existing.lifecycle,
        status: 'deleted',
        updatedAt: new Date().toISOString()
      }
    };

    this.save(updated, tenantId);

    if (existing.fingerprint && existing.sourceWindowHash) {
      this.createTombstone({
        userId: existing.userId,
        fingerprint: existing.fingerprint,
        sourceWindowHash: existing.sourceWindowHash,
        memoryId: existing.memoryId,
        reason: 'user_delete',
      }, tenantId);
    }
  }

  applyPatch(memoryId: string, patch: LongTermMemoryPatch, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord {
    const existing = this.getByMemoryId(memoryId, tenantId);

    if (!existing) {
      throw new Error(`Memory with id "${memoryId}" not found`);
    }

    const updated: LongTermMemoryRecord = {
      ...existing,
      ...patch,
      memoryId: existing.memoryId,
      userId: existing.userId,
      lifecycle: {
        ...existing.lifecycle,
        ...(patch.lifecycle || {}),
        updatedAt: new Date().toISOString()
      }
    };

    this.save(updated, tenantId);

    return updated;
  }

  findCurrentByFingerprint(userId: string, fingerprint: string, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord | null {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND fingerprint = ? 
        AND lifecycle_status = 'active'
        AND tenant_id = ?
      LIMIT 1
    `;
    const rows = this.connection.query<MemoryRow>(sql, [userId, fingerprint, tenantId]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.rowToRecord(rows[0]);
  }

  upsertExtracted(record: LongTermMemoryRecord, tenantId: string = DEFAULT_TENANT_ID): void {
    if (!record.fingerprint) {
      throw new Error('Cannot upsert memory without fingerprint');
    }

    if (
      record.sourceWindowHash &&
      this.hasTombstone(record.userId, record.fingerprint, record.sourceWindowHash, tenantId)
    ) {
      return;
    }

    const current = this.findCurrentByFingerprint(record.userId, record.fingerprint, tenantId);
    
    if (current) {
      this.applyPatch(current.memoryId, {
        lifecycle: {
          ...current.lifecycle,
          status: 'superseded',
          supersededBy: record.memoryId,
        },
      }, tenantId);
    }

    this.save(record, tenantId);
  }

  createTombstone(input: TombstoneInput, tenantId: string = DEFAULT_TENANT_ID): void {
    const tombstoneId = `tombstone-${input.userId}-${input.fingerprint}-${input.sourceWindowHash}`;
    const sql = `
      INSERT OR IGNORE INTO memory_tombstones (
        tombstone_id, user_id, memory_id, fingerprint, source_window_hash, reason, created_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    this.connection.exec(sql, [
      tombstoneId,
      input.userId,
      input.memoryId ?? '',
      input.fingerprint,
      input.sourceWindowHash,
      input.reason ?? '',
      new Date().toISOString(),
      tenantId,
    ]);
  }

  hasTombstone(userId: string, fingerprint: string, sourceWindowHash: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = 'SELECT 1 FROM memory_tombstones WHERE user_id = ? AND fingerprint = ? AND source_window_hash = ? AND tenant_id = ? LIMIT 1';
    const rows = this.connection.query<{ 1: number }>(sql, [userId, fingerprint, sourceWindowHash, tenantId]);
    return rows.length > 0;
  }

  getTombstone(memoryId: string, tenantId: string = DEFAULT_TENANT_ID): MemoryTombstone | null {
    const sql = 'SELECT * FROM memory_tombstones WHERE memory_id = ? AND tenant_id = ? LIMIT 1';
    const rows = this.connection.query<TombstoneRow>(sql, [memoryId, tenantId]);
    if (rows.length === 0) {
      return null;
    }
    return this.rowToTombstone(rows[0]);
  }

  hasTombstoneForSource(userId: string, sourceWindowHash: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = 'SELECT 1 FROM memory_tombstones WHERE user_id = ? AND source_window_hash = ? AND tenant_id = ? LIMIT 1';
    const rows = this.connection.query<{ 1: number }>(sql, [userId, sourceWindowHash, tenantId]);
    return rows.length > 0;
  }

  searchActive(query: string, userId: string, limit: number, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND lifecycle_status = 'active'
        AND tenant_id = ?
        AND (
          content LIKE ? 
          OR retrieval LIKE ?
        )
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
      LIMIT ?
    `;
    
    const searchPattern = `%${query}%`;
    const rows = this.connection.query<MemoryRow>(sql, [userId, tenantId, searchPattern, searchPattern, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  getByEntityName(entityName: string, limit: number = 10, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE entity_names LIKE ? 
        AND lifecycle_status != 'deleted'
        AND tenant_id = ?
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
      LIMIT ?
    `;
    const rows = this.connection.query<MemoryRow>(sql, [`%"${entityName}"%`, tenantId, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  getByDateRange(startDate: string, endDate: string, limit: number = 50, tenantId: string = DEFAULT_TENANT_ID): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE json_extract(lifecycle, '$.createdAt') >= ? 
        AND json_extract(lifecycle, '$.createdAt') <= ?
        AND lifecycle_status != 'deleted'
        AND tenant_id = ?
      ORDER BY json_extract(lifecycle, '$.createdAt') DESC
      LIMIT ?
    `;
    const rows = this.connection.query<MemoryRow>(sql, [startDate, endDate, tenantId, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  private rowToRecord(row: MemoryRow): LongTermMemoryRecord {
    return {
      memoryId: row.memory_id,
      userId: row.user_id,
      memoryType: row.memory_type as MemoryType,
      content: JSON.parse(row.content),
      entities: row.entities ? JSON.parse(row.entities) : undefined,
      entityNames: row.entity_names ? JSON.parse(row.entity_names) : undefined,
      sourceRefs: JSON.parse(row.source_refs) as MemorySourceRefs,
      scope: JSON.parse(row.scope) as MemoryScope,
      confidence: row.confidence,
      importance: row.importance as Importance,
      sensitivity: row.sensitivity as Sensitivity,
      lifecycle: JSON.parse(row.lifecycle) as MemoryLifecycle,
      retrieval: JSON.parse(row.retrieval) as MemoryRetrieval,
      fingerprint: row.fingerprint ?? undefined,
      sourceWindowHash: row.source_window_hash ?? undefined,
    };
  }

  private rowToTombstone(row: TombstoneRow): MemoryTombstone {
    return {
      tombstoneId: row.tombstone_id,
      userId: row.user_id,
      memoryId: row.memory_id,
      fingerprint: row.fingerprint,
      sourceWindowHash: row.source_window_hash,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }
}

type MemoryRow = {
  memory_id: string;
  user_id: string;
  memory_type: string;
  content: string;
  entities: string | null;
  entity_names: string | null;
  source_refs: string;
  scope: string;
  confidence: number;
  importance: string;
  sensitivity: string;
  lifecycle: string;
  retrieval: string;
  fingerprint: string | null;
  source_window_hash: string | null;
  lifecycle_status: string;
};

type TombstoneRow = {
  tombstone_id: string;
  user_id: string;
  memory_id: string;
  fingerprint: string;
  source_window_hash: string;
  reason: string;
  created_at: string;
};

export function createLongTermMemoryStore(connection: ConnectionManager): LongTermMemoryStore {
  return new LongTermMemoryStoreImpl(connection);
}

export function createLongTermMemoryMigration() {
  return {
    version: 9,
    name: 'create_long_term_memories_table',
    up: `
      CREATE TABLE IF NOT EXISTS long_term_memories (
        memory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        entities TEXT,
        source_refs TEXT NOT NULL,
        scope TEXT NOT NULL,
        confidence REAL NOT NULL,
        importance TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        retrieval TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_long_term_memories_user_status
        ON long_term_memories(user_id, json_extract(lifecycle, '$.status'));

      CREATE INDEX IF NOT EXISTS idx_long_term_memories_type
        ON long_term_memories(memory_type);

      CREATE INDEX IF NOT EXISTS idx_long_term_memories_importance
        ON long_term_memories(importance);

      CREATE INDEX IF NOT EXISTS idx_long_term_memories_updated
        ON long_term_memories(json_extract(lifecycle, '$.updatedAt'));
    `,
    down: `
      DROP INDEX IF EXISTS idx_long_term_memories_user_status;
      DROP INDEX IF EXISTS idx_long_term_memories_type;
      DROP INDEX IF EXISTS idx_long_term_memories_importance;
      DROP INDEX IF EXISTS idx_long_term_memories_updated;
      DROP TABLE IF EXISTS long_term_memories;
    `
  };
}
