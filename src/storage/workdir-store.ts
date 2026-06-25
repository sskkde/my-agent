import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface Workdir {
  id: string
  tenantId: string
  userId: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  metadata?: Record<string, unknown>
}

export interface CreateWorkdirInput {
  id: string
  userId: string
  name: string
  path: string
  metadata?: Record<string, unknown>
}

export interface UpdateWorkdirInput {
  name?: string
  path?: string
  metadata?: Record<string, unknown>
}

export interface WorkdirStore {
  create(input: CreateWorkdirInput, tenantId?: string): Workdir
  listByUser(userId: string, tenantId?: string): Workdir[]
  getById(id: string, userId: string, tenantId?: string): Workdir | null
  update(id: string, input: UpdateWorkdirInput, userId: string, tenantId?: string): boolean
  softDelete(id: string, userId: string, tenantId?: string): boolean
}

interface WorkdirRow {
  id: string
  tenant_id: string
  user_id: string
  name: string
  path: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  metadata: string | null
}

class WorkdirStoreImpl implements WorkdirStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(input: CreateWorkdirInput, tenantId: string = DEFAULT_TENANT_ID): Workdir {
    const now = new Date().toISOString()
    const workdir: Workdir = {
      id: input.id,
      tenantId,
      userId: input.userId,
      name: input.name,
      path: input.path,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      metadata: input.metadata,
    }

    const sql = `
      INSERT INTO work_directories (
        id, tenant_id, user_id, name, path,
        created_at, updated_at, deleted_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      workdir.id,
      workdir.tenantId,
      workdir.userId,
      workdir.name,
      workdir.path,
      workdir.createdAt,
      workdir.updatedAt,
      workdir.deletedAt,
      workdir.metadata ? JSON.stringify(workdir.metadata) : null,
    ]

    this.connection.exec(sql, params)
    return workdir
  }

  listByUser(userId: string, tenantId: string = DEFAULT_TENANT_ID): Workdir[] {
    const sql = `
      SELECT * FROM work_directories
      WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `
    const rows = this.connection.query<WorkdirRow>(sql, [tenantId, userId])
    return rows.map((row) => this.rowToWorkdir(row))
  }

  getById(id: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): Workdir | null {
    const sql = `
      SELECT * FROM work_directories
      WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL
    `
    const rows = this.connection.query<WorkdirRow>(sql, [tenantId, userId, id])
    if (rows.length === 0) {
      return null
    }
    return this.rowToWorkdir(rows[0]!)
  }

  update(id: string, input: UpdateWorkdirInput, userId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const updates: string[] = []
    const params: unknown[] = []
    const now = new Date().toISOString()

    if (input.name !== undefined) {
      updates.push('name = ?')
      params.push(input.name)
    }

    if (input.path !== undefined) {
      updates.push('path = ?')
      params.push(input.path)
    }

    if (input.metadata !== undefined) {
      updates.push('metadata = ?')
      params.push(input.metadata ? JSON.stringify(input.metadata) : null)
    }

    if (updates.length === 0) {
      return false
    }

    updates.push('updated_at = ?')
    params.push(now)
    params.push(tenantId)
    params.push(userId)
    params.push(id)

    const sql = `
      UPDATE work_directories
      SET ${updates.join(', ')}
      WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL
    `

    try {
      this.connection.exec(sql, params)
      return true
    } catch {
      return false
    }
  }

  softDelete(id: string, userId: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const now = new Date().toISOString()
    const sql = `
      UPDATE work_directories
      SET deleted_at = ?, updated_at = ?
      WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL
    `

    try {
      this.connection.exec(sql, [now, now, tenantId, userId, id])
      return true
    } catch {
      return false
    }
  }

  private rowToWorkdir(row: WorkdirRow): Workdir {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      name: row.name,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }
}

export function createWorkdirStore(connection: ConnectionManager): WorkdirStore {
  return new WorkdirStoreImpl(connection)
}
