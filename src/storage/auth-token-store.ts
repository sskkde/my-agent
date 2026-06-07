import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface AuthToken {
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
}

export interface CreateAuthTokenInput {
  tokenHash: string
  userId: string
  expiresAt: string
}

export interface AuthTokenStore {
  create(input: CreateAuthTokenInput, tenantId?: string): AuthToken
  findByHash(tokenHash: string, tenantId?: string): AuthToken | null
  revoke(tokenHash: string, tenantId?: string): boolean
  purgeExpired(now: string, tenantId?: string): number
}

interface AuthTokenRow {
  token_hash: string
  user_id: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}

class AuthTokenStoreImpl implements AuthTokenStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  create(input: CreateAuthTokenInput, tenantId: string = DEFAULT_TENANT_ID): AuthToken {
    const now = new Date().toISOString()
    const token: AuthToken = {
      tokenHash: input.tokenHash,
      userId: input.userId,
      createdAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
    }

    const sql = `
      INSERT INTO auth_tokens (
        token_hash, user_id, created_at, expires_at, revoked_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `

    const params = [token.tokenHash, token.userId, token.createdAt, token.expiresAt, token.revokedAt, tenantId]

    this.connection.exec(sql, params)
    return token
  }

  findByHash(tokenHash: string, tenantId: string = DEFAULT_TENANT_ID): AuthToken | null {
    const sql = 'SELECT * FROM auth_tokens WHERE tenant_id = ? AND token_hash = ?'
    const rows = this.connection.query<AuthTokenRow>(sql, [tenantId, tokenHash])

    if (rows.length === 0) {
      return null
    }

    return this.rowToAuthToken(rows[0])
  }

  revoke(tokenHash: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE auth_tokens
      SET revoked_at = ?
      WHERE tenant_id = ? AND token_hash = ? AND revoked_at IS NULL
    `

    const now = new Date().toISOString()

    try {
      this.connection.exec(sql, [now, tenantId, tokenHash])
      return true
    } catch {
      return false
    }
  }

  purgeExpired(now: string, tenantId: string = DEFAULT_TENANT_ID): number {
    const sql = 'DELETE FROM auth_tokens WHERE tenant_id = ? AND expires_at < ?'

    try {
      this.connection.exec(sql, [tenantId, now])
      const result = this.connection.query<{ changes: number }>('SELECT changes() as changes')
      return result[0]?.changes ?? 0
    } catch {
      return 0
    }
  }

  private rowToAuthToken(row: AuthTokenRow): AuthToken {
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }
  }
}

export function createAuthTokenStore(connection: ConnectionManager): AuthTokenStore {
  return new AuthTokenStoreImpl(connection)
}
