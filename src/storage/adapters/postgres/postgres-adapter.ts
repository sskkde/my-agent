import { type DatabaseAdapter, DatabaseAdapterError } from '../../database-adapter.js';
import { SqlDialect } from '../../sql-dialect.js';
import { PostgresConnectionManager, type PostgresConnectionConfig } from './postgres-connection.js';

const SYNC_ERROR = 'Synchronous operations are not supported on PostgreSQL. Use async methods (asyncQuery, asyncExec, asyncTransaction) instead.';

/**
 * PostgresAdapter — DatabaseAdapter implementation for PostgreSQL.
 *
 * Sync methods (query, exec, transaction) throw DatabaseAdapterError because
 * PostgreSQL is network-based and inherently async. Use the async counterparts
 * (asyncQuery, asyncExec, asyncTransaction) instead.
 *
 * open() and close() are synchronous per the DatabaseAdapter interface, but
 * internally initiate async operations. The pg.Pool constructor is synchronous
 * (it does not connect immediately), so open() creates the pool synchronously
 * and actual connections are established lazily on first query. Use healthCheck()
 * on the underlying connection manager to verify connectivity.
 */
export class PostgresAdapter implements DatabaseAdapter {
  private connection: PostgresConnectionManager;
  private dialect: SqlDialect;

  constructor(config: PostgresConnectionConfig) {
    this.connection = new PostgresConnectionManager(config);
    this.dialect = SqlDialect.postgresql();
  }

  // Sync methods — throw because PostgreSQL is async

  query<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): T[] {
    throw new DatabaseAdapterError(SYNC_ERROR);
  }

  exec(_sql: string, _params?: unknown[]): void {
    throw new DatabaseAdapterError(SYNC_ERROR);
  }

  transaction<T>(_fn: () => T): () => T {
    throw new DatabaseAdapterError(SYNC_ERROR);
  }

  // Async methods — delegate to PostgresConnectionManager

  asyncQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.connection.query<T>(sql, params);
  }

  asyncExec(sql: string, params?: unknown[]): Promise<void> {
    return this.connection.exec(sql, params);
  }

  asyncTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.connection.transaction(fn);
  }

  // Lifecycle — sync per interface, pool creation is sync in pg

  open(): void {
    if (this.connection.isOpen()) {
      return;
    }
    void this.connection.open();
  }

  close(): void {
    if (!this.connection.isOpen()) {
      return;
    }
    void this.connection.close();
  }

  isOpen(): boolean {
    return this.connection.isOpen();
  }

  getDialect(): SqlDialect {
    return this.dialect;
  }

  getType(): 'postgresql' {
    return 'postgresql';
  }

  async healthCheck(): Promise<boolean> {
    return this.connection.healthCheck();
  }

  getPoolMetrics(): { totalCount: number; idleCount: number; waitingCount: number } {
    return this.connection.getPoolMetrics();
  }

  getConnection(): PostgresConnectionManager {
    return this.connection;
  }
}

export function createPostgresAdapter(connectionString: string): DatabaseAdapter {
  return new PostgresAdapter({ connectionString });
}

export function createPostgresAdapterWithConfig(config: PostgresConnectionConfig): DatabaseAdapter {
  return new PostgresAdapter(config);
}
