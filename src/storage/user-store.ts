import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export type UserRole = 'admin' | 'user' | 'service'

export interface User {
  userId: string
  username: string
  passwordHash: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  userId: string
  username: string
  passwordHash: string
  role?: UserRole
}

export interface UserStore {
  create(input: CreateUserInput, tenantId?: string): User
  getById(userId: string, tenantId?: string): User | null
  getByUsername(username: string, tenantId?: string): User | null
  getFirstCreated(tenantId?: string): User | null
  list(tenantId?: string): User[]
  updatePassword(userId: string, passwordHash: string, tenantId?: string): boolean
}

interface UserRow {
  user_id: string
  username: string
  password_hash: string
  role: UserRole
  created_at: string
  updated_at: string
}

class UserStoreImpl implements UserStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(input: CreateUserInput, tenantId: string = DEFAULT_TENANT_ID): User {
    const isFirstUser = this.getFirstCreated(tenantId) === null
    const role = input.role ?? (isFirstUser ? 'admin' : 'user')
    const now = new Date().toISOString()
    const user: User = {
      userId: input.userId,
      username: input.username,
      passwordHash: input.passwordHash,
      role,
      createdAt: now,
      updatedAt: now,
    }

    const sql = `
      INSERT INTO users (
        user_id, username, password_hash, role, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `

    const params = [user.userId, user.username, user.passwordHash, user.role, user.createdAt, user.updatedAt, tenantId]

    this.connection.exec(sql, params)
    return user
  }

  getById(userId: string, tenantId: string = DEFAULT_TENANT_ID): User | null {
    const sql = 'SELECT * FROM users WHERE tenant_id = ? AND user_id = ?'
    const rows = this.connection.query<UserRow>(sql, [tenantId, userId])

    if (rows.length === 0) {
      return null
    }

    return this.rowToUser(rows[0])
  }

  getByUsername(username: string, tenantId: string = DEFAULT_TENANT_ID): User | null {
    const sql = 'SELECT * FROM users WHERE tenant_id = ? AND username = ?'
    const rows = this.connection.query<UserRow>(sql, [tenantId, username])

    if (rows.length === 0) {
      return null
    }

    return this.rowToUser(rows[0])
  }

  getFirstCreated(tenantId: string = DEFAULT_TENANT_ID): User | null {
    const sql = 'SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1'
    const rows = this.connection.query<UserRow>(sql, [tenantId])

    if (rows.length === 0) {
      return null
    }

    return this.rowToUser(rows[0])
  }

  list(tenantId: string = DEFAULT_TENANT_ID): User[] {
    const sql = 'SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at DESC'
    const rows = this.connection.query<UserRow>(sql, [tenantId])
    return rows.map((row) => this.rowToUser(row))
  }

  updatePassword(userId: string, passwordHash: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE tenant_id = ? AND user_id = ?
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [passwordHash, now, tenantId, userId])
      return true
    } catch {
      return false
    }
  }

  private rowToUser(row: UserRow): User {
    return {
      userId: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export function createUserStore(connection: ConnectionManager): UserStore {
  return new UserStoreImpl(connection)
}
