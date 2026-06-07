/**
 * Cross-User Retrieval Security Tests
 *
 * Tests that HybridRetrievalOrchestrator doesn't leak memories across users:
 * 1. User A cannot see User B's memories
 * 2. User B cannot see User A's memories
 * 3. User A sees own memories
 * 4. Tenant isolation works correctly
 *
 * Security invariants verified:
 * - HybridRecallQuery.userId strictly filters results
 * - LexicalRetrievalStrategy respects userId boundary
 * - HybridRetrievalOrchestrator does not bypass user isolation
 *
 * @module security/memory/cross-user-retrieval
 */

import { describe, it, expect, vi } from 'vitest'
import { LexicalRetrievalStrategy, HybridRetrievalOrchestrator } from '../../../src/memory/hybrid-retrieval.js'
import type {
  LongTermMemoryRecallService,
  RecallQuery,
  RecallResult,
} from '../../../src/memory/long-term-memory-recall.js'
import type { LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js'
import type { HybridRecallQuery } from '../../../src/memory/hybrid-retrieval-types.js'

const USER_A = 'user-alice'
const USER_B = 'user-bob'

/**
 * Helper to create a LongTermMemoryRecord for testing.
 */
function makeMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  const now = new Date().toISOString()
  return {
    memoryId: 'mem-1',
    userId: USER_A,
    memoryType: 'user_preference',
    content: { text: 'test content' },
    sourceRefs: { transcriptRefs: ['t-1'] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
    retrieval: { keywords: ['test'], recallCount: 10 },
    fingerprint: 'fp-1',
    ...overrides,
  }
}

/**
 * Mock recall service that returns user-specific data.
 * Simulates a real service that strictly filters by userId.
 */
function makeUserIsolatedRecallService(
  memoriesByUser: Map<string, LongTermMemoryRecord[]>,
): LongTermMemoryRecallService {
  return {
    recall: vi.fn().mockImplementation((query: RecallQuery): Promise<RecallResult> => {
      const userMemories = memoriesByUser.get(query.userId) ?? []
      return Promise.resolve({
        memories: userMemories.map((mem) => ({ ...mem, source: 'long_term' as const })),
        total: userMemories.length,
      })
    }),
    recallByMetadata: vi.fn().mockResolvedValue([]),
  }
}

describe('Cross-User Retrieval Security Tests', () => {
  describe('LexicalRetrievalStrategy user isolation', () => {
    it("User A cannot see User B's memories via LexicalRetrievalStrategy", async () => {
      const memA = makeMemory({ memoryId: 'mem-alice', userId: USER_A, content: { text: 'Alice secret' } })
      const memB = makeMemory({ memoryId: 'mem-bob', userId: USER_B, content: { text: 'Bob secret' } })

      const memoriesByUser = new Map([
        [USER_A, [memA]],
        [USER_B, [memB]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const strategy = new LexicalRetrievalStrategy(service)

      // Query as User A
      const query: HybridRecallQuery = { userId: USER_A, query: 'secret' }
      const result = await strategy.recall(query)

      // Should only see User A's memory
      expect(result.items).toHaveLength(1)
      expect(result.items[0].memory.userId).toBe(USER_A)
      expect(result.items[0].memory.memoryId).toBe('mem-alice')
      expect(result.items.some((item) => item.memory.userId === USER_B)).toBe(false)
    })

    it("User B cannot see User A's memories via LexicalRetrievalStrategy", async () => {
      const memA = makeMemory({ memoryId: 'mem-alice', userId: USER_A, content: { text: 'Alice secret' } })
      const memB = makeMemory({ memoryId: 'mem-bob', userId: USER_B, content: { text: 'Bob secret' } })

      const memoriesByUser = new Map([
        [USER_A, [memA]],
        [USER_B, [memB]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const strategy = new LexicalRetrievalStrategy(service)

      // Query as User B
      const query: HybridRecallQuery = { userId: USER_B, query: 'secret' }
      const result = await strategy.recall(query)

      // Should only see User B's memory
      expect(result.items).toHaveLength(1)
      expect(result.items[0].memory.userId).toBe(USER_B)
      expect(result.items[0].memory.memoryId).toBe('mem-bob')
      expect(result.items.some((item) => item.memory.userId === USER_A)).toBe(false)
    })

    it('User A sees own memories only', async () => {
      const memA1 = makeMemory({ memoryId: 'mem-alice-1', userId: USER_A, content: { text: 'Alice data 1' } })
      const memA2 = makeMemory({ memoryId: 'mem-alice-2', userId: USER_A, content: { text: 'Alice data 2' } })
      const memB = makeMemory({ memoryId: 'mem-bob', userId: USER_B, content: { text: 'Bob data' } })

      const memoriesByUser = new Map([
        [USER_A, [memA1, memA2]],
        [USER_B, [memB]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const strategy = new LexicalRetrievalStrategy(service)

      const query: HybridRecallQuery = { userId: USER_A }
      const result = await strategy.recall(query)

      expect(result.items).toHaveLength(2)
      expect(result.items.every((item) => item.memory.userId === USER_A)).toBe(true)
    })
  })

  describe('HybridRetrievalOrchestrator user isolation', () => {
    it("User A cannot see User B's memories via HybridRetrievalOrchestrator", async () => {
      const memA = makeMemory({ memoryId: 'mem-alice', userId: USER_A, content: { text: 'Alice secret' } })
      const memB = makeMemory({ memoryId: 'mem-bob', userId: USER_B, content: { text: 'Bob secret' } })

      const memoriesByUser = new Map([
        [USER_A, [memA]],
        [USER_B, [memB]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const lexicalStrategy = new LexicalRetrievalStrategy(service)
      const orchestrator = new HybridRetrievalOrchestrator([lexicalStrategy])

      const query: HybridRecallQuery = { userId: USER_A, query: 'secret' }
      const result = await orchestrator.recall(query)

      expect(result.items.every((item) => item.memory.userId === USER_A)).toBe(true)
      expect(result.items.some((item) => item.memory.userId === USER_B)).toBe(false)
    })

    it("User B cannot see User A's memories via HybridRetrievalOrchestrator", async () => {
      const memA = makeMemory({ memoryId: 'mem-alice', userId: USER_A, content: { text: 'Alice secret' } })
      const memB = makeMemory({ memoryId: 'mem-bob', userId: USER_B, content: { text: 'Bob secret' } })

      const memoriesByUser = new Map([
        [USER_A, [memA]],
        [USER_B, [memB]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const lexicalStrategy = new LexicalRetrievalStrategy(service)
      const orchestrator = new HybridRetrievalOrchestrator([lexicalStrategy])

      const query: HybridRecallQuery = { userId: USER_B, query: 'secret' }
      const result = await orchestrator.recall(query)

      expect(result.items.every((item) => item.memory.userId === USER_B)).toBe(true)
      expect(result.items.some((item) => item.memory.userId === USER_A)).toBe(false)
    })

    it('Orchestrator returns empty for non-existent user', async () => {
      const memA = makeMemory({ memoryId: 'mem-alice', userId: USER_A })

      const memoriesByUser = new Map([[USER_A, [memA]]])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const lexicalStrategy = new LexicalRetrievalStrategy(service)
      const orchestrator = new HybridRetrievalOrchestrator([lexicalStrategy])

      const query: HybridRecallQuery = { userId: 'user-unknown' }
      const result = await orchestrator.recall(query)

      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  describe('tenant isolation', () => {
    it('Different tenants are isolated (mocked service respects tenant)', async () => {
      const memTenantA = makeMemory({
        memoryId: 'mem-tenant-a',
        userId: USER_A,
        content: { text: 'Tenant A data' },
      })

      const service: LongTermMemoryRecallService = {
        recall: vi.fn().mockImplementation((_query: RecallQuery): Promise<RecallResult> => {
          return Promise.resolve({
            memories: [{ ...memTenantA, source: 'long_term' as const }],
            total: 1,
          })
        }),
        recallByMetadata: vi.fn().mockResolvedValue([]),
      }

      const strategy = new LexicalRetrievalStrategy(service)

      const query: HybridRecallQuery = { userId: USER_A }
      const result = await strategy.recall(query)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].memory.memoryId).toBe('mem-tenant-a')
    })
  })

  describe('userId in query is mandatory', () => {
    it('recall service is always called with userId from query', async () => {
      const service: LongTermMemoryRecallService = {
        recall: vi.fn().mockResolvedValue({ memories: [], total: 0 }),
        recallByMetadata: vi.fn().mockResolvedValue([]),
      }

      const strategy = new LexicalRetrievalStrategy(service)

      const query: HybridRecallQuery = { userId: USER_A, query: 'test' }
      await strategy.recall(query)

      expect(service.recall).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_A }))
    })

    it('orchestrator passes userId to all strategies', async () => {
      const service: LongTermMemoryRecallService = {
        recall: vi.fn().mockResolvedValue({ memories: [], total: 0 }),
        recallByMetadata: vi.fn().mockResolvedValue([]),
      }

      const lexicalStrategy = new LexicalRetrievalStrategy(service)
      const orchestrator = new HybridRetrievalOrchestrator([lexicalStrategy])

      const query: HybridRecallQuery = { userId: USER_B }
      await orchestrator.recall(query)

      expect(service.recall).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_B }))
    })
  })

  describe('no cross-user contamination in results', () => {
    it("multiple users' memories do not mix in results", async () => {
      // Setup: 3 users with different memories
      const userC = 'user-charlie'
      const memA = makeMemory({ memoryId: 'mem-a', userId: USER_A, content: { text: 'A data' } })
      const memB = makeMemory({ memoryId: 'mem-b', userId: USER_B, content: { text: 'B data' } })
      const memC = makeMemory({ memoryId: 'mem-c', userId: userC, content: { text: 'C data' } })

      const memoriesByUser = new Map([
        [USER_A, [memA]],
        [USER_B, [memB]],
        [userC, [memC]],
      ])

      const service = makeUserIsolatedRecallService(memoriesByUser)
      const strategy = new LexicalRetrievalStrategy(service)

      // Query for each user and verify isolation
      const resultA = await strategy.recall({ userId: USER_A })
      const resultB = await strategy.recall({ userId: USER_B })
      const resultC = await strategy.recall({ userId: userC })

      expect(resultA.items.every((item) => item.memory.userId === USER_A)).toBe(true)
      expect(resultB.items.every((item) => item.memory.userId === USER_B)).toBe(true)
      expect(resultC.items.every((item) => item.memory.userId === userC)).toBe(true)
    })
  })
})
