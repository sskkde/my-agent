import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { agentConfigRuntimeDefaultsMigration } from '../../../src/storage/all-stores-migrations.js';
import type { ConnectionManager } from '../../../src/storage/connection.js';

interface TableColumnInfo {
  name: string;
  dflt_value: string | number | null;
}

interface AgentConfigRuntimeRow {
  agent_config_id: string;
  routing_timeout_ms: number;
  repair_attempts: number;
}

const connections: ConnectionManager[] = [];

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:');
  connection.open();
  connections.push(connection);
  return connection;
}

function execStatements(connection: ConnectionManager, sql: string): void {
  for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
    connection.exec(statement);
  }
}

function createOldSqlMigrationSchema(connection: ConnectionManager): void {
  execStatements(connection, `
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
      allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
      routing_timeout_ms INTEGER NOT NULL DEFAULT 10000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);
    CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);
    CREATE INDEX idx_agent_configs_scope ON agent_configs(scope);
  `);
}

function createOldAllStoresSchema(connection: ConnectionManager): void {
  execStatements(connection, `
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
      allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
      routing_timeout_ms INTEGER NOT NULL DEFAULT 10000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_configs_global ON agent_configs(agent_id, scope) WHERE scope = 'global';
    CREATE UNIQUE INDEX idx_agent_configs_user ON agent_configs(agent_id, scope, user_id) WHERE scope = 'user';
    CREATE INDEX idx_agent_configs_agent_id ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user_id ON agent_configs(user_id);
  `);
}

function seedRows(connection: ConnectionManager, seedRepairAttempts = 1): void {
  connection.exec(
    `INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'agent-global-foreground-default',
      'foreground.default',
      'global',
      '',
      'Foreground Agent',
      1,
      'You are the foreground agent. You handle user-facing interactions and coordinate with the planner and subagents as needed.',
      null,
      null,
      null,
      '[]',
      '[]',
      10000,
      seedRepairAttempts,
      '2026-05-03T00:00:00.000Z',
      '2026-05-03T00:00:00.000Z',
    ]
  );
  connection.exec(
    `INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'custom-global',
      'foreground.default',
      'user',
      'custom',
      'Custom Agent',
      1,
      'Custom prompt',
      null,
      null,
      null,
      '[]',
      '[]',
      10000,
      1,
      '2026-05-03T00:00:00.000Z',
      '2026-05-03T00:00:00.000Z',
    ]
  );
}

function getDefault(connection: ConnectionManager, columnName: string): string {
  const columns = connection.query<TableColumnInfo>('PRAGMA table_info(agent_configs)');
  const column = columns.find((item) => item.name === columnName);
  return String(column?.dflt_value);
}

