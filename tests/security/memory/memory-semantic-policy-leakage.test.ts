/**
 * Memory Semantic Policy Leakage Security Tests
 *
 * Tests that memories are properly isolated across:
 * - Different users (cross-user isolation)
 * - Different tenants (cross-tenant isolation)
 * - Visibility scopes (private_user not accessible to other users)
 *
 * Security invariants verified:
 * 1. A user cannot recall memories from another user
 * 2. A tenant cannot access memories from another tenant
 * 3. private_user visibility memories are never shared across users
 * 4. Same fingerprint does not create cross-user leakage
 *
 * @module security/memory/memory-semantic-policy-leakage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  createLongTermMemoryStore,
  type LongTermMemoryStore,
  type LongTermMemoryRecord,
} from '../../../src/storage/long-term-memory-store.js'
import {
  createLongTermMemoryRecallService,
  type LongTermMemoryRecallService,
  type RecallQuery,
} from '../../../src/memory/long-term-memory-recall.js'

const USER_A = 'user-alice'
const USER_B = 'user-bob'
const TENANT_A = 'tenant-org-alpha'
const TENANT_B = 'tenant-org-beta'

describe('Memory Semantic Policy Leakage Security Tests', () => {
  let connection: ConnectionManager
  let store: LongTermMemoryStore
  let recallService: LongTermMemoryRecallService

  const createTestMemory = (
    userId: string,
    tenantId: string,
    overrides: Partial<LongTermMemoryRecord> = {},
  ): LongTermMemoryRecord => ({
    memoryId: `mem-${Date.now()}-${Math.random()}`,
    userId,
    memoryType: 'user_preference',
    content: {
      text: `Confidential data for ${userId} in ${tenantId}`,
    },
    sourceRefs: {
      transcriptRefs: ['trans-001'],
    },
    scope: {
      visibility: 'private_user',
    },
    confidence: 0.95,
    importance: 'high',
    sensitivity: 'low',
    lifecycle: {
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    retrieval: {
      keywords: ['confidential', 'private', userId],
      recallCount: 0,
    },
    fingerprint: `fp-${userId}-${Date.now()}`,
    sourceWindowHash: `hash-${userId}-${Date.now()}`,
    ...overrides,
  })

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    store = createLongTermMemoryStore(connection)
    recallService = createLongTermMemoryRecallService(store)
  })

  afterEach(() => {
    connection.close()
  })

  describe('cross-user isolation', () => {
    it('User A cannot recall memories from User B even with same query', async () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-secret',
        content: { text: 'User A secret: confidential project alpha details' },
        retrieval: { keywords: ['secret', 'confidential', 'project'], recallCount: 0 },
      })
      const memB = createTestMemory(USER_B, TENANT_A, {
        memoryId: 'mem-b-secret',
        content: { text: 'User B secret: confidential project beta details' },
        retrieval: { keywords: ['secret', 'confidential', 'project'], recallCount: 0 },
      })

      store.save(memA)
      store.save(memB)

      // User A recall with keyword that matches both
      const queryA: RecallQuery = {
        userId: USER_A,
        query: 'confidential project',
      }
      const resultA = await recallService.recall(queryA)

      // User A should only see User A's memories
      expect(resultA.memories).toHaveLength(1)
      expect(resultA.memories[0]?.userId).toBe(USER_A)
      expect(resultA.memories[0]?.content.text).toContain('project alpha')

      // User B recall with same query
      const queryB: RecallQuery = {
        userId: USER_B,
        query: 'confidential project',
      }
      const resultB = await recallService.recall(queryB)

      // User B should only see User B's memories
      expect(resultB.memories).toHaveLength(1)
      expect(resultB.memories[0]?.userId).toBe(USER_B)
      expect(resultB.memories[0]?.content.text).toContain('project beta')
    })

    it('User A memory content never appears in User B recall results', async () => {
      const secretContent = 'ALPHA_SECRET_CODE_12345_USER_A_ONLY'
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-ultra-secret',
        content: { text: secretContent },
        retrieval: {
          keywords: ['ultra', 'secret', 'code'],
          recallCount: 0,
        },
      })

      store.save(memA)

      // User B attempts to recall with same keywords
      const queryB: RecallQuery = {
        userId: USER_B,
        query: 'ultra secret code',
      }
      const resultB = await recallService.recall(queryB)

      expect(resultB.memories).toHaveLength(0)
    })

    it('searchActive filters by userId correctly', () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-search',
        content: { text: 'User A searchable content about API keys' },
      })
      const memB = createTestMemory(USER_B, TENANT_A, {
        memoryId: 'mem-b-search',
        content: { text: 'User B searchable content about API keys' },
      })

      store.save(memA)
      store.save(memB)

      // searchActive should only return user-specific results
      const resultsA = store.searchActive('API keys', USER_A, 10)
      const resultsB = store.searchActive('API keys', USER_B, 10)

      expect(resultsA).toHaveLength(1)
      expect(resultsA[0]?.userId).toBe(USER_A)

      expect(resultsB).toHaveLength(1)
      expect(resultsB[0]?.userId).toBe(USER_B)
    })
  })

  describe('cross-tenant isolation', () => {
    it('Tenant A user cannot access Tenant B memories via store', () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-tenant-a',
        content: { text: 'Tenant A confidential roadmap' },
      })
      const memB = createTestMemory(USER_A, TENANT_B, {
        memoryId: 'mem-tenant-b',
        content: { text: 'Tenant B confidential roadmap' },
      })

      store.save(memA, TENANT_A)
      store.save(memB, TENANT_B)

      // Query for Tenant A should not return Tenant B data
      const resultsA = store.getByUserId(USER_A, TENANT_A)
      expect(resultsA).toHaveLength(1)
      expect(resultsA[0]?.content.text).toContain('Tenant A')
      expect(resultsA[0]?.content.text).not.toContain('Tenant B')

      // Query for Tenant B should not return Tenant A data
      const resultsB = store.getByUserId(USER_A, TENANT_B)
      expect(resultsB).toHaveLength(1)
      expect(resultsB[0]?.content.text).toContain('Tenant B')
      expect(resultsB[0]?.content.text).not.toContain('Tenant A')
    })

    it('memoryId must be globally unique across tenants (no isolation by memoryId)', () => {
      const sameMemoryId = 'mem-shared-id-test'

      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: sameMemoryId,
        content: { text: 'Tenant A version of memory' },
        fingerprint: 'fp-shared',
        sourceWindowHash: 'hash-shared',
      })
      const memB = createTestMemory(USER_A, TENANT_B, {
        memoryId: sameMemoryId,
        content: { text: 'Tenant B version of memory' },
        fingerprint: 'fp-shared',
        sourceWindowHash: 'hash-shared',
      })

      store.save(memA, TENANT_A)
      store.save(memB, TENANT_B)

      const retrievedA = store.getByMemoryId(sameMemoryId, TENANT_A)
      const retrievedB = store.getByMemoryId(sameMemoryId, TENANT_B)

      expect(retrievedA).toBeNull()
      expect(retrievedB?.content.text).toContain('Tenant B')
    })

    it('tombstones are tenant-isolated', () => {
      const fingerprint = 'fp-tombstone-test'
      const sourceHash = 'hash-tombstone-test'

      // Create tombstone in Tenant A
      store.createTombstone(
        {
          userId: USER_A,
          fingerprint,
          sourceWindowHash: sourceHash,
          memoryId: 'mem-deleted-a',
          reason: 'user_delete',
        },
        TENANT_A,
      )

      // Tenant A should have tombstone
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash, TENANT_A)).toBe(true)

      // Tenant B should NOT have tombstone
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash, TENANT_B)).toBe(false)

      // Can create memory with same fingerprint in Tenant B
      const memB = createTestMemory(USER_A, TENANT_B, {
        memoryId: 'mem-new-b',
        fingerprint,
        sourceWindowHash: sourceHash,
      })

      // Should not throw since tombstone doesn't exist in Tenant B
      expect(() => store.upsertExtracted(memB, TENANT_B)).not.toThrow()
    })
  })

  describe('private_user visibility isolation', () => {
    it('private_user memories are only recalled by owning user', async () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-private',
        content: { text: 'User A private preference' },
        scope: { visibility: 'private_user' },
      })
      const memB = createTestMemory(USER_B, TENANT_A, {
        memoryId: 'mem-b-private',
        content: { text: 'User B private preference' },
        scope: { visibility: 'private_user' },
      })

      store.save(memA)
      store.save(memB)

      // Recall service only returns private_user memories for the requesting user
      const queryA: RecallQuery = { userId: USER_A }
      const resultA = await recallService.recall(queryA)

      expect(resultA.memories).toHaveLength(1)
      expect(resultA.memories[0]?.userId).toBe(USER_A)
      expect(resultA.memories[0]?.scope.visibility).toBe('private_user')

      const queryB: RecallQuery = { userId: USER_B }
      const resultB = await recallService.recall(queryB)

      expect(resultB.memories).toHaveLength(1)
      expect(resultB.memories[0]?.userId).toBe(USER_B)
    })

    it('workspace visibility is not returned by recall service for other users', async () => {
      // Recall service currently only returns private_user visibility
      // This test ensures the visibility filter is enforced
      const memPrivate = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-private-viz',
        content: { text: 'Private user memory' },
        scope: { visibility: 'private_user' },
      })
      const memWorkspace = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-workspace-viz',
        content: { text: 'Workspace memory' },
        scope: { visibility: 'workspace' },
      })

      store.save(memPrivate)
      store.save(memWorkspace)

      const query: RecallQuery = { userId: USER_A }
      const result = await recallService.recall(query)

      // Only private_user visibility should be returned
      expect(result.memories).toHaveLength(1)
      expect(result.memories[0]?.scope.visibility).toBe('private_user')
    })
  })

  describe('same fingerprint does not cause cross-user leakage', () => {
    it('same fingerprint for different users are isolated', async () => {
      const sharedFingerprint = 'fp-shared-cross-user'

      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-fp-shared',
        fingerprint: sharedFingerprint,
        sourceWindowHash: 'hash-a',
        content: { text: 'User A data with shared fingerprint' },
      })
      const memB = createTestMemory(USER_B, TENANT_A, {
        memoryId: 'mem-b-fp-shared',
        fingerprint: sharedFingerprint,
        sourceWindowHash: 'hash-b',
        content: { text: 'User B data with shared fingerprint' },
      })

      store.save(memA)
      store.save(memB)

      // findCurrentByFingerprint must respect userId
      const foundA = store.findCurrentByFingerprint(USER_A, sharedFingerprint)
      const foundB = store.findCurrentByFingerprint(USER_B, sharedFingerprint)

      expect(foundA?.userId).toBe(USER_A)
      expect(foundA?.content.text).toContain('User A')

      expect(foundB?.userId).toBe(USER_B)
      expect(foundB?.content.text).toContain('User B')
    })

    it('upsertExtracted does not supersede other users memory with same fingerprint', () => {
      const sharedFingerprint = 'fp-upsert-cross-user'

      // User A creates memory
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-a-upsert',
        fingerprint: sharedFingerprint,
        sourceWindowHash: 'hash-a-upsert',
        content: { text: 'User A original' },
      })
      store.save(memA)

      // User B upserts with same fingerprint
      const memB = createTestMemory(USER_B, TENANT_A, {
        memoryId: 'mem-b-upsert',
        fingerprint: sharedFingerprint,
        sourceWindowHash: 'hash-b-upsert',
        content: { text: 'User B original' },
      })
      store.upsertExtracted(memB)

      // User A's memory should still be active
      const foundA = store.findCurrentByFingerprint(USER_A, sharedFingerprint)
      expect(foundA?.lifecycle.status).toBe('active')
      expect(foundA?.memoryId).toBe('mem-a-upsert')

      // User B's memory should also be active (separate chain)
      const foundB = store.findCurrentByFingerprint(USER_B, sharedFingerprint)
      expect(foundB?.lifecycle.status).toBe('active')
      expect(foundB?.memoryId).toBe('mem-b-upsert')
    })
  })

  describe('store-level query isolation', () => {
    it('getByType filters by tenant', () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-type-a',
        memoryType: 'user_preference',
        content: { text: 'Tenant A preference' },
      })
      const memB = createTestMemory(USER_A, TENANT_B, {
        memoryId: 'mem-type-b',
        memoryType: 'user_preference',
        content: { text: 'Tenant B preference' },
      })

      store.save(memA, TENANT_A)
      store.save(memB, TENANT_B)

      const resultsA = store.getByType('user_preference', TENANT_A)
      const resultsB = store.getByType('user_preference', TENANT_B)

      expect(resultsA).toHaveLength(1)
      expect(resultsA[0]?.content.text).toContain('Tenant A')

      expect(resultsB).toHaveLength(1)
      expect(resultsB[0]?.content.text).toContain('Tenant B')
    })

    it('search filters by tenant', () => {
      const memA = createTestMemory(USER_A, TENANT_A, {
        memoryId: 'mem-search-a',
        content: { text: 'Tenant A searchable: API_ENDPOINT=secret-a' },
      })
      const memB = createTestMemory(USER_A, TENANT_B, {
        memoryId: 'mem-search-b',
        content: { text: 'Tenant B searchable: API_ENDPOINT=secret-b' },
      })

      store.save(memA, TENANT_A)
      store.save(memB, TENANT_B)

      const resultsA = store.search('API_ENDPOINT', USER_A, 10, TENANT_A)
      const resultsB = store.search('API_ENDPOINT', USER_A, 10, TENANT_B)

      expect(resultsA).toHaveLength(1)
      expect(resultsA[0]?.content.text).toContain('secret-a')

      expect(resultsB).toHaveLength(1)
      expect(resultsB[0]?.content.text).toContain('secret-b')
    })
  })
})
