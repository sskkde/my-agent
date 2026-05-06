import type { ConnectionManager } from './connection.js';

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
  | 'episodic_summary';

export type MemoryStatus =
  | 'active'
  | 'low_priority'
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
};

export interface LongTermMemoryStore {
  save(record: LongTermMemoryRecord): void;
  getByMemoryId(memoryId: string): LongTermMemoryRecord | null;
  getByUserId(userId: string): LongTermMemoryRecord[];
  getByType(memoryType: MemoryType): LongTermMemoryRecord[];
  search(query: string, userId: string, limit?: number): LongTermMemoryRecord[];
  delete(memoryId: string): void;
  applyPatch(memoryId: string, patch: LongTermMemoryPatch): LongTermMemoryRecord;
  findCurrentByFingerprint(userId: string, fingerprint: string): LongTermMemoryRecord | null;
  upsertExtracted(record: LongTermMemoryRecord): void;
  createTombstone(input: TombstoneInput): void;
  hasTombstone(userId: string, fingerprint: string, sourceWindowHash: string): boolean;
  searchActive(query: string, userId: string, limit: number): LongTermMemoryRecord[];
}

class LongTermMemoryStoreImpl implements LongTermMemoryStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  save(record: LongTermMemoryRecord): void {
    const lifecycleStatus = record.lifecycle.status;
    
    const sql = `
      INSERT INTO long_term_memories (
        memory_id, user_id, memory_type, content, entities, source_refs,
        scope, confidence, importance, sensitivity, lifecycle, retrieval,
        fingerprint, source_window_hash, lifecycle_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        user_id = excluded.user_id,
        memory_type = excluded.memory_type,
        content = excluded.content,
        entities = excluded.entities,
        source_refs = excluded.source_refs,
        scope = excluded.scope,
        confidence = excluded.confidence,
        importance = excluded.importance,
        sensitivity = excluded.sensitivity,
        lifecycle = excluded.lifecycle,
        retrieval = excluded.retrieval,
        fingerprint = excluded.fingerprint,
        source_window_hash = excluded.source_window_hash,
        lifecycle_status = excluded.lifecycle_status
    `;

    this.connection.exec(sql, [
      record.memoryId,
      record.userId,
      record.memoryType,
      JSON.stringify(record.content),
      record.entities ? JSON.stringify(record.entities) : null,
      JSON.stringify(record.sourceRefs),
      JSON.stringify(record.scope),
      record.confidence,
      record.importance,
      record.sensitivity,
      JSON.stringify(record.lifecycle),
      JSON.stringify(record.retrieval),
      record.fingerprint ?? null,
      record.sourceWindowHash ?? null,
      lifecycleStatus
    ]);
  }

  getByMemoryId(memoryId: string): LongTermMemoryRecord | null {
    const sql = 'SELECT * FROM long_term_memories WHERE memory_id = ?';
    const rows = this.connection.query<MemoryRow>(sql, [memoryId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  getByUserId(userId: string): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? AND lifecycle_status != 'deleted'
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
    `;
    const rows = this.connection.query<MemoryRow>(sql, [userId]);
    return rows.map(r => this.rowToRecord(r));
  }

  getByType(memoryType: MemoryType): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE memory_type = ? AND lifecycle_status != 'deleted'
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
    `;
    const rows = this.connection.query<MemoryRow>(sql, [memoryType]);
    return rows.map(r => this.rowToRecord(r));
  }

  search(query: string, userId: string, limit: number = 10): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND lifecycle_status != 'deleted'
        AND (
          content LIKE ? 
          OR retrieval LIKE ?
        )
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
      LIMIT ?
    `;
    
    const searchPattern = `%${query}%`;
    const rows = this.connection.query<MemoryRow>(sql, [userId, searchPattern, searchPattern, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  delete(memoryId: string): void {
    const existing = this.getByMemoryId(memoryId);
    
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

    this.save(updated);

    if (existing.fingerprint && existing.sourceWindowHash) {
      this.createTombstone({
        userId: existing.userId,
        fingerprint: existing.fingerprint,
        sourceWindowHash: existing.sourceWindowHash,
      });
    }
  }

  applyPatch(memoryId: string, patch: LongTermMemoryPatch): LongTermMemoryRecord {
    const existing = this.getByMemoryId(memoryId);

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

    this.save(updated);

    return updated;
  }

  findCurrentByFingerprint(userId: string, fingerprint: string): LongTermMemoryRecord | null {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND fingerprint = ? 
        AND lifecycle_status = 'active'
      LIMIT 1
    `;
    const rows = this.connection.query<MemoryRow>(sql, [userId, fingerprint]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.rowToRecord(rows[0]);
  }

  upsertExtracted(record: LongTermMemoryRecord): void {
    if (!record.fingerprint) {
      throw new Error('Cannot upsert memory without fingerprint');
    }

    const current = this.findCurrentByFingerprint(record.userId, record.fingerprint);
    
    if (current) {
      this.applyPatch(current.memoryId, {
        lifecycle: {
          ...current.lifecycle,
          status: 'superseded',
          supersededBy: record.memoryId,
        },
      });
    }

    this.save(record);
  }

  createTombstone(input: TombstoneInput): void {
    const tombstoneId = `tombstone-${input.userId}-${input.fingerprint}-${input.sourceWindowHash}`;
    const sql = `
      INSERT OR IGNORE INTO memory_tombstones (
        tombstone_id, user_id, fingerprint, source_window_hash, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `;
    
    this.connection.exec(sql, [
      tombstoneId,
      input.userId,
      input.fingerprint,
      input.sourceWindowHash,
      new Date().toISOString(),
    ]);
  }

  hasTombstone(userId: string, fingerprint: string, _sourceWindowHash: string): boolean {
    const sql = `
      SELECT 1 FROM memory_tombstones 
      WHERE user_id = ? AND fingerprint = ?
      LIMIT 1
    `;
    const rows = this.connection.query<{ '1': number }>(sql, [userId, fingerprint]);
    return rows.length > 0;
  }

  searchActive(query: string, userId: string, limit: number): LongTermMemoryRecord[] {
    const sql = `
      SELECT * FROM long_term_memories 
      WHERE user_id = ? 
        AND lifecycle_status = 'active'
        AND (
          content LIKE ? 
          OR retrieval LIKE ?
        )
      ORDER BY json_extract(lifecycle, '$.updatedAt') DESC
      LIMIT ?
    `;
    
    const searchPattern = `%${query}%`;
    const rows = this.connection.query<MemoryRow>(sql, [userId, searchPattern, searchPattern, limit]);
    return rows.map(r => this.rowToRecord(r));
  }

  private rowToRecord(row: MemoryRow): LongTermMemoryRecord {
    return {
      memoryId: row.memory_id,
      userId: row.user_id,
      memoryType: row.memory_type as MemoryType,
      content: JSON.parse(row.content),
      entities: row.entities ? JSON.parse(row.entities) : undefined,
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
}

type MemoryRow = {
  memory_id: string;
  user_id: string;
  memory_type: string;
  content: string;
  entities: string | null;
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
