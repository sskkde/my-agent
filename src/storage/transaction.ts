import type { ConnectionManager } from './connection.js'

export interface TransactionHelper {
  begin(): void
  commit(): void
  rollback(): void
  withTransaction<T>(fn: () => T | Promise<T>): Promise<T>
  getDepth(): number
}

class TransactionHelperImpl implements TransactionHelper {
  private connection: ConnectionManager
  private depth: number = 0
  private wtDepth: number = 0

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  begin(): void {
    if (this.depth === 0) {
      this.connection.exec('BEGIN')
    } else {
      // Use savepoints for nested transactions
      this.connection.exec(`SAVEPOINT sp_${this.depth}`)
    }
    this.depth++
  }

  commit(): void {
    if (this.depth === 0) {
      throw new Error('No active transaction to commit')
    }

    this.depth--

    if (this.depth === 0) {
      this.connection.exec('COMMIT')
    } else {
      // Release savepoint
      this.connection.exec(`RELEASE SAVEPOINT sp_${this.depth}`)
    }
  }

  rollback(): void {
    if (this.depth === 0) {
      throw new Error('No active transaction to rollback')
    }

    this.depth--

    if (this.depth === 0) {
      this.connection.exec('ROLLBACK')
    } else {
      // Rollback to savepoint
      this.connection.exec(`ROLLBACK TO SAVEPOINT sp_${this.depth}`)
    }
  }

  async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    // Capture depth synchronously before any await to prevent overlapping
    // calls from corrupting each other's savepoint state.
    const myDepth = this.wtDepth++
    const savepointName = `sp_wt_${myDepth}`

    try {
      if (myDepth === 0) {
        this.connection.exec('BEGIN')
      } else {
        this.connection.exec(`SAVEPOINT ${savepointName}`)
      }

      const result = await fn()

      if (myDepth === 0) {
        this.connection.exec('COMMIT')
      } else {
        this.connection.exec(`RELEASE SAVEPOINT ${savepointName}`)
      }

      return result
    } catch (error) {
      if (myDepth === 0) {
        this.connection.exec('ROLLBACK')
      } else {
        this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`)
        this.connection.exec(`RELEASE SAVEPOINT ${savepointName}`)
      }
      throw error
    } finally {
      this.wtDepth--
    }
  }

  getDepth(): number {
    return this.depth
  }
}

export function createTransactionHelper(connection: ConnectionManager): TransactionHelper {
  return new TransactionHelperImpl(connection)
}
