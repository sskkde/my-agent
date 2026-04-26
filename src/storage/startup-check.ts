import type { ConnectionManager } from './connection.js';
import { createMigrationRunner } from './migrations.js';
import { getLatestMigrationVersion } from './all-stores-migrations.js';

export interface ConsistencyCheckResult {
  passed: boolean;
  checks: {
    connection: boolean;
    tables: boolean;
    migrations: boolean;
    walMode: boolean;
    foreignKeys: boolean;
    integrity: boolean;
  };
  details: {
    connectionError?: string;
    missingTables?: string[];
    migrationVersion?: number;
    expectedVersion?: number;
    journalMode?: string;
    integrityError?: string;
  };
  errors: string[];
}

const REQUIRED_TABLES = [
  'events',
  'runtime_actions',
  'transcripts',
  'summaries',
  'plans',
  'plan_patches',
  'planner_runs',
  'kernel_runs',
  'tool_executions',
  'background_runs',
  'workflow_runs',
  'workflow_step_runs',
  'approval_requests',
  'permission_grants',
  'trigger_registrations',
  'wait_conditions',
  'artifacts',
  'tool_results',
  'connector_definitions',
  'connector_instances',
  'connector_events',
];

export function performStartupConsistencyCheck(connection: ConnectionManager): ConsistencyCheckResult {
  const result: ConsistencyCheckResult = {
    passed: false,
    checks: {
      connection: false,
      tables: false,
      migrations: false,
      walMode: false,
      foreignKeys: false,
      integrity: false,
    },
    details: {},
    errors: [],
  };

  try {
    if (!connection.isOpen()) {
      result.details.connectionError = 'Database connection is not open';
      result.errors.push(result.details.connectionError);
      return result;
    }
    result.checks.connection = true;

    const journalMode = connection.query<{ journal_mode: string }>('PRAGMA journal_mode');
    result.details.journalMode = journalMode[0]?.journal_mode;
    result.checks.walMode = result.details.journalMode?.toLowerCase() === 'wal';
    if (!result.checks.walMode) {
      result.errors.push(`WAL mode not enabled (current: ${result.details.journalMode})`);
    }

    const fkResult = connection.query<{ foreign_keys: 0 | 1 }>('PRAGMA foreign_keys');
    result.checks.foreignKeys = fkResult[0]?.foreign_keys === 1;
    if (!result.checks.foreignKeys) {
      result.errors.push('Foreign keys are not enabled');
    }

    const integrityCheck = connection.query<{ integrity_check: string }>('PRAGMA integrity_check');
    result.checks.integrity = integrityCheck[0]?.integrity_check === 'ok';
    if (!result.checks.integrity) {
      result.details.integrityError = integrityCheck[0]?.integrity_check;
      result.errors.push(`Integrity check failed: ${result.details.integrityError}`);
    }

    const tables = connection.query<{ name: string }>(`
      SELECT name FROM sqlite_master 
      WHERE type = 'table' 
      AND name NOT LIKE 'sqlite_%' 
      AND name != 'migrations'
    `);
    const existingTables = tables.map(t => t.name);
    result.details.missingTables = REQUIRED_TABLES.filter(t => !existingTables.includes(t));
    result.checks.tables = result.details.missingTables.length === 0;
    if (!result.checks.tables) {
      result.errors.push(`Missing tables: ${result.details.missingTables.join(', ')}`);
    }

    const migrations = createMigrationRunner(connection);
    migrations.init();
    result.details.migrationVersion = migrations.getCurrentVersion();
    result.details.expectedVersion = getLatestMigrationVersion();
    result.checks.migrations = result.details.migrationVersion === result.details.expectedVersion;
    if (!result.checks.migrations) {
      result.errors.push(
        `Migration version mismatch: current=${result.details.migrationVersion}, expected=${result.details.expectedVersion}`
      );
    }

    result.passed = Object.values(result.checks).every(check => check);

  } catch (error) {
    result.errors.push(`Startup check error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

export function formatConsistencyResult(result: ConsistencyCheckResult): string {
  const lines: string[] = [];
  
  lines.push('Startup Consistency Check');
  lines.push('=' .repeat(50));
  lines.push('');
  
  const checkResults = [
    { name: 'Connection', passed: result.checks.connection },
    { name: 'WAL Mode', passed: result.checks.walMode },
    { name: 'Foreign Keys', passed: result.checks.foreignKeys },
    { name: 'Integrity', passed: result.checks.integrity },
    { name: 'Tables', passed: result.checks.tables },
    { name: 'Migrations', passed: result.checks.migrations },
  ];
  
  for (const check of checkResults) {
    lines.push(`  ${check.passed ? '✓' : '✗'} ${check.name}`);
  }
  
  lines.push('');
  
  if (result.details.journalMode) {
    lines.push(`Journal Mode: ${result.details.journalMode}`);
  }
  
  if (result.details.migrationVersion !== undefined) {
    lines.push(`Migration Version: ${result.details.migrationVersion} / ${result.details.expectedVersion}`);
  }
  
  if (result.details.missingTables && result.details.missingTables.length > 0) {
    lines.push(`Missing Tables: ${result.details.missingTables.join(', ')}`);
  }
  
  if (result.details.integrityError) {
    lines.push(`Integrity Error: ${result.details.integrityError}`);
  }
  
  lines.push('');
  lines.push(`Overall: ${result.passed ? '✓ PASSED' : '✗ FAILED'}`);
  
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }
  
  return lines.join('\n');
}
