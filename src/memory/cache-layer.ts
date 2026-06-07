/**
 * Memory Cache Layer with LRU Eviction and TTL
 *
 * In-process cache for session memory data with:
 * - LRU (Least Recently Used) eviction when exceeding maxSizeMb
 * - Per-entry TTL (Time-To-Live) expiry
 * - Statistics tracking (hits, misses, evictions, currentSize)
 */

import type { CacheConfig } from './limit-types.js'

export type CacheStats = {
  hits: number
  misses: number
  evictions: number
  currentSizeMb: number
}

export type CacheEntry<T = unknown> = {
  value: T
  expiresAt: number
}

export interface CacheLayer {
  get<T = unknown>(key: string): T | null
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): void
  delete(key: string): boolean
  clear(): void
  stats(): CacheStats
}

type ListNode = {
  key: string
  prev: ListNode | null
  next: ListNode | null
}

function estimateSizeMb(value: unknown): number {
  if (value === undefined) {
    return 0
  }
  const str = JSON.stringify(value)
  return str.length / (1024 * 1024)
}

export function createCacheLayer(config: CacheConfig): CacheLayer {
  const maxSizeMb = config.maxSizeMb
  const defaultTtlSeconds = config.ttlSeconds

  let hits = 0
  let misses = 0
  let evictions = 0
  let currentSizeMb = 0

  const cache = new Map<string, CacheEntry>()
  const keySizes = new Map<string, number>()
  const nodeMap = new Map<string, ListNode>()

  let head: ListNode | null = null
  let tail: ListNode | null = null

  function addToHead(node: ListNode): void {
    node.prev = null
    node.next = head
    if (head) {
      head.prev = node
    }
    head = node
    if (!tail) {
      tail = node
    }
  }

  function removeNode(node: ListNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      head = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    } else {
      tail = node.prev
    }
  }

  function moveToHead(node: ListNode): void {
    removeNode(node)
    addToHead(node)
  }

  function evictOne(): void {
    if (!tail) return

    const keyToRemove = tail.key
    const entry = cache.get(keyToRemove)
    if (entry) {
      const size = keySizes.get(keyToRemove) ?? 0
      currentSizeMb -= size
      cache.delete(keyToRemove)
      keySizes.delete(keyToRemove)
      nodeMap.delete(keyToRemove)
      evictions++
    }
    removeNode(tail)
  }

  function evictToFit(additionalSize: number): void {
    while (currentSizeMb + additionalSize > maxSizeMb && cache.size > 0) {
      evictOne()
    }
  }

  function isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.expiresAt
  }

  return {
    get<T = unknown>(key: string): T | null {
      const entry = cache.get(key)
      if (!entry) {
        misses++
        return null
      }

      if (isExpired(entry)) {
        const node = nodeMap.get(key)
        if (node) removeNode(node)
        const size = keySizes.get(key) ?? 0
        currentSizeMb -= size
        cache.delete(key)
        keySizes.delete(key)
        nodeMap.delete(key)
        misses++
        return null
      }

      const node = nodeMap.get(key)
      if (node) moveToHead(node)
      hits++
      return entry.value as T
    },

    set<T = unknown>(key: string, value: T, ttlSeconds?: number): void {
      const ttl = ttlSeconds ?? defaultTtlSeconds
      const expiresAt = Date.now() + ttl * 1000
      const size = estimateSizeMb(value)

      const existingEntry = cache.get(key)
      if (existingEntry) {
        const oldSize = keySizes.get(key) ?? 0
        currentSizeMb -= oldSize
        evictToFit(size)
        currentSizeMb += size
        cache.set(key, { value, expiresAt })
        keySizes.set(key, size)
        const node = nodeMap.get(key)
        if (node) moveToHead(node)
        return
      }

      evictToFit(size)

      cache.set(key, { value, expiresAt })
      keySizes.set(key, size)
      currentSizeMb += size

      const newNode: ListNode = { key, prev: null, next: null }
      nodeMap.set(key, newNode)
      addToHead(newNode)
    },

    delete(key: string): boolean {
      const entry = cache.get(key)
      if (!entry) return false

      const size = keySizes.get(key) ?? 0
      currentSizeMb -= size
      cache.delete(key)
      keySizes.delete(key)

      const node = nodeMap.get(key)
      if (node) removeNode(node)
      nodeMap.delete(key)

      return true
    },

    clear(): void {
      cache.clear()
      keySizes.clear()
      nodeMap.clear()
      head = null
      tail = null
      hits = 0
      misses = 0
      evictions = 0
      currentSizeMb = 0
    },

    stats(): CacheStats {
      return {
        hits,
        misses,
        evictions,
        currentSizeMb,
      }
    },
  }
}
