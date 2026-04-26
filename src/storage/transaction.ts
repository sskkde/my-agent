import type { ConnectionManager } from './connection.js';

export interface TransactionHelper {
  begin(): void;
  commit(): void;
  rollback(): void;
  withTransaction<T>(fn: () => T | Promise<T>): Promise<T>;
  getDepth(): number;
}

class TransactionHelperImpl implements TransactionHelper {
  private connection: ConnectionManager;
  private depth: number = 0;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  begin(): void {
    if (this.depth === 0) {
      this.connection.exec('BEGIN');
    } else {
      // Use savepoints for nested transactions
      this.connection.exec(`SAVEPOINT sp_${this.depth}`);
    }
    this.depth++;
  }

  commit(): void {
    if (this.depth === 0) {
      throw new Error('No active transaction to commit');
    }

    this.depth--;

    if (this.depth === 0) {
      this.connection.exec('COMMIT');
    } else {
      // Release savepoint
      this.connection.exec(`RELEASE SAVEPOINT sp_${this.depth}`);
    }
  }

  rollback(): void {
    if (this.depth === 0) {
      throw new Error('No active transaction to rollback');
    }

    this.depth--;

    if (this.depth === 0) {
      this.connection.exec('ROLLBACK');
    } else {
      // Rollback to savepoint
      this.connection.exec(`ROLLBACK TO SAVEPOINT sp_${this.depth}`);
    }
  }

  async withTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.begin();

    try {
      const result = await fn();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  getDepth(): number {
    return this.depth;
  }
}

export function createTransactionHelper(connection: ConnectionManager): TransactionHelper {
  return new TransactionHelperImpl(connection);
}
