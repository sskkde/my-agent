import type { ConnectionManager } from './connection.js'
import type { MigrationRunner, Migration } from './migrations.js'

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'restricted'

export interface ToolResultBlob {
  id: string
  resultRef: string
  toolCallId: string
  toolName: string
  userId: string
  sessionId?: string
  preview?: string
  rawBlobRef?: string
  structuredContent?: Record<string, unknown>
  sensitivity: SensitivityLevel
  createdAt: string
}

export interface ToolResultStore {
  applyMigrations(runner: MigrationRunner): void
  create(data: Omit<ToolResultBlob, 'id' | 'createdAt'>): ToolResultBlob
  findById(id: string): ToolResultBlob | undefined
  findByToolCallId(toolCallId: string): ToolResultBlob[]
  findBySessionId(sessionId: string): ToolResultBlob[]
  findByToolName(toolName: string): ToolResultBlob[]
  findBySensitivity(sensitivity: SensitivityLevel): ToolResultBlob[]
  delete(id: string): boolean
}

class ToolResultStoreImpl implements ToolResultStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  applyMigrations(runner: MigrationRunner): void {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'create_tool_results_table',
        up: `
          CREATE TABLE tool_results (
            id TEXT PRIMARY KEY,
            result_ref TEXT NOT NULL,
            tool_call_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT,
            preview TEXT,
            raw_blob_ref TEXT,
            structured_content TEXT,
            sensitivity TEXT NOT NULL CHECK(sensitivity IN ('low', 'medium', 'high', 'restricted')),
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_tool_results_tool_call_id ON tool_results(tool_call_id);
          CREATE INDEX idx_tool_results_session_id ON tool_results(session_id);
          CREATE INDEX idx_tool_results_tool_name_created ON tool_results(tool_name, created_at);
          CREATE INDEX idx_tool_results_sensitivity ON tool_results(sensitivity);
        `,
        down: `
          DROP INDEX IF EXISTS idx_tool_results_sensitivity;
          DROP INDEX IF EXISTS idx_tool_results_tool_name_created;
          DROP INDEX IF EXISTS idx_tool_results_session_id;
          DROP INDEX IF EXISTS idx_tool_results_tool_call_id;
          DROP TABLE IF EXISTS tool_results;
        `,
      },
    ]
    runner.apply(migrations)
  }

  create(data: Omit<ToolResultBlob, 'id' | 'createdAt'>): ToolResultBlob {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    this.connection.exec(
      `INSERT INTO tool_results (
        id, result_ref, tool_call_id, tool_name, user_id, session_id,
        preview, raw_blob_ref, structured_content, sensitivity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.resultRef,
        data.toolCallId,
        data.toolName,
        data.userId,
        data.sessionId ?? null,
        data.preview ?? null,
        data.rawBlobRef ?? null,
        data.structuredContent ? JSON.stringify(data.structuredContent) : null,
        data.sensitivity,
        createdAt,
      ],
    )

    return {
      ...data,
      id,
      createdAt,
    }
  }

  findById(id: string): ToolResultBlob | undefined {
    const rows = this.connection.query<{
      id: string
      result_ref: string
      tool_call_id: string
      tool_name: string
      user_id: string
      session_id: string | null
      preview: string | null
      raw_blob_ref: string | null
      structured_content: string | null
      sensitivity: SensitivityLevel
      created_at: string
    }>('SELECT * FROM tool_results WHERE id = ?', [id])

    if (rows.length === 0) {
      return undefined
    }

    return this.mapRow(rows[0])
  }

  findByToolCallId(toolCallId: string): ToolResultBlob[] {
    const rows = this.connection.query<{
      id: string
      result_ref: string
      tool_call_id: string
      tool_name: string
      user_id: string
      session_id: string | null
      preview: string | null
      raw_blob_ref: string | null
      structured_content: string | null
      sensitivity: SensitivityLevel
      created_at: string
    }>('SELECT * FROM tool_results WHERE tool_call_id = ?', [toolCallId])

    return rows.map((row) => this.mapRow(row))
  }

  findBySessionId(sessionId: string): ToolResultBlob[] {
    const rows = this.connection.query<{
      id: string
      result_ref: string
      tool_call_id: string
      tool_name: string
      user_id: string
      session_id: string | null
      preview: string | null
      raw_blob_ref: string | null
      structured_content: string | null
      sensitivity: SensitivityLevel
      created_at: string
    }>('SELECT * FROM tool_results WHERE session_id = ?', [sessionId])

    return rows.map((row) => this.mapRow(row))
  }

  findByToolName(toolName: string): ToolResultBlob[] {
    const rows = this.connection.query<{
      id: string
      result_ref: string
      tool_call_id: string
      tool_name: string
      user_id: string
      session_id: string | null
      preview: string | null
      raw_blob_ref: string | null
      structured_content: string | null
      sensitivity: SensitivityLevel
      created_at: string
    }>('SELECT * FROM tool_results WHERE tool_name = ? ORDER BY created_at ASC', [toolName])

    return rows.map((row) => this.mapRow(row))
  }

  findBySensitivity(sensitivity: SensitivityLevel): ToolResultBlob[] {
    const rows = this.connection.query<{
      id: string
      result_ref: string
      tool_call_id: string
      tool_name: string
      user_id: string
      session_id: string | null
      preview: string | null
      raw_blob_ref: string | null
      structured_content: string | null
      sensitivity: SensitivityLevel
      created_at: string
    }>('SELECT * FROM tool_results WHERE sensitivity = ?', [sensitivity])

    return rows.map((row) => this.mapRow(row))
  }

  delete(id: string): boolean {
    const before = this.findById(id)
    if (!before) {
      return false
    }
    this.connection.exec('DELETE FROM tool_results WHERE id = ?', [id])
    return this.findById(id) === undefined
  }

  private mapRow(row: {
    id: string
    result_ref: string
    tool_call_id: string
    tool_name: string
    user_id: string
    session_id: string | null
    preview: string | null
    raw_blob_ref: string | null
    structured_content: string | null
    sensitivity: SensitivityLevel
    created_at: string
  }): ToolResultBlob {
    return {
      id: row.id,
      resultRef: row.result_ref,
      toolCallId: row.tool_call_id,
      toolName: row.tool_name,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      preview: row.preview ?? undefined,
      rawBlobRef: row.raw_blob_ref ?? undefined,
      structuredContent: row.structured_content ? JSON.parse(row.structured_content) : undefined,
      sensitivity: row.sensitivity,
      createdAt: row.created_at,
    }
  }
}

export function createToolResultStore(connection: ConnectionManager): ToolResultStore {
  return new ToolResultStoreImpl(connection)
}
