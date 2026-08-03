import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SubagentRunRecord {
  subagentRunId: string
  userId: string
  sessionId?: string
  parentRunId?: string
  rootRunId?: string
  backgroundRunId?: string
  agentType: string
  agentProfile?: string
  status: string
  taskSpecJson: string
  contextBundleJson?: string
  providerId?: string
  model?: string
  resultJson?: string
  errorCode?: string
  errorMessage?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  tenantId?: string
  /** Child session id that this run attempt belongs to (child session linkage) */
  childSessionId?: string
  /** Task id linkage (identity rule: taskId === childSessionId) */
  taskId?: string
}

export interface SubagentRunQuery {
  userId?: string
  sessionId?: string
  status?: string
  agentType?: string
  agentProfile?: string
  backgroundRunId?: string
  childSessionId?: string
  taskId?: string
  limit?: number
  offset?: number
}

export interface SubagentRunStore {
  create(run: SubagentRunRecord, tenantId?: string): void
  getById(subagentRunId: string, tenantId?: string): SubagentRunRecord | null
  updateStatus(subagentRunId: string, status: string, tenantId?: string): void
  saveResult(subagentRunId: string, result: unknown, tenantId?: string): void
  query(filters: SubagentRunQuery, tenantId?: string): SubagentRunRecord[]
}

interface SubagentRunRow {
  subagent_run_id: string
  user_id: string
  session_id: string | null
  parent_run_id: string | null
  root_run_id: string | null
  background_run_id: string | null
  agent_type: string
  agent_profile: string | null
  status: string
  task_spec_json: string
  context_bundle_json: string | null
  provider_id: string | null
  model: string | null
  result_json: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
  tenant_id: string
  child_session_id: string | null
  task_id: string | null
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
    agentProfile: row.agent_profile ?? undefined,
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
    tenantId: row.tenant_id,
    childSessionId: row.child_session_id ?? undefined,
    taskId: row.task_id ?? undefined,
  }
}

class SubagentRunStoreImpl implements SubagentRunStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
    this.createTable()
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
        agent_profile TEXT,
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
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        child_session_id TEXT,
        task_id TEXT
      )
    `)

    this.ensureColumn('subagent_runs', 'tenant_id', "TEXT NOT NULL DEFAULT 'org_default'")
    this.ensureColumn('subagent_runs', 'child_session_id', 'TEXT')
    this.ensureColumn('subagent_runs', 'task_id', 'TEXT')

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_user_status
        ON subagent_runs(user_id, status)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_session_status
        ON subagent_runs(session_id, status)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_background
        ON subagent_runs(background_run_id)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_agent_profile
        ON subagent_runs(agent_profile)
    `)

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_child_session
        ON subagent_runs(child_session_id)
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

  create(run: SubagentRunRecord, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `INSERT INTO subagent_runs (
        subagent_run_id, user_id, session_id, parent_run_id, root_run_id,
        background_run_id, agent_type, agent_profile, status, task_spec_json,
        context_bundle_json, provider_id, model, result_json,
        error_code, error_message, created_at, started_at, completed_at, updated_at,
        tenant_id, child_session_id, task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.subagentRunId,
        run.userId,
        run.sessionId ?? null,
        run.parentRunId ?? null,
        run.rootRunId ?? null,
        run.backgroundRunId ?? null,
        run.agentType,
        run.agentProfile ?? null,
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
        run.tenantId ?? tenantId,
        run.childSessionId ?? null,
        run.taskId ?? null,
      ],
    )
  }

  getById(subagentRunId: string, tenantId: string = DEFAULT_TENANT_ID): SubagentRunRecord | null {
    const results = this.connection.query<SubagentRunRow>(
      `SELECT * FROM subagent_runs WHERE tenant_id = ? AND subagent_run_id = ?`,
      [tenantId, subagentRunId],
    )

    if (results.length === 0) {
      return null
    }

    return rowToRecord(results[0]!)
  }

  updateStatus(subagentRunId: string, status: string, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE subagent_runs SET status = ?, updated_at = ? WHERE tenant_id = ? AND subagent_run_id = ?`,
      [status, now, tenantId, subagentRunId],
    )
  }

  saveResult(subagentRunId: string, result: unknown, tenantId: string = DEFAULT_TENANT_ID): void {
    const now = new Date().toISOString()
    this.connection.exec(
      `UPDATE subagent_runs SET result_json = ?, completed_at = ?, updated_at = ? WHERE tenant_id = ? AND subagent_run_id = ?`,
      [JSON.stringify(result), now, now, tenantId, subagentRunId],
    )
  }

  query(filters: SubagentRunQuery, tenantId: string = DEFAULT_TENANT_ID): SubagentRunRecord[] {
    const conditions: string[] = ['tenant_id = ?']
    const params: (string | number)[] = [tenantId]

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?')
      params.push(filters.userId)
    }

    if (filters.sessionId !== undefined) {
      conditions.push('session_id = ?')
      params.push(filters.sessionId)
    }

    if (filters.status !== undefined) {
      conditions.push('status = ?')
      params.push(filters.status)
    }

    if (filters.agentType !== undefined) {
      conditions.push('agent_type = ?')
      params.push(filters.agentType)
    }

    if (filters.agentProfile !== undefined) {
      conditions.push('agent_profile = ?')
      params.push(filters.agentProfile)
    }

    if (filters.backgroundRunId !== undefined) {
      conditions.push('background_run_id = ?')
      params.push(filters.backgroundRunId)
    }

    if (filters.childSessionId !== undefined) {
      conditions.push('child_session_id = ?')
      params.push(filters.childSessionId)
    }

    if (filters.taskId !== undefined) {
      conditions.push('task_id = ?')
      params.push(filters.taskId)
    }

    let sql = 'SELECT * FROM subagent_runs'
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY created_at DESC'

    if (filters.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters.offset !== undefined) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const rows = this.connection.query<SubagentRunRow>(sql, params)
    return rows.map(rowToRecord)
  }
}

export function createSubagentRunStore(connection: ConnectionManager): SubagentRunStore {
  return new SubagentRunStoreImpl(connection)
}
