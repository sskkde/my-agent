import type { ConnectionManager } from './connection.js';
import type { BudgetPeriod } from '../memory/limit-types.js';

// ============================================================================
// Types
// ============================================================================

export type BudgetUsageRecord = {
  /** Unique record ID */
  recordId: string;
  /** User ID this budget belongs to */
  userId: string;
  /** Budget tracking period */
  period: BudgetPeriod;
  /** Tokens used so far */
  tokensUsed: number;
  /** Requests made so far */
  requestsUsed: number;
  /** Memory used in MB so far */
  memoryUsedMb: number;
  /** When the current period started (ISO 8601) */
  periodStartedAt: string;
  /** When the record was last updated (ISO 8601) */
  updatedAt: string;
};

export interface BudgetStore {
  /** Upsert a budget usage record (insert or update) */
  upsert(record: BudgetUsageRecord): void;
  /** Get budget usage by userId and period */
  getByUserAndPeriod(userId: string, period: BudgetPeriod): BudgetUsageRecord | null;
  /** Get all budget records for a user */
  getByUserId(userId: string): BudgetUsageRecord[];
  /** Delete a budget record */
  delete(recordId: string): void;
  /** Reset usage for a user+period (sets counters to 0, updates periodStartedAt) */
  resetUsage(userId: string, period: BudgetPeriod, newPeriodStart: string): void;
}

// ============================================================================
// Implementation
// ============================================================================

class BudgetStoreImpl implements BudgetStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  upsert(record: BudgetUsageRecord): void {
    const sql = `
      INSERT INTO budget_usage (
        record_id, user_id, period, tokens_used, requests_used,
        memory_used_mb, period_started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        tokens_used = excluded.tokens_used,
        requests_used = excluded.requests_used,
        memory_used_mb = excluded.memory_used_mb,
        period_started_at = excluded.period_started_at,
        updated_at = excluded.updated_at
    `;

    this.connection.exec(sql, [
      record.recordId,
      record.userId,
      record.period,
      record.tokensUsed,
      record.requestsUsed,
      record.memoryUsedMb,
      record.periodStartedAt,
      record.updatedAt
    ]);
  }

  getByUserAndPeriod(userId: string, period: BudgetPeriod): BudgetUsageRecord | null {
    const sql = 'SELECT * FROM budget_usage WHERE user_id = ? AND period = ?';
    const rows = this.connection.query<BudgetUsageRow>(sql, [userId, period]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToRecord(rows[0]);
  }

  getByUserId(userId: string): BudgetUsageRecord[] {
    const sql = 'SELECT * FROM budget_usage WHERE user_id = ? ORDER BY period';
    const rows = this.connection.query<BudgetUsageRow>(sql, [userId]);
    return rows.map(r => this.rowToRecord(r));
  }

  delete(recordId: string): void {
    this.connection.exec('DELETE FROM budget_usage WHERE record_id = ?', [recordId]);
  }

  resetUsage(userId: string, period: BudgetPeriod, newPeriodStart: string): void {
    const sql = `
      UPDATE budget_usage
      SET tokens_used = 0,
          requests_used = 0,
          memory_used_mb = 0,
          period_started_at = ?,
          updated_at = ?
      WHERE user_id = ? AND period = ?
    `;

    this.connection.exec(sql, [newPeriodStart, new Date().toISOString(), userId, period]);
  }

  private rowToRecord(row: BudgetUsageRow): BudgetUsageRecord {
    return {
      recordId: row.record_id,
      userId: row.user_id,
      period: row.period as BudgetPeriod,
      tokensUsed: row.tokens_used,
      requestsUsed: row.requests_used,
      memoryUsedMb: row.memory_used_mb,
      periodStartedAt: row.period_started_at,
      updatedAt: row.updated_at
    };
  }
}

type BudgetUsageRow = {
  record_id: string;
  user_id: string;
  period: string;
  tokens_used: number;
  requests_used: number;
  memory_used_mb: number;
  period_started_at: string;
  updated_at: string;
};

// ============================================================================
// Factory
// ============================================================================

export function createBudgetStore(connection: ConnectionManager): BudgetStore {
  return new BudgetStoreImpl(connection);
}

// ============================================================================
// Migration
// ============================================================================

export function createBudgetUsageMigration() {
  return {
    version: 48,
    name: 'create_budget_usage_table',
    up: `
      CREATE TABLE IF NOT EXISTS budget_usage (
        record_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        period TEXT NOT NULL CHECK(period IN ('daily', 'monthly', 'per_session')),
        tokens_used INTEGER NOT NULL DEFAULT 0,
        requests_used INTEGER NOT NULL DEFAULT 0,
        memory_used_mb REAL NOT NULL DEFAULT 0,
        period_started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_usage_user_period
        ON budget_usage(user_id, period);

      CREATE INDEX IF NOT EXISTS idx_budget_usage_user
        ON budget_usage(user_id)
    `,
    down: `
      DROP INDEX IF EXISTS idx_budget_usage_user;
      DROP INDEX IF EXISTS idx_budget_usage_user_period;
      DROP TABLE IF EXISTS budget_usage
    `
  };
}
