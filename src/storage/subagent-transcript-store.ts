import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SubagentTranscriptRecord {
  id: string
  subagentRunId: string
  eventType: string
  contentJson: string
  createdAt: string
  tenantId?: string
  sessionId?: string
  userId?: string
}

export interface SubagentTranscriptStore {
  append(record: SubagentTranscriptRecord, tenantId?: string): void
  getByRunId(subagentRunId: string, tenantId?: string): SubagentTranscriptRecord[]
  getByEventType(subagentRunId: string, eventType: string, tenantId?: string): SubagentTranscriptRecord[]
}

interface SubagentTranscriptRow {
  id: string
  subagent_run_id: string
  event_type: string
  content_json: string
  created_at: string
  tenant_id: string
  session_id: string | null
  user_id: string | null
}

function rowToRecord(row: SubagentTranscriptRow): SubagentTranscriptRecord {
  return {
    id: row.id,
    subagentRunId: row.subagent_run_id,
    eventType: row.event_type,
    contentJson: row.content_json,
    createdAt: row.created_at,
    tenantId: row.tenant_id,
    sessionId: row.session_id ?? undefined,
    userId: row.user_id ?? undefined,
  }
}

class SubagentTranscriptStoreImpl implements SubagentTranscriptStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
    this.createTable()
  }

  private createTable(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS subagent_transcripts (
        id TEXT PRIMARY KEY,
        subagent_run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        session_id TEXT,
        user_id TEXT
      )
    `)

    this.ensureColumn('subagent_transcripts', 'tenant_id', "TEXT NOT NULL DEFAULT 'org_default'")
    this.ensureColumn('subagent_transcripts', 'session_id', 'TEXT')
    this.ensureColumn('subagent_transcripts', 'user_id', 'TEXT')

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_transcripts_run_id
        ON subagent_transcripts(subagent_run_id)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_transcripts_run_type
        ON subagent_transcripts(subagent_run_id, event_type)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_transcripts_session
        ON subagent_transcripts(session_id)
    `)
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('duplicate column name') && !message.includes('already exists')) {
        throw err
      }
    }
  }

  append(record: SubagentTranscriptRecord, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `INSERT INTO subagent_transcripts (
        id, subagent_run_id, event_type, content_json, created_at,
        tenant_id, session_id, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.subagentRunId,
        record.eventType,
        record.contentJson,
        record.createdAt || now,
        record.tenantId ?? tenantId,
        record.sessionId ?? null,
        record.userId ?? null,
      ],
    )
  }

  getByRunId(subagentRunId: string, tenantId: string = DEFAULT_TENANT_ID): SubagentTranscriptRecord[] {
    const rows = this.connection.query<SubagentTranscriptRow>(
      `SELECT * FROM subagent_transcripts WHERE tenant_id = ? AND subagent_run_id = ? ORDER BY created_at ASC`,
      [tenantId, subagentRunId],
    )
    return rows.map(rowToRecord)
  }

  getByEventType(
    subagentRunId: string,
    eventType: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): SubagentTranscriptRecord[] {
    const rows = this.connection.query<SubagentTranscriptRow>(
      `SELECT * FROM subagent_transcripts WHERE tenant_id = ? AND subagent_run_id = ? AND event_type = ? ORDER BY created_at ASC`,
      [tenantId, subagentRunId, eventType],
    )
    return rows.map(rowToRecord)
  }
}

export function createSubagentTranscriptStore(connection: ConnectionManager): SubagentTranscriptStore {
  return new SubagentTranscriptStoreImpl(connection)
}
