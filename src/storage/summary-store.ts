import type { ConnectionManager } from './connection.js';

export type SummaryType =
  | 'working_summary'
  | 'session_memory'
  | 'rolling_5_turns'
  | 'rolling_10_turns'
  | 'daily_summary'
  | 'weekly_summary'
  | 'workflow_run_summary'
  | 'background_subagent_summary'
  | 'planner_run_summary'
  | 'compact_summary';

export type SummaryStatus =
  | 'candidate'
  | 'validated'
  | 'active'
  | 'superseded'
  | 'archived'
  | 'expired';

export type RelatedRefs = {
  plannerRunId?: string;
  planId?: string;
  workflowRunId?: string;
  backgroundRunId?: string;
  subagentRunId?: string;
  artifactId?: string;
};

export type SourceRefs = {
  transcriptRefs?: string[];
  eventRange?: {
    startEventId: string;
    endEventId: string;
  };
  previousSummaryRefs?: string[];
};

export type RetrievalMetadata = {
  keywords?: string[];
  embeddingRef?: string;
  importance?: 'low' | 'medium' | 'high';
};

export type SummaryRecord = {
  summaryId: string;
  summaryType: SummaryType;
  userId: string;
  sessionId?: string;
  runId?: string;
  relatedRefs?: RelatedRefs;
  sourceRefs: SourceRefs;
  summary: string;
  structuredState?: Record<string, unknown>;
  status: SummaryStatus;
  retrieval?: RetrievalMetadata;
  createdAt: string;
  updatedAt?: string;
};

export type SummaryPatch = Partial<
  Omit<SummaryRecord, 'summaryId' | 'createdAt'>
>;

export interface SummaryStore {
  save(record: SummaryRecord): void;
  getBySummaryId(summaryId: string): SummaryRecord | null;
  getByType(summaryType: SummaryType): SummaryRecord[];
  getWorkingSummary(runId: string): SummaryRecord | null;
  getSessionMemory(sessionId: string): SummaryRecord | null;
  applyPatch(summaryId: string, patch: SummaryPatch): SummaryRecord;
}

class SummaryStoreImpl implements SummaryStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  save(record: SummaryRecord): void {
    this.validateSourceRefs(record.sourceRefs);

    const sql = `
      INSERT INTO summaries (
        summary_id, summary_type, user_id, session_id, run_id,
        related_refs, source_refs, summary, structured_state,
        status, retrieval, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(summary_id) DO UPDATE SET
        summary_type = excluded.summary_type,
        user_id = excluded.user_id,
        session_id = excluded.session_id,
        run_id = excluded.run_id,
        related_refs = excluded.related_refs,
        source_refs = excluded.source_refs,
        summary = excluded.summary,
        structured_state = excluded.structured_state,
        status = excluded.status,
        retrieval = excluded.retrieval,
        updated_at = excluded.updated_at
    `;

