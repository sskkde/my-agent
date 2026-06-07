import type { BudgetPeriod, BudgetConfig, BudgetUsage, ResourceLimitType } from './limit-types.js'
import type { BudgetStore, BudgetUsageRecord } from '../storage/budget-store.js'
import { checkResourceLimit } from './resource-limits.js'

class BudgetExceededErrorImpl extends Error {
  budgetType: ResourceLimitType
  currentUsage: number
  limit: number

  constructor(budgetType: ResourceLimitType, currentUsage: number, limit: number) {
    super(`Budget exceeded: ${budgetType} usage ${currentUsage} exceeds limit ${limit}`)
    this.name = 'BudgetExceededError'
    this.budgetType = budgetType
    this.currentUsage = currentUsage
    this.limit = limit
  }
}

export { BudgetExceededErrorImpl as BudgetExceededError }

function generateRecordId(userId: string, period: BudgetPeriod): string {
  return `budget-${userId}-${period}`
}

function shouldResetPeriod(period: BudgetPeriod, periodStartedAt: string): boolean {
  const startedAt = new Date(periodStartedAt)
  const now = new Date()

  switch (period) {
    case 'daily': {
      return startedAt.toDateString() !== now.toDateString()
    }
    case 'monthly': {
      return startedAt.getFullYear() !== now.getFullYear() || startedAt.getMonth() !== now.getMonth()
    }
    case 'per_session':
      return false
    default:
      return false
  }
}

export interface BudgetManager {
  trackTokenUsage(userId: string, tokens: number, config: BudgetConfig): BudgetUsage
  trackRequestUsage(userId: string, config: BudgetConfig): BudgetUsage
  checkBudget(userId: string, period: BudgetPeriod, config: BudgetConfig): void
  getBudgetUsage(userId: string, period: BudgetPeriod, config: BudgetConfig): BudgetUsage
}

export function createBudgetManager(budgetStore: BudgetStore): BudgetManager {
  return {
    trackTokenUsage,
    trackRequestUsage,
    checkBudget,
    getBudgetUsage,
  }

  function trackTokenUsage(userId: string, tokens: number, config: BudgetConfig): BudgetUsage {
    const record = getOrResetRecord(userId, config)
    record.tokensUsed += tokens
    record.updatedAt = new Date().toISOString()
    budgetStore.upsert(record)
    return recordToUsage(record, config)
  }

  function trackRequestUsage(userId: string, config: BudgetConfig): BudgetUsage {
    const record = getOrResetRecord(userId, config)
    record.requestsUsed += 1
    record.updatedAt = new Date().toISOString()
    budgetStore.upsert(record)
    return recordToUsage(record, config)
  }

  function checkBudget(userId: string, period: BudgetPeriod, config: BudgetConfig): void {
    const record = getOrResetRecord(userId, { ...config, period })
    const usage = recordToUsage(record, config)

    if (!checkResourceLimit('token_count', usage.tokensUsed, config.tokenLimit)) {
      throw new BudgetExceededErrorImpl('token_count', usage.tokensUsed, config.tokenLimit)
    }

    if (!checkResourceLimit('request_count', usage.requestsUsed, config.requestLimit)) {
      throw new BudgetExceededErrorImpl('request_count', usage.requestsUsed, config.requestLimit)
    }

    if (!checkResourceLimit('memory_mb', usage.memoryUsedMb, config.memoryLimitMb)) {
      throw new BudgetExceededErrorImpl('memory_mb', usage.memoryUsedMb, config.memoryLimitMb)
    }
  }

  function getBudgetUsage(userId: string, period: BudgetPeriod, config: BudgetConfig): BudgetUsage {
    const record = getOrResetRecord(userId, { ...config, period })
    return recordToUsage(record, config)
  }

  function getOrResetRecord(userId: string, config: BudgetConfig): BudgetUsageRecord {
    const existing = budgetStore.getByUserAndPeriod(userId, config.period)

    if (!existing) {
      const now = new Date().toISOString()
      const record: BudgetUsageRecord = {
        recordId: generateRecordId(userId, config.period),
        userId,
        period: config.period,
        tokensUsed: 0,
        requestsUsed: 0,
        memoryUsedMb: 0,
        periodStartedAt: now,
        updatedAt: now,
      }
      budgetStore.upsert(record)
      return record
    }

    if (shouldResetPeriod(config.period, existing.periodStartedAt)) {
      const now = new Date().toISOString()
      budgetStore.resetUsage(userId, config.period, now)
      return {
        ...existing,
        tokensUsed: 0,
        requestsUsed: 0,
        memoryUsedMb: 0,
        periodStartedAt: now,
        updatedAt: now,
      }
    }

    return existing
  }

  function recordToUsage(record: BudgetUsageRecord, config: BudgetConfig): BudgetUsage {
    const maxLimit = Math.max(config.tokenLimit, config.requestLimit, config.memoryLimitMb)
    const maxUsed = Math.max(record.tokensUsed, record.requestsUsed, record.memoryUsedMb)
    const percentUsed = maxLimit > 0 ? Math.round((maxUsed / maxLimit) * 100) : 0

    return {
      period: record.period,
      tokensUsed: record.tokensUsed,
      requestsUsed: record.requestsUsed,
      memoryUsedMb: record.memoryUsedMb,
      percentUsed: Math.min(percentUsed, 100),
    }
  }
}
