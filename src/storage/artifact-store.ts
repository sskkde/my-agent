import type { ConnectionManager } from './connection.js';
import type { MigrationRunner, Migration } from './migrations.js';

export type ArtifactType = 'document' | 'draft' | 'image' | 'report' | 'spreadsheet' | 'code' | 'workflow';
export type ArtifactStatus = 'draft' | 'active' | 'archived' | 'deleted';

export interface Artifact {
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  name: string;
  contentRef: string;
  contentSummary?: string;
  userId: string;
  sessionId?: string;
  status: ArtifactStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactStore {
  applyMigrations(runner: MigrationRunner): void;
  create(data: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>): Artifact;
  findById(id: string): Artifact | undefined;
  findByArtifactId(artifactId: string): Artifact | undefined;
  findByUserId(userId: string): Artifact[];
  findBySessionId(sessionId: string): Artifact[];
  findByType(artifactType: ArtifactType): Artifact[];
  findByStatus(status: ArtifactStatus): Artifact[];
  update(id: string, data: Partial<Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>>): Artifact | undefined;
  delete(id: string): boolean;
}

class ArtifactStoreImpl implements ArtifactStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  applyMigrations(runner: MigrationRunner): void {
    const migrations: Migration[] = [
      {
        version: 2,
        name: 'create_artifacts_table',
        up: `
          CREATE TABLE artifacts (
            id TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL UNIQUE,
            artifact_type TEXT NOT NULL CHECK(artifact_type IN ('document', 'draft', 'image', 'report', 'spreadsheet', 'code', 'workflow')),
            name TEXT NOT NULL,
            content_ref TEXT NOT NULL,
            content_summary TEXT,
            user_id TEXT NOT NULL,
            session_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'archived', 'deleted')),
            metadata TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_artifacts_artifact_id ON artifacts(artifact_id);
          CREATE INDEX idx_artifacts_user_id_updated ON artifacts(user_id, updated_at DESC);
          CREATE INDEX idx_artifacts_session_id ON artifacts(session_id);
          CREATE INDEX idx_artifacts_type ON artifacts(artifact_type);
          CREATE INDEX idx_artifacts_status ON artifacts(status);
        `,
        down: `
          DROP INDEX IF EXISTS idx_artifacts_status;
          DROP INDEX IF EXISTS idx_artifacts_type;
          DROP INDEX IF EXISTS idx_artifacts_session_id;
          DROP INDEX IF EXISTS idx_artifacts_user_id_updated;
          DROP INDEX IF EXISTS idx_artifacts_artifact_id;
          DROP TABLE IF EXISTS artifacts;
        `
      }
    ];
    runner.apply(migrations);
  }

  create(data: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>): Artifact {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.connection.exec(
      `INSERT INTO artifacts (
        id, artifact_id, artifact_type, name, content_ref, content_summary,
        user_id, session_id, status, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.artifactId,
        data.artifactType,
        data.name,
        data.contentRef,
        data.contentSummary ?? null,
        data.userId,
        data.sessionId ?? null,
        data.status,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        now
      ]
    );

    return {
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    };
  }

  findById(id: string): Artifact | undefined {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE id = ?', [id]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapRow(rows[0]);
  }

  findByArtifactId(artifactId: string): Artifact | undefined {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE artifact_id = ?', [artifactId]);

    if (rows.length === 0) {
      return undefined;
    }

    return this.mapRow(rows[0]);
  }

  findByUserId(userId: string): Artifact[] {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC', [userId]);

    return rows.map(row => this.mapRow(row));
  }

  findBySessionId(sessionId: string): Artifact[] {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE session_id = ?', [sessionId]);

    return rows.map(row => this.mapRow(row));
  }

  findByType(artifactType: ArtifactType): Artifact[] {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE artifact_type = ?', [artifactType]);

    return rows.map(row => this.mapRow(row));
  }

  findByStatus(status: ArtifactStatus): Artifact[] {
    const rows = this.connection.query<{
      id: string;
      artifact_id: string;
      artifact_type: ArtifactType;
      name: string;
      content_ref: string;
      content_summary: string | null;
      user_id: string;
      session_id: string | null;
      status: ArtifactStatus;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM artifacts WHERE status = ?', [status]);

    return rows.map(row => this.mapRow(row));
  }

  update(id: string, data: Partial<Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>>): Artifact | undefined {
    const existing = this.findById(id);
    if (!existing) {
      return undefined;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.artifactId !== undefined) {
      updates.push('artifact_id = ?');
      values.push(data.artifactId);
    }
    if (data.artifactType !== undefined) {
      updates.push('artifact_type = ?');
      values.push(data.artifactType);
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.contentRef !== undefined) {
      updates.push('content_ref = ?');
      values.push(data.contentRef);
    }
    if (data.contentSummary !== undefined) {
      updates.push('content_summary = ?');
      values.push(data.contentSummary);
    }
    if (data.userId !== undefined) {
      updates.push('user_id = ?');
      values.push(data.userId);
    }
    if (data.sessionId !== undefined) {
      updates.push('session_id = ?');
      values.push(data.sessionId);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(data.metadata));
    }

    if (updates.length === 0) {
      return existing;
    }

    const updatedAt = new Date().toISOString();
    updates.push('updated_at = ?');
    values.push(updatedAt);
    values.push(id);

    this.connection.exec(
      `UPDATE artifacts SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return this.findById(id);
  }

  delete(id: string): boolean {
    const before = this.findById(id);
    if (!before) {
      return false;
    }
    this.connection.exec('DELETE FROM artifacts WHERE id = ?', [id]);
    return this.findById(id) === undefined;
  }

  private mapRow(row: {
    id: string;
    artifact_id: string;
    artifact_type: ArtifactType;
    name: string;
    content_ref: string;
    content_summary: string | null;
    user_id: string;
    session_id: string | null;
    status: ArtifactStatus;
    metadata: string | null;
    created_at: string;
    updated_at: string;
  }): Artifact {
    return {
      id: row.id,
      artifactId: row.artifact_id,
      artifactType: row.artifact_type,
      name: row.name,
      contentRef: row.content_ref,
      contentSummary: row.content_summary ?? undefined,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function createArtifactStore(connection: ConnectionManager): ArtifactStore {
  return new ArtifactStoreImpl(connection);
}
