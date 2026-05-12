#!/usr/bin/env node
import { createConnectionManager } from '../storage/connection.js';
import { createMigrationRunner } from '../storage/migrations.js';
import { getLatestMigrationVersion } from '../storage/all-stores-migrations.js';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || process.env.DATABASE_URL || './data/agent-platform.db';

interface HealthCheckResult {
  healthy: boolean;
  database: {
    path: string;
    exists: boolean;
    sizeBytes: number;
  };
  connection: {
    connected: boolean;
    journalMode: string;
    synchronous: number;
    foreignKeys: boolean;
    busyTimeout: number;
  };
  migrations: {
    currentVersion: number;
    expectedVersion: number;
    upToDate: boolean;
  };
  wal: {
    enabled: boolean;
    walSizeBytes: number;
    checkpointCount: number;
  };
  tables: {
    total: number;
    userTables: string[];
    recordCounts: Record<string, number>;
  };
  integrity: {
    checkPassed: boolean;
    errors: string[];
  };
}

async function runHealthCheck(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    healthy: false,
    database: {
      path: DB_PATH,
      exists: fs.existsSync(DB_PATH),
      sizeBytes: 0,
    },
    connection: {
      connected: false,
      journalMode: 'unknown',
      synchronous: -1,
      foreignKeys: false,
      busyTimeout: 0,
    },
    migrations: {
      currentVersion: 0,
      expectedVersion: getLatestMigrationVersion(),
      upToDate: false,
    },
    wal: {
      enabled: false,
      walSizeBytes: 0,
      checkpointCount: 0,
    },
    tables: {
      total: 0,
      userTables: [],
      recordCounts: {},
    },
    integrity: {
      checkPassed: false,
      errors: [],
    },
  };

  if (!result.database.exists) {
    result.integrity.errors.push(`Database file not found: ${DB_PATH}`);
    return result;
  }

  const stats = fs.statSync(DB_PATH);
  result.database.sizeBytes = stats.size;

  const connection = createConnectionManager(DB_PATH);
  
  try {
    connection.open();
    result.connection.connected = true;

    // Check journal mode (WAL)
    const journalMode = connection.query<{ journal_mode: string }>('PRAGMA journal_mode');
    result.connection.journalMode = journalMode[0]?.journal_mode ?? 'unknown';
    result.wal.enabled = result.connection.journalMode.toLowerCase() === 'wal';

    // Check WAL file size
    const walPath = DB_PATH + '-wal';
    if (fs.existsSync(walPath)) {
      const walStats = fs.statSync(walPath);
      result.wal.walSizeBytes = walStats.size;
    }

    // Check WAL checkpoint count
    const walCheck = connection.query<{ checkpointed: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
    result.wal.checkpointCount = walCheck[0]?.checkpointed ?? 0;

    // Check synchronous mode
    const syncMode = connection.query<{ synchronous: number }>('PRAGMA synchronous');
    result.connection.synchronous = syncMode[0]?.synchronous ?? -1;

    // Check foreign keys
    const fkMode = connection.query<{ foreign_keys: 0 | 1 }>('PRAGMA foreign_keys');
    result.connection.foreignKeys = fkMode[0]?.foreign_keys === 1;

    // Check busy timeout
    const busyTimeout = connection.query<{ timeout: number }>('PRAGMA busy_timeout');
    result.connection.busyTimeout = busyTimeout[0]?.timeout ?? 0;

    // Check migrations
    const migrations = createMigrationRunner(connection);
    migrations.init();
    result.migrations.currentVersion = migrations.getCurrentVersion();
    result.migrations.upToDate = result.migrations.currentVersion === result.migrations.expectedVersion;

    // Check tables
    const tables = connection.query<{ name: string }>(`
      SELECT name FROM sqlite_master 
      WHERE type = 'table' 
      AND name NOT LIKE 'sqlite_%' 
      ORDER BY name
    `);
    result.tables.total = tables.length;
    result.tables.userTables = tables.map(t => t.name);

    // Count records in each table
    for (const table of tables) {
      try {
        const count = connection.query<{ count: number }>(`SELECT COUNT(*) as count FROM "${table.name}"`);
        result.tables.recordCounts[table.name] = count[0]?.count ?? 0;
      } catch {
        result.tables.recordCounts[table.name] = -1;
      }
    }

    // Run integrity check
    const integrityCheck = connection.query<{ integrity_check: string }>('PRAGMA integrity_check');
    result.integrity.checkPassed = integrityCheck[0]?.integrity_check === 'ok';
    if (!result.integrity.checkPassed) {
      result.integrity.errors.push(`Integrity check failed: ${integrityCheck[0]?.integrity_check}`);
    }

    // Determine overall health
    result.healthy = 
      result.connection.connected &&
      result.wal.enabled &&
      result.migrations.upToDate &&
      result.integrity.checkPassed &&
      result.connection.foreignKeys;

  } catch (error) {
    result.integrity.errors.push(`Health check error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    connection.close();
  }

  return result;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function printHealthCheck(result: HealthCheckResult, format: 'text' | 'json' = 'text'): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                Database Health Check Report                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  // Overall status
  const statusIcon = result.healthy ? '✓' : '✗';
  const statusColor = result.healthy ? 'HEALTHY' : 'UNHEALTHY';
  console.log(`Overall Status: ${statusIcon} ${statusColor}`);
  console.log();

  // Database Info
  console.log('─'.repeat(60));
  console.log('Database File');
  console.log('─'.repeat(60));
  console.log(`  Path:    ${result.database.path}`);
  console.log(`  Exists:  ${result.database.exists ? '✓ Yes' : '✗ No'}`);
  console.log(`  Size:    ${formatBytes(result.database.sizeBytes)}`);
  console.log();

  // Connection Settings
  console.log('─'.repeat(60));
  console.log('Connection Settings');
  console.log('─'.repeat(60));
  console.log(`  Connected:     ${result.connection.connected ? '✓ Yes' : '✗ No'}`);
  console.log(`  Journal Mode:  ${result.connection.journalMode} ${result.wal.enabled ? '✓' : '✗'}`);
  console.log(`  Synchronous:   ${result.connection.synchronous === 1 ? 'NORMAL (1)' : result.connection.synchronous}`);
  console.log(`  Foreign Keys:  ${result.connection.foreignKeys ? '✓ Enabled' : '✗ Disabled'}`);
  console.log(`  Busy Timeout:  ${result.connection.busyTimeout}ms`);
  console.log();

  // WAL Status
  console.log('─'.repeat(60));
  console.log('WAL (Write-Ahead Logging) Status');
  console.log('─'.repeat(60));
  console.log(`  Enabled:           ${result.wal.enabled ? '✓ Yes' : '✗ No'}`);
  console.log(`  WAL File Size:     ${formatBytes(result.wal.walSizeBytes)}`);
  console.log(`  Checkpoints:       ${result.wal.checkpointCount}`);
  console.log();

  // Migrations
  console.log('─'.repeat(60));
  console.log('Migrations');
  console.log('─'.repeat(60));
  console.log(`  Current Version:  ${result.migrations.currentVersion}`);
  console.log(`  Expected Version: ${result.migrations.expectedVersion}`);
  console.log(`  Up to Date:       ${result.migrations.upToDate ? '✓ Yes' : '✗ No'}`);
  console.log();

  // Tables
  console.log('─'.repeat(60));
  console.log(`Tables (${result.tables.total})`);
  console.log('─'.repeat(60));
  const tableEntries = Object.entries(result.tables.recordCounts);
  if (tableEntries.length > 0) {
    const maxNameLength = Math.max(...tableEntries.map(([name]) => name.length));
    for (const [name, count] of tableEntries) {
      const paddedName = name.padEnd(maxNameLength);
      console.log(`  ${paddedName}  ${count.toString().padStart(6)} records`);
    }
  }
  console.log();

  // Integrity
  console.log('─'.repeat(60));
  console.log('Integrity Check');
  console.log('─'.repeat(60));
  console.log(`  Result: ${result.integrity.checkPassed ? '✓ PASSED' : '✗ FAILED'}`);
  if (result.integrity.errors.length > 0) {
    console.log('  Errors:');
    for (const error of result.integrity.errors) {
      console.log(`    - ${error}`);
    }
  }
  console.log();

  // Summary
  console.log('─'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60));
  const checks = [
    { name: 'Database exists', pass: result.database.exists },
    { name: 'Connection active', pass: result.connection.connected },
    { name: 'WAL mode enabled', pass: result.wal.enabled },
    { name: 'Migrations current', pass: result.migrations.upToDate },
    { name: 'Foreign keys enabled', pass: result.connection.foreignKeys },
    { name: 'Integrity check passed', pass: result.integrity.checkPassed },
  ];
  for (const check of checks) {
    console.log(`  ${check.pass ? '✓' : '✗'} ${check.name}`);
  }
  console.log();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const format = args.includes('--json') ? 'json' : 'text';
  const exitOnError = args.includes('--exit-code');

  try {
    const result = await runHealthCheck();
    printHealthCheck(result, format);

    if (exitOnError && !result.healthy) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Health check failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
