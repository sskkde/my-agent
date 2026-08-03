import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'
import { DEFAULT_REASONING_DEPTH, parseReasoningDepth, type ReasoningDepth } from '../llm/reasoning-depth.js'

export interface Session {
  sessionId: string
  userId: string
  title: string
  status: 'active' | 'archived' | 'closed'
  messageCount: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
  selectedModel?: string
  selectedProviderId?: string
  /** Model reasoning depth for this session */
  reasoningDepth?: ReasoningDepth
  /** Session kind: 'foreground' for user sessions, 'subagent' for internal child sessions */
  sessionKind?: 'foreground' | 'subagent'
  /** Parent session id for subagent child sessions */
  parentSessionId?: string
  /** Task id for subagent child sessions (identity rule: taskId === child sessionId) */
  taskId?: string
  /** Agent profile that runs this child session */
  agentProfile?: string
  /** Launch mode: 'foreground' (waited on) or 'background' (notified later) */
  launchMode?: 'foreground' | 'background'
  /** Subagent nesting depth: 0 = foreground, >= 1 = child */
  subagentDepth?: number
}

export interface CreateSessionInput {
  sessionId: string
  userId: string
  title: string
  status?: 'active' | 'archived' | 'closed'
  messageCount?: number
  metadata?: Record<string, unknown>
  sessionKind?: 'foreground' | 'subagent'
  parentSessionId?: string
  taskId?: string
  agentProfile?: string
  launchMode?: 'foreground' | 'background'
  subagentDepth?: number
}

export interface CreateChildSessionInput {
  sessionId: string
  userId: string
  /** Parent session that launched this child */
  parentSessionId: string
  title?: string
  status?: 'active' | 'archived' | 'closed'
  messageCount?: number
  metadata?: Record<string, unknown>
  /** Defaults to sessionId per the taskId === childSessionId identity rule */
  taskId?: string
  agentProfile?: string
  launchMode?: 'foreground' | 'background'
  /** Defaults to 1 (depth of a foreground parent is 0) */
  subagentDepth?: number
}

export interface ListSessionsOptions {
  userId?: string
  status?: 'active' | 'archived' | 'closed'
  limit?: number
  offset?: number
}

export interface ListChildrenOptions {
  status?: 'active' | 'archived' | 'closed'
  limit?: number
  offset?: number
}

export interface UpdateMetadataInput {
  messageCount?: number
  lastActivityAt?: string
}

export interface SessionStore {
  create(input: CreateSessionInput, tenantId?: string): Session
  getById(sessionId: string, tenantId?: string): Session | null
  list(options?: ListSessionsOptions, tenantId?: string): Session[]
  updateActivity(sessionId: string, lastActivityAt: string, tenantId?: string): boolean
  updateMetadata(sessionId: string, input: UpdateMetadataInput, tenantId?: string): boolean
  updateStatus(sessionId: string, status: 'active' | 'archived' | 'closed', tenantId?: string): boolean
  updateTitle(sessionId: string, title: string, tenantId?: string): boolean
  updateUserId(sessionId: string, newUserId: string, tenantId?: string): boolean
  setModel(sessionId: string, selectedModel: string, selectedProviderId: string, tenantId?: string): boolean
  setReasoningDepth(sessionId: string, reasoningDepth: ReasoningDepth, tenantId?: string): boolean
  getCount(options?: { userId?: string; status?: 'active' | 'archived' | 'closed' }, tenantId?: string): number
  createChildSession(input: CreateChildSessionInput, tenantId?: string): Session
  getChildSessionById(sessionId: string, tenantId?: string): Session | null
  getByTaskId(taskId: string, userId?: string, tenantId?: string): Session | null
  listChildren(parentSessionId: string, options?: ListChildrenOptions, tenantId?: string): Session[]
  countChildLaunches(parentSessionId: string, since?: string, tenantId?: string): number
  archiveDescendants(parentSessionId: string, tenantId?: string): number
}

interface SessionRow {
  session_id: string
  user_id: string
  title: string
  status: 'active' | 'archived' | 'closed'
  message_count: number
  last_activity_at: string
  created_at: string
  updated_at: string
  metadata: string | null
  selected_model: string | null
  selected_provider_id: string | null
  reasoning_depth: string | null
  parent_session_id: string | null
  task_id: string | null
  agent_profile: string | null
  launch_mode: 'foreground' | 'background' | null
  subagent_depth: number | null
  session_kind: 'foreground' | 'subagent' | null
}

class SessionStoreImpl implements SessionStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(input: CreateSessionInput, tenantId: string = DEFAULT_TENANT_ID): Session {
    const now = new Date().toISOString()
    const session: Session = {
      sessionId: input.sessionId,
      userId: input.userId,
      title: input.title,
      status: input.status ?? 'active',
      messageCount: input.messageCount ?? 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
      sessionKind: input.sessionKind,
      parentSessionId: input.parentSessionId,
      taskId: input.taskId,
      agentProfile: input.agentProfile,
      launchMode: input.launchMode,
      subagentDepth: input.subagentDepth,
    }