function assertRuntimeDefaultsMigrated(connection: ConnectionManager): void {
  expect(getDefault(connection, 'routing_timeout_ms')).toBe('60000');
  expect(getDefault(connection, 'repair_attempts')).toBe('1');

  const rows = connection.query<AgentConfigRuntimeRow>(
    `SELECT agent_config_id, routing_timeout_ms, repair_attempts
     FROM agent_configs
     ORDER BY agent_config_id`
  );
  expect(rows).toEqual([
    { agent_config_id: 'agent-global-foreground-default', routing_timeout_ms: 60000, repair_attempts: 1 },
    { agent_config_id: 'custom-global', routing_timeout_ms: 10000, repair_attempts: 1 },
  ]);

  connection.exec(
    `INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, system_prompt,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'new-default-row',
      'foreground.default',
      'user',
      'user-1',
      'New Default Row',
      '',
      '2026-05-04T00:00:00.000Z',
      '2026-05-04T00:00:00.000Z',
    ]
  );

  const [newRow] = connection.query<AgentConfigRuntimeRow>(
    `SELECT agent_config_id, routing_timeout_ms, repair_attempts
     FROM agent_configs
     WHERE agent_config_id = ?`,
    ['new-default-row']
  );
  expect(newRow).toEqual({
    agent_config_id: 'new-default-row',
    routing_timeout_ms: 60000,
    repair_attempts: 1,
  });
}

function assertCustomizedSeedRepairPreserved(connection: ConnectionManager): void {
  expect(getDefault(connection, 'routing_timeout_ms')).toBe('60000');
  expect(getDefault(connection, 'repair_attempts')).toBe('1');

  const [seedRow] = connection.query<AgentConfigRuntimeRow>(
    `SELECT agent_config_id, routing_timeout_ms, repair_attempts
     FROM agent_configs
     WHERE agent_config_id = ?`,
    ['agent-global-foreground-default']
  );

  expect(seedRow).toEqual({
    agent_config_id: 'agent-global-foreground-default',
    routing_timeout_ms: 10000,
    repair_attempts: 0,
  });
}

function extractUpMigration(sql: string): string {
  const match = sql.match(/--\s*Up\s*migration\s*\n([\s\S]*?)(?=--\s*Down|$)/i);
  if (!match) {
    throw new Error('Missing up migration section');
  }
  return match[1].trim();
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close();
  }
});

describe('agent config runtime default migrations', () => {
  it('updates SQL migration path defaults without overwriting custom 10000 rows', () => {
    const connection = openMemoryConnection();
    createOldSqlMigrationSchema(connection);
    seedRows(connection);

    const runner = createMigrationRunner(connection);
    runner.init();
    connection.exec(
      'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      [6, 'create_agent_configs', '2026-05-03T00:00:00.000Z', 'old']
    );
    const sql = readFileSync(join(process.cwd(), 'migrations/007_update_agent_config_runtime_defaults.sql'), 'utf8');
    const migration: Migration = {
      version: 7,
      name: 'update_agent_config_runtime_defaults',
      up: extractUpMigration(sql),
      down: '',
    };

    runner.apply([migration]);

    assertRuntimeDefaultsMigrated(connection);
    expect(runner.getCurrentVersion()).toBe(7);
  });

  it('preserves SQL migration path seed row when only repair attempts were customized', () => {
    const connection = openMemoryConnection();
    createOldSqlMigrationSchema(connection);
    seedRows(connection, 0);

    const runner = createMigrationRunner(connection);
    runner.init();
    connection.exec(
      'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      [6, 'create_agent_configs', '2026-05-03T00:00:00.000Z', 'old']
    );
    const sql = readFileSync(join(process.cwd(), 'migrations/007_update_agent_config_runtime_defaults.sql'), 'utf8');
    const migration: Migration = {
      version: 7,
      name: 'update_agent_config_runtime_defaults',
      up: extractUpMigration(sql),
      down: '',
    };

    runner.apply([migration]);

    assertCustomizedSeedRepairPreserved(connection);
  });

  it('updates all-stores migration path defaults without overwriting custom 10000 rows', () => {
    const connection = openMemoryConnection();
    createOldAllStoresSchema(connection);
    seedRows(connection);

    const runner = createMigrationRunner(connection);
    runner.init();
    connection.exec(
      'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      [34, 'create_agent_configs_table', '2026-05-03T00:00:00.000Z', 'old']
    );

    runner.apply([agentConfigRuntimeDefaultsMigration]);

    assertRuntimeDefaultsMigrated(connection);
    expect(runner.getCurrentVersion()).toBe(35);
  });

  it('preserves all-stores migration path seed row when only repair attempts were customized', () => {
    const connection = openMemoryConnection();
    createOldAllStoresSchema(connection);
    seedRows(connection, 0);

    const runner = createMigrationRunner(connection);
    runner.init();
    connection.exec(
      'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
      [34, 'create_agent_configs_table', '2026-05-03T00:00:00.000Z', 'old']
    );

    runner.apply([agentConfigRuntimeDefaultsMigration]);

    assertCustomizedSeedRepairPreserved(connection);
  });
});
