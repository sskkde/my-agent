import type { SqlDialect } from './sql-dialect.js'

/**
 * Async connection interface for PostgreSQL-style databases.
 * All operations return Promises since network-based databases are inherently async.
 */
export interface AsyncConnectionManager {
  open(): Promise<void>
  close(): Promise<void>
  isOpen(): boolean
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  exec(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: () => Promise<T>): Promise<T>
}

/**
 * DatabaseAdapter — unified interface bridging synchronous (SQLite) and
 * asynchronous (PostgreSQL) database access.
 *
 * Dual-mode strategy:
 * - **SQLite mode**: Use sync methods (`query`, `exec`, `transaction`).
 *   Async methods throw `DatabaseAdapterError` because SQLite (better-sqlite3) is synchronous.
 * - **PostgreSQL mode**: Use async methods (`asyncQuery`, `asyncExec`, `asyncTransaction`).
 *   Sync methods throw `DatabaseAdapterError` because PostgreSQL is network-based and inherently async.
 *
 * @example
 * const adapter: DatabaseAdapter = createSqliteAdapter(':memory:');
 * adapter.open();
 * const rows = adapter.query('SELECT * FROM users WHERE id = ?', [1]);
 * adapter.close();
 */
export interface DatabaseAdapter {
  open(): void
  close(): void
  isOpen(): boolean

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[]
  exec(sql: string, params?: unknown[]): void
  transaction<T>(fn: () => T): () => T

  asyncQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  asyncExec(sql: string, params?: unknown[]): Promise<void>
  asyncTransaction<T>(fn: () => Promise<T>): Promise<T>

  getDialect(): SqlDialect
  getType(): 'sqlite' | 'postgresql'

  healthCheck(): Promise<boolean>
  getPoolMetrics(): { totalCount: number; idleCount: number; waitingCount: number }
}

export class DatabaseAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseAdapterError'
  }
}
