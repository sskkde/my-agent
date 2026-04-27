/**
 * Resource limits, concurrency caps, and memory budget enforcement.
 * Provides ResourceBudgetManager, ConcurrencyLimiter, and MemorySafeCache
 * for protecting the system against resource exhaustion.
 */

import type { MetricRecord, MetricStore } from '../observability/types.js';
import type { ConnectionManager } from '../storage/connection.js';

// ============================================================================
// Resource Limit Error
// ============================================================================

export interface ResourceLimitError {
  code: 'resource_limit_exceeded';
  message: string;
  limitType: string;
  currentValue: number;
  maxValue: number;
}

export class ResourceLimitExceededError extends Error implements ResourceLimitError {
  code: 'resource_limit_exceeded' = 'resource_limit_exceeded';
  limitType: string;
  currentValue: number;
  maxValue: number;

  constructor(limitType: string, currentValue: number, maxValue: number, message?: string) {
    super(message || `Resource limit exceeded: ${limitType} (${currentValue}/${maxValue})`);
    this.limitType = limitType;
    this.currentValue = currentValue;
    this.maxValue = maxValue;
  }

  toJSON(): ResourceLimitError {
    return {
      code: this.code,
      message: this.message,
      limitType: this.limitType,
      currentValue: this.currentValue,
      maxValue: this.maxValue,
    };
  }
}

// ============================================================================
// Resource Configuration
// ============================================================================

export interface ResourceConfig {
  maxConcurrentForegroundTurns: number;
  maxConcurrentPlannerRunsPerSession: number;
  maxConcurrentPlannerRunsPerUser: number;
  maxConcurrentBackgroundRuns: number;
  maxConcurrentWorkflowRuns: number;
  maxConcurrentLLMCalls: number;
  maxConcurrentToolExecutions: number;
  maxCacheSizeMB: number;
  maxContextTokens: number;
  sqliteQueueMaxDepth: number;
}

export const DEFAULT_RESOURCE_CONFIG: ResourceConfig = {
  maxConcurrentForegroundTurns: 10,
  maxConcurrentPlannerRunsPerSession: 3,
  maxConcurrentPlannerRunsPerUser: 5,
  maxConcurrentBackgroundRuns: 5,
  maxConcurrentWorkflowRuns: 3,
  maxConcurrentLLMCalls: 2,
  maxConcurrentToolExecutions: 5,
  maxCacheSizeMB: 256,
  maxContextTokens: 8000,
  sqliteQueueMaxDepth: 100,
};

// ============================================================================
// Budget Types
// ============================================================================

export type ResourceType =
  | 'foreground_turn'
  | 'planner_run_session'
  | 'planner_run_user'
  | 'background_run'
  | 'workflow_run'
  | 'llm_call'
  | 'tool_execution'
  | 'cache_memory'
  | 'context_tokens'
  | 'sqlite_queue';

export interface BudgetRequest {
  resourceType: ResourceType;
  sessionId?: string;
  userId?: string;
  requestedTokens?: number;
  requestedMemoryMB?: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  error?: ResourceLimitError;
}

export interface BudgetUsage {
  resourceType: ResourceType;
  current: number;
  max: number;
  percentage: number;
}

// ============================================================================
// Concurrency Limiter
// ============================================================================

export interface ConcurrencyToken {
  resourceType: ResourceType;
  tokenId: string;
  acquiredAt: string;
  metadata?: Record<string, string>;
}

export interface ConcurrencyLimiter {
  acquire(resourceType: ResourceType, metadata?: Record<string, string>): ConcurrencyToken;
  release(token: ConcurrencyToken): void;
  getActiveCount(resourceType: ResourceType): number;
  getActiveCountForSession(resourceType: ResourceType, sessionId: string): number;
  getActiveCountForUser(resourceType: ResourceType, userId: string): number;
}

interface ActiveSlot {
  tokenId: string;
  resourceType: ResourceType;
  sessionId?: string;
  userId?: string;
  acquiredAt: string;
}

class ConcurrencyLimiterImpl implements ConcurrencyLimiter {
  private activeSlots: Map<string, ActiveSlot> = new Map();
  private config: ResourceConfig;

  constructor(config: ResourceConfig) {
    this.config = config;
  }

