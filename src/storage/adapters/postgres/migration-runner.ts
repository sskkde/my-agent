import type { AsyncConnectionManager } from '../../database-adapter.js';
import type { PgMigration } from './pg-migrations.js';

export interface PgMigrationRunner {
  init(): Promise<void>;
  getCurrentVersion(): Promise<number>;
  apply(migrations: PgMigration[]): Promise<void>;
}

class PgMigrationRunnerImpl implements PgMigrationRunner {
  private connection: AsyncConnectionManager;

  constructor(connection: AsyncConnectionManager) {
    this.connection = connection;
  }

  async init(): Promise<void> {
    await this.connection.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      )
    `);
  }

  async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.connection.query<{ version: number }>(
        'SELECT MAX(version) as version FROM migrations'
      );
      return result[0]?.version ?? 0;
    } catch {
      return 0;
    }
  }

  async apply(migrations: PgMigration[]): Promise<void> {
    if (migrations.length === 0) {
      return;
    }

    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

    this.validateVersionSequence(sortedMigrations);

    let currentVersion = await this.getCurrentVersion();

    for (const migration of sortedMigrations) {
      if (migration.version <= currentVersion) {
        continue;
      }

      if (migration.version !== currentVersion + 1) {
        throw new Error(
          `Migration version gap detected: expected ${currentVersion + 1}, got ${migration.version}`
        );
      }

      await this.connection.transaction(async () => {
        await this.executeMigrationSql(migration.up);

        const checksum = this.computeChecksum(migration.up);
        await this.connection.exec(
          'INSERT INTO migrations (version, name, applied_at, checksum) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, new Date().toISOString(), checksum]
        );
      });

      currentVersion = migration.version;
    }
  }

  private validateVersionSequence(migrations: PgMigration[]): void {
    const versions = migrations.map(m => m.version).sort((a, b) => a - b);
    
    for (let i = 1; i < versions.length; i++) {
      if (versions[i] === versions[i - 1]) {
        throw new Error(`Duplicate migration version: ${versions[i]}`);
      }
    }
  }

  private async executeMigrationSql(sql: string): Promise<void> {
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      await this.connection.exec(statement);
    }
  }

  private computeChecksum(sql: string): string {
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
      const char = sql.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

export function createPgMigrationRunner(connection: AsyncConnectionManager): PgMigrationRunner {
  return new PgMigrationRunnerImpl(connection);
}
