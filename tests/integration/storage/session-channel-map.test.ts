import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import {
  createSessionChannelMapStore,
  type SessionChannelMapStore,
} from '../../../src/storage/session-channel-map-store.js'
import { sessionChannelMappingsTableMigration } from '../../../src/storage/all-stores-migrations.js'

describe('SessionChannelMapStore', () => {
  let connection: ConnectionManager
  let store: SessionChannelMapStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const statements = sessionChannelMappingsTableMigration.up
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const stmt of statements) {
      connection.exec(stmt)
    }

    store = createSessionChannelMapStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('createMapping', () => {
    it('should create a mapping with all fields', () => {
      const mapping = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-002',
      })

      expect(mapping.id).toBeDefined()
      expect(mapping.provider).toBe('feishu')
      expect(mapping.externalConversationId).toBe('conv-123')
      expect(mapping.externalUserId).toBe('ext-user-456')
      expect(mapping.connectorInstanceId).toBe('ci-789')
      expect(mapping.internalUserId).toBe('int-user-001')
      expect(mapping.internalSessionId).toBe('int-session-002')
      expect(mapping.createdAt).toBeDefined()
      expect(mapping.lastSeenAt).toBeDefined()
      expect(mapping.createdAt).toBe(mapping.lastSeenAt)
    })

    it('should return existing mapping on duplicate external ids', () => {
      const first = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-002',
      })

      const second = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-different',
        internalSessionId: 'int-session-different',
      })

      expect(second.id).toBe(first.id)
      expect(second.internalUserId).toBe('int-user-001')
      expect(second.internalSessionId).toBe('int-session-002')
    })

    it('should create separate mappings for different providers', () => {
      const feishu = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-002',
      })

      const telegram = store.createMapping({
        provider: 'telegram',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-003',
      })

      expect(feishu.id).not.toBe(telegram.id)
      expect(feishu.internalSessionId).toBe('int-session-002')
      expect(telegram.internalSessionId).toBe('int-session-003')
    })

    it('should create separate mappings for different connector instances', () => {
      const first = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-aaa',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-002',
      })

      const second = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-bbb',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-003',
      })

      expect(first.id).not.toBe(second.id)
    })
  })

  describe('findByExternalIds', () => {
    it('should find an existing mapping by external ids', () => {
      const created = store.createMapping({
        provider: 'telegram',
        externalConversationId: 'tg-chat-111',
        externalUserId: 'tg-user-222',
        connectorInstanceId: 'ci-333',
        internalUserId: 'int-user-444',
        internalSessionId: 'int-session-555',
      })

      const found = store.findByExternalIds('telegram', 'tg-chat-111', 'tg-user-222', 'ci-333')

      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.internalUserId).toBe('int-user-444')
      expect(found?.internalSessionId).toBe('int-session-555')
    })

    it('should return undefined for non-existent external ids', () => {
      const found = store.findByExternalIds('feishu', 'no-such-conv', 'no-such-user', 'no-such-ci')
      expect(found).toBeUndefined()
    })

    it('should return same session id on second lookup', () => {
      store.createMapping({
        provider: 'dingtalk',
        externalConversationId: 'dd-group-100',
        externalUserId: 'dd-user-200',
        connectorInstanceId: 'dd-ci-300',
        internalUserId: 'int-user-400',
        internalSessionId: 'int-session-500',
      })

      const first = store.findByExternalIds('dingtalk', 'dd-group-100', 'dd-user-200', 'dd-ci-300')
      const second = store.findByExternalIds('dingtalk', 'dd-group-100', 'dd-user-200', 'dd-ci-300')

      expect(first?.internalSessionId).toBe('int-session-500')
      expect(second?.internalSessionId).toBe('int-session-500')
      expect(first?.id).toBe(second?.id)
    })
  })

  describe('updateLastSeen', () => {
    it('should update lastSeenAt timestamp', async () => {
      const mapping = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-123',
        externalUserId: 'ext-user-456',
        connectorInstanceId: 'ci-789',
        internalUserId: 'int-user-001',
        internalSessionId: 'int-session-002',
      })

      const originalLastSeen = mapping.lastSeenAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = store.updateLastSeen(mapping.id)

      expect(updated).toBeDefined()
      expect(updated?.lastSeenAt).not.toBe(originalLastSeen)
      expect(updated?.id).toBe(mapping.id)
      expect(updated?.provider).toBe('feishu')
    })

    it('should return undefined for non-existent id', () => {
      const updated = store.updateLastSeen('non-existent-id')
      expect(updated).toBeUndefined()
    })

    it('should preserve all other fields after update', () => {
      const mapping = store.createMapping({
        provider: 'telegram',
        externalConversationId: 'tg-conv',
        externalUserId: 'tg-user',
        connectorInstanceId: 'tg-ci',
        internalUserId: 'int-user',
        internalSessionId: 'int-session',
      })

      const updated = store.updateLastSeen(mapping.id)

      expect(updated?.provider).toBe('telegram')
      expect(updated?.externalConversationId).toBe('tg-conv')
      expect(updated?.externalUserId).toBe('tg-user')
      expect(updated?.connectorInstanceId).toBe('tg-ci')
      expect(updated?.internalUserId).toBe('int-user')
      expect(updated?.internalSessionId).toBe('int-session')
      expect(updated?.createdAt).toBe(mapping.createdAt)
    })
  })

  describe('deleteMapping', () => {
    it('should delete an existing mapping', () => {
      const mapping = store.createMapping({
        provider: 'feishu',
        externalConversationId: 'conv-del',
        externalUserId: 'ext-user-del',
        connectorInstanceId: 'ci-del',
        internalUserId: 'int-user-del',
        internalSessionId: 'int-session-del',
      })

      const deleted = store.deleteMapping(mapping.id)
      expect(deleted).toBe(true)

      const found = store.findByExternalIds('feishu', 'conv-del', 'ext-user-del', 'ci-del')
      expect(found).toBeUndefined()
    })

    it('should return false for non-existent id', () => {
      const deleted = store.deleteMapping('non-existent-id')
      expect(deleted).toBe(false)
    })
  })

  describe('end-to-end: inbound message creates mapping, second reuses session', () => {
    it('should create mapping on first inbound and reuse on second', () => {
      const provider = 'feishu'
      const externalConversationId = 'chat_abc'
      const externalUserId = 'user_xyz'
      const connectorInstanceId = 'conn_inst_1'

      const firstMapping = store.createMapping({
        provider,
        externalConversationId,
        externalUserId,
        connectorInstanceId,
        internalUserId: 'auto-user-1',
        internalSessionId: 'auto-session-1',
      })

      expect(firstMapping.id).toBeDefined()
      expect(firstMapping.internalSessionId).toBe('auto-session-1')

      const secondLookup = store.findByExternalIds(
        provider,
        externalConversationId,
        externalUserId,
        connectorInstanceId,
      )

      expect(secondLookup).toBeDefined()
      expect(secondLookup?.id).toBe(firstMapping.id)
      expect(secondLookup?.internalSessionId).toBe('auto-session-1')
    })
  })
})
