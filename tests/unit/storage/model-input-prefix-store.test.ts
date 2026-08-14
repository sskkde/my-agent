import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  createModelInputPrefixStore,
  composePrefixKey,
  type ModelInputPrefixStore,
} from '../../../src/storage/model-input-prefix-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): MigrationRunner {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
  return runner
}

function makeStore(): ModelInputPrefixStore {
  const connection = openMemoryConnection()
  applyAll(connection)
  return createModelInputPrefixStore(connection)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('ModelInputPrefixStore', () => {
  it('records a first-seen prefix hash and reports no change', () => {
    const store = makeStore()
    const changed = store.recordPrefixHash('org_default', 'default_main|openai|none', 'hash-1')
    expect(changed).toBe(false)
    expect(store.getPrefixHash('org_default', 'default_main|openai|none')).toBe('hash-1')
  })

  it('reports no change when the same hash is recorded again', () => {
    const store = makeStore()
    store.recordPrefixHash('org_default', 'default_main|openai|none', 'hash-1')
    const changed = store.recordPrefixHash('org_default', 'default_main|openai|none', 'hash-1')
    expect(changed).toBe(false)
    expect(store.getPrefixHash('org_default', 'default_main|openai|none')).toBe('hash-1')
  })

  it('reports drift when the hash changes for an existing key', () => {
    const store = makeStore()
    store.recordPrefixHash('org_default', 'default_main|openai|none', 'hash-1')
    const changed = store.recordPrefixHash('org_default', 'default_main|openai|none', 'hash-2')
    expect(changed).toBe(true)
    expect(store.getPrefixHash('org_default', 'default_main|openai|none')).toBe('hash-2')
  })

  it('keeps the fingerprint per tenant isolated', () => {
    const store = makeStore()
    store.recordPrefixHash('tenant-a', 'default_main|openai|none', 'hash-a')
    store.recordPrefixHash('tenant-b', 'default_main|openai|none', 'hash-b')

    // Drift within tenant-a only.
    const changedA = store.recordPrefixHash('tenant-a', 'default_main|openai|none', 'hash-a2')
    const changedB = store.recordPrefixHash('tenant-b', 'default_main|openai|none', 'hash-b')
    expect(changedA).toBe(true)
    expect(changedB).toBe(false)
    expect(store.getPrefixHash('tenant-a', 'default_main|openai|none')).toBe('hash-a2')
    expect(store.getPrefixHash('tenant-b', 'default_main|openai|none')).toBe('hash-b')
  })

  it('returns null for an unknown prefix key', () => {
    const store = makeStore()
    expect(store.getPrefixHash('org_default', 'missing|key|none')).toBeNull()
  })

  it('defaults the tenant to org_default when omitted', () => {
    const store = makeStore()
    const changed = store.recordPrefixHash(undefined, 'default_main|openai|none', 'hash-1')
    expect(changed).toBe(false)
    expect(store.getPrefixHash(undefined, 'default_main|openai|none')).toBe('hash-1')
  })
})

describe('composePrefixKey', () => {
  it('builds a stable human-readable composite key', () => {
    expect(composePrefixKey('default_main', 'openai', 'output:default-chat.schema')).toBe(
      'default_main|openai|output:default-chat.schema',
    )
  })

  it('falls back to none for a missing output contract', () => {
    expect(composePrefixKey('subagent', 'deepseek')).toBe('subagent|deepseek|none')
  })
})
