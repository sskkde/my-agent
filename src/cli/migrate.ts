#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createConnectionManager, type ConnectionManager } from '../storage/connection.js';
import { allStoreMigrations } from '../storage/all-stores-migrations.js';
import { createMigrationRunner } from '../storage/migrations.js';

const DB_PATH = process.env.DATABASE_PATH || process.env.DATABASE_URL || './data/agent-platform.db';

async function main(): Promise<void> {
  const command = process.argv[2] || 'up';

  ensureDataDirectory();

  if (command === 'up') {
    runMigrations();
    return;
  }

  if (command === 'status') {
    printMigrationStatus();
    return;
  }

  if (command === 'create') {
    console.error('Migration creation uses src/storage/all-stores-migrations.ts. Add new migrations there.');
    process.exit(1);
  }

  console.error(`Unknown command: ${command}`);
  console.error('Usage: db:migrate [up|status]');
  process.exit(1);
}

function ensureDataDirectory(): void {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function runMigrations(): void {
  const connection = createConnectionManager(DB_PATH);
  connection.open();

  try {
    const migrations = createMigrationRunner(connection);
    migrations.init();
    const currentVersion = migrations.getCurrentVersion();
    const latestVersion = allStoreMigrations[allStoreMigrations.length - 1]?.version ?? 0;
    console.log(`Current database version: ${currentVersion}`);

    if (shouldResetLegacySqlDatabase(connection, currentVersion)) {
      connection.close();
      const backupPath = backupLegacyDatabase();
      removeDatabaseFiles(DB_PATH);
      console.log(`Backed up legacy SQL-migration database to: ${backupPath}`);
      connection.open();
    }

    const runner = createMigrationRunner(connection);
    runner.init();
    const versionBeforeApply = runner.getCurrentVersion();
    runner.apply(allStoreMigrations);
    const newVersion = runner.getCurrentVersion();

    console.log(`Migrated to version: ${newVersion}`);
    if (newVersion === versionBeforeApply) {
      console.log('Database is up to date.');
    } else {
      console.log(`Applied ${newVersion - versionBeforeApply} migration(s).`);
    }

    if (newVersion !== latestVersion) {
      throw new Error(`Expected migration version ${latestVersion}, got ${newVersion}`);
    }
  } finally {
    if (connection.isOpen()) {
      connection.close();
    }
  }
}

function printMigrationStatus(): void {
  const connection = createConnectionManager(DB_PATH);
  connection.open();

  try {
    const migrations = createMigrationRunner(connection);
    migrations.init();
    const version = migrations.getCurrentVersion();
    console.log(`Current database version: ${version}`);
    console.log(`Available migrations: ${allStoreMigrations.length}`);
    console.log('\nMigrations:');
    for (const migration of allStoreMigrations) {
      const status = migration.version <= version ? '✓ applied' : '○ pending';
      console.log(`  ${status} ${migration.version.toString().padStart(3, '0')}_${migration.name}`);
    }
  } finally {
    connection.close();
  }
}

function shouldResetLegacySqlDatabase(connection: ConnectionManager, currentVersion: number): boolean {
  if (currentVersion === 0 || currentVersion >= (allStoreMigrations[allStoreMigrations.length - 1]?.version ?? 0)) {
    return false;
  }

  return !tableExists(connection, 'events') || !tableExists(connection, 'runtime_actions');
}

function tableExists(connection: ConnectionManager, tableName: string): boolean {
  const rows = connection.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return rows.length > 0;
}

function backupLegacyDatabase(): string {
  if (!fs.existsSync(DB_PATH)) {
    return '';
  }

  const backupDir = path.join(path.dirname(DB_PATH), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `legacy-sql-migrations-${timestamp}.db`);
  fs.copyFileSync(DB_PATH, backupPath);
  return backupPath;
}

function removeDatabaseFiles(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
