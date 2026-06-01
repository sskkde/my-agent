import type { ConnectionManager } from './connection.js';

export interface SubagentRunRecord {
  subagentRunId: string;
  userId: string;
  sessionId?: string;
  parentRunId?: string;
  rootRunId?: string;
  backgroundRunId?: string;
  agentType: string;
  status: string;
  taskSpecJson: string;
  contextBundleJson?: string;
  providerId?: string;
  model?: string;
  resultJson?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface SubagentRunQuery {
  userId?: string;
  sessionId?: string;
  status?: string;
  agentType?: string;
  backgroundRunId?: string;
  limit?: number;
  offset?: number;
}

export interface SubagentRunStore {
  create(run: SubagentRunRecord): void;
  getById(subagentRunId: string): SubagentRunRecord | null;
  updateStatus(subagentRunId: string, status: string): void;
  saveResult(subagentRunId: string, result: unknown): void;
  query(filters: SubagentRunQuery): SubagentRunRecord[];
}

interface SubagentRunRow {
  subagent_run_id: string;
  user_id: string;
  session_id: string | null;
  parent_run_id: string | null;
  root_run_id: string | null;
  background_run_id: string | null;
  agent_type: string;
  status: string;
  task_spec_json: string;
  context_bundle_json: string | null;
  provider_id: string | null;
  model: string | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

function rowToRecord(row: SubagentRunRow): SubagentRunRecord {
  return {
    subagentRunId: row.subagent_run_id,
    userId: row.user_id,
    sessionId: row.session_id ?? undefined,
    parentRunId: row.parent_run_id ?? undefined,
    rootRunId: row.root_run_id ?? undefined,
    backgroundRunId: row.background_run_id ?? undefined,
    agentType: row.agent_type,
    status: row.status,
    taskSpecJson: row.task_spec_json,
    contextBundleJson: row.context_bundle_json ?? undefined,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    resultJson: row.result_json ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

class SubagentRunStoreImpl implements SubagentRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
    this.createTable();
  }

  private createTable(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS subagent_runs (
        subagent_run_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        parent_run_id TEXT,
        root_run_id TEXT,
        background_run_id TEXT,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        task_spec_json TEXT NOT NULL,
        context_bundle_json TEXT,
        provider_id TEXT,
        model TEXT,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      )
    `);

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_user_status
        ON subagent_runs(user_id, status)
    `);

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_session_status
        ON subagent_runs(session_id, status)
    `);

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_background
        ON subagent_runs(background_run_id)
    `);
  }

  create(run: SubagentRunRecord): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `INSERT INTO subagent_runs (
        subagent_run_id, user_id, session_id, parent_run_id, root_run_id,
        background_run_id, agent_type, status, task_spec_json,
        context_bundle_json, provider_id, model, result_json,
        error_code, error_message, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.subagentRunId,
        run.userId,
        run.sessionId ?? null,
        run.parentRunId ?? null,
        run.rootRunId ?? null,
        run.backgroundRunId ?? null,
        run.agentType,
        run.status,
        run.taskSpecJson,
        run.contextBundleJson ?? null,
        run.providerId ?? null,
        run.model ?? null,
        run.resultJson ?? null,
        run.errorCode ?? null,
        run.errorMessage ?? null,
        run.createdAt || now,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.updatedAt || now,
      ]
    );
  }

  getById(subagentRunId: string): SubagentRunRecord | null {
    const results = this.connection.query<SubagentRunRow>(
      `SELECT * FROM subagent_runs WHERE subagent_run_id = ?`,
      [subagentRunId]
    );

    if (results.length === 0) {
      return null;
    }

    return rowToRecord(results[0]);
  }

  updateStatus(subagentRunId: string, status: string): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE subagent_runs SET status = ?, updated_at = ? WHERE subagent_run_id = ?`,
      [status, now, subagentRunId]
    );
  }

  saveResult(subagentRunId: string, result: unknown): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE subagent_runs SET result_json = ?, completed_at = ?, updated_at = ? WHERE subagent_run_id = ?`,
      [JSON.stringify(result), now, now, subagentRunId]
    );
  }

  query(filters: SubagentRunQuery): SubagentRunRecord[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }

    if (filters.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }

    if (filters.status !== undefined) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.agentType !== undefined) {
      conditions.push('agent_type = ?');
      params.push(filters.agentType);
    }

    if (filters.backgroundRunId !== undefined) {
      conditions.push('background_run_id = ?');
      params.push(filters.backgroundRunId);
    }

    let sql = 'SELECT * FROM subagent_runs';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    if (filters.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = this.connection.query<SubagentRunRow>(sql, params);
    return rows.map(rowToRecord);
  }
}

export function createSubagentRunStore(connection: ConnectionManager): SubagentRunStore {
  return new SubagentRunStoreImpl(connection);
}
