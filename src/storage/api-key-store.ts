import { createHash } from 'crypto';
import type { ConnectionManager } from './connection.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export type ApiKeyRole = 'admin' | 'user' | 'service';

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  role: ApiKeyRole;
  userId: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isActive: boolean;
}

export interface CreateApiKeyInput {
  id: string;
  name: string;
  key: string;
  role: ApiKeyRole;
  userId?: string;
  expiresAt?: string;
}

export interface ApiKeyStore {
  createKey(input: CreateApiKeyInput, tenantId?: string): ApiKey;
  getKeyByHash(keyHash: string, tenantId?: string): ApiKey | null;
  listKeysByUser(userId: string, tenantId?: string): ApiKey[];
  revokeKey(id: string, tenantId?: string): boolean;
  updateLastUsed(keyHash: string, tenantId?: string): boolean;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  role: ApiKeyRole;
  user_id: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: number;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function extractPrefix(key: string): string {
  return key.slice(0, 8);
}

class ApiKeyStoreImpl implements ApiKeyStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createKey(input: CreateApiKeyInput, tenantId: string = DEFAULT_TENANT_ID): ApiKey {
    const now = new Date().toISOString();
    const keyHash = hashKey(input.key);
    const keyPrefix = extractPrefix(input.key);

    const sql = `
      INSERT INTO api_keys (
        id, name, key_hash, key_prefix, role, user_id,
        created_at, expires_at, last_used_at, is_active, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      input.id,
      input.name,
      keyHash,
      keyPrefix,
      input.role,
      input.userId ?? null,
      now,
      input.expiresAt ?? null,
      null,
      1,
      tenantId
    ];

    this.connection.exec(sql, params);

    return {
      id: input.id,
      name: input.name,
      keyHash,
      keyPrefix,
      role: input.role,
      userId: input.userId ?? null,
      createdAt: now,
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      isActive: true
    };
  }

  getKeyByHash(keyHash: string, tenantId: string = DEFAULT_TENANT_ID): ApiKey | null {
    const sql = 'SELECT * FROM api_keys WHERE tenant_id = ? AND key_hash = ?';
    const rows = this.connection.query<ApiKeyRow>(sql, [tenantId, keyHash]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToApiKey(rows[0]);
  }

  listKeysByUser(userId: string, tenantId: string = DEFAULT_TENANT_ID): ApiKey[] {
    const sql = `
      SELECT * FROM api_keys
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY created_at ASC, id ASC
    `;
    const rows = this.connection.query<ApiKeyRow>(sql, [tenantId, userId]);
    return rows.map(row => this.rowToApiKey(row));
  }

  revokeKey(id: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE api_keys
      SET is_active = 0
      WHERE tenant_id = ? AND id = ? AND is_active = 1
    `;

    try {
      this.connection.exec(sql, [tenantId, id]);
      const result = this.connection.query<{ changes: number }>('SELECT changes() as changes');
      return (result[0]?.changes ?? 0) > 0;
    } catch {
      return false;
    }
  }

  updateLastUsed(keyHash: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const sql = `
      UPDATE api_keys
      SET last_used_at = ?
      WHERE tenant_id = ? AND key_hash = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [now, tenantId, keyHash]);
      const result = this.connection.query<{ changes: number }>('SELECT changes() as changes');
      return (result[0]?.changes ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private rowToApiKey(row: ApiKeyRow): ApiKey {
    return {
      id: row.id,
      name: row.name,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      role: row.role,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      isActive: Boolean(row.is_active)
    };
  }
}

export function createApiKeyStore(connection: ConnectionManager): ApiKeyStore {
  return new ApiKeyStoreImpl(connection);
}
