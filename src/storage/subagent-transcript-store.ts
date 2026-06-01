import type { ConnectionManager } from './connection.js';

export interface SubagentTranscriptRecord {
  id: string;
  subagentRunId: string;
  eventType: string;
  contentJson: string;
  createdAt: string;
}

export interface SubagentTranscriptStore {
  append(record: SubagentTranscriptRecord): void;
  getByRunId(subagentRunId: string): SubagentTranscriptRecord[];
  getByEventType(subagentRunId: string, eventType: string): SubagentTranscriptRecord[];
}

interface SubagentTranscriptRow {
  id: string;
  subagent_run_id: string;
  event_type: string;
  content_json: string;
  created_at: string;
}

function rowToRecord(row: SubagentTranscriptRow): SubagentTranscriptRecord {
  return {
    id: row.id,
    subagentRunId: row.subagent_run_id,
    eventType: row.event_type,
    contentJson: row.content_json,
    createdAt: row.created_at,
  };
}

class SubagentTranscriptStoreImpl implements SubagentTranscriptStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
    this.createTable();
  }

  private createTable(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS subagent_transcripts (
        id TEXT PRIMARY KEY,
        subagent_run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_transcripts_run_id
        ON subagent_transcripts(subagent_run_id)
    `);

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_transcripts_run_type
        ON subagent_transcripts(subagent_run_id, event_type)
    `);
  }

  append(record: SubagentTranscriptRecord): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `INSERT INTO subagent_transcripts (
        id, subagent_run_id, event_type, content_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        record.id,
        record.subagentRunId,
        record.eventType,
        record.contentJson,
        record.createdAt || now,
      ]
    );
  }

  getByRunId(subagentRunId: string): SubagentTranscriptRecord[] {
    const rows = this.connection.query<SubagentTranscriptRow>(
      `SELECT * FROM subagent_transcripts WHERE subagent_run_id = ? ORDER BY created_at ASC`,
      [subagentRunId]
    );
    return rows.map(rowToRecord);
  }

  getByEventType(subagentRunId: string, eventType: string): SubagentTranscriptRecord[] {
    const rows = this.connection.query<SubagentTranscriptRow>(
      `SELECT * FROM subagent_transcripts WHERE subagent_run_id = ? AND event_type = ? ORDER BY created_at ASC`,
      [subagentRunId, eventType]
    );
    return rows.map(rowToRecord);
  }
}

export function createSubagentTranscriptStore(connection: ConnectionManager): SubagentTranscriptStore {
  return new SubagentTranscriptStoreImpl(connection);
}
