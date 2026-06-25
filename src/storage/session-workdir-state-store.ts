import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SessionWorkdirState {
  tenantId: string
  userId: string
  sessionId: string
  activeWorkDirId: string
  createdAt: string
  updatedAt: string
}

export interface SessionWorkdirStateStore {
  getActive(sessionId: string, userId: string, tenantId?: string): SessionWorkdirState | null
  setActive(sessionId: string, workdirId: string, userId: string, tenantId?: string): boolean
  clearActive(sessionId: string, userId: string, tenantId?: string): boolean
  /** Clear all session active-selections pointing to a specific workdir. Returns count of cleared rows. */
  clearAllForWorkdir(workdirId: string, userId: string, tenantId?: string): number
}

interface SessionWorkdirStateRow {
  tenant_id: string
  user_id: string
  session_id: string
  active_work_dir_id: string
  created_at: string
  updated_at: string
}

class SessionWorkdirStateStoreImpl implements SessionWorkdirStateStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  getActive(sessionId: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): SessionWorkdirState | null {
    const sql = `
      SELECT sws.* FROM session_workdir_state sws
      INNER JOIN work_directories wd ON wd.id = sws.active_work_dir_id
        AND wd.tenant_id = sws.tenant_id
        AND wd.user_id = sws.user_id
        AND wd.deleted_at IS NULL
      WHERE sws.tenant_id = ? AND sws.user_id = ? AND sws.session_id = ?
    `
    const rows = this.connection.query<SessionWorkdirStateRow>(sql, [tenantId, userId, sessionId])
    if (rows.length === 0) {
      return null
    }
    return this.rowToState(rows[0]!)
  }

  setActive(sessionId: string, workdirId: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const ownershipSql = `
      SELECT id FROM work_directories
      WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL
    `
    const owners = this.connection.query<{ id: string }>(ownershipSql, [tenantId, userId, workdirId])
    if (owners.length === 0) {
      return false
    }

    const now = new Date().toISOString()
    const upsertSql = `
      INSERT INTO session_workdir_state (tenant_id, user_id, session_id, active_work_dir_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_id, session_id) DO UPDATE SET
        active_work_dir_id = excluded.active_work_dir_id,
        updated_at = excluded.updated_at
    `

    try {
      this.connection.exec(upsertSql, [tenantId, userId, sessionId, workdirId, now, now])
      return true
    } catch {
      return false
    }
  }

  clearActive(sessionId: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      DELETE FROM session_workdir_state
      WHERE tenant_id = ? AND user_id = ? AND session_id = ?
    `

    try {
      this.connection.exec(sql, [tenantId, userId, sessionId])
      return true
    } catch {
      return false
    }
  }

  clearAllForWorkdir(workdirId: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): number {
    const sql = `
      DELETE FROM session_workdir_state
      WHERE tenant_id = ? AND user_id = ? AND active_work_dir_id = ?
    `

    try {
      const before = this.connection.query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM session_workdir_state WHERE tenant_id = ? AND user_id = ? AND active_work_dir_id = ?`,
        [tenantId, userId, workdirId],
      )
      this.connection.exec(sql, [tenantId, userId, workdirId])
      return before[0]?.cnt ?? 0
    } catch {
      return 0
    }
  }

  private rowToState(row: SessionWorkdirStateRow): SessionWorkdirState {
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      sessionId: row.session_id,
      activeWorkDirId: row.active_work_dir_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export function createSessionWorkdirStateStore(connection: ConnectionManager): SessionWorkdirStateStore {
  return new SessionWorkdirStateStoreImpl(connection)
}
