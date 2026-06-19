import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { agentTypeProfileSplitMigration } from '../../../src/storage/all-stores-migrations.js'
import type { ConnectionManager } from '../../../src/storage/connection.js'

interface SubagentRunRow {
  subagent_run_id: string
  agent_type: string
  agent_profile: string | null
}

interface BackgroundRunRow {
  background_run_id: string
  agent_type: string
  agent_profile: string | null
}

interface PreferenceRow {
  user_id: string
  agent_type: string
  agent_profile: string | null
}

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function execStatements(connection: ConnectionManager, sql: string): void {
  for (const statement of sql
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    connection.exec(statement)
  }
}

function createAllOldSchemas(connection: ConnectionManager): void {
  execStatements(
    connection,
    `
    CREATE TABLE subagent_runs (
      subagent_run_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      parent_run_id TEXT,
      root_run_id TEXT,
      background_run_id TEXT,
      agent_type TEXT NOT NULL,
      status TEXT NOT NULL,
      task_spec_json TEXT NOT NULL,
      context_bundle_json TEXT,
      provider_id TEXT,
      model TEXT,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_subagent_runs_user_status ON subagent_runs(user_id, status);
    CREATE INDEX idx_subagent_runs_session_status ON subagent_runs(session_id, status);
    CREATE INDEX idx_subagent_runs_background ON subagent_runs(background_run_id);

    CREATE TABLE background_runs (
      background_run_id TEXT PRIMARY KEY,
      subagent_run_id TEXT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      agent_type TEXT NOT NULL,
      status TEXT NOT NULL,
      launch_source TEXT NOT NULL,
      checkpoint_data TEXT,
      recovery_point TEXT,
      result_data TEXT,
      error_message TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      expires_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_background_runs_user_status ON background_runs(user_id, status);
    CREATE INDEX idx_background_runs_session_status ON background_runs(session_id, status);
    CREATE INDEX idx_background_runs_subagent ON background_runs(subagent_run_id);

    CREATE TABLE subagent_provider_preferences (
      user_id TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      fallback_mode TEXT NOT NULL DEFAULT 'any_compatible',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, agent_type)
    )
  `,
  )
}

function seedSubagentRun(connection: ConnectionManager, agentType = 'research_processor'): void {
  connection.exec(
    `INSERT INTO subagent_runs (
      subagent_run_id, user_id, agent_type, status, task_spec_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['run-1', 'user-1', agentType, 'completed', '{}', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'],
  )
}

function seedBackgroundRun(connection: ConnectionManager, agentType = 'document_processor'): void {
  connection.exec(
    `INSERT INTO background_runs (
      background_run_id, user_id, agent_type, status, launch_source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['bg-1', 'user-1', agentType, 'running', 'system', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'],
  )
}

function seedPreference(connection: ConnectionManager, agentType = 'research_processor'): void {
  connection.exec(
    `INSERT INTO subagent_provider_preferences (
      user_id, agent_type, provider_id, model, fallback_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['user-1', agentType, 'openrouter', 'claude-3', 'any_compatible', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'],
  )
}

function createRunnerAtV62(connection: ConnectionManager): ReturnType<typeof createMigrationRunner> {
  const runner = createMigrationRunner(connection)
  runner.init()
  connection.exec('INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)', [
    62,
    'create_file_uploads_table',
    '2026-06-19T00:00:00.000Z',
    'old',
  ])
  return runner
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('agent_type_profile_split migration', () => {
  it('subagent_runs: backfills agent_type=subagent and agent_profile=research_processor', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)
    seedSubagentRun(connection, 'research_processor')

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const rows = connection.query<SubagentRunRow>('SELECT * FROM subagent_runs WHERE subagent_run_id = ?', ['run-1'])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.agent_type).toBe('subagent')
    expect(rows[0]!.agent_profile).toBe('research_processor')
    expect(runner.getCurrentVersion()).toBe(63)
  })

  it('subagent_runs: backfills agent_type=subagent and agent_profile=document_processor', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)
    seedSubagentRun(connection, 'document_processor')

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const rows = connection.query<SubagentRunRow>('SELECT * FROM subagent_runs WHERE subagent_run_id = ?', ['run-1'])
    expect(rows[0]!.agent_type).toBe('subagent')
    expect(rows[0]!.agent_profile).toBe('document_processor')
  })

  it('background_runs: backfills agent_type=background and agent_profile=document_processor', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)
    seedBackgroundRun(connection, 'document_processor')

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const rows = connection.query<BackgroundRunRow>('SELECT * FROM background_runs WHERE background_run_id = ?', [
      'bg-1',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.agent_type).toBe('background')
    expect(rows[0]!.agent_profile).toBe('document_processor')
  })

  it('subagent_provider_preferences: backfills agent_type=subagent and agent_profile=research_processor', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)
    seedPreference(connection, 'research_processor')

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const rows = connection.query<PreferenceRow>(
      'SELECT * FROM subagent_provider_preferences WHERE user_id = ?',
      ['user-1'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.agent_type).toBe('subagent')
    expect(rows[0]!.agent_profile).toBe('research_processor')
  })

  it('creates agent_profile indexes on all three tables', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const indexes = connection.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%agent_profile%' ORDER BY name`,
    )
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_subagent_runs_agent_profile')
    expect(indexNames).toContain('idx_background_runs_agent_profile')
    expect(indexNames).toContain('idx_subagent_provider_prefs_agent_profile')
  })

  it('multiple subagent runs with different profiles all get agent_type=subagent', () => {
    const connection = openMemoryConnection()
    createAllOldSchemas(connection)

    seedSubagentRun(connection, 'research_processor')
    connection.exec(
      `INSERT INTO subagent_runs (
        subagent_run_id, user_id, agent_type, status, task_spec_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['run-2', 'user-1', 'image_processor', 'completed', '{}', '2026-06-19T00:00:00.000Z', '2026-06-19T00:00:00.000Z'],
    )

    const runner = createRunnerAtV62(connection)
    runner.apply([agentTypeProfileSplitMigration])

    const rows = connection.query<SubagentRunRow>(
      'SELECT * FROM subagent_runs ORDER BY subagent_run_id',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]!.agent_type).toBe('subagent')
    expect(rows[0]!.agent_profile).toBe('research_processor')
    expect(rows[1]!.agent_type).toBe('subagent')
    expect(rows[1]!.agent_profile).toBe('image_processor')
  })
})
