/**
 * Memory Limits and Budget Types
 *
 * Types for resource limits, budget management, and cache configuration.
 */

// ============================================================================
// Resource Limit Types
// ============================================================================

/**
 * Types of resources that can be limited
 */
export type ResourceLimitType = 'memory_mb' | 'token_count' | 'request_count'

/**
 * Current status of a resource limit
 */
export type ResourceLimit = {
  /** Type of resource being limited */
  type: ResourceLimitType
  /** Maximum allowed value */
  limit: number
  /** Current usage value */
  current: number
  /** When the limit resets (ISO 8601 timestamp) */
  resetAt: string
}

// ============================================================================
// Budget Types
// ============================================================================

/**
 * Budget period for tracking usage
 */
export type BudgetPeriod = 'daily' | 'monthly' | 'per_session'

/**
 * Budget configuration for a period
 */
export type BudgetConfig = {
  /** Budget tracking period */
  period: BudgetPeriod
  /** Maximum tokens allowed */
  tokenLimit: number
  /** Maximum requests allowed */
  requestLimit: number
  /** Maximum memory in MB allowed */
  memoryLimitMb: number
}

/**
 * Current budget usage for a period
 */
export type BudgetUsage = {
  /** Budget tracking period */
  period: BudgetPeriod
  /** Tokens used so far */
  tokensUsed: number
  /** Requests made so far */
  requestsUsed: number
  /** Memory used in MB so far */
  memoryUsedMb: number
  /** Percentage of budget used (0-100) */
  percentUsed: number
}

/**
 * Error when budget is exceeded
 */
export type BudgetExceededError = {
  /** Type of budget that was exceeded */
  budgetType: ResourceLimitType
  /** Current usage value */
  currentUsage: number
  /** Configured limit */
  limit: number
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache eviction policy
 */
export type CacheEvictionPolicy = 'lru' | 'lfu'

/**
 * Cache configuration
 */
export type CacheConfig = {
  /** Maximum cache size in megabytes */
  maxSizeMb: number
  /** Time-to-live for cache entries in seconds */
  ttlSeconds: number
  /** Eviction policy when cache is full */
  evictionPolicy: CacheEvictionPolicy
}
