import { describe, it, expect } from 'vitest'
import type {
  ResourceLimit,
  BudgetPeriod,
  BudgetConfig,
  BudgetUsage,
  BudgetExceededError,
  CacheConfig,
} from '../../../src/memory/limit-types.js'

describe('Memory Limit Types', () => {
  describe('ResourceLimit', () => {
    it('should allow memory_mb type', () => {
      const limit: ResourceLimit = {
        type: 'memory_mb',
        limit: 1024,
        current: 512,
        resetAt: '2024-01-01T00:00:00Z',
      }
      expect(limit.type).toBe('memory_mb')
    })

    it('should allow token_count type', () => {
      const limit: ResourceLimit = {
        type: 'token_count',
        limit: 100000,
        current: 50000,
        resetAt: '2024-01-01T00:00:00Z',
      }
      expect(limit.type).toBe('token_count')
    })

    it('should allow request_count type', () => {
      const limit: ResourceLimit = {
        type: 'request_count',
        limit: 1000,
        current: 500,
        resetAt: '2024-01-01T00:00:00Z',
      }
      expect(limit.type).toBe('request_count')
    })
  })

  describe('BudgetPeriod', () => {
    it('should allow daily period', () => {
      const period: BudgetPeriod = 'daily'
      expect(period).toBe('daily')
    })

    it('should allow monthly period', () => {
      const period: BudgetPeriod = 'monthly'
      expect(period).toBe('monthly')
    })

    it('should allow per_session period', () => {
      const period: BudgetPeriod = 'per_session'
      expect(period).toBe('per_session')
    })
  })

  describe('BudgetConfig', () => {
    it('should support daily budget configuration', () => {
      const config: BudgetConfig = {
        period: 'daily',
        tokenLimit: 100000,
        requestLimit: 1000,
        memoryLimitMb: 512,
      }
      expect(config.period).toBe('daily')
      expect(config.tokenLimit).toBe(100000)
    })

    it('should support monthly budget configuration', () => {
      const config: BudgetConfig = {
        period: 'monthly',
        tokenLimit: 1000000,
        requestLimit: 10000,
        memoryLimitMb: 2048,
      }
      expect(config.period).toBe('monthly')
    })

    it('should support per_session budget configuration', () => {
      const config: BudgetConfig = {
        period: 'per_session',
        tokenLimit: 50000,
        requestLimit: 100,
        memoryLimitMb: 128,
      }
      expect(config.period).toBe('per_session')
    })
  })

  describe('BudgetUsage', () => {
    it('should track usage with percentage', () => {
      const usage: BudgetUsage = {
        period: 'daily',
        tokensUsed: 50000,
        requestsUsed: 500,
        memoryUsedMb: 256,
        percentUsed: 50,
      }
      expect(usage.percentUsed).toBe(50)
    })
  })

  describe('BudgetExceededError', () => {
    it('should have budgetType, currentUsage, and limit', () => {
      const error: BudgetExceededError = {
        budgetType: 'token_count',
        currentUsage: 110000,
        limit: 100000,
      }
      expect(error.budgetType).toBe('token_count')
      expect(error.currentUsage).toBe(110000)
      expect(error.limit).toBe(100000)
    })

    it('should allow memory_mb budget type', () => {
      const error: BudgetExceededError = {
        budgetType: 'memory_mb',
        currentUsage: 2048,
        limit: 1024,
      }
      expect(error.budgetType).toBe('memory_mb')
    })

    it('should allow request_count budget type', () => {
      const error: BudgetExceededError = {
        budgetType: 'request_count',
        currentUsage: 1500,
        limit: 1000,
      }
      expect(error.budgetType).toBe('request_count')
    })
  })

  describe('CacheConfig', () => {
    it('should support LRU eviction policy', () => {
      const config: CacheConfig = {
        maxSizeMb: 256,
        ttlSeconds: 3600,
        evictionPolicy: 'lru',
      }
      expect(config.evictionPolicy).toBe('lru')
    })

    it('should support LFU eviction policy', () => {
      const config: CacheConfig = {
        maxSizeMb: 512,
        ttlSeconds: 7200,
        evictionPolicy: 'lfu',
      }
      expect(config.evictionPolicy).toBe('lfu')
    })

    it('should have maxSizeMb and ttlSeconds', () => {
      const config: CacheConfig = {
        maxSizeMb: 128,
        ttlSeconds: 1800,
        evictionPolicy: 'lru',
      }
      expect(config.maxSizeMb).toBe(128)
      expect(config.ttlSeconds).toBe(1800)
    })
  })
})