  acquire(resourceType: ResourceType, metadata?: Record<string, string>): ConcurrencyToken {
    const limit = this.getLimitForResourceType(resourceType);
    const currentCount = this.getActiveCount(resourceType);

    if (currentCount >= limit) {
      throw new ResourceLimitExceededError(
        resourceType,
        currentCount,
        limit,
        `Concurrency limit exceeded for ${resourceType}`
      );
    }

    const tokenId = `${resourceType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const slot: ActiveSlot = {
      tokenId,
      resourceType,
      sessionId: metadata?.sessionId,
      userId: metadata?.userId,
      acquiredAt: new Date().toISOString(),
    };

    this.activeSlots.set(tokenId, slot);

    return {
      resourceType,
      tokenId,
      acquiredAt: slot.acquiredAt,
      metadata,
    };
  }

  release(token: ConcurrencyToken): void {
    this.activeSlots.delete(token.tokenId);
  }

  getActiveCount(resourceType: ResourceType): number {
    let count = 0;
    for (const slot of this.activeSlots.values()) {
      if (slot.resourceType === resourceType) {
        count++;
      }
    }
    return count;
  }

  getActiveCountForSession(resourceType: ResourceType, sessionId: string): number {
    let count = 0;
    for (const slot of this.activeSlots.values()) {
      if (slot.resourceType === resourceType && slot.sessionId === sessionId) {
        count++;
      }
    }
    return count;
  }

  getActiveCountForUser(resourceType: ResourceType, userId: string): number {
    let count = 0;
    for (const slot of this.activeSlots.values()) {
      if (slot.resourceType === resourceType && slot.userId === userId) {
        count++;
      }
    }
    return count;
  }

  private getLimitForResourceType(resourceType: ResourceType): number {
    switch (resourceType) {
      case 'foreground_turn':
        return this.config.maxConcurrentForegroundTurns;
      case 'planner_run_session':
        return this.config.maxConcurrentPlannerRunsPerSession;
      case 'planner_run_user':
        return this.config.maxConcurrentPlannerRunsPerUser;
      case 'background_run':
        return this.config.maxConcurrentBackgroundRuns;
      case 'workflow_run':
        return this.config.maxConcurrentWorkflowRuns;
      case 'llm_call':
        return this.config.maxConcurrentLLMCalls;
      case 'tool_execution':
        return this.config.maxConcurrentToolExecutions;
      case 'cache_memory':
        return this.config.maxCacheSizeMB;
      case 'context_tokens':
        return this.config.maxContextTokens;
      case 'sqlite_queue':
        return this.config.sqliteQueueMaxDepth;
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }
}

export function createConcurrencyLimiter(config: ResourceConfig): ConcurrencyLimiter {
  return new ConcurrencyLimiterImpl(config);
}

// ============================================================================
// Resource Budget Manager
// ============================================================================

export interface ResourceBudgetManager {
  checkBudget(request: BudgetRequest): BudgetCheckResult;
  getBudgetUsage(): BudgetUsage[];
  getBudgetUsageForType(resourceType: ResourceType): BudgetUsage | null;
  configureBudget(config: ResourceConfig): void;
  getConfig(): ResourceConfig;
}

class ResourceBudgetManagerImpl implements ResourceBudgetManager {
  private config: ResourceConfig;
  private limiter: ConcurrencyLimiter;
  private connection?: ConnectionManager;
  private metricStore?: MetricStore;

  constructor(
    config: ResourceConfig,
    limiter: ConcurrencyLimiter,
    connection?: ConnectionManager,
    metricStore?: MetricStore
  ) {
    this.config = config;
    this.limiter = limiter;
    this.connection = connection;
    this.metricStore = metricStore;
  }

  checkBudget(request: BudgetRequest): BudgetCheckResult {
    if (request.resourceType === 'planner_run_session' && request.sessionId) {
      const currentCount = this.limiter.getActiveCountForSession('planner_run_session', request.sessionId);
      if (currentCount >= this.config.maxConcurrentPlannerRunsPerSession) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: 'planner_run_session', sessionId: request.sessionId });
        return {
          allowed: false,
          error: new ResourceLimitExceededError(
            'planner_run_session',
            currentCount,
            this.config.maxConcurrentPlannerRunsPerSession,
            `Planner run limit exceeded for session ${request.sessionId}`
          ),
        };
      }
    }

    if (request.resourceType === 'planner_run_user' && request.userId) {
      const currentCount = this.limiter.getActiveCountForUser('planner_run_user', request.userId);
      if (currentCount >= this.config.maxConcurrentPlannerRunsPerUser) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: 'planner_run_user', userId: request.userId });
        return {
          allowed: false,
          error: new ResourceLimitExceededError(
            'planner_run_user',
            currentCount,
            this.config.maxConcurrentPlannerRunsPerUser,
            `Planner run limit exceeded for user ${request.userId}`
          ),
        };
      }
    }

    if (request.resourceType === 'context_tokens' && request.requestedTokens) {
      if (request.requestedTokens > this.config.maxContextTokens) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: 'context_tokens' });
        return {
          allowed: false,
          error: new ResourceLimitExceededError(
            'context_tokens',
            request.requestedTokens,
            this.config.maxContextTokens,
            `Context token limit exceeded: ${request.requestedTokens} > ${this.config.maxContextTokens}`
          ),
        };
      }
    }

    if (request.resourceType === 'sqlite_queue' && this.connection) {
      const queueDepth = this.getSQLiteQueueDepth();
      if (queueDepth >= this.config.sqliteQueueMaxDepth) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: 'sqlite_queue' });
        return {
          allowed: false,
          error: new ResourceLimitExceededError(
            'sqlite_queue',
            queueDepth,
            this.config.sqliteQueueMaxDepth,
            `SQLite queue depth limit exceeded`
          ),
        };
      }
    }

    try {
      const limit = this.getLimitForResourceType(request.resourceType);
      const currentCount = this.limiter.getActiveCount(request.resourceType);
      if (currentCount >= limit) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: request.resourceType });
        return {
          allowed: false,
          error: new ResourceLimitExceededError(
            request.resourceType,
            currentCount,
            limit,
            `Concurrency limit exceeded for ${request.resourceType}`
          ),
        };
      }
    } catch (error) {
      if (error instanceof ResourceLimitExceededError) {
        this.recordBudgetMetric('limit_exceeded', 1, { limitType: request.resourceType });
        return { allowed: false, error };
      }
      throw error;
    }

    this.recordBudgetMetric('check_allowed', 1, { resourceType: request.resourceType });
    return { allowed: true };
  }

  getBudgetUsage(): BudgetUsage[] {
    const types: ResourceType[] = [
      'foreground_turn',
      'planner_run_session',
      'planner_run_user',
      'background_run',
      'workflow_run',
      'llm_call',
      'tool_execution',
      'cache_memory',
      'context_tokens',
      'sqlite_queue',
    ];

    return types.map((type) => this.getBudgetUsageForType(type)).filter((usage): usage is BudgetUsage => usage !== null);
  }

  getBudgetUsageForType(resourceType: ResourceType): BudgetUsage | null {
    const limit = this.getLimitForResourceType(resourceType);
    const current = this.limiter.getActiveCount(resourceType);

    return {
      resourceType,
      current,
      max: limit,
      percentage: limit > 0 ? (current / limit) * 100 : 0,
    };
  }

  configureBudget(config: ResourceConfig): void {
    this.config = config;
  }

  getConfig(): ResourceConfig {
    return { ...this.config };
  }

  private getLimitForResourceType(resourceType: ResourceType): number {
    switch (resourceType) {
      case 'foreground_turn':
        return this.config.maxConcurrentForegroundTurns;
      case 'planner_run_session':
        return this.config.maxConcurrentPlannerRunsPerSession;
      case 'planner_run_user':
        return this.config.maxConcurrentPlannerRunsPerUser;
      case 'background_run':
        return this.config.maxConcurrentBackgroundRuns;
      case 'workflow_run':
        return this.config.maxConcurrentWorkflowRuns;
      case 'llm_call':
        return this.config.maxConcurrentLLMCalls;
      case 'tool_execution':
        return this.config.maxConcurrentToolExecutions;
      case 'cache_memory':
        return this.config.maxCacheSizeMB;
      case 'context_tokens':
        return this.config.maxContextTokens;
      case 'sqlite_queue':
        return this.config.sqliteQueueMaxDepth;
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }

  private getSQLiteQueueDepth(): number {
    if (!this.connection) {
      return 0;
    }
    try {
      const result = this.connection.query<{ queue_depth: number }>(
        "SELECT COUNT(*) as queue_depth FROM sqlite_master WHERE type='table'"
      );
      return result[0]?.queue_depth ?? 0;
    } catch {
      return 0;
    }
  }

  private recordBudgetMetric(name: string, value: number, labels?: Record<string, string>): void {
    if (this.metricStore) {
      const metric: MetricRecord = {
        metricId: `budget_${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        module: 'memory',
        metricType: 'counter',
        name: `budget_${name}`,
        value,
        timestamp: new Date().toISOString(),
        labels,
      };
      this.metricStore.recordMetric(metric);
    }
  }
}

