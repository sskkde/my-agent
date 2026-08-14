import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface ModelInputPrefixStore {
  /**
   * Upsert the fingerprint for a prefix key. Returns `true` when the stored
   * hash CHANGED versus the previous value (drift detected), `false` for a
   * first-seen key or an unchanged hash.
   */
  recordPrefixHash(tenantId: string | undefined, prefixKey: string, prefixHash: string): boolean
  /** Return the persisted prefix hash for a key, or `null` when never recorded. */
  getPrefixHash(tenantId: string | undefined, prefixKey: string): string | null
}

/**
 * Stable, human-readable composite identity for a cache-stable prefix,
 * derived from the exact dimensions computeCacheKey's inputs are built from.
 */
export function composePrefixKey(agentProfile: string, providerFamily: string, outputContract?: string): string {
  return `${agentProfile}|${providerFamily}|${outputContract ?? 'none'}`
}

class ModelInputPrefixStoreImpl implements ModelInputPrefixStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  recordPrefixHash(tenantId: string | undefined, prefixKey: string, prefixHash: string): boolean {
    const resolvedTenant = tenantId ?? DEFAULT_TENANT_ID
    const existing = this.getPrefixHash(resolvedTenant, prefixKey)

    if (existing === null) {
      const now = new Date().toISOString()
      this.connection.exec(
        `INSERT INTO model_input_prefix (tenant_id, prefix_key, prefix_hash, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
        [resolvedTenant, prefixKey, prefixHash, now, now],
      )
      return false
    }

    const now = new Date().toISOString()
    if (existing === prefixHash) {
      this.connection.exec(`UPDATE model_input_prefix SET last_seen_at = ? WHERE tenant_id = ? AND prefix_key = ?`, [
        now,
        resolvedTenant,
        prefixKey,
      ])
      return false
    }

    this.connection.exec(
      `UPDATE model_input_prefix SET prefix_hash = ?, last_seen_at = ? WHERE tenant_id = ? AND prefix_key = ?`,
      [prefixHash, now, resolvedTenant, prefixKey],
    )
    return true
  }

  getPrefixHash(tenantId: string | undefined, prefixKey: string): string | null {
    const resolvedTenant = tenantId ?? DEFAULT_TENANT_ID
    const rows = this.connection.query<{ prefix_hash: string }>(
      'SELECT prefix_hash FROM model_input_prefix WHERE tenant_id = ? AND prefix_key = ?',
      [resolvedTenant, prefixKey],
    )
    return rows.length > 0 ? rows[0]!.prefix_hash : null
  }
}

export function createModelInputPrefixStore(connection: ConnectionManager): ModelInputPrefixStore {
  return new ModelInputPrefixStoreImpl(connection)
}
