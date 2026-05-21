import type { ConnectionManager } from './connection.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export interface MigrationRunner {
  init(): void;
  getCurrentVersion(): number;
  apply(migrations: Migration[]): void;
}

class MigrationRunnerImpl implements MigrationRunner {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  init(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      )
    `);
  }

  getCurrentVersion(): number {
    try {
      const result = this.connection.query<{ version: number }>(
        'SELECT MAX(version) as version FROM migrations'
      );
      return result[0]?.version ?? 0;
    } catch {
      return 0;
    }
  }

  apply(migrations: Migration[]): void {
    if (migrations.length === 0) {
      return;
    }

    // Sort migrations by version
    const sortedMigrations = [...migrations].sort((a, b) => a.version - b.version);

    // Validate version sequence
    this.validateVersionSequence(sortedMigrations);

    let currentVersion = this.getCurrentVersion();

    for (const migration of sortedMigrations) {
      // Skip already applied migrations
      if (migration.version <= currentVersion) {
        continue;
      }

      // Verify this is the next expected version
      if (migration.version !== currentVersion + 1) {
        throw new Error(
          `Migration version gap detected: expected ${currentVersion + 1}, got ${migration.version}`
        );
      }

      // Apply migration within a transaction
      this.connection.transaction(() => {
        this.executeMigrationSql(migration.up);

        const checksum = this.computeChecksum(migration.up);
        this.connection.exec(
          'INSERT INTO migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
          [migration.version, migration.name, new Date().toISOString(), checksum]
        );
      })();

      currentVersion = migration.version;
    }
  }

  private validateVersionSequence(migrations: Migration[]): void {
    const versions = migrations.map(m => m.version).sort((a, b) => a - b);
    
    for (let i = 1; i < versions.length; i++) {
      if (versions[i] === versions[i - 1]) {
        throw new Error(`Duplicate migration version: ${versions[i]}`);
      }
    }
  }

  private executeMigrationSql(sql: string): void {
    // Split SQL by semicolons to handle multiple statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        this.connection.exec(statement);

        // After a CREATE TABLE, ensure tenant_id column exists
        const upperStatement = statement.trim().toUpperCase();
        if (upperStatement.startsWith('CREATE TABLE')) {
          const tableMatch = statement.trim().match(
            /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?['"]?(\w+)['"]?/i
          );
          if (tableMatch) {
            const tableName = tableMatch[1]!;
            this.ensureTenantIdColumn(tableName);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          statement.trim().toUpperCase().startsWith('ALTER TABLE') &&
          statement.trim().toUpperCase().includes('ADD COLUMN') &&
          (message.includes('duplicate column name') || message.includes('already exists'))
        ) {
          continue;
        }
        throw err;
      }
    }
  }

  private ensureTenantIdColumn(tableName: string): void {
    const columns = this.connection.query<{ name: string }>(
      `PRAGMA table_info('${tableName}')`
    );
    const hasTenantId = columns.some(c => c.name === 'tenant_id');
    if (!hasTenantId) {
      try {
        this.connection.exec(
          `ALTER TABLE "${tableName}" ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default'`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('duplicate column name') || message.includes('already exists')) {
          return;
        }
        throw err;
      }
    }
  }

  private computeChecksum(sql: string): string {
    // Simple checksum using string hash
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
      const char = sql.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

export function createMigrationRunner(connection: ConnectionManager): MigrationRunner {
  return new MigrationRunnerImpl(connection);
}
