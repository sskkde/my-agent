import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createMetricStore } from '../../../src/observability/metric-store.js'
import type { MetricStore } from '../../../src/observability/types.js'
import {
  createResourceLimits,
  createConcurrencyLimiter,
  createMemorySafeCache,
  DEFAULT_RESOURCE_CONFIG,
  ResourceLimitExceededError,
  type ResourceConfig,
} from '../../../src/runtime/resource-limits.js'

const resourceLimitsMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_metrics_table',
    up: `
      CREATE TABLE metrics (
        metric_id TEXT PRIMARY KEY,
        trace_id TEXT,
        span_id TEXT,
        module TEXT NOT NULL CHECK(module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
        metric_type TEXT NOT NULL CHECK(metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        labels TEXT
      );
      CREATE INDEX idx_metrics_module ON metrics(module);
      CREATE INDEX idx_metrics_name ON metrics(name);
      CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_metrics_timestamp;
      DROP INDEX IF EXISTS idx_metrics_name;
      DROP INDEX IF EXISTS idx_metrics_module;
      DROP TABLE IF EXISTS metrics;
    `,
  },
]

describe('Resource Limits Integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let metricStore: MetricStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(resourceLimitsMigrations)
    metricStore = createMetricStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('ResourceBudgetManager', () => {
    it('should allow operations within budget', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const result = limits.budgetManager.checkBudget({
        resourceType: 'llm_call',
      })

      expect(result.allowed).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return structured error when limit exceeded', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 1,
      }
      const limits = createResourceLimits(config, connection, metricStore)

      // Acquire first slot
      limits.concurrencyLimiter.acquire('llm_call')

      // Try to check budget for second - should fail
      const result = limits.budgetManager.checkBudget({
        resourceType: 'llm_call',
      })

      expect(result.allowed).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('resource_limit_exceeded')
      expect(result.error?.limitType).toBe('llm_call')
      expect(result.error?.currentValue).toBe(1)
      expect(result.error?.maxValue).toBe(1)
    })

    it('should get current budget usage', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const usage = limits.budgetManager.getBudgetUsage()

      expect(usage).toBeInstanceOf(Array)
      expect(usage.length).toBeGreaterThan(0)

      const llmUsage = usage.find((u) => u.resourceType === 'llm_call')
      expect(llmUsage).toBeDefined()
      expect(llmUsage?.current).toBe(0)
      expect(llmUsage?.max).toBe(DEFAULT_RESOURCE_CONFIG.maxConcurrentLLMCalls)
      expect(llmUsage?.percentage).toBe(0)
    })

    it('should get budget usage for specific type', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const usage = limits.budgetManager.getBudgetUsageForType('workflow_run')

      expect(usage).toBeDefined()
      expect(usage?.resourceType).toBe('workflow_run')
      expect(usage?.max).toBe(DEFAULT_RESOURCE_CONFIG.maxConcurrentWorkflowRuns)
    })

    it('should allow configuration updates', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const newConfig: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 10,
      }

      limits.budgetManager.configureBudget(newConfig)
      const config = limits.budgetManager.getConfig()

      expect(config.maxConcurrentLLMCalls).toBe(10)
    })
  })

  describe('ConcurrencyLimiter', () => {
    it('should acquire and release slots', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 2,
      }
      const limiter = createConcurrencyLimiter(config)

      const token1 = limiter.acquire('llm_call')
      expect(token1.resourceType).toBe('llm_call')
      expect(token1.tokenId).toBeDefined()
      expect(limiter.getActiveCount('llm_call')).toBe(1)

      const token2 = limiter.acquire('llm_call')
      expect(limiter.getActiveCount('llm_call')).toBe(2)

      limiter.release(token1)
      expect(limiter.getActiveCount('llm_call')).toBe(1)

      limiter.release(token2)
      expect(limiter.getActiveCount('llm_call')).toBe(0)
    })

    it('should throw ResourceLimitExceededError when limit reached', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 1,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('llm_call')

      expect(() => {
        limiter.acquire('llm_call')
      }).toThrow(ResourceLimitExceededError)
    })

    it('should track active count per resource type', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      limiter.acquire('llm_call')
      limiter.acquire('llm_call')
      limiter.acquire('tool_execution')

      expect(limiter.getActiveCount('llm_call')).toBe(2)
      expect(limiter.getActiveCount('tool_execution')).toBe(1)
      expect(limiter.getActiveCount('workflow_run')).toBe(0)
    })

    it('should include metadata in token', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      const token = limiter.acquire('llm_call', { sessionId: 'sess_123', userId: 'user_456' })

      expect(token.metadata).toEqual({ sessionId: 'sess_123', userId: 'user_456' })
      expect(token.acquiredAt).toBeDefined()
    })
  })

  describe('PlannerRun session limits', () => {
    it('should enforce maxConcurrentPlannerRunsPerSession', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentPlannerRunsPerSession: 2,
      }
      const limits = createResourceLimits(config, connection, metricStore)

      // Acquire within limit
      limits.concurrencyLimiter.acquire('planner_run_session', { sessionId: 'sess_1' })
      limits.concurrencyLimiter.acquire('planner_run_session', { sessionId: 'sess_1' })

      // Third should fail at budget check
      const result = limits.budgetManager.checkBudget({
        resourceType: 'planner_run_session',
        sessionId: 'sess_1',
      })

      expect(result.allowed).toBe(false)
      expect(result.error?.limitType).toBe('planner_run_session')
    })

    it('should track active count per session', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      limiter.acquire('planner_run_session', { sessionId: 'sess_1' })
      limiter.acquire('planner_run_session', { sessionId: 'sess_1' })
      limiter.acquire('planner_run_session', { sessionId: 'sess_2' })

      expect(limiter.getActiveCountForSession('planner_run_session', 'sess_1')).toBe(2)
      expect(limiter.getActiveCountForSession('planner_run_session', 'sess_2')).toBe(1)
      expect(limiter.getActiveCountForSession('planner_run_session', 'sess_3')).toBe(0)
    })
  })

  describe('PlannerRun user limits', () => {
    it('should enforce maxConcurrentPlannerRunsPerUser', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentPlannerRunsPerUser: 2,
      }
      const limits = createResourceLimits(config, connection, metricStore)

      // Acquire within limit
      limits.concurrencyLimiter.acquire('planner_run_user', { userId: 'user_1' })
      limits.concurrencyLimiter.acquire('planner_run_user', { userId: 'user_1' })

      // Third should fail at budget check
      const result = limits.budgetManager.checkBudget({
        resourceType: 'planner_run_user',
        userId: 'user_1',
      })

      expect(result.allowed).toBe(false)
      expect(result.error?.limitType).toBe('planner_run_user')
    })

    it('should track active count per user', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      limiter.acquire('planner_run_user', { userId: 'user_1' })
      limiter.acquire('planner_run_user', { userId: 'user_1' })
      limiter.acquire('planner_run_user', { userId: 'user_2' })

      expect(limiter.getActiveCountForUser('planner_run_user', 'user_1')).toBe(2)
      expect(limiter.getActiveCountForUser('planner_run_user', 'user_2')).toBe(1)
      expect(limiter.getActiveCountForUser('planner_run_user', 'user_3')).toBe(0)
    })
  })

  describe('LLM concurrent call limits', () => {
    it('should enforce maxConcurrentLLMCalls', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 2,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('llm_call')
      limiter.acquire('llm_call')

      expect(() => {
        limiter.acquire('llm_call')
      }).toThrow(ResourceLimitExceededError)
    })

    it('should report correct active count for LLM calls', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      expect(limiter.getActiveCount('llm_call')).toBe(0)

      const token1 = limiter.acquire('llm_call')
      expect(limiter.getActiveCount('llm_call')).toBe(1)

      const token2 = limiter.acquire('llm_call')
      expect(limiter.getActiveCount('llm_call')).toBe(2)

      limiter.release(token1)
      expect(limiter.getActiveCount('llm_call')).toBe(1)

      limiter.release(token2)
      expect(limiter.getActiveCount('llm_call')).toBe(0)
    })
  })

  describe('Background run queue limits', () => {
    it('should enforce maxConcurrentBackgroundRuns', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentBackgroundRuns: 1,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('background_run')

      expect(() => {
        limiter.acquire('background_run')
      }).toThrow(ResourceLimitExceededError)
    })

    it('should track background run active count', () => {
      const limiter = createConcurrencyLimiter(DEFAULT_RESOURCE_CONFIG)

      const token = limiter.acquire('background_run')
      expect(limiter.getActiveCount('background_run')).toBe(1)

      limiter.release(token)
      expect(limiter.getActiveCount('background_run')).toBe(0)
    })
  })

  describe('Workflow run concurrency limits', () => {
    it('should enforce maxConcurrentWorkflowRuns', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentWorkflowRuns: 2,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('workflow_run')
      limiter.acquire('workflow_run')

      expect(() => {
        limiter.acquire('workflow_run')
      }).toThrow(ResourceLimitExceededError)
    })

    it('should track workflow run active count', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const token1 = limits.concurrencyLimiter.acquire('workflow_run')
      const token2 = limits.concurrencyLimiter.acquire('workflow_run')

      expect(limits.concurrencyLimiter.getActiveCount('workflow_run')).toBe(2)

      limits.concurrencyLimiter.release(token1)
      limits.concurrencyLimiter.release(token2)

      expect(limits.concurrencyLimiter.getActiveCount('workflow_run')).toBe(0)
    })
  })

  describe('Context/token caps', () => {
    it('should enforce maxContextTokens', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxContextTokens: 1000,
      }
      const limits = createResourceLimits(config, connection, metricStore)

      const resultWithinLimit = limits.budgetManager.checkBudget({
        resourceType: 'context_tokens',
        requestedTokens: 500,
      })
      expect(resultWithinLimit.allowed).toBe(true)

      const resultExceedsLimit = limits.budgetManager.checkBudget({
        resourceType: 'context_tokens',
        requestedTokens: 1500,
      })
      expect(resultExceedsLimit.allowed).toBe(false)
      expect(resultExceedsLimit.error?.limitType).toBe('context_tokens')
      expect(resultExceedsLimit.error?.currentValue).toBe(1500)
      expect(resultExceedsLimit.error?.maxValue).toBe(1000)
    })

    it('should allow tokens within limit', () => {
      const limits = createResourceLimits(DEFAULT_RESOURCE_CONFIG, connection, metricStore)

      const result = limits.budgetManager.checkBudget({
        resourceType: 'context_tokens',
        requestedTokens: 5000,
      })

      expect(result.allowed).toBe(true)
    })
  })

  describe('MemorySafeCache', () => {
    it('should store and retrieve values', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      expect(cache.get('key1')).toBe('value1')
      expect(cache.has('key1')).toBe(true)
    })

    it('should return undefined for missing keys', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      expect(cache.get('nonexistent')).toBeUndefined()
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should delete entries', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.delete('key1')).toBe(false)
    })

    it('should clear all entries', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      cache.set('key2', 'value2', 100)
      cache.clear()

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.keys()).toHaveLength(0)
    })

    it('should track cache stats', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      cache.set('key2', 'value2', 200)

      const stats = cache.getStats()

      expect(stats.entryCount).toBe(2)
      expect(stats.totalSizeBytes).toBe(300)
      expect(stats.totalSizeMB).toBeCloseTo(300 / (1024 * 1024), 6)
      expect(stats.maxSizeMB).toBe(256)
    })

    it('should track hits and misses', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)

      cache.get('key1')
      cache.get('key1')
      cache.get('nonexistent')

      const stats = cache.getStats()
      expect(stats.hitCount).toBe(2)
      expect(stats.missCount).toBe(1)
    })

    it('should evict entries when size limit reached', () => {
      const cache = createMemorySafeCache<string>(2, 'test_cache', metricStore) // 2 MB limit

      // Each entry is ~1MB
      cache.set('key1', 'x'.repeat(1024 * 1024), 1024 * 1024)
      cache.set('key2', 'y'.repeat(1024 * 1024), 1024 * 1024)

      // Access key1 to make it more recently used
      cache.get('key1')

      // Add another entry - should evict key2 (LRU) since key1 was accessed more recently
      cache.set('key3', 'z'.repeat(1024 * 1024), 1024 * 1024)

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(true)

      const stats = cache.getStats()
      expect(stats.evictionCount).toBeGreaterThan(0)
    })

    it('should return all keys', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      cache.set('key2', 'value2', 100)
      cache.set('key3', 'value3', 100)

      const keys = cache.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
      expect(keys).toHaveLength(3)
    })

    it('should report current size in MB', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 1024 * 1024) // 1 MB

      expect(cache.getCurrentSizeMB()).toBeCloseTo(1, 2)
    })
  })

  describe('Cache metrics observability', () => {
    it('should record cache metrics when metricStore provided', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)
      cache.get('key1')
      cache.get('nonexistent')

      const metrics = metricStore.queryMetrics({ name: 'test_cache_cache_set' })
      expect(metrics.length).toBeGreaterThan(0)
      expect(metrics[0]?.value).toBe(1)

      const hitMetrics = metricStore.queryMetrics({ name: 'test_cache_cache_hit' })
      expect(hitMetrics.length).toBeGreaterThan(0)

      const missMetrics = metricStore.queryMetrics({ name: 'test_cache_cache_miss' })
      expect(missMetrics.length).toBeGreaterThan(0)
    })

    it('should record cache size metrics', () => {
      const cache = createMemorySafeCache<string>(256, 'test_cache', metricStore)

      cache.set('key1', 'value1', 100)

      const sizeMetrics = metricStore.queryMetrics({ name: 'test_cache_cache_size_bytes' })
      expect(sizeMetrics.length).toBeGreaterThan(0)
    })
  })

  describe('ResourceLimitExceededError', () => {
    it('should have correct error structure', () => {
      const error = new ResourceLimitExceededError('test_limit', 10, 5)

      expect(error.code).toBe('resource_limit_exceeded')
      expect(error.limitType).toBe('test_limit')
      expect(error.currentValue).toBe(10)
      expect(error.maxValue).toBe(5)
      expect(error.message).toContain('test_limit')
    })

    it('should serialize to JSON correctly', () => {
      const error = new ResourceLimitExceededError('test_limit', 10, 5, 'Custom message')
      const json = error.toJSON()

      expect(json.code).toBe('resource_limit_exceeded')
      expect(json.limitType).toBe('test_limit')
      expect(json.currentValue).toBe(10)
      expect(json.maxValue).toBe(5)
      expect(json.message).toBe('Custom message')
    })
  })

  describe('Default resource configuration', () => {
    it('should have correct default values for 2C2G target', () => {
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentForegroundTurns).toBe(10)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentPlannerRunsPerSession).toBe(3)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentPlannerRunsPerUser).toBe(5)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentBackgroundRuns).toBe(5)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentWorkflowRuns).toBe(3)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentLLMCalls).toBe(2)
      expect(DEFAULT_RESOURCE_CONFIG.maxConcurrentToolExecutions).toBe(5)
      expect(DEFAULT_RESOURCE_CONFIG.maxCacheSizeMB).toBe(256)
      expect(DEFAULT_RESOURCE_CONFIG.maxContextTokens).toBe(8000)
      expect(DEFAULT_RESOURCE_CONFIG.sqliteQueueMaxDepth).toBe(100)
    })
  })

  describe('Tool execution limits', () => {
    it('should enforce maxConcurrentToolExecutions', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentToolExecutions: 2,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('tool_execution')
      limiter.acquire('tool_execution')

      expect(() => {
        limiter.acquire('tool_execution')
      }).toThrow(ResourceLimitExceededError)
    })
  })

  describe('Foreground turn limits', () => {
    it('should enforce maxConcurrentForegroundTurns', () => {
      const config: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentForegroundTurns: 2,
      }
      const limiter = createConcurrencyLimiter(config)

      limiter.acquire('foreground_turn')
      limiter.acquire('foreground_turn')

      expect(() => {
        limiter.acquire('foreground_turn')
      }).toThrow(ResourceLimitExceededError)
    })
  })

  describe('Factory function createResourceLimits', () => {
    it('should create all components with defaults', () => {
      const limits = createResourceLimits()

      expect(limits.budgetManager).toBeDefined()
      expect(limits.concurrencyLimiter).toBeDefined()
      expect(limits.createCache).toBeDefined()

      const cache = limits.createCache<string>('test')
      expect(cache).toBeDefined()
    })

    it('should use provided configuration', () => {
      const customConfig: ResourceConfig = {
        ...DEFAULT_RESOURCE_CONFIG,
        maxConcurrentLLMCalls: 50,
      }
      const limits = createResourceLimits(customConfig)

      const config = limits.budgetManager.getConfig()
      expect(config.maxConcurrentLLMCalls).toBe(50)
    })
  })
})