    const sql = `
      INSERT INTO sessions (
        session_id, user_id, title, status, message_count,
        last_activity_at, created_at, updated_at, metadata, tenant_id,
        session_kind, parent_session_id, task_id, agent_profile, launch_mode, subagent_depth
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      session.sessionId,
      session.userId,
      session.title,
      session.status,
      session.messageCount,
      session.lastActivityAt,
      session.createdAt,
      session.updatedAt,
      session.metadata ? JSON.stringify(session.metadata) : null,
      tenantId,
      session.sessionKind ?? 'foreground',
      session.parentSessionId ?? null,
      session.taskId ?? null,
      session.agentProfile ?? null,
      session.launchMode ?? null,
      session.subagentDepth ?? 0,
    ]

    this.connection.exec(sql, params)
    return session
  }

  getById(sessionId: string, tenantId: string = DEFAULT_TENANT_ID): Session | null {
    const sql = 'SELECT * FROM sessions WHERE tenant_id = ? AND session_id = ?'
    const rows = this.connection.query<SessionRow>(sql, [tenantId, sessionId])

    if (rows.length === 0) {
      return null
    }

    return this.rowToSession(rows[0])
  }

  list(options: ListSessionsOptions = {}, tenantId: string = DEFAULT_TENANT_ID): Session[] {
    const { userId, status, limit = 100, offset = 0 } = options

    let sql: string
    let params: unknown[]

    if (userId && status) {
      sql = `
        SELECT * FROM sessions
        WHERE tenant_id = ? AND session_kind != 'subagent' AND user_id = ? AND status = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      params = [tenantId, userId, status, limit, offset]
    } else if (userId) {
      sql = `
        SELECT * FROM sessions
        WHERE tenant_id = ? AND session_kind != 'subagent' AND user_id = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      params = [tenantId, userId, limit, offset]
    } else if (status) {
      sql = `
        SELECT * FROM sessions
        WHERE tenant_id = ? AND session_kind != 'subagent' AND status = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      params = [tenantId, status, limit, offset]
    } else {
      sql = `
        SELECT * FROM sessions
        WHERE tenant_id = ? AND session_kind != 'subagent'
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `
      params = [tenantId, limit, offset]
    }

    const rows = this.connection.query<SessionRow>(sql, params)
    return rows.map((row) => this.rowToSession(row))
  }

  updateActivity(sessionId: string, lastActivityAt: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE sessions
      SET last_activity_at = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [lastActivityAt, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  updateMetadata(sessionId: string, input: UpdateMetadataInput, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const updates: string[] = []
    const params: unknown[] = []
    const now = new Date().toISOString()

    if (input.messageCount !== undefined) {
      updates.push('message_count = ?')
      params.push(input.messageCount)
    }

    if (input.lastActivityAt !== undefined) {
      updates.push('last_activity_at = ?')
      params.push(input.lastActivityAt)
    }

    if (updates.length === 0) {
      return false
    }

    updates.push('updated_at = ?')
    params.push(now)
    params.push(tenantId)
    params.push(sessionId)

    const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE tenant_id = ? AND session_id = ?`

    try {
      this.connection.exec(sql, params)
      return true
    } catch {
      return false
    }
  }

  updateStatus(
    sessionId: string,
    status: 'active' | 'archived' | 'closed',
    tenantId: string = DEFAULT_TENANT_ID,
  ): boolean {
    const sql = `
      UPDATE sessions
      SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [status, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  updateTitle(sessionId: string, title: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE sessions
      SET title = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [title, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  updateUserId(sessionId: string, newUserId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE sessions
      SET user_id = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [newUserId, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  setModel(
    sessionId: string,
    selectedModel: string,
    selectedProviderId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): boolean {
    const sql = `
      UPDATE sessions
      SET selected_model = ?, selected_provider_id = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [selectedModel, selectedProviderId, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  setReasoningDepth(sessionId: string, reasoningDepth: ReasoningDepth, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE sessions
      SET reasoning_depth = ?, updated_at = ?
      WHERE tenant_id = ? AND session_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [reasoningDepth, now, tenantId, sessionId])
      return true
    } catch {
      return false
    }
  }

  getCount(
    options: { userId?: string; status?: 'active' | 'archived' | 'closed' } = {},
    tenantId: string = DEFAULT_TENANT_ID,
  ): number {
    const { userId, status } = options

    let sql: string
    let params: unknown[]

    if (userId && status) {
      sql =
        "SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ? AND session_kind != 'subagent' AND user_id = ? AND status = ?"
      params = [tenantId, userId, status]
    } else if (userId) {
      sql = "SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ? AND session_kind != 'subagent' AND user_id = ?"
      params = [tenantId, userId]
    } else if (status) {
      sql = "SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ? AND session_kind != 'subagent' AND status = ?"
      params = [tenantId, status]
    } else {
      sql = "SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ? AND session_kind != 'subagent'"
      params = [tenantId]
    }

    const rows = this.connection.query<{ count: number }>(sql, params)
    return rows[0]?.count ?? 0
  }

  private rowToSession(row: SessionRow): Session {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      title: row.title,
      status: row.status,
      messageCount: row.message_count,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      selectedModel: row.selected_model ?? undefined,
      selectedProviderId: row.selected_provider_id ?? undefined,
      reasoningDepth: parseReasoningDepth(row.reasoning_depth ?? DEFAULT_REASONING_DEPTH),
      sessionKind: row.session_kind ?? undefined,
      parentSessionId: row.parent_session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentProfile: row.agent_profile ?? undefined,
      launchMode: row.launch_mode ?? undefined,
      subagentDepth: row.subagent_depth ?? undefined,
    }
  }

  createChildSession(input: CreateChildSessionInput, tenantId: string = DEFAULT_TENANT_ID): Session {
    return this.create(
      {
        sessionId: input.sessionId,
        userId: input.userId,
        title: input.title ?? 'Subagent task',
        status: input.status,
        messageCount: input.messageCount,
        metadata: input.metadata,
        sessionKind: 'subagent',
        parentSessionId: input.parentSessionId,
        taskId: input.taskId ?? input.sessionId,
        agentProfile: input.agentProfile,
        launchMode: input.launchMode ?? 'foreground',
        subagentDepth: input.subagentDepth ?? 1,
      },
      tenantId,
    )
  }

  getChildSessionById(sessionId: string, tenantId: string = DEFAULT_TENANT_ID): Session | null {
    const sql = "SELECT * FROM sessions WHERE tenant_id = ? AND session_id = ? AND session_kind = 'subagent'"
    const rows = this.connection.query<SessionRow>(sql, [tenantId, sessionId])
    return rows.length === 0 ? null : this.rowToSession(rows[0]!)
  }

  getByTaskId(taskId: string, userId?: string, tenantId: string = DEFAULT_TENANT_ID): Session | null {
    let sql = "SELECT * FROM sessions WHERE tenant_id = ? AND task_id = ? AND session_kind = 'subagent'"
    const params: unknown[] = [tenantId, taskId]
    if (userId !== undefined) {
      sql += ' AND user_id = ?'
      params.push(userId)
    }
    const rows = this.connection.query<SessionRow>(sql, params)
    return rows.length === 0 ? null : this.rowToSession(rows[0]!)
  }

  listChildren(
    parentSessionId: string,
    options: ListChildrenOptions = {},
    tenantId: string = DEFAULT_TENANT_ID,
  ): Session[] {
    const { status, limit = 100, offset = 0 } = options

    let sql = "SELECT * FROM sessions WHERE tenant_id = ? AND parent_session_id = ? AND session_kind = 'subagent'"
    const params: unknown[] = [tenantId, parentSessionId]
    if (status !== undefined) {
      sql += ' AND status = ?'
      params.push(status)
    }
    sql += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = this.connection.query<SessionRow>(sql, params)
    return rows.map((row) => this.rowToSession(row))
  }

  countChildLaunches(parentSessionId: string, since?: string, tenantId: string = DEFAULT_TENANT_ID): number {
    let sql =
      "SELECT COUNT(*) as count FROM sessions WHERE tenant_id = ? AND parent_session_id = ? AND session_kind = 'subagent'"
    const params: unknown[] = [tenantId, parentSessionId]
    if (since !== undefined) {
      sql += ' AND created_at >= ?'
      params.push(since)
    }
    const rows = this.connection.query<{ count: number }>(sql, params)
    return rows[0]?.count ?? 0
  }

  archiveDescendants(parentSessionId: string, tenantId: string = DEFAULT_TENANT_ID): number {
    const descendantsSql = `
      WITH RECURSIVE descendants AS (
        SELECT session_id FROM sessions WHERE tenant_id = ? AND parent_session_id = ?
        UNION ALL
        SELECT s.session_id FROM sessions s
        JOIN descendants d ON s.parent_session_id = d.session_id
        WHERE s.tenant_id = ?
      )
      SELECT COUNT(*) as count FROM descendants WHERE session_id IN (
        SELECT session_id FROM sessions WHERE tenant_id = ? AND status != 'archived'
      )
    `
    const archiveSql = `
      WITH RECURSIVE descendants AS (
        SELECT session_id FROM sessions WHERE tenant_id = ? AND parent_session_id = ?
        UNION ALL
        SELECT s.session_id FROM sessions s
        JOIN descendants d ON s.parent_session_id = d.session_id
        WHERE s.tenant_id = ?
      )
      UPDATE sessions
      SET status = 'archived', updated_at = ?
      WHERE tenant_id = ? AND status != 'archived' AND session_id IN (SELECT session_id FROM descendants)
    `

    return this.connection.transaction(() => {
      const rows = this.connection.query<{ count: number }>(descendantsSql, [
        tenantId,
        parentSessionId,
        tenantId,
        tenantId,
      ])
      const now = new Date().toISOString()
      this.connection.exec(archiveSql, [tenantId, parentSessionId, tenantId, now, tenantId])
      return rows[0]?.count ?? 0
    })()
  }
}

export function createSessionStore(connection: ConnectionManager): SessionStore {
  return new SessionStoreImpl(connection)
}