export function createResourceBudgetManager(
  config: ResourceConfig,
  limiter: ConcurrencyLimiter,
  connection?: ConnectionManager,
  metricStore?: MetricStore
): ResourceBudgetManager {
  return new ResourceBudgetManagerImpl(config, limiter, connection, metricStore);
}

// ============================================================================
// Memory Safe Cache
// ============================================================================

export interface CacheEntry<T> {
  key: string;
  value: T;
  sizeBytes: number;
  insertedAt: string;
  lastAccessedAt: number;
  accessCount: number;
}

export interface CacheStats {
  totalSizeBytes: number;
  totalSizeMB: number;
  entryCount: number;
  maxSizeMB: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
}

export interface MemorySafeCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, sizeBytes: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  getStats(): CacheStats;
  keys(): string[];
  getCurrentSizeMB(): number;
}

class MemorySafeCacheImpl<T> implements MemorySafeCache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map();
  private maxSizeBytes: number;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private metricStore?: MetricStore;
  private cacheName: string;
  private metricCounter = 0;
  private accessSequence = 0;

  constructor(maxSizeMB: number, cacheName: string, metricStore?: MetricStore) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    this.cacheName = cacheName;
    this.metricStore = metricStore;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.accessSequence++;
      entry.lastAccessedAt = this.accessSequence;
      entry.accessCount++;
      this.hitCount++;
      this.recordMetric('cache_hit', 1);
      return entry.value;
    }
    this.missCount++;
    this.recordMetric('cache_miss', 1);
    return undefined;
  }

  set(key: string, value: T, sizeBytes: number): void {
    const currentSize = this.getCurrentSizeBytes();
    if (currentSize + sizeBytes > this.maxSizeBytes) {
      this.evictToMakeRoom(sizeBytes);
    }

    this.accessSequence++;
    const entry: CacheEntry<T> = {
      key,
      value,
      sizeBytes,
      insertedAt: new Date().toISOString(),
      lastAccessedAt: this.accessSequence,
      accessCount: 0,
    };

    this.entries.set(key, entry);
    this.recordMetric('cache_set', 1);
    this.recordMetric('cache_size_bytes', this.getCurrentSizeBytes(), 'bytes');
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): boolean {
    const existed = this.entries.delete(key);
    if (existed) {
      this.recordMetric('cache_delete', 1);
      this.recordMetric('cache_size_bytes', this.getCurrentSizeBytes(), 'bytes');
    }
    return existed;
  }

  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.evictionCount += count;
    this.recordMetric('cache_clear', count);
    this.recordMetric('cache_size_bytes', 0, 'bytes');
  }

  getStats(): CacheStats {
    const totalSizeBytes = this.getCurrentSizeBytes();
    return {
      totalSizeBytes,
      totalSizeMB: totalSizeBytes / (1024 * 1024),
      entryCount: this.entries.size,
      maxSizeMB: this.maxSizeBytes / (1024 * 1024),
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
    };
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  getCurrentSizeMB(): number {
    return this.getCurrentSizeBytes() / (1024 * 1024);
  }

  private getCurrentSizeBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  private evictToMakeRoom(requiredBytes: number): void {
    const sortedEntries = Array.from(this.entries.entries()).sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
    );

    let freedBytes = 0;
    const targetBytes = requiredBytes + this.getCurrentSizeBytes() - this.maxSizeBytes;

    for (const [key, entry] of sortedEntries) {
      if (freedBytes >= targetBytes) {
        break;
      }
      this.entries.delete(key);
      freedBytes += entry.sizeBytes;
      this.evictionCount++;
      this.recordMetric('cache_eviction', 1);
    }
  }

  private recordMetric(name: string, value: number, unit?: string): void {
    if (this.metricStore) {
      this.metricCounter++;
      const metric: MetricRecord = {
        metricId: `${this.cacheName}_${name}_${Date.now()}_${this.metricCounter}_${Math.random().toString(36).substr(2, 9)}`,
        module: 'memory',
        metricType: 'counter',
        name: `${this.cacheName}_${name}`,
        value,
        unit,
        timestamp: new Date().toISOString(),
        labels: { cacheName: this.cacheName },
      };
      this.metricStore.recordMetric(metric);
    }
  }
}

export function createMemorySafeCache<T>(
  maxSizeMB: number,
  cacheName: string,
  metricStore?: MetricStore
): MemorySafeCache<T> {
  return new MemorySafeCacheImpl<T>(maxSizeMB, cacheName, metricStore);
}

// ============================================================================
// Factory Function
// ============================================================================

export interface ResourceLimits {
  budgetManager: ResourceBudgetManager;
  concurrencyLimiter: ConcurrencyLimiter;
  createCache: <T>(name: string) => MemorySafeCache<T>;
}

export function createResourceLimits(
  config: ResourceConfig = DEFAULT_RESOURCE_CONFIG,
  connection?: ConnectionManager,
  metricStore?: MetricStore
): ResourceLimits {
  const limiter = createConcurrencyLimiter(config);
  const budgetManager = createResourceBudgetManager(config, limiter, connection, metricStore);

  return {
    budgetManager,
    concurrencyLimiter: limiter,
    createCache: <T>(name: string) => createMemorySafeCache<T>(config.maxCacheSizeMB, name, metricStore),
  };
}
