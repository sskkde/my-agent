import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createApiKeyStore, type CreateApiKeyInput } from '../../../src/storage/api-key-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createTestSchema(connection: ConnectionManager): void {
  // Create users table first (foreign key dependency)
  connection.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    )
  `)

  // Create api_keys table
  connection.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user', 'service')),
      user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    )
  `)

  // Create indexes
  connection.exec(`CREATE INDEX idx_api_keys_user ON api_keys(user_id)`)
  connection.exec(`CREATE INDEX idx_api_keys_hash ON api_keys(key_hash)`)
  connection.exec(`CREATE INDEX idx_api_keys_active ON api_keys(is_active)`)
}

function seedTestUser(connection: ConnectionManager, userId: string = 'user-1'): void {
  connection.exec(
    `INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, userId, 'hash123', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
  )
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('ApiKeyStore', () => {
  describe('createKey', () => {
    it('creates an API key with SHA-256 hash and prefix', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const input: CreateApiKeyInput = {
        id: 'key-1',
        name: 'Test Key',
        key: 'sk_test_1234567890abcdef',
        role: 'user',
        userId: 'user-1',
        expiresAt: '2026-12-31T23:59:59.000Z',
      }

      const result = store.createKey(input)

      expect(result.id).toBe('key-1')
      expect(result.name).toBe('Test Key')
      expect(result.keyHash).toHaveLength(64) // SHA-256 hex = 64 chars
      expect(result.keyPrefix).toBe('sk_test_') // First 8 chars
      expect(result.role).toBe('user')
      expect(result.userId).toBe('user-1')
      expect(result.isActive).toBe(true)
      expect(result.expiresAt).toBe('2026-12-31T23:59:59.000Z')
    })

    it('creates an API key without expiration', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const input: CreateApiKeyInput = {
        id: 'key-2',
        name: 'No Expiry Key',
        key: 'sk_noexpire_12345678',
        role: 'admin',
        userId: 'user-1',
      }

      const result = store.createKey(input)

      expect(result.expiresAt).toBeNull()
    })

    it('creates a service role API key without user_id', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)

      const store = createApiKeyStore(connection)
      const input: CreateApiKeyInput = {
        id: 'key-service',
        name: 'Service Key',
        key: 'sk_service_12345678',
        role: 'service',
      }

      const result = store.createKey(input)

      expect(result.role).toBe('service')
      expect(result.userId).toBeNull()
    })
  })

  describe('getKeyByHash', () => {
    it('returns key by hash', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const created = store.createKey({
        id: 'key-3',
        name: 'Lookup Key',
        key: 'sk_lookup_12345678',
        role: 'user',
        userId: 'user-1',
      })

      const found = store.getKeyByHash(created.keyHash)

      expect(found).not.toBeNull()
      expect(found?.id).toBe('key-3')
      expect(found?.keyHash).toBe(created.keyHash)
    })

    it('returns null for non-existent hash', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)

      const store = createApiKeyStore(connection)
      const found = store.getKeyByHash('nonexistenthash00000000000000000000000000000000')

      expect(found).toBeNull()
    })
  })

  describe('listKeysByUser', () => {
    it('lists all keys for a user', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection, 'user-1')
      seedTestUser(connection, 'user-2')

      const store = createApiKeyStore(connection)
      store.createKey({
        id: 'key-u1-1',
        name: 'User 1 Key 1',
        key: 'sk_u1_1_12345678',
        role: 'user',
        userId: 'user-1',
      })
      store.createKey({
        id: 'key-u1-2',
        name: 'User 1 Key 2',
        key: 'sk_u1_2_12345678',
        role: 'user',
        userId: 'user-1',
      })
      store.createKey({
        id: 'key-u2-1',
        name: 'User 2 Key 1',
        key: 'sk_u2_1_12345678',
        role: 'user',
        userId: 'user-2',
      })

      const keys = store.listKeysByUser('user-1')

      expect(keys).toHaveLength(2)
      expect(keys.map((k) => k.id)).toEqual(['key-u1-1', 'key-u1-2'])
    })

    it('returns empty array for user with no keys', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)

      const store = createApiKeyStore(connection)
      const keys = store.listKeysByUser('nonexistent-user')

      expect(keys).toEqual([])
    })
  })

  describe('revokeKey', () => {
    it('revokes an active key', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const created = store.createKey({
        id: 'key-revoke',
        name: 'To Revoke',
        key: 'sk_revoke_12345678',
        role: 'user',
        userId: 'user-1',
      })

      expect(created.isActive).toBe(true)

      const result = store.revokeKey('key-revoke')
      expect(result).toBe(true)

      const found = store.getKeyByHash(created.keyHash)
      expect(found?.isActive).toBe(false)
    })

    it('returns false for non-existent key', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)

      const store = createApiKeyStore(connection)
      const result = store.revokeKey('nonexistent-key')

      expect(result).toBe(false)
    })
  })

  describe('updateLastUsed', () => {
    it('updates last_used_at timestamp', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const created = store.createKey({
        id: 'key-usage',
        name: 'Usage Key',
        key: 'sk_usage_12345678',
        role: 'user',
        userId: 'user-1',
      })

      expect(created.lastUsedAt).toBeNull()

      const result = store.updateLastUsed(created.keyHash)
      expect(result).toBe(true)

      const found = store.getKeyByHash(created.keyHash)
      expect(found?.lastUsedAt).not.toBeNull()
    })

    it('returns false for non-existent key', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)

      const store = createApiKeyStore(connection)
      const result = store.updateLastUsed('nonexistenthash00000000000000000000000000000000')

      expect(result).toBe(false)
    })
  })

  describe('hash verification', () => {
    it('produces consistent SHA-256 hash for same key', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const key1 = store.createKey({
        id: 'key-hash-1',
        name: 'Hash Test 1',
        key: 'sk_same_key_12345',
        role: 'user',
        userId: 'user-1',
      })

      // Create another connection and store
      const connection2 = openMemoryConnection()
      createTestSchema(connection2)
      seedTestUser(connection2)

      const store2 = createApiKeyStore(connection2)
      const key2 = store2.createKey({
        id: 'key-hash-2',
        name: 'Hash Test 2',
        key: 'sk_same_key_12345',
        role: 'user',
        userId: 'user-1',
      })

      expect(key1.keyHash).toBe(key2.keyHash)
    })

    it('extracts correct 8-char prefix', () => {
      const connection = openMemoryConnection()
      createTestSchema(connection)
      seedTestUser(connection)

      const store = createApiKeyStore(connection)
      const key = store.createKey({
        id: 'key-prefix',
        name: 'Prefix Test',
        key: 'sk_prefix_test_1234567890',
        role: 'user',
        userId: 'user-1',
      })

      expect(key.keyPrefix).toBe('sk_prefi')
    })
  })
})
