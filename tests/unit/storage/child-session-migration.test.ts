import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import {
  allStoreMigrations,
  childSessionColumnsMigration,
  subagentChildLinkageMigration,
  backgroundChildTaskPersistenceMigration,
} from '../../../src/storage/all-stores-migrations.js'

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

describe('child session columns migration', () => {
  it('runs a fresh :memory: DB through all migrations and adds the child-session columns to sessions', () => {
    const connection = openMemoryConnection()
    const runner = applyAll(connection)

    const columns = getColumnNames(connection, 'sessions')
    expect(columns).toContain('parent_session_id')
    expect(columns).toContain('task_id')
    expect(columns).toContain('agent_profile')
    expect(columns).toContain('launch_mode')
    expect(columns).toContain('subagent_depth')
    expect(columns).toContain('session_kind')
    expect(runner.getCurrentVersion()).toBe(76)
  })

  it('adds parent and task indexes on sessions', () => {
    const connection = openMemoryConnection()
    applyAll(connection)

    const indexes = getIndexNames(connection, 'sessions')
    expect(indexes).toContain('idx_sessions_parent_session_id')
    expect(indexes).toContain('idx_sessions_task_id')
  })

  it('keeps a pre-migration foreground row valid with new defaults after applying the new migrations', () => {
    const connection = openMemoryConnection()
    const runner = createRunner(connection)
    // Apply every migration except the child-session/background ones (v74, v75, v76).
    runner.apply(
      allStoreMigrations.filter(
        (migration) => migration.version !== 74 && migration.version !== 75 && migration.version !== 76,
      ),
    )

    connection.exec(
      `INSERT INTO sessions (
        session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'sess_pre',
        'user-1',
        'Foreground chat',
        'active',
        3,
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ],
    )

    // Apply the child-session/background migrations to the existing DB.
    runner.apply([childSessionColumnsMigration, subagentChildLinkageMigration, backgroundChildTaskPersistenceMigration])

    interface SeededRow {
      session_id: string
      parent_session_id: string | null
      task_id: string | null
      agent_profile: string | null
      launch_mode: string | null
      subagent_depth: number
      session_kind: string
    }
    const rows = connection.query<SeededRow>('SELECT * FROM sessions WHERE session_id = ?', ['sess_pre'])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.session_id).toBe('sess_pre')
    expect(rows[0]!.parent_session_id).toBeNull()
    expect(rows[0]!.task_id).toBeNull()
    expect(rows[0]!.agent_profile).toBeNull()
    expect(rows[0]!.launch_mode).toBeNull()
    expect(rows[0]!.subagent_depth).toBe(0)
    expect(rows[0]!.session_kind).toBe('foreground')
    expect(runner.getCurrentVersion()).toBe(76)
  })

  it('accepts internal subagent-shaped rows with parent/task linkage', () => {
    const connection = openMemoryConnection()
    applyAll(connection)

    connection.exec(
      `INSERT INTO sessions (
        session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at,
        parent_session_id, task_id, agent_profile, launch_mode, subagent_depth, session_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'sess_child',
        'user-1',
        'Child task',
        'active',
        1,
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
        'sess_pre',
        'task_1',
        'subagent',
        'foreground',
        1,
        'subagent',
      ],
    )

    const rows = connection.query<{ session_id: string; parent_session_id: string | null; task_id: string | null }>(
      'SELECT session_id, parent_session_id, task_id FROM sessions WHERE session_id = ?',
      ['sess_child'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.parent_session_id).toBe('sess_pre')
    expect(rows[0]!.task_id).toBe('task_1')
  })

  it('is idempotent-safe when the migration runner is applied twice', () => {
    const connection = openMemoryConnection()
    const runner = createRunner(connection)
    runner.apply(allStoreMigrations)
    runner.apply(allStoreMigrations)

    const columns = getColumnNames(connection, 'sessions')
    expect(columns.filter((name) => name === 'parent_session_id')).toHaveLength(1)
    expect(columns.filter((name) => name === 'task_id')).toHaveLength(1)
    expect(columns.filter((name) => name === 'subagent_depth')).toHaveLength(1)
    expect(columns.filter((name) => name === 'session_kind')).toHaveLength(1)

    const indexes = getIndexNames(connection, 'sessions')
    expect(indexes.filter((name) => name === 'idx_sessions_parent_session_id')).toHaveLength(1)
    expect(indexes.filter((name) => name === 'idx_sessions_task_id')).toHaveLength(1)
  })
})
