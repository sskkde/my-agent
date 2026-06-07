import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { createBudgetStore, type BudgetStore, type BudgetUsageRecord } from '../../../src/storage/budget-store.js'
import { createBudgetManager, BudgetExceededError, type BudgetManager } from '../../../src/memory/budget-manager.js'
import type { BudgetConfig } from '../../../src/memory/limit-types.js'

const DEFAULT_CONFIG: BudgetConfig = {
  period: 'daily',
  tokenLimit: 10000,
  requestLimit: 100,
  memoryLimitMb: 512,
}

function createBudgetMigration() {
  return {
    version: 1,
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
    `,
  }
}

describe('Budget Manager Integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let budgetStore: BudgetStore
  let budgetManager: BudgetManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply([createBudgetMigration()])
    budgetStore = createBudgetStore(connection)
    budgetManager = createBudgetManager(budgetStore)
  })

  afterEach(() => {
    connection?.close()
  })

  // ============================================================================
  // Budget Store CRUD
  // ============================================================================
  describe('BudgetStore', () => {
    it('should upsert and retrieve a budget record', () => {
      const now = new Date().toISOString()
      const record: BudgetUsageRecord = {
        recordId: 'budget-user1-daily',
        userId: 'user1',
        period: 'daily',
        tokensUsed: 500,
        requestsUsed: 10,
        memoryUsedMb: 128,
        periodStartedAt: now,
        updatedAt: now,
      }

      budgetStore.upsert(record)
      const retrieved = budgetStore.getByUserAndPeriod('user1', 'daily')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.userId).toBe('user1')
      expect(retrieved!.period).toBe('daily')
      expect(retrieved!.tokensUsed).toBe(500)
      expect(retrieved!.requestsUsed).toBe(10)
      expect(retrieved!.memoryUsedMb).toBe(128)
    })

    it('should update existing record on upsert', () => {
      const now = new Date().toISOString()
      const record: BudgetUsageRecord = {
        recordId: 'budget-user2-daily',
        userId: 'user2',
        period: 'daily',
        tokensUsed: 100,
        requestsUsed: 5,
        memoryUsedMb: 64,
        periodStartedAt: now,
        updatedAt: now,
      }

      budgetStore.upsert(record)

      const updated: BudgetUsageRecord = {
        ...record,
        tokensUsed: 200,
        requestsUsed: 15,
        updatedAt: new Date().toISOString(),
      }

      budgetStore.upsert(updated)
      const retrieved = budgetStore.getByUserAndPeriod('user2', 'daily')

      expect(retrieved!.tokensUsed).toBe(200)
      expect(retrieved!.requestsUsed).toBe(15)
    })

    it('should return null for non-existent record', () => {
      const result = budgetStore.getByUserAndPeriod('nonexistent', 'daily')
      expect(result).toBeNull()
    })

    it('should get all records for a user', () => {
      const now = new Date().toISOString()

      budgetStore.upsert({
        recordId: 'budget-user3-daily',
        userId: 'user3',
        period: 'daily',
        tokensUsed: 100,
        requestsUsed: 5,
        memoryUsedMb: 32,
        periodStartedAt: now,
        updatedAt: now,
      })

      budgetStore.upsert({
        recordId: 'budget-user3-monthly',
        userId: 'user3',
        period: 'monthly',
        tokensUsed: 5000,
        requestsUsed: 200,
        memoryUsedMb: 256,
        periodStartedAt: now,
        updatedAt: now,
      })

      const records = budgetStore.getByUserId('user3')
      expect(records.length).toBe(2)
    })

    it('should delete a budget record', () => {
      const now = new Date().toISOString()
      budgetStore.upsert({
        recordId: 'budget-user4-daily',
        userId: 'user4',
        period: 'daily',
        tokensUsed: 0,
        requestsUsed: 0,
        memoryUsedMb: 0,
        periodStartedAt: now,
        updatedAt: now,
      })

      budgetStore.delete('budget-user4-daily')
      const result = budgetStore.getByUserAndPeriod('user4', 'daily')
      expect(result).toBeNull()
    })

    it('should reset usage counters', () => {
      const now = new Date().toISOString()
      budgetStore.upsert({
        recordId: 'budget-user5-daily',
        userId: 'user5',
        period: 'daily',
        tokensUsed: 5000,
        requestsUsed: 50,
        memoryUsedMb: 256,
        periodStartedAt: now,
        updatedAt: now,
      })

      const newPeriodStart = new Date().toISOString()
      budgetStore.resetUsage('user5', 'daily', newPeriodStart)

      const result = budgetStore.getByUserAndPeriod('user5', 'daily')
      expect(result!.tokensUsed).toBe(0)
      expect(result!.requestsUsed).toBe(0)
      expect(result!.memoryUsedMb).toBe(0)
      expect(result!.periodStartedAt).toBe(newPeriodStart)
    })

    it('should support per_session period', () => {
      const now = new Date().toISOString()
      budgetStore.upsert({
        recordId: 'budget-user6-per_session',
        userId: 'user6',
        period: 'per_session',
        tokensUsed: 100,
        requestsUsed: 5,
        memoryUsedMb: 32,
        periodStartedAt: now,
        updatedAt: now,
      })

      const result = budgetStore.getByUserAndPeriod('user6', 'per_session')
      expect(result).not.toBeNull()
      expect(result!.period).toBe('per_session')
    })
  })

  // ============================================================================
  // BudgetManager - trackTokenUsage
  // ============================================================================
  describe('BudgetManager.trackTokenUsage', () => {
    it('should track token consumption for a new user', () => {
      const usage = budgetManager.trackTokenUsage('user-t1', 500, DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(500)
      expect(usage.requestsUsed).toBe(0)
      expect(usage.period).toBe('daily')
    })

    it('should accumulate token usage across multiple calls', () => {
      budgetManager.trackTokenUsage('user-t2', 200, DEFAULT_CONFIG)
      budgetManager.trackTokenUsage('user-t2', 300, DEFAULT_CONFIG)
      const usage = budgetManager.trackTokenUsage('user-t2', 100, DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(600)
    })

    it('should return percentUsed', () => {
      const usage = budgetManager.trackTokenUsage('user-t3', 5000, DEFAULT_CONFIG)

      expect(usage.percentUsed).toBeGreaterThan(0)
      expect(usage.percentUsed).toBeLessThanOrEqual(100)
    })
  })

  // ============================================================================
  // BudgetManager - trackRequestUsage
  // ============================================================================
  describe('BudgetManager.trackRequestUsage', () => {
    it('should track request count for a new user', () => {
      const usage = budgetManager.trackRequestUsage('user-r1', DEFAULT_CONFIG)

      expect(usage.requestsUsed).toBe(1)
      expect(usage.tokensUsed).toBe(0)
    })

    it('should accumulate request count across multiple calls', () => {
      budgetManager.trackRequestUsage('user-r2', DEFAULT_CONFIG)
      budgetManager.trackRequestUsage('user-r2', DEFAULT_CONFIG)
      const usage = budgetManager.trackRequestUsage('user-r2', DEFAULT_CONFIG)

      expect(usage.requestsUsed).toBe(3)
    })
  })

  // ============================================================================
  // BudgetManager - checkBudget
  // ============================================================================
  describe('BudgetManager.checkBudget', () => {
    it('should not throw when budget is within limits', () => {
      budgetManager.trackTokenUsage('user-c1', 5000, DEFAULT_CONFIG)
      budgetManager.trackRequestUsage('user-c1', DEFAULT_CONFIG)

      expect(() => budgetManager.checkBudget('user-c1', 'daily', DEFAULT_CONFIG)).not.toThrow()
    })

    it('should throw BudgetExceededError when token limit exceeded', () => {
      budgetManager.trackTokenUsage('user-c2', 10000, DEFAULT_CONFIG)
      budgetManager.trackTokenUsage('user-c2', 1, DEFAULT_CONFIG)

      try {
        budgetManager.checkBudget('user-c2', 'daily', DEFAULT_CONFIG)
        expect.unreachable('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BudgetExceededError)
        const err = e as InstanceType<typeof BudgetExceededError>
        expect(err.budgetType).toBe('token_count')
        expect(err.currentUsage).toBeGreaterThan(DEFAULT_CONFIG.tokenLimit)
        expect(err.limit).toBe(DEFAULT_CONFIG.tokenLimit)
      }
    })

    it('should throw BudgetExceededError when request limit exceeded', () => {
      for (let i = 0; i < 101; i++) {
        budgetManager.trackRequestUsage('user-c3', DEFAULT_CONFIG)
      }

      try {
        budgetManager.checkBudget('user-c3', 'daily', DEFAULT_CONFIG)
        expect.unreachable('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BudgetExceededError)
        const err = e as InstanceType<typeof BudgetExceededError>
        expect(err.budgetType).toBe('request_count')
        expect(err.currentUsage).toBeGreaterThan(DEFAULT_CONFIG.requestLimit)
      }
    })

    it('should throw BudgetExceededError when memory limit exceeded', () => {
      const lowMemoryConfig: BudgetConfig = {
        period: 'daily',
        tokenLimit: 10000,
        requestLimit: 100,
        memoryLimitMb: 10,
      }

      const store = budgetStore.getByUserAndPeriod('user-c4', 'daily')
      if (!store) {
        const now = new Date().toISOString()
        budgetStore.upsert({
          recordId: `budget-user-c4-daily`,
          userId: 'user-c4',
          period: 'daily',
          tokensUsed: 0,
          requestsUsed: 0,
          memoryUsedMb: 20,
          periodStartedAt: now,
          updatedAt: now,
        })
      } else {
        budgetStore.upsert({
          ...store,
          memoryUsedMb: 20,
          updatedAt: new Date().toISOString(),
        })
      }

      try {
        budgetManager.checkBudget('user-c4', 'daily', lowMemoryConfig)
        expect.unreachable('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BudgetExceededError)
        const err = e as InstanceType<typeof BudgetExceededError>
        expect(err.budgetType).toBe('memory_mb')
        expect(err.currentUsage).toBeGreaterThan(lowMemoryConfig.memoryLimitMb)
      }
    })

    it('should not throw when usage exactly equals limit', () => {
      budgetManager.trackTokenUsage('user-c5', 10000, DEFAULT_CONFIG)

      for (let i = 0; i < 100; i++) {
        budgetManager.trackRequestUsage('user-c5', DEFAULT_CONFIG)
      }

      expect(() => budgetManager.checkBudget('user-c5', 'daily', DEFAULT_CONFIG)).not.toThrow()
    })
  })

  // ============================================================================
  // BudgetManager - getBudgetUsage
  // ============================================================================
  describe('BudgetManager.getBudgetUsage', () => {
    it('should return zero usage for new user', () => {
      const usage = budgetManager.getBudgetUsage('user-g1', 'daily', DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(0)
      expect(usage.requestsUsed).toBe(0)
      expect(usage.memoryUsedMb).toBe(0)
      expect(usage.percentUsed).toBe(0)
    })

    it('should return current usage after tracking', () => {
      budgetManager.trackTokenUsage('user-g2', 3000, DEFAULT_CONFIG)
      budgetManager.trackRequestUsage('user-g2', DEFAULT_CONFIG)
      budgetManager.trackRequestUsage('user-g2', DEFAULT_CONFIG)

      const usage = budgetManager.getBudgetUsage('user-g2', 'daily', DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(3000)
      expect(usage.requestsUsed).toBe(2)
      expect(usage.period).toBe('daily')
    })

    it('should calculate percentUsed correctly', () => {
      budgetManager.trackTokenUsage('user-g3', 5000, DEFAULT_CONFIG)

      const usage = budgetManager.getBudgetUsage('user-g3', 'daily', DEFAULT_CONFIG)
      expect(usage.percentUsed).toBe(50)
    })
  })

  // ============================================================================
  // Budget Period Reset
  // ============================================================================
  describe('Budget Period Reset', () => {
    it('should reset daily budget when day changes', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString()

      budgetStore.upsert({
        recordId: 'budget-user-d1-daily',
        userId: 'user-d1',
        period: 'daily',
        tokensUsed: 9000,
        requestsUsed: 90,
        memoryUsedMb: 400,
        periodStartedAt: yesterdayStr,
        updatedAt: yesterdayStr,
      })

      const usage = budgetManager.getBudgetUsage('user-d1', 'daily', DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(0)
      expect(usage.requestsUsed).toBe(0)
      expect(usage.memoryUsedMb).toBe(0)
    })

    it('should not reset daily budget within same day', () => {
      const today = new Date().toISOString()

      budgetStore.upsert({
        recordId: 'budget-user-d2-daily',
        userId: 'user-d2',
        period: 'daily',
        tokensUsed: 5000,
        requestsUsed: 50,
        memoryUsedMb: 200,
        periodStartedAt: today,
        updatedAt: today,
      })

      const usage = budgetManager.getBudgetUsage('user-d2', 'daily', DEFAULT_CONFIG)

      expect(usage.tokensUsed).toBe(5000)
      expect(usage.requestsUsed).toBe(50)
    })

    it('should reset monthly budget when month changes', () => {
      const lastMonth = new Date()
      lastMonth.setMonth(lastMonth.getMonth() - 1)
      const lastMonthStr = lastMonth.toISOString()

      budgetStore.upsert({
        recordId: 'budget-user-m1-monthly',
        userId: 'user-m1',
        period: 'monthly',
        tokensUsed: 50000,
        requestsUsed: 500,
        memoryUsedMb: 1024,
        periodStartedAt: lastMonthStr,
        updatedAt: lastMonthStr,
      })

      const usage = budgetManager.getBudgetUsage('user-m1', 'monthly', {
        ...DEFAULT_CONFIG,
        period: 'monthly',
      })

      expect(usage.tokensUsed).toBe(0)
      expect(usage.requestsUsed).toBe(0)
    })

    it('should not reset monthly budget within same month', () => {
      const thisMonth = new Date().toISOString()

      budgetStore.upsert({
        recordId: 'budget-user-m2-monthly',
        userId: 'user-m2',
        period: 'monthly',
        tokensUsed: 50000,
        requestsUsed: 500,
        memoryUsedMb: 1024,
        periodStartedAt: thisMonth,
        updatedAt: thisMonth,
      })

      const usage = budgetManager.getBudgetUsage('user-m2', 'monthly', {
        ...DEFAULT_CONFIG,
        period: 'monthly',
      })

      expect(usage.tokensUsed).toBe(50000)
    })

    it('should never reset per_session budget automatically', () => {
      const longAgo = new Date('2020-01-01').toISOString()

      budgetStore.upsert({
        recordId: 'budget-user-s1-per_session',
        userId: 'user-s1',
        period: 'per_session',
        tokensUsed: 8000,
        requestsUsed: 80,
        memoryUsedMb: 400,
        periodStartedAt: longAgo,
        updatedAt: longAgo,
      })

      const usage = budgetManager.getBudgetUsage('user-s1', 'per_session', {
        ...DEFAULT_CONFIG,
        period: 'per_session',
      })

      expect(usage.tokensUsed).toBe(8000)
      expect(usage.requestsUsed).toBe(80)
    })
  })
})
