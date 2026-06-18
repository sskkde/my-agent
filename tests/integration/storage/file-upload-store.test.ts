import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  createFileUploadStore,
  type FileUploadStore,
  type FileUploadCreateInput,
} from '../../../src/storage/file-upload-store.js'

function makeCreateInput(overrides: Partial<FileUploadCreateInput> = {}): FileUploadCreateInput {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    tenantId: 'org_default',
    originalFilename: 'photo.jpg',
    sanitizedName: 'photo.jpg',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    sizeBytes: 1024,
    checksum: 'abc123def456',
    storageRef: 'uploads/user-1/photo.jpg',
    previewText: undefined,
    previewStatus: 'pending',
    sensitivity: 'low',
    status: 'ready',
    ...overrides,
  }
}

describe('FileUploadStore', () => {
  let connection: ConnectionManager
  let store: FileUploadStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    store = createFileUploadStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  describe('create', () => {
    it('creates a file record and returns it with generated id and timestamps', () => {
      const input = makeCreateInput()
      const record = store.create(input)

      expect(record.fileId).toBeDefined()
      expect(record.fileId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
      expect(record.userId).toBe('user-1')
      expect(record.sessionId).toBe('session-1')
      expect(record.tenantId).toBe('org_default')
      expect(record.originalFilename).toBe('photo.jpg')
      expect(record.sanitizedName).toBe('photo.jpg')
      expect(record.mimeType).toBe('image/jpeg')
      expect(record.extension).toBe('.jpg')
      expect(record.sizeBytes).toBe(1024)
      expect(record.checksum).toBe('abc123def456')
      expect(record.storageRef).toBe('uploads/user-1/photo.jpg')
      expect(record.previewText).toBeUndefined()
      expect(record.previewStatus).toBe('pending')
      expect(record.sensitivity).toBe('low')
      expect(record.status).toBe('ready')
      expect(record.createdAt).toBeDefined()
      expect(record.updatedAt).toBeDefined()
      expect(record.deletedAt).toBeUndefined()
    })

    it('stores previewText when provided', () => {
      const record = store.create(makeCreateInput({ previewText: 'A sunset over the ocean' }))

      expect(record.previewText).toBe('A sunset over the ocean')
    })
  })

  describe('getById', () => {
    it('retrieves a file by id with matching userId', () => {
      const created = store.create(makeCreateInput())
      const found = store.getById(created.fileId, { userId: 'user-1' })

      expect(found).toBeDefined()
      expect(found!.fileId).toBe(created.fileId)
      expect(found!.originalFilename).toBe('photo.jpg')
    })

    it('retrieves a file by id with matching sessionId', () => {
      const created = store.create(makeCreateInput())
      const found = store.getById(created.fileId, { sessionId: 'session-1' })

      expect(found).toBeDefined()
      expect(found!.fileId).toBe(created.fileId)
    })

    it('denies access when userId does not match', () => {
      const created = store.create(makeCreateInput())
      const found = store.getById(created.fileId, { userId: 'user-2' })

      expect(found).toBeUndefined()
    })

    it('denies access when sessionId does not match', () => {
      const created = store.create(makeCreateInput())
      const found = store.getById(created.fileId, { sessionId: 'session-999' })

      expect(found).toBeUndefined()
    })

    it('denies access when no accessor provided', () => {
      const created = store.create(makeCreateInput())
      const found = store.getById(created.fileId, {})

      expect(found).toBeUndefined()
    })

    it('returns undefined for non-existent fileId', () => {
      const found = store.getById('non-existent-id', { userId: 'user-1' })

      expect(found).toBeUndefined()
    })
  })

  describe('listBySession', () => {
    it('lists files for a specific session', () => {
      store.create(makeCreateInput({ sessionId: 'session-A' }))
      store.create(makeCreateInput({ sessionId: 'session-A' }))
      store.create(makeCreateInput({ sessionId: 'session-B' }))

      const results = store.listBySession('session-A')

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.sessionId === 'session-A')).toBe(true)
    })

    it('excludes soft-deleted files', () => {
      const file1 = store.create(makeCreateInput({ sessionId: 'session-X' }))
      store.create(makeCreateInput({ sessionId: 'session-X' }))
      store.markDeleted(file1.fileId)

      const results = store.listBySession('session-X')

      expect(results).toHaveLength(1)
      expect(results[0]!.fileId).not.toBe(file1.fileId)
    })

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        store.create(makeCreateInput({ sessionId: 'session-L', originalFilename: `file-${i}.txt` }))
      }

      const page1 = store.listBySession('session-L', { limit: 2, offset: 0 })
      const page2 = store.listBySession('session-L', { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      expect(page1[0]!.fileId).not.toBe(page2[0]!.fileId)
    })

    it('returns empty array for session with no files', () => {
      const results = store.listBySession('empty-session')

      expect(results).toHaveLength(0)
    })
  })

  describe('listByUser', () => {
    it('lists files for a specific user', () => {
      store.create(makeCreateInput({ userId: 'alice' }))
      store.create(makeCreateInput({ userId: 'alice' }))
      store.create(makeCreateInput({ userId: 'bob' }))

      const results = store.listByUser('alice')

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.userId === 'alice')).toBe(true)
    })

    it('excludes soft-deleted files', () => {
      const file1 = store.create(makeCreateInput({ userId: 'carol' }))
      store.create(makeCreateInput({ userId: 'carol' }))
      store.markDeleted(file1.fileId)

      const results = store.listByUser('carol')

      expect(results).toHaveLength(1)
    })

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        store.create(makeCreateInput({ userId: 'dave', originalFilename: `doc-${i}.pdf` }))
      }

      const page = store.listByUser('dave', { limit: 3, offset: 2 })

      expect(page).toHaveLength(3)
    })
  })

  describe('update', () => {
    it('updates mutable fields', () => {
      const created = store.create(makeCreateInput())

      const updated = store.update(created.fileId, {
        originalFilename: 'renamed.jpg',
        sanitizedName: 'renamed.jpg',
        previewText: 'Updated preview',
        previewStatus: 'generated',
        sensitivity: 'high',
      })

      expect(updated).toBeDefined()
      expect(updated!.originalFilename).toBe('renamed.jpg')
      expect(updated!.sanitizedName).toBe('renamed.jpg')
      expect(updated!.previewText).toBe('Updated preview')
      expect(updated!.previewStatus).toBe('generated')
      expect(updated!.sensitivity).toBe('high')
      // updatedAt should be >= createdAt (may be same millisecond in fast tests)
      expect(updated!.updatedAt >= created.createdAt).toBe(true)
    })

    it('returns existing record when no fields provided', () => {
      const created = store.create(makeCreateInput())

      const updated = store.update(created.fileId, {})

      expect(updated).toBeDefined()
      expect(updated!.fileId).toBe(created.fileId)
    })

    it('returns undefined for non-existent fileId', () => {
      const updated = store.update('non-existent', { originalFilename: 'x' })

      expect(updated).toBeUndefined()
    })
  })

  describe('markDeleted', () => {
    it('soft-deletes a file record', () => {
      const created = store.create(makeCreateInput())

      const result = store.markDeleted(created.fileId)

      expect(result).toBe(true)

      const found = store.getById(created.fileId, { userId: 'user-1' })
      expect(found).toBeDefined()
      expect(found!.status).toBe('deleted')
      expect(found!.deletedAt).toBeDefined()
    })

    it('returns false for non-existent fileId', () => {
      const result = store.markDeleted('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('delete', () => {
    it('hard-deletes a file record', () => {
      const created = store.create(makeCreateInput())

      const result = store.delete(created.fileId)

      expect(result).toBe(true)

      const found = store.getById(created.fileId, { userId: 'user-1' })
      expect(found).toBeUndefined()
    })

    it('returns true even for non-existent fileId (idempotent)', () => {
      const result = store.delete('non-existent')

      expect(result).toBe(true)
    })
  })

  describe('cross-user access', () => {
    it('prevents user A from accessing user B files via getById', () => {
      const fileA = store.create(makeCreateInput({ userId: 'alice', sessionId: 'sess-alice' }))

      const found = store.getById(fileA.fileId, { userId: 'bob' })

      expect(found).toBeUndefined()
    })

    it('prevents session A from seeing session B files via listBySession', () => {
      store.create(makeCreateInput({ sessionId: 'sess-1' }))
      store.create(makeCreateInput({ sessionId: 'sess-2' }))

      const sess1Files = store.listBySession('sess-1')
      const sess2Files = store.listBySession('sess-2')

      expect(sess1Files).toHaveLength(1)
      expect(sess2Files).toHaveLength(1)
      expect(sess1Files[0]!.sessionId).toBe('sess-1')
      expect(sess2Files[0]!.sessionId).toBe('sess-2')
    })

    it('allows access via sessionId even for different userId', () => {
      const created = store.create(makeCreateInput({ userId: 'alice', sessionId: 'shared-sess' }))

      const found = store.getById(created.fileId, { sessionId: 'shared-sess' })

      expect(found).toBeDefined()
      expect(found!.fileId).toBe(created.fileId)
    })
  })
})
