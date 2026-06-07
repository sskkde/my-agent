import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import type { AsyncConnectionManager } from '../../database-adapter.js'

/**
 * Configuration for a PostgreSQL connection pool.
 */
export interface PostgresConnectionConfig {
  /** PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db) */
  connectionString: string
  /** Maximum pool size (default: 10) */
  max?: number
  /** Idle timeout in milliseconds (default: 30000) */
  idleTimeoutMillis?: number
  /** Connection timeout in milliseconds (default: 5000) */
  connectionTimeoutMillis?: number
}

const DEFAULT_MAX = 10
const DEFAULT_IDLE_TIMEOUT = 30000
const DEFAULT_CONNECTION_TIMEOUT = 5000

/**
 * PostgresConnectionManager — async connection pool management for PostgreSQL.
 *
 * Implements the AsyncConnectionManager interface, providing Promise-based
 * query, exec, and transaction operations backed by a `pg.Pool`.
 *
 * Pool creation is synchronous (pg.Pool constructor does not connect immediately).
 * Actual connections are acquired lazily on first query or via `open()` which
 * verifies connectivity with a SELECT 1.
 */
export class PostgresConnectionManager implements AsyncConnectionManager {
  private pool: pg.Pool | null = null
  private config: PostgresConnectionConfig
  private transactionClient = new AsyncLocalStorage<pg.PoolClient>()

  constructor(config: PostgresConnectionConfig) {
    this.config = config
  }

  /**
   * Open the connection pool and verify connectivity.
   * Creates the pool (sync) and tests with SELECT 1 (async).
   */
  async open(): Promise<void> {
    if (this.pool) {
      return
    }

    this.pool = new pg.Pool({
      connectionString: this.config.connectionString,
      max: this.config.max ?? DEFAULT_MAX,
      idleTimeoutMillis: this.config.idleTimeoutMillis ?? DEFAULT_IDLE_TIMEOUT,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT,
    })

    try {
      const client = await this.pool.connect()
      client.release()
    } catch (err) {
      await this.pool.end()
      this.pool = null
      throw err
    }
  }

  /**
   * Drain and close the connection pool.
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }

  /**
   * Check if the pool has been created.
   * Note: this does not verify that connections are actually available.
   */
  isOpen(): boolean {
    return this.pool !== null
  }

  /**
   * Execute a query and return rows.
   */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const transactionClient = this.transactionClient.getStore()
    if (transactionClient) {
      const result = await transactionClient.query(sql, params)
      return result.rows as T[]
    }

    if (!this.pool) {
      throw new Error('PostgreSQL connection pool is not open')
    }
    const result = await this.pool.query(sql, params)
    return result.rows as T[]
  }

  /**
   * Execute a statement without returning rows.
   */
  async exec(sql: string, params?: unknown[]): Promise<void> {
    const transactionClient = this.transactionClient.getStore()
    if (transactionClient) {
      await transactionClient.query(sql, params)
      return
    }

    if (!this.pool) {
      throw new Error('PostgreSQL connection pool is not open')
    }
    await this.pool.query(sql, params)
  }

  /**
   * Execute a function within a database transaction.
   * Acquires a dedicated client, runs BEGIN/COMMIT/ROLLBACK.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('PostgreSQL connection pool is not open')
    }

    const transactionClient = this.transactionClient.getStore()
    if (transactionClient) {
      return fn()
    }

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.transactionClient.run(client, fn)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // Pool Metrics & Health

  /**
   * Get pool metrics for health checking and monitoring.
   * Returns zeros if pool is not open.
   */
  getPoolMetrics(): { totalCount: number; idleCount: number; waitingCount: number } {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 }
    }
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    }
  }

  /**
   * Verify database connectivity by executing SELECT 1.
   * Returns true if the query succeeds, false otherwise.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }
}
