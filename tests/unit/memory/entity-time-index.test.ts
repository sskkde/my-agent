import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  createLongTermMemoryStore,
  type LongTermMemoryStore,
  type LongTermMemoryRecord,
} from '../../../src/storage/long-term-memory-store.js'

describe('Entity/Time Index for Long-term Memories', () => {
  let connection: ConnectionManager
  let memoryStore: LongTermMemoryStore

  const createTestMemory = (overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord => ({
    memoryId: 'mem-test-001',
    userId: 'user-123',
    memoryType: 'user_preference',
    content: {
      text: 'User prefers dark mode',
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
      keywords: ['dark mode'],
      recallCount: 0,
    },
    ...overrides,
  })

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    memoryStore = createLongTermMemoryStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  describe('Entity Names Auto-extraction', () => {
    it('should auto-extract entityNames from entities when saving', () => {
      const memory = createTestMemory({
        memoryId: 'mem-entity-001',
        entities: [
          { entityType: 'person' as const, displayName: 'Alice' },
          { entityType: 'project' as const, displayName: 'ProjectX' },
        ],
      })

      memoryStore.save(memory)

      const retrieved = memoryStore.getByMemoryId(memory.memoryId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.entityNames).toEqual(['Alice', 'ProjectX'])
    })

    it('should return memory when searching by entity name', () => {
      const memory = createTestMemory({
        memoryId: 'mem-entity-002',
        entities: [
          { entityType: 'person' as const, displayName: 'Alice' },
          { entityType: 'project' as const, displayName: 'ProjectX' },
        ],
      })

      memoryStore.save(memory)

      const results = memoryStore.getByEntityName('Alice')

      expect(results).toHaveLength(1)
      expect(results[0]?.memoryId).toBe('mem-entity-002')
    })

    it('should return empty array when no matching entity name', () => {
      const memory = createTestMemory({
        memoryId: 'mem-entity-003',
        entities: [{ entityType: 'person' as const, displayName: 'Alice' }],
      })

      memoryStore.save(memory)

      const results = memoryStore.getByEntityName('Bob')

      expect(results).toHaveLength(0)
    })

    it('should have undefined entityNames when no entities', () => {
      const memory = createTestMemory({
        memoryId: 'mem-entity-004',
      })

      memoryStore.save(memory)

      const retrieved = memoryStore.getByMemoryId(memory.memoryId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.entityNames).toBeUndefined()
    })

    it('should update entityNames when entities change', () => {
      const memory = createTestMemory({
        memoryId: 'mem-entity-005',
        entities: [{ entityType: 'person' as const, displayName: 'Alice' }],
      })

      memoryStore.save(memory)

      const updated = {
        ...memory,
        entities: [
          { entityType: 'person' as const, displayName: 'Bob' },
          { entityType: 'project' as const, displayName: 'ProjectY' },
        ],
      }

      memoryStore.save(updated)

      const retrieved = memoryStore.getByMemoryId(memory.memoryId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.entityNames).toEqual(['Bob', 'ProjectY'])
    })
  })

  describe('Date Range Query', () => {
    it('should return memories within date range', () => {
      const memory = createTestMemory({
        memoryId: 'mem-date-001',
        lifecycle: {
          status: 'active',
          createdAt: '2025-06-15T10:00:00Z',
          updatedAt: '2025-06-15T10:00:00Z',
        },
      })

      memoryStore.save(memory)

      const results = memoryStore.getByDateRange('2025-06-01', '2025-06-30')

      expect(results).toHaveLength(1)
      expect(results[0]?.memoryId).toBe('mem-date-001')
    })

    it('should return empty array for out-of-range dates', () => {
      const memory = createTestMemory({
        memoryId: 'mem-date-002',
        lifecycle: {
          status: 'active',
          createdAt: '2025-06-15T10:00:00Z',
          updatedAt: '2025-06-15T10:00:00Z',
        },
      })

      memoryStore.save(memory)

      const results = memoryStore.getByDateRange('2024-01-01', '2024-12-31')

      expect(results).toHaveLength(0)
    })

    it('should return multiple memories sorted by createdAt DESC', () => {
      const memory1 = createTestMemory({
        memoryId: 'mem-date-003',
        lifecycle: {
          status: 'active',
          createdAt: '2025-06-01T10:00:00Z',
          updatedAt: '2025-06-01T10:00:00Z',
        },
      })

      const memory2 = createTestMemory({
        memoryId: 'mem-date-004',
        lifecycle: {
          status: 'active',
          createdAt: '2025-06-20T10:00:00Z',
          updatedAt: '2025-06-20T10:00:00Z',
        },
      })

      memoryStore.save(memory1)
      memoryStore.save(memory2)

      const results = memoryStore.getByDateRange('2025-06-01', '2025-06-30')

      expect(results).toHaveLength(2)
      expect(results[0]?.memoryId).toBe('mem-date-004')
      expect(results[1]?.memoryId).toBe('mem-date-003')
    })

    it('should exclude deleted memories from date range results', () => {
      const memory = createTestMemory({
        memoryId: 'mem-date-005',
        lifecycle: {
          status: 'deleted',
          createdAt: '2025-06-15T10:00:00Z',
          updatedAt: '2025-06-15T10:00:00Z',
        },
      })

      memoryStore.save(memory)

      const results = memoryStore.getByDateRange('2025-06-01', '2025-06-30')

      expect(results).toHaveLength(0)
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        const memory = createTestMemory({
          memoryId: `mem-date-${String(i).padStart(2, '0')}`,
          lifecycle: {
            status: 'active',
            createdAt: `2025-06-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
            updatedAt: `2025-06-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
          },
        })
        memoryStore.save(memory)
      }

      const results = memoryStore.getByDateRange('2025-06-01', '2025-06-30', 5)

      expect(results).toHaveLength(5)
    })
  })

  describe('Migration Idempotence', () => {
    it('should handle CREATE INDEX IF NOT EXISTS being run twice', () => {
      connection.exec(`
        CREATE INDEX IF NOT EXISTS idx_ltm_entity_names
          ON long_term_memories(entity_names)
      `)

      connection.exec(`
        CREATE INDEX IF NOT EXISTS idx_ltm_created_at
          ON long_term_memories(json_extract(lifecycle, '$.createdAt'))
      `)

      const memory = createTestMemory({
        memoryId: 'mem-idempotent-001',
        entities: [{ entityType: 'person' as const, displayName: 'Alice' }],
        lifecycle: {
          status: 'active',
          createdAt: '2025-06-15T10:00:00Z',
          updatedAt: '2025-06-15T10:00:00Z',
        },
      })

      memoryStore.save(memory)

      const byEntity = memoryStore.getByEntityName('Alice')
      expect(byEntity).toHaveLength(1)

      const byDate = memoryStore.getByDateRange('2025-06-01', '2025-06-30')
      expect(byDate).toHaveLength(1)
    })
  })

  describe('upsertExtracted integration', () => {
    it('should auto-extract entityNames when upserting extracted memory', () => {
      const memory = createTestMemory({
        memoryId: 'mem-upsert-001',
        fingerprint: 'fp-upsert-001',
        sourceWindowHash: 'hash-upsert-001',
        entities: [{ entityType: 'person' as const, displayName: 'Charlie' }],
      })

      memoryStore.upsertExtracted(memory)

      const retrieved = memoryStore.getByMemoryId(memory.memoryId)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.entityNames).toEqual(['Charlie'])
    })
  })
})