    this.connection.exec(sql, [
      record.summaryId,
      record.summaryType,
      record.userId,
      record.sessionId ?? null,
      record.runId ?? null,
      record.relatedRefs ? JSON.stringify(record.relatedRefs) : null,
      JSON.stringify(record.sourceRefs),
      record.summary,
      record.structuredState ? JSON.stringify(record.structuredState) : null,
      record.status,
      record.retrieval ? JSON.stringify(record.retrieval) : null,
      record.createdAt,
      record.updatedAt ?? null
    ]);
  }

  getBySummaryId(summaryId: string): SummaryRecord | null {
    const sql = 'SELECT * FROM summaries WHERE summary_id = ?';
    const rows = this.connection.query<SummaryRow>(sql, [summaryId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  getByType(summaryType: SummaryType): SummaryRecord[] {
    const sql = `
      SELECT * FROM summaries 
      WHERE summary_type = ? 
      ORDER BY created_at DESC
    `;
    const rows = this.connection.query<SummaryRow>(sql, [summaryType]);
    return rows.map(r => this.rowToRecord(r));
  }

  getWorkingSummary(runId: string): SummaryRecord | null {
    const sql = `
      SELECT * FROM summaries 
      WHERE run_id = ? AND summary_type = 'working_summary'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const rows = this.connection.query<SummaryRow>(sql, [runId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  getSessionMemory(sessionId: string): SummaryRecord | null {
    const sql = `
      SELECT * FROM summaries 
      WHERE session_id = ? AND summary_type = 'session_memory'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const rows = this.connection.query<SummaryRow>(sql, [sessionId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  applyPatch(summaryId: string, patch: SummaryPatch): SummaryRecord {
    const existing = this.getBySummaryId(summaryId);

    if (!existing) {
      throw new Error(`Summary with id "${summaryId}" not found`);
    }

    const updated: SummaryRecord = {
      ...existing,
      ...patch,
      summaryId: existing.summaryId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    this.save(updated);

    return updated;
  }

  private validateSourceRefs(sourceRefs: SourceRefs): void {
    if (!sourceRefs) {
      throw new Error('sourceRefs is required');
    }

    const hasTranscriptRefs =
      sourceRefs.transcriptRefs &&
      Array.isArray(sourceRefs.transcriptRefs) &&
      sourceRefs.transcriptRefs.length > 0;

    const hasEventRange =
      sourceRefs.eventRange &&
      typeof sourceRefs.eventRange.startEventId === 'string' &&
      typeof sourceRefs.eventRange.endEventId === 'string';

    const hasPreviousSummaryRefs =
      sourceRefs.previousSummaryRefs &&
      Array.isArray(sourceRefs.previousSummaryRefs) &&
      sourceRefs.previousSummaryRefs.length > 0;

    if (!hasTranscriptRefs && !hasEventRange && !hasPreviousSummaryRefs) {
      throw new Error(
        'sourceRefs must contain at least one of: transcriptRefs, eventRange, or previousSummaryRefs'
      );
    }
  }

  private rowToRecord(row: SummaryRow): SummaryRecord {
    return {
      summaryId: row.summary_id,
      summaryType: row.summary_type as SummaryType,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      runId: row.run_id ?? undefined,
      relatedRefs: row.related_refs
        ? JSON.parse(row.related_refs)
        : undefined,
      sourceRefs: JSON.parse(row.source_refs) as SourceRefs,
      summary: row.summary,
      structuredState: row.structured_state
        ? JSON.parse(row.structured_state)
        : undefined,
      status: row.status as SummaryStatus,
      retrieval: row.retrieval
        ? JSON.parse(row.retrieval)
        : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined
    };
  }
}

type SummaryRow = {
  summary_id: string;
  summary_type: string;
  user_id: string;
  session_id: string | null;
  run_id: string | null;
  related_refs: string | null;
  source_refs: string;
  summary: string;
  structured_state: string | null;
  status: string;
  retrieval: string | null;
  created_at: string;
  updated_at: string | null;
};

export function createSummaryStore(connection: ConnectionManager): SummaryStore {
  return new SummaryStoreImpl(connection);
}

export function createSummaryMigration() {
  return {
    version: 2,
    name: 'create_summaries_table',
    up: `
      CREATE TABLE IF NOT EXISTS summaries (
        summary_id TEXT PRIMARY KEY,
        summary_type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        run_id TEXT,
        related_refs TEXT,
        source_refs TEXT NOT NULL,
        summary TEXT NOT NULL,
        structured_state TEXT,
        status TEXT NOT NULL,
        retrieval TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_user_type_updated
        ON summaries(user_id, summary_type, updated_at);

      CREATE INDEX IF NOT EXISTS idx_summaries_session_type_updated
        ON summaries(session_id, summary_type, updated_at);

      CREATE INDEX IF NOT EXISTS idx_summaries_plan_id
        ON summaries(json_extract(related_refs, '$.planId'))
        WHERE related_refs IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_summaries_planner_run_id
        ON summaries(json_extract(related_refs, '$.plannerRunId'))
        WHERE related_refs IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_summaries_workflow_run_id
        ON summaries(json_extract(related_refs, '$.workflowRunId'))
        WHERE related_refs IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_summaries_status
        ON summaries(status);

      CREATE INDEX IF NOT EXISTS idx_summaries_run_id
        ON summaries(run_id)
        WHERE run_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_summaries_session_id
        ON summaries(session_id)
        WHERE session_id IS NOT NULL;
    `,
    down: `
      DROP INDEX IF EXISTS idx_summaries_user_type_updated;
      DROP INDEX IF EXISTS idx_summaries_session_type_updated;
      DROP INDEX IF EXISTS idx_summaries_plan_id;
      DROP INDEX IF EXISTS idx_summaries_planner_run_id;
      DROP INDEX IF EXISTS idx_summaries_workflow_run_id;
      DROP INDEX IF EXISTS idx_summaries_status;
      DROP INDEX IF EXISTS idx_summaries_run_id;
      DROP INDEX IF EXISTS idx_summaries_session_id;
      DROP TABLE IF EXISTS summaries;
    `
  };
}
