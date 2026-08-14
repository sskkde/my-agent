import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations, modelInputPrefixTableMigration } from '../../../src/storage/all-stores-migrations.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createRunner(connection: ConnectionManager): MigrationRunner {
  const runner = createMigrationRunner(connection)
  runner.init()
  return runner
}

function applyAll(connection: ConnectionManager): MigrationRunner {
  const runner = createRunner(connection)
  runner.apply(allStoreMigrations)
  return runner
}

function getColumnNames(connection: ConnectionManager, tableName: string): string[] {
  return connection.query<{ name: string }>(`PRAGMA table_info('${tableName}')`).map((column) => column.name)
}

function getIndexNames(connection: ConnectionManager, tableName: string): string[] {
  return connection.query<{ name: string }>(`PRAGMA index_list('${tableName}')`).map((index) => index.name)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('model input prefix table migration', () => {
  it('runs a fresh :memory: DB through all migrations and creates the model_input_prefix table', () => {
    const connection = openMemoryConnection()
    const runner = applyAll(connection)

    const columns = getColumnNames(connection, 'model_input_prefix')
    expect(columns).toContain('tenant_id')
    expect(columns).toContain('prefix_key')
    expect(columns).toContain('prefix_hash')
    expect(columns).toContain('first_seen_at')
    expect(columns).toContain('last_seen_at')
    expect(runner.getCurrentVersion()).toBe(78)
  })

  it('creates a tenant+key index on model_input_prefix', () => {
    const connection = openMemoryConnection()
    applyAll(connection)

    const indexes = getIndexNames(connection, 'model_input_prefix')
    expect(indexes).toContain('idx_model_input_prefix_tenant_key')
  })

  it('upserts a fingerprint row across the migration boundary', () => {
    const connection = openMemoryConnection()
    const runner = createRunner(connection)
    // Apply every migration except v78.
    runner.apply(allStoreMigrations.filter((migration) => migration.version !== 78))
    expect(runner.getCurrentVersion()).toBe(77)

    // Apply the prefix migration to the existing DB.
    runner.apply([modelInputPrefixTableMigration])

    connection.exec(
      `INSERT INTO model_input_prefix (tenant_id, prefix_key, prefix_hash, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['org_default', 'default_main|openai|none', 'hash-1', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'],
    )

    const rows = connection.query<{ prefix_key: string; prefix_hash: string }>(
      'SELECT prefix_key, prefix_hash FROM model_input_prefix WHERE prefix_key = ?',
      ['default_main|openai|none'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.prefix_hash).toBe('hash-1')
    expect(runner.getCurrentVersion()).toBe(78)
  })

  it('is idempotent-safe when the migration runner is applied twice', () => {
    const connection = openMemoryConnection()
    const runner = createRunner(connection)
    runner.apply(allStoreMigrations)
    runner.apply(allStoreMigrations)

    const columns = getColumnNames(connection, 'model_input_prefix')
    expect(columns.filter((name) => name === 'prefix_key')).toHaveLength(1)
    expect(columns.filter((name) => name === 'prefix_hash')).toHaveLength(1)

    const indexes = getIndexNames(connection, 'model_input_prefix')
    expect(indexes.filter((name) => name === 'idx_model_input_prefix_tenant_key')).toHaveLength(1)
  })
})
