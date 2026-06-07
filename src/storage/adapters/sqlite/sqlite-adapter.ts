import { type DatabaseAdapter, DatabaseAdapterError } from '../../database-adapter.js'
import { SqlDialect } from '../../sql-dialect.js'
import { createConnectionManager, type ConnectionManager } from '../../connection.js'

const ASYNC_NOT_SUPPORTED = 'Async operations are not supported on SQLite adapter. Use sync methods instead.'

/**
 * SqliteAdapter — SQLite implementation of the DatabaseAdapter interface.
 *
 * Wraps the existing synchronous ConnectionManager (better-sqlite3) into
 * the unified DatabaseAdapter contract. Sync methods delegate directly;
 * async methods throw `DatabaseAdapterError` because SQLite is inherently synchronous.
 *
 * @example
 * const adapter = createSqliteAdapter(':memory:');
 * adapter.open();
 * adapter.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)');
 * const rows = adapter.query('SELECT * FROM foo WHERE id = ?', [1]);
 * adapter.close();
 */
export class SqliteAdapter implements DatabaseAdapter {
  private connection: ConnectionManager
  private dialect: SqlDialect

  constructor(path: string) {
    this.connection = createConnectionManager(path)
    this.dialect = SqlDialect.sqlite()
  }

  open(): void {
    this.connection.open()
  }

  close(): void {
    this.connection.close()
  }

  isOpen(): boolean {
    return this.connection.isOpen()
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    return this.connection.query<T>(sql, params)
  }

  exec(sql: string, params?: unknown[]): void {
    this.connection.exec(sql, params)
  }

  transaction<T>(fn: () => T): () => T {
    return this.connection.transaction(fn)
  }

  asyncQuery<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): Promise<T[]> {
    throw new DatabaseAdapterError(ASYNC_NOT_SUPPORTED)
  }

  asyncExec(_sql: string, _params?: unknown[]): Promise<void> {
    throw new DatabaseAdapterError(ASYNC_NOT_SUPPORTED)
  }

  asyncTransaction<T>(_fn: () => Promise<T>): Promise<T> {
    throw new DatabaseAdapterError(ASYNC_NOT_SUPPORTED)
  }

  getDialect(): SqlDialect {
    return this.dialect
  }

  getType(): 'sqlite' {
    return 'sqlite'
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.connection.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  getPoolMetrics(): { totalCount: number; idleCount: number; waitingCount: number } {
    return { totalCount: 1, idleCount: 1, waitingCount: 0 }
  }
}

/**
 * Factory function to create a SqliteAdapter instance.
 *
 * @param path - SQLite database path (use `:memory:` for in-memory databases)
 * @returns A DatabaseAdapter backed by SQLite
 */
export function createSqliteAdapter(path: string): DatabaseAdapter {
  return new SqliteAdapter(path)
}
