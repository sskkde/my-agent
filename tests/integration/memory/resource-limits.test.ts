import { describe, it, expect } from 'vitest'
import { checkResourceLimit, enforceMemoryLimit, checkAllLimits } from '../../../src/memory/resource-limits.js'
import type { ResourceLimit } from '../../../src/memory/limit-types.js'

describe('Resource Limits', () => {
  describe('checkResourceLimit', () => {
    it('should return true when current is within limit', () => {
      expect(checkResourceLimit('memory_mb', 50, 100)).toBe(true)
      expect(checkResourceLimit('token_count', 500, 1000)).toBe(true)
      expect(checkResourceLimit('request_count', 10, 50)).toBe(true)
    })

    it('should return true when current equals limit', () => {
      expect(checkResourceLimit('memory_mb', 100, 100)).toBe(true)
      expect(checkResourceLimit('token_count', 1000, 1000)).toBe(true)
      expect(checkResourceLimit('request_count', 50, 50)).toBe(true)
    })

    it('should return false when current exceeds limit', () => {
      expect(checkResourceLimit('memory_mb', 150, 100)).toBe(false)
      expect(checkResourceLimit('token_count', 1500, 1000)).toBe(false)
      expect(checkResourceLimit('request_count', 60, 50)).toBe(false)
    })

    it('should return true when current is zero', () => {
      expect(checkResourceLimit('memory_mb', 0, 100)).toBe(true)
      expect(checkResourceLimit('token_count', 0, 1000)).toBe(true)
    })

    it('should return true when limit is zero and current is zero', () => {
      expect(checkResourceLimit('memory_mb', 0, 0)).toBe(true)
    })

    it('should return false when limit is zero and current is positive', () => {
      expect(checkResourceLimit('memory_mb', 1, 0)).toBe(false)
    })
  })

  describe('enforceMemoryLimit', () => {
    it('should not throw when memory is within limit', () => {
      expect(() => enforceMemoryLimit('sess-001', 100, 50)).not.toThrow()
    })

    it('should not throw when memory equals limit', () => {
      expect(() => enforceMemoryLimit('sess-001', 100, 100)).not.toThrow()
    })

    it('should throw ResourceLimit when memory exceeds limit', () => {
      expect(() => enforceMemoryLimit('sess-001', 100, 150)).toThrow()
    })

    it('should throw with correct ResourceLimit structure', () => {
      try {
        enforceMemoryLimit('sess-001', 100, 150)
        expect.unreachable('Should have thrown')
      } catch (e) {
        const limit = e as ResourceLimit
        expect(limit.type).toBe('memory_mb')
        expect(limit.limit).toBe(100)
        expect(limit.current).toBe(150)
        expect(limit.resetAt).toBeDefined()
      }
    })

    it('should throw when limit is zero and any memory is used', () => {
      expect(() => enforceMemoryLimit('sess-001', 0, 1)).toThrow()
    })
  })

  describe('checkAllLimits', () => {
    it('should return withinLimit=true when all limits are satisfied', () => {
      const result = checkAllLimits([
        { type: 'memory_mb', current: 50, limit: 100 },
        { type: 'token_count', current: 500, limit: 1000 },
        { type: 'request_count', current: 10, limit: 50 },
      ])

      expect(result.withinLimit).toBe(true)
      expect(result.violations).toEqual([])
    })

    it('should return violations for exceeded limits', () => {
      const result = checkAllLimits([
        { type: 'memory_mb', current: 50, limit: 100 },
        { type: 'token_count', current: 1500, limit: 1000 },
        { type: 'request_count', current: 60, limit: 50 },
      ])

      expect(result.withinLimit).toBe(false)
      expect(result.violations.length).toBe(2)
      expect(result.violations[0].type).toBe('token_count')
      expect(result.violations[0].current).toBe(1500)
      expect(result.violations[0].limit).toBe(1000)
      expect(result.violations[1].type).toBe('request_count')
    })

    it('should return single violation when only one limit exceeded', () => {
      const result = checkAllLimits([
        { type: 'memory_mb', current: 150, limit: 100 },
        { type: 'token_count', current: 500, limit: 1000 },
      ])

      expect(result.withinLimit).toBe(false)
      expect(result.violations.length).toBe(1)
      expect(result.violations[0].type).toBe('memory_mb')
    })

    it('should return withinLimit=true for empty limits array', () => {
      const result = checkAllLimits([])
      expect(result.withinLimit).toBe(true)
      expect(result.violations).toEqual([])
    })

    it('should include resetAt in violations', () => {
      const result = checkAllLimits([{ type: 'token_count', current: 2000, limit: 1000 }])

      expect(result.violations[0].resetAt).toBeDefined()
      expect(typeof result.violations[0].resetAt).toBe('string')
    })
  })
})
