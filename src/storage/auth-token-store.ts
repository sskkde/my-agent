import type { ConnectionManager } from './connection.js';

export interface AuthToken {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface CreateAuthTokenInput {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface AuthTokenStore {
  create(input: CreateAuthTokenInput): AuthToken;
  findByHash(tokenHash: string): AuthToken | null;
  revoke(tokenHash: string): boolean;
  purgeExpired(now: string): number;
}

interface AuthTokenRow {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

class AuthTokenStoreImpl implements AuthTokenStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(input: CreateAuthTokenInput): AuthToken {
    const now = new Date().toISOString();
    const token: AuthToken = {
      tokenHash: input.tokenHash,
      userId: input.userId,
      createdAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null
    };

    const sql = `
      INSERT INTO auth_tokens (
        token_hash, user_id, created_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?)
    `;

    const params = [
      token.tokenHash,
      token.userId,
      token.createdAt,
      token.expiresAt,
      token.revokedAt
    ];

    this.connection.exec(sql, params);
    return token;
  }

  findByHash(tokenHash: string): AuthToken | null {
    const sql = 'SELECT * FROM auth_tokens WHERE token_hash = ?';
    const rows = this.connection.query<AuthTokenRow>(sql, [tokenHash]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToAuthToken(rows[0]);
  }

  revoke(tokenHash: string): boolean {
    const sql = `
      UPDATE auth_tokens
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [now, tokenHash]);
      return true;
    } catch {
      return false;
    }
  }

  purgeExpired(now: string): number {
    const sql = 'DELETE FROM auth_tokens WHERE expires_at < ?';

    try {
      this.connection.exec(sql, [now]);
      const result = this.connection.query<{ changes: number }>('SELECT changes() as changes');
      return result[0]?.changes ?? 0;
    } catch {
      return 0;
    }
  }

  private rowToAuthToken(row: AuthTokenRow): AuthToken {
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at
    };
  }
}

export function createAuthTokenStore(connection: ConnectionManager): AuthTokenStore {
  return new AuthTokenStoreImpl(connection);
}
