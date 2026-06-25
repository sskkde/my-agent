import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SessionChannelMapping {
  id: string
  tenantId: string
  provider: string
  externalConversationId: string
  externalUserId: string
  connectorInstanceId: string
  internalUserId: string
  internalSessionId: string
  createdAt: string
  lastSeenAt: string
}

export interface SessionChannelMapStore {
  createMapping(
    data: Omit<SessionChannelMapping, 'id' | 'tenantId' | 'createdAt' | 'lastSeenAt'>,
    tenantId?: string,
  ): SessionChannelMapping

  findByExternalIds(
    provider: string,
    externalConversationId: string,
    externalUserId: string,
    connectorInstanceId: string,
    tenantId?: string,
  ): SessionChannelMapping | undefined

  updateLastSeen(id: string, tenantId?: string): SessionChannelMapping | undefined

  deleteMapping(id: string, tenantId?: string): boolean
}

interface MappingRow {
  id: string
  tenant_id: string
  provider: string
  external_conversation_id: string
  external_user_id: string
  connector_instance_id: string
  internal_user_id: string
  internal_session_id: string
  created_at: string
  last_seen_at: string
}

class SessionChannelMapStoreImpl implements SessionChannelMapStore {
  private connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  createMapping(
    data: Omit<SessionChannelMapping, 'id' | 'tenantId' | 'createdAt' | 'lastSeenAt'>,
    tenantId: string = DEFAULT_TENANT_ID,
  ): SessionChannelMapping {
    const existing = this.findByExternalIds(
      data.provider,
      data.externalConversationId,
      data.externalUserId,
      data.connectorInstanceId,
      tenantId,
    )
    if (existing) {
      return existing
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    this.connection.exec(
      `INSERT INTO session_channel_mappings (
        id, tenant_id, provider, external_conversation_id, external_user_id,
        connector_instance_id, internal_user_id, internal_session_id,
        created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        data.provider,
        data.externalConversationId,
        data.externalUserId,
        data.connectorInstanceId,
        data.internalUserId,
        data.internalSessionId,
        now,
        now,
      ],
    )

    return {
      id,
      tenantId,
      provider: data.provider,
      externalConversationId: data.externalConversationId,
      externalUserId: data.externalUserId,
      connectorInstanceId: data.connectorInstanceId,
      internalUserId: data.internalUserId,
      internalSessionId: data.internalSessionId,
      createdAt: now,
      lastSeenAt: now,
    }
  }

  findByExternalIds(
    provider: string,
    externalConversationId: string,
    externalUserId: string,
    connectorInstanceId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): SessionChannelMapping | undefined {
    const rows = this.connection.query<MappingRow>(
      `SELECT * FROM session_channel_mappings
       WHERE tenant_id = ? AND provider = ? AND external_conversation_id = ?
         AND external_user_id = ? AND connector_instance_id = ?`,
      [tenantId, provider, externalConversationId, externalUserId, connectorInstanceId],
    )

    if (rows.length === 0) {
      return undefined
    }

    return this.mapRow(rows[0]!)
  }

  updateLastSeen(id: string, tenantId: string = DEFAULT_TENANT_ID): SessionChannelMapping | undefined {
    const now = new Date().toISOString()
    this.connection.exec(
      'UPDATE session_channel_mappings SET last_seen_at = ? WHERE tenant_id = ? AND id = ?',
      [now, tenantId, id],
    )

    const rows = this.connection.query<MappingRow>(
      'SELECT * FROM session_channel_mappings WHERE tenant_id = ? AND id = ?',
      [tenantId, id],
    )

    if (rows.length === 0) {
      return undefined
    }

    return this.mapRow(rows[0]!)
  }

  deleteMapping(id: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    const rows = this.connection.query<MappingRow>(
      'SELECT * FROM session_channel_mappings WHERE tenant_id = ? AND id = ?',
      [tenantId, id],
    )

    if (rows.length === 0) {
      return false
    }

    this.connection.exec('DELETE FROM session_channel_mappings WHERE tenant_id = ? AND id = ?', [tenantId, id])
    return true
  }

  private mapRow(row: MappingRow): SessionChannelMapping {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      externalConversationId: row.external_conversation_id,
      externalUserId: row.external_user_id,
      connectorInstanceId: row.connector_instance_id,
      internalUserId: row.internal_user_id,
      internalSessionId: row.internal_session_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }
  }
}

export function createSessionChannelMapStore(connection: ConnectionManager): SessionChannelMapStore {
  return new SessionChannelMapStoreImpl(connection)
}
