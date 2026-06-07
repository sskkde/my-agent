import type { ResourceLimitType, ResourceLimit } from './limit-types.js'

export function checkResourceLimit(_type: ResourceLimitType, current: number, limit: number): boolean {
  return current <= limit
}

export function enforceMemoryLimit(_sessionId: string, memoryLimitMb: number, currentMemoryMb: number): void {
  if (!checkResourceLimit('memory_mb', currentMemoryMb, memoryLimitMb)) {
    const exceeded: ResourceLimit = {
      type: 'memory_mb',
      limit: memoryLimitMb,
      current: currentMemoryMb,
      resetAt: new Date().toISOString(),
    }
    throw exceeded
  }
}

export function checkAllLimits(limits: Array<{ type: ResourceLimitType; current: number; limit: number }>): {
  withinLimit: boolean
  violations: ResourceLimit[]
} {
  const violations: ResourceLimit[] = []

  for (const { type, current, limit } of limits) {
    if (!checkResourceLimit(type, current, limit)) {
      violations.push({
        type,
        limit,
        current,
        resetAt: new Date().toISOString(),
      })
    }
  }

  return {
    withinLimit: violations.length === 0,
    violations,
  }
}
