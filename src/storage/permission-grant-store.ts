import type { ConnectionManager } from './connection.js';

export interface PermissionGrant {
  id: string;
  userId: string;
  scope: string;
  action: string;
  resourcePattern?: string | null;
  conditions?: string | null;
  riskLevelMax?: string | null;
  expiresAt?: string | null;
  sourceContext?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePermissionGrant {
  id: string;
  userId: string;
  scope: string;
  action: string;
  resourcePattern?: string;
  conditions?: string;
  riskLevelMax?: string;
  expiresAt?: string;
  sourceContext?: string;
}

export interface PermissionGrantStore {
  create(grant: CreatePermissionGrant): PermissionGrant;
  getById(id: string): PermissionGrant | null;
  findByUser(userId: string): PermissionGrant[];
  findActiveByUserAndScope(userId: string, scope: string): PermissionGrant[];
  findExpired(before: string): PermissionGrant[];
  revoke(id: string, reason: string): PermissionGrant;
  delete(id: string): void;
}

class PermissionGrantStoreImpl implements PermissionGrantStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(grant: CreatePermissionGrant): PermissionGrant {
    const now = new Date().toISOString();
    const permissionGrant: PermissionGrant = {
      id: grant.id,
      userId: grant.userId,
      scope: grant.scope,
      action: grant.action,
      resourcePattern: grant.resourcePattern ?? null,
      conditions: grant.conditions ?? null,
      riskLevelMax: grant.riskLevelMax ?? null,
      expiresAt: grant.expiresAt ?? null,
      sourceContext: grant.sourceContext ?? null,
      revokedAt: null,
      revokedReason: null,
      createdAt: now,
      updatedAt: now,
    };

    this.connection.exec(
      `INSERT INTO permission_grants (
        id, user_id, scope, action, resource_pattern, conditions, risk_level_max,
        expires_at, source_context, revoked_at, revoked_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        permissionGrant.id,
        permissionGrant.userId,
        permissionGrant.scope,
        permissionGrant.action,
        permissionGrant.resourcePattern,
        permissionGrant.conditions,
        permissionGrant.riskLevelMax,
        permissionGrant.expiresAt,
        permissionGrant.sourceContext,
        permissionGrant.revokedAt,
        permissionGrant.revokedReason,
        permissionGrant.createdAt,
        permissionGrant.updatedAt,
      ]
    );

    return permissionGrant;
  }

  getById(id: string): PermissionGrant | null {
    const results = this.connection.query<PermissionGrantRow>(
      'SELECT * FROM permission_grants WHERE id = ?',
      [id]
    );

    if (results.length === 0) {
      return null;
    }

    return this.rowToGrant(results[0]);
  }

  findByUser(userId: string): PermissionGrant[] {
    const results = this.connection.query<PermissionGrantRow>(
      'SELECT * FROM permission_grants WHERE user_id = ?',
      [userId]
    );
    return results.map(row => this.rowToGrant(row));
  }

  findActiveByUserAndScope(userId: string, scope: string): PermissionGrant[] {
    const now = new Date().toISOString();
    const results = this.connection.query<PermissionGrantRow>(
      `SELECT * FROM permission_grants
       WHERE user_id = ? AND scope = ?
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
      [userId, scope, now]
    );
    return results.map(row => this.rowToGrant(row));
  }

  findExpired(before: string): PermissionGrant[] {
    const results = this.connection.query<PermissionGrantRow>(
      'SELECT * FROM permission_grants WHERE expires_at IS NOT NULL AND expires_at < ?',
      [before]
    );
    return results.map(row => this.rowToGrant(row));
  }

  revoke(id: string, reason: string): PermissionGrant {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Permission grant not found: ${id}`);
    }

    const now = new Date().toISOString();
    const updated: PermissionGrant = {
      ...existing,
      revokedAt: now,
      revokedReason: reason,
      updatedAt: now,
    };

    this.connection.exec(
      `UPDATE permission_grants SET
        revoked_at = ?,
        revoked_reason = ?,
        updated_at = ?
      WHERE id = ?`,
      [updated.revokedAt, updated.revokedReason, updated.updatedAt, id]
    );

    return updated;
  }

  delete(id: string): void {
    this.connection.exec('DELETE FROM permission_grants WHERE id = ?', [id]);
  }

  private rowToGrant(row: PermissionGrantRow): PermissionGrant {
    return {
      id: row.id,
      userId: row.user_id,
      scope: row.scope,
      action: row.action,
      resourcePattern: row.resource_pattern,
      conditions: row.conditions,
      riskLevelMax: row.risk_level_max,
      expiresAt: row.expires_at,
      sourceContext: row.source_context,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface PermissionGrantRow {
  id: string;
  user_id: string;
  scope: string;
  action: string;
  resource_pattern: string | null;
  conditions: string | null;
  risk_level_max: string | null;
  expires_at: string | null;
  source_context: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function createPermissionGrantStore(connection: ConnectionManager): PermissionGrantStore {
  return new PermissionGrantStoreImpl(connection);
}
