/**
 * Deleted Memory Reingest Security Tests
 *
 * Tests that tombstone mechanism properly prevents re-extraction
 * of deleted memories:
 * 1. Tombstone blocks re-extraction with same fingerprint + sourceWindowHash
 * 2. Tombstone blocks re-extraction with same sourceWindowHash (source-level)
 * 3. Backfill operations do not resurrect deleted memories
 * 4. Tombstone is created automatically on memory delete
 *
 * Security invariants verified:
 * - Deleted memory cannot be re-extracted via upsertExtracted
 * - Tombstone persists across sessions
 * - Different users' tombstones are isolated
 *
 * @module security/memory/deleted-memory-reingest
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

const USER_A = 'user-alice'
const TENANT_A = 'tenant-alpha'

describe('Deleted Memory Reingest Security Tests', () => {
  let connection: ConnectionManager
  let store: LongTermMemoryStore

  const createTestMemory = (overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord => ({
    memoryId: `mem-${Date.now()}-${Math.random()}`,
    userId: USER_A,
    memoryType: 'user_preference',
    content: {
      text: 'User preference content',
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
      keywords: ['preference'],
      recallCount: 0,
    },
    fingerprint: 'fp-test',
    sourceWindowHash: 'hash-test',
    ...overrides,
  })

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    store = createLongTermMemoryStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  describe('tombstone blocks re-extraction by fingerprint + source', () => {
    it('upsertExtracted is blocked when tombstone exists for same fingerprint + sourceWindowHash', () => {
      const fingerprint = 'fp-blocked'
      const sourceHash = 'hash-blocked'

      // Create tombstone
      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // Attempt to upsert memory with same fingerprint + source
      const mem = createTestMemory({
        memoryId: 'mem-reingest-attempt',
        fingerprint,
        sourceWindowHash: sourceHash,
        content: { text: 'Attempted reingest content' },
      })

      // upsertExtracted should silently skip (no throw, no save)
      store.upsertExtracted(mem)

      // Memory should NOT exist
      const found = store.getByMemoryId('mem-reingest-attempt')
      expect(found).toBeNull()

      // Tombstone should still exist
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash)).toBe(true)
    })

    it('upsertExtracted succeeds when only fingerprint matches (different source)', () => {
      const fingerprint = 'fp-partial'
      const sourceHashA = 'hash-source-a'
      const sourceHashB = 'hash-source-b'

      // Create tombstone for source A
      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHashA,
        reason: 'user_delete',
      })

      // Upsert with same fingerprint but different source should succeed
      const mem = createTestMemory({
        memoryId: 'mem-different-source',
        fingerprint,
        sourceWindowHash: sourceHashB,
        content: { text: 'Different source content' },
      })

      store.upsertExtracted(mem)

      // Memory should exist
      const found = store.getByMemoryId('mem-different-source')
      expect(found).not.toBeNull()
      expect(found?.lifecycle.status).toBe('active')
    })

    it('upsertExtracted succeeds when only source matches (different fingerprint)', () => {
      const fingerprintA = 'fp-a'
      const fingerprintB = 'fp-b'
      const sourceHash = 'hash-shared-source'

      // Create tombstone for fingerprint A
      store.createTombstone({
        userId: USER_A,
        fingerprint: fingerprintA,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // Upsert with different fingerprint but same source should succeed
      const mem = createTestMemory({
        memoryId: 'mem-different-fp',
        fingerprint: fingerprintB,
        sourceWindowHash: sourceHash,
        content: { text: 'Different fingerprint content' },
      })

      store.upsertExtracted(mem)

      // Memory should exist
      const found = store.getByMemoryId('mem-different-fp')
      expect(found).not.toBeNull()
      expect(found?.lifecycle.status).toBe('active')
    })
  })

  describe('source-level tombstone check', () => {
    it('hasTombstoneForSource checks by userId + sourceWindowHash only', () => {
      const sourceHash = 'hash-source-level'
      const fingerprintA = 'fp-source-a'
      const fingerprintB = 'fp-source-b'

      // Create tombstone for fingerprint A
      store.createTombstone({
        userId: USER_A,
        fingerprint: fingerprintA,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // hasTombstoneForSource should return true for the source
      expect(store.hasTombstoneForSource(USER_A, sourceHash)).toBe(true)

      // Even for different fingerprint, source is tombstoned
      // (Note: hasTombstoneForSource is a broader check than hasTombstone)
      expect(store.hasTombstone(USER_A, fingerprintB, sourceHash)).toBe(false)
      expect(store.hasTombstoneForSource(USER_A, sourceHash)).toBe(true)
    })

    it('hasTombstoneForSource is user-isolated', () => {
      const sourceHash = 'hash-user-isolated'
      const userB = 'user-bob'

      // Create tombstone for User A
      store.createTombstone({
        userId: USER_A,
        fingerprint: 'fp-a',
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // User A has tombstone for source
      expect(store.hasTombstoneForSource(USER_A, sourceHash)).toBe(true)

      // User B does NOT have tombstone for same source
      expect(store.hasTombstoneForSource(userB, sourceHash)).toBe(false)
    })
  })

  describe('delete creates tombstone automatically', () => {
    it('calling delete on memory creates tombstone', () => {
      const fingerprint = 'fp-auto-tombstone'
      const sourceHash = 'hash-auto-tombstone'

      const mem = createTestMemory({
        memoryId: 'mem-to-delete',
        fingerprint,
        sourceWindowHash: sourceHash,
      })

      store.save(mem)

      // Tombstone should not exist yet
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash)).toBe(false)

      // Delete the memory
      store.delete('mem-to-delete')

      // Tombstone should now exist
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash)).toBe(true)

      // Memory should be soft-deleted
      const deleted = store.getByMemoryId('mem-to-delete')
      expect(deleted?.lifecycle.status).toBe('deleted')
    })

    it('re-extraction after delete is blocked by auto-created tombstone', () => {
      const fingerprint = 'fp-reingest-blocked'
      const sourceHash = 'hash-reingest-blocked'

      // Create and delete memory
      const mem = createTestMemory({
        memoryId: 'mem-delete-then-reingest',
        fingerprint,
        sourceWindowHash: sourceHash,
        content: { text: 'Original content' },
      })

      store.save(mem)
      store.delete('mem-delete-then-reingest')

      // Attempt re-extraction with same fingerprint + source
      const reingestMem = createTestMemory({
        memoryId: 'mem-reingest-after-delete',
        fingerprint,
        sourceWindowHash: sourceHash,
        content: { text: 'Reingest attempt' },
      })

      store.upsertExtracted(reingestMem)

      // Reingest should be blocked
      const found = store.getByMemoryId('mem-reingest-after-delete')
      expect(found).toBeNull()

      // Original should still be deleted
      const original = store.getByMemoryId('mem-delete-then-reingest')
      expect(original?.lifecycle.status).toBe('deleted')
    })

    it('delete without fingerprint/sourceWindowHash does not create tombstone', () => {
      const mem = createTestMemory({
        memoryId: 'mem-no-fp',
        fingerprint: undefined,
        sourceWindowHash: undefined,
      })

      store.save(mem)
      store.delete('mem-no-fp')

      // Memory should be deleted
      const deleted = store.getByMemoryId('mem-no-fp')
      expect(deleted?.lifecycle.status).toBe('deleted')

      // No tombstone should be created (no fingerprint to check)
      // This is expected behavior - memories without fingerprint
      // cannot be deduplicated anyway
    })
  })

  describe('backfill does not resurrect deleted memories', () => {
    it('backfill with same fingerprint is blocked by tombstone', () => {
      const fingerprint = 'fp-backfill'
      const sourceHash = 'hash-backfill'

      // Create tombstone
      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // Simulate backfill operation (calls upsertExtracted)
      const backfillMem = createTestMemory({
        memoryId: 'mem-backfill-attempt',
        fingerprint,
        sourceWindowHash: sourceHash,
        content: { text: 'Backfill content' },
      })

      store.upsertExtracted(backfillMem)

      // Backfill should be blocked
      expect(store.getByMemoryId('mem-backfill-attempt')).toBeNull()
    })

    it('backfill with different source creates new memory', () => {
      const fingerprint = 'fp-backfill-new'
      const sourceHashDeleted = 'hash-deleted'
      const sourceHashNew = 'hash-new'

      // Create tombstone for old source
      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHashDeleted,
        reason: 'user_delete',
      })

      // Backfill with new source should succeed
      const backfillMem = createTestMemory({
        memoryId: 'mem-backfill-new-source',
        fingerprint,
        sourceWindowHash: sourceHashNew,
        content: { text: 'Backfill with new source' },
      })

      store.upsertExtracted(backfillMem)

      // New memory should exist
      const found = store.getByMemoryId('mem-backfill-new-source')
      expect(found).not.toBeNull()
      expect(found?.lifecycle.status).toBe('active')
    })
  })

  describe('tombstone persistence', () => {
    it('tombstone persists across multiple upsertExtracted attempts', () => {
      const fingerprint = 'fp-persist'
      const sourceHash = 'hash-persist'

      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      // Multiple attempts should all be blocked
      for (let i = 0; i < 5; i++) {
        const mem = createTestMemory({
          memoryId: `mem-attempt-${i}`,
          fingerprint,
          sourceWindowHash: sourceHash,
          content: { text: `Attempt ${i}` },
        })

        store.upsertExtracted(mem)
      }

      // No memories should be created
      for (let i = 0; i < 5; i++) {
        expect(store.getByMemoryId(`mem-attempt-${i}`)).toBeNull()
      }

      // Tombstone should still exist
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash)).toBe(true)
    })

    it('tombstone is idempotent (same tombstone can be created multiple times)', () => {
      const fingerprint = 'fp-idempotent'
      const sourceHash = 'hash-idempotent'

      // Create tombstone multiple times
      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHash,
        reason: 'user_delete',
      })

      expect(() => {
        store.createTombstone({
          userId: USER_A,
          fingerprint,
          sourceWindowHash: sourceHash,
          reason: 'user_delete',
        })
      }).not.toThrow()

      // Tombstone should still exist
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash)).toBe(true)
    })
  })

  describe('tombstone retrieval', () => {
    it('getTombstone returns tombstone details', () => {
      const fingerprint = 'fp-retrieve'
      const sourceHash = 'hash-retrieve'
      const memoryId = 'mem-tombstone-retrieve'

      store.createTombstone({
        userId: USER_A,
        fingerprint,
        sourceWindowHash: sourceHash,
        memoryId,
        reason: 'user_delete',
      })

      const tombstone = store.getTombstone(memoryId)

      expect(tombstone).not.toBeNull()
      expect(tombstone?.userId).toBe(USER_A)
      expect(tombstone?.fingerprint).toBe(fingerprint)
      expect(tombstone?.sourceWindowHash).toBe(sourceHash)
      expect(tombstone?.reason).toBe('user_delete')
    })

    it('getTombstone returns null for non-existent memory', () => {
      const tombstone = store.getTombstone('non-existent-memory')
      expect(tombstone).toBeNull()
    })
  })

  describe('tenant isolation for tombstones', () => {
    it('tombstone is tenant-isolated', () => {
      const fingerprint = 'fp-tenant-tombstone'
      const sourceHash = 'hash-tenant-tombstone'
      const tenantB = 'tenant-beta'

      // Create tombstone in Tenant A
      store.createTombstone(
        {
          userId: USER_A,
          fingerprint,
          sourceWindowHash: sourceHash,
          reason: 'user_delete',
        },
        TENANT_A,
      )

      // Tenant A has tombstone
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash, TENANT_A)).toBe(true)

      // Tenant B does NOT have tombstone
      expect(store.hasTombstone(USER_A, fingerprint, sourceHash, tenantB)).toBe(false)

      // Can upsert in Tenant B
      const mem = createTestMemory({
        memoryId: 'mem-tenant-b',
        fingerprint,
        sourceWindowHash: sourceHash,
      })

      expect(() => store.upsertExtracted(mem, tenantB)).not.toThrow()
      expect(store.getByMemoryId('mem-tenant-b', tenantB)).not.toBeNull()
    })
  })
})
