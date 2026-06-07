import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createCacheLayer, type CacheLayer } from '../../../src/memory/cache-layer.js'
import type { CacheConfig } from '../../../src/memory/limit-types.js'

describe('Cache Layer Integration', () => {
  describe('Basic Operations', () => {
    let cache: CacheLayer
    const config: CacheConfig = {
      maxSizeMb: 1,
      ttlSeconds: 60,
      evictionPolicy: 'lru',
    }

    beforeEach(() => {
      cache = createCacheLayer(config)
    })

    it('should set and get a value', () => {
      const key = 'memory:session-1:key1'
      const value = { data: 'test value' }

      cache.set(key, value)
      const result = cache.get(key)

      expect(result).toEqual(value)
    })

    it('should return null for missing key', () => {
      const result = cache.get('non-existent-key')
      expect(result).toBeNull()
    })

    it('should delete a value', () => {
      const key = 'memory:session-1:key1'
      cache.set(key, { data: 'test' })

      const deleted = cache.delete(key)
      expect(deleted).toBe(true)

      const result = cache.get(key)
      expect(result).toBeNull()
    })

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('non-existent-key')
      expect(deleted).toBe(false)
    })

    it('should clear all entries', () => {
      cache.set('memory:session-1:key1', { data: 'a' })
      cache.set('memory:session-1:key2', { data: 'b' })
      cache.set('memory:session-2:key1', { data: 'c' })

      cache.clear()

      expect(cache.get('memory:session-1:key1')).toBeNull()
      expect(cache.get('memory:session-1:key2')).toBeNull()
      expect(cache.get('memory:session-2:key1')).toBeNull()
    })
  })

  describe('TTL Expiry', () => {
    let cache: CacheLayer

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire entry after TTL', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key = 'memory:session-1:key1'
      cache.set(key, { data: 'test' })

      // Before TTL
      expect(cache.get(key)).toEqual({ data: 'test' })

      // After TTL
      vi.advanceTimersByTime(60 * 1000 + 1)
      expect(cache.get(key)).toBeNull()
    })

    it('should use custom TTL when provided', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key = 'memory:session-1:key1'
      cache.set(key, { data: 'test' }, 30) // 30 second custom TTL

      // Before custom TTL
      vi.advanceTimersByTime(29 * 1000)
      expect(cache.get(key)).toEqual({ data: 'test' })

      // After custom TTL
      vi.advanceTimersByTime(2 * 1000)
      expect(cache.get(key)).toBeNull()
    })

    it('should respect default TTL when custom TTL is not provided', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 10,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key = 'memory:session-1:key1'
      cache.set(key, { data: 'test' })

      vi.advanceTimersByTime(10 * 1000 + 1)
      expect(cache.get(key)).toBeNull()
    })

    it('should allow custom TTL longer than default', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 10,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key = 'memory:session-1:key1'
      cache.set(key, { data: 'test' }, 60) // 60 second custom TTL

      vi.advanceTimersByTime(10 * 1000 + 1)
      expect(cache.get(key)).toEqual({ data: 'test' })

      vi.advanceTimersByTime(50 * 1000)
      expect(cache.get(key)).toBeNull()
    })
  })

  describe('LRU Eviction', () => {
    let cache: CacheLayer

    it('should evict least recently used when exceeding max size', () => {
      const config: CacheConfig = {
        maxSizeMb: 0.001,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key1 = 'memory:session-1:key1'
      const key2 = 'memory:session-1:key2'
      const key3 = 'memory:session-1:key3'

      const largeValue1 = { data: 'x'.repeat(500) }
      const largeValue2 = { data: 'y'.repeat(500) }
      const largeValue3 = { data: 'z'.repeat(500) }

      cache.set(key1, largeValue1)
      cache.set(key2, largeValue2)
      cache.set(key3, largeValue3)

      // key1 should be evicted (least recently used)
      expect(cache.get(key1)).toBeNull()
      expect(cache.get(key2)).toEqual(largeValue2)
      expect(cache.get(key3)).toEqual(largeValue3)
    })

    it('should update LRU order on get', () => {
      const config: CacheConfig = {
        maxSizeMb: 0.001,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key1 = 'memory:session-1:key1'
      const key2 = 'memory:session-1:key2'
      const key3 = 'memory:session-1:key3'

      const largeValue1 = { data: 'x'.repeat(500) }
      const largeValue2 = { data: 'y'.repeat(500) }
      const largeValue3 = { data: 'z'.repeat(500) }

      cache.set(key1, largeValue1)
      cache.set(key2, largeValue2)

      // Access key1 to make it recently used
      cache.get(key1)

      cache.set(key3, largeValue3)

      // key2 should be evicted (key1 was accessed, so key2 is LRU)
      expect(cache.get(key1)).toEqual(largeValue1)
      expect(cache.get(key2)).toBeNull()
      expect(cache.get(key3)).toEqual(largeValue3)
    })

    it('should update LRU order on set (update existing key)', () => {
      const config: CacheConfig = {
        maxSizeMb: 0.001,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const key1 = 'memory:session-1:key1'
      const key2 = 'memory:session-1:key2'

      cache.set(key1, { data: 'x'.repeat(500) })
      cache.set(key2, { data: 'y'.repeat(500) })

      // Update key1 (makes it most recently used)
      cache.set(key1, { data: 'z'.repeat(500) })

      // Now add key3 which should trigger eviction
      cache.set('memory:session-1:key3', { data: 'w'.repeat(500) })

      // key2 should be evicted (key1 was updated)
      expect(cache.get(key1)).toEqual({ data: 'z'.repeat(500) })
      expect(cache.get(key2)).toBeNull()
    })
  })

  describe('Statistics', () => {
    let cache: CacheLayer
    const config: CacheConfig = {
      maxSizeMb: 1,
      ttlSeconds: 60,
      evictionPolicy: 'lru',
    }

    beforeEach(() => {
      cache = createCacheLayer(config)
    })

    it('should track hits', () => {
      cache.set('memory:session-1:key1', { data: 'test' })

      cache.get('memory:session-1:key1')
      cache.get('memory:session-1:key1')
      cache.get('memory:session-1:key1')

      const stats = cache.stats()
      expect(stats.hits).toBe(3)
    })

    it('should track misses', () => {
      cache.get('non-existent-1')
      cache.get('non-existent-2')

      const stats = cache.stats()
      expect(stats.misses).toBe(2)
    })

    it('should track evictions', () => {
      const smallConfig: CacheConfig = {
        maxSizeMb: 0.0005, // ~500 bytes
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(smallConfig)

      cache.set('memory:session-1:key1', { data: 'x'.repeat(200) })
      cache.set('memory:session-1:key2', { data: 'y'.repeat(200) })
      cache.set('memory:session-1:key3', { data: 'z'.repeat(200) })

      const stats = cache.stats()
      expect(stats.evictions).toBeGreaterThan(0)
    })

    it('should track current size', () => {
      const value = { data: 'x'.repeat(100) }
      cache.set('memory:session-1:key1', value)

      const stats = cache.stats()
      expect(stats.currentSizeMb).toBeGreaterThan(0)
      expect(stats.currentSizeMb).toBeLessThan(1)
    })

    it('should reset statistics on clear', () => {
      cache.set('memory:session-1:key1', { data: 'test' })
      cache.get('memory:session-1:key1')
      cache.get('non-existent')

      cache.clear()

      const stats = cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.evictions).toBe(0)
      expect(stats.currentSizeMb).toBe(0)
    })

    it('should return all stats fields', () => {
      const stats = cache.stats()
      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('evictions')
      expect(stats).toHaveProperty('currentSizeMb')
    })
  })

  describe('Edge Cases', () => {
    let cache: CacheLayer

    it('should handle null and undefined values', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      cache.set('memory:session-1:null', null)
      cache.set('memory:session-1:undefined', undefined)

      expect(cache.get('memory:session-1:null')).toBeNull()
      expect(cache.get('memory:session-1:undefined')).toBeUndefined()
    })

    it('should handle complex nested objects', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      const complexValue = {
        level1: {
          level2: {
            level3: {
              data: [1, 2, 3],
              nested: { a: 'b' },
            },
          },
        },
        array: [{ id: 1 }, { id: 2 }],
      }

      cache.set('memory:session-1:complex', complexValue)
      expect(cache.get('memory:session-1:complex')).toEqual(complexValue)
    })

    it('should handle empty strings and empty objects', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      cache.set('memory:session-1:empty-str', '')
      cache.set('memory:session-1:empty-obj', {})

      expect(cache.get('memory:session-1:empty-str')).toBe('')
      expect(cache.get('memory:session-1:empty-obj')).toEqual({})
    })

    it('should calculate size correctly for various value types', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 60,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      cache.set('memory:session-1:str', 'x'.repeat(100))
      const stats1 = cache.stats()

      cache.set('memory:session-1:obj', { data: 'y'.repeat(100) })
      const stats2 = cache.stats()

      expect(stats2.currentSizeMb).toBeGreaterThan(stats1.currentSizeMb)
    })
  })

  describe('Multiple Sessions', () => {
    let cache: CacheLayer
    const config: CacheConfig = {
      maxSizeMb: 1,
      ttlSeconds: 60,
      evictionPolicy: 'lru',
    }

    beforeEach(() => {
      cache = createCacheLayer(config)
    })

    it('should isolate entries by session via key prefix', () => {
      const session1Key = 'memory:session-1:summary'
      const session2Key = 'memory:session-2:summary'

      cache.set(session1Key, { summary: 'Session 1 summary' })
      cache.set(session2Key, { summary: 'Session 2 summary' })

      expect(cache.get(session1Key)).toEqual({ summary: 'Session 1 summary' })
      expect(cache.get(session2Key)).toEqual({ summary: 'Session 2 summary' })
    })

    it('should allow same key suffix for different sessions', () => {
      cache.set('memory:session-1:summary', { version: 1 })
      cache.set('memory:session-2:summary', { version: 2 })

      expect(cache.get('memory:session-1:summary')).toEqual({ version: 1 })
      expect(cache.get('memory:session-2:summary')).toEqual({ version: 2 })
    })
  })

  describe('TTL Edge Cases', () => {
    let cache: CacheLayer

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should handle entries with different TTLs', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 100,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      cache.set('memory:session-1:short', { data: 'a' }, 10)
      cache.set('memory:session-1:long', { data: 'b' }, 200)

      // After short TTL expires
      vi.advanceTimersByTime(11 * 1000)
      expect(cache.get('memory:session-1:short')).toBeNull()
      expect(cache.get('memory:session-1:long')).toEqual({ data: 'b' })

      // After long TTL expires
      vi.advanceTimersByTime(190 * 1000)
      expect(cache.get('memory:session-1:long')).toBeNull()
    })

    it('should not count expired entries as hits', () => {
      const config: CacheConfig = {
        maxSizeMb: 1,
        ttlSeconds: 10,
        evictionPolicy: 'lru',
      }
      cache = createCacheLayer(config)

      cache.set('memory:session-1:key', { data: 'test' })

      // Access before expiry - counts as hit
      cache.get('memory:session-1:key')
      expect(cache.stats().hits).toBe(1)

      // After expiry - counts as miss
      vi.advanceTimersByTime(11 * 1000)
      cache.get('memory:session-1:key')
      expect(cache.stats().misses).toBe(1)
    })
  })
})
