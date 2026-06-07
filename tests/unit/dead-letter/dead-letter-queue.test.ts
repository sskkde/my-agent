import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createDeadLetterStore } from '../../../src/dead-letter/dead-letter-store.js'
import { createDeadLetterQueue } from '../../../src/dead-letter/dead-letter-queue.js'
import type { ConnectionManager } from '../../../src/storage/connection.js'
import type { DeadLetterStore } from '../../../src/dead-letter/dead-letter-store.js'
import type { DeadLetterQueue, RetryHandler } from '../../../src/dead-letter/dead-letter-queue.js'

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS dead_letter (
    event_id TEXT PRIMARY KEY,
    source_module TEXT NOT NULL,
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'retrying', 'discarded', 'resolved')),
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    enqueued_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    discarded_at TEXT,
    resolved_at TEXT
  )
`

describe('DeadLetterQueue', () => {
  let connection: ConnectionManager
  let store: DeadLetterStore
  let queue: DeadLetterQueue
  let retryHandler: Mock<RetryHandler>

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    connection.exec(CREATE_TABLE_SQL)
    store = createDeadLetterStore(connection)
    retryHandler = vi.fn<RetryHandler>()
    queue = createDeadLetterQueue(store, retryHandler)
  })

  afterEach(() => {
    connection.close()
  })

  describe('enqueue', () => {
    it('should create a record with correct fields', () => {
      const record = queue.enqueue('trigger.webhook', 'webhook-1', 'Signature mismatch', {
        eventType: 'test',
      })

      expect(record.eventId).toBeTruthy()
      expect(record.sourceModule).toBe('trigger.webhook')
      expect(record.sourceId).toBe('webhook-1')
      expect(record.reason).toBe('Signature mismatch')
      expect(record.payload).toEqual({ eventType: 'test' })
      expect(record.status).toBe('pending')
      expect(record.failureCount).toBe(0)
      expect(record.enqueuedAt).toBeTruthy()
      expect(record.updatedAt).toBeTruthy()
    })

    it('should persist record to store', () => {
      const record = queue.enqueue('trigger.webhook', 'webhook-1', 'Error')

      const found = store.findByEventId(record.eventId)
      expect(found).not.toBeNull()
      expect(found?.sourceModule).toBe('trigger.webhook')
      expect(found?.sourceId).toBe('webhook-1')
    })

    it('should set enqueuedAt and updatedAt timestamps', () => {
      const record = queue.enqueue('test.module', 'id-1', 'reason')

      expect(record.enqueuedAt).toBeTruthy()
      expect(record.updatedAt).toBeTruthy()
      expect(new Date(record.enqueuedAt).getTime()).toBeGreaterThan(0)
    })
  })

  describe('list', () => {
    it('should return all records when no filters', () => {
      queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-b', 'id-2', 'reason 2')

      const records = queue.list()
      expect(records.length).toBe(2)
    })

    it('should filter by module', () => {
      queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-a', 'id-2', 'reason 2')
      queue.enqueue('module-b', 'id-3', 'reason 3')

      const records = queue.list({ module: 'module-a' })
      expect(records.length).toBe(2)
      expect(records.every((r) => r.sourceModule === 'module-a')).toBe(true)
    })

    it('should filter by status', () => {
      const r1 = queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.discard(r1.eventId)

      const pending = queue.list({ status: 'pending' })
      const discarded = queue.list({ status: 'discarded' })

      expect(pending.length).toBe(0)
      expect(discarded.length).toBe(1)
    })

    it('should filter by both module and status', () => {
      const r1 = queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-b', 'id-2', 'reason 2')
      queue.discard(r1.eventId)

      const filtered = queue.list({ module: 'module-a', status: 'discarded' })
      expect(filtered.length).toBe(1)
      expect(filtered[0]?.sourceModule).toBe('module-a')
    })
  })

  describe('retry', () => {
    it('should re-dispatch via callback on success', async () => {
      retryHandler.mockResolvedValue({ success: true })

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      const result = await queue.retry(record.eventId)

      expect(result.success).toBe(true)
      expect(retryHandler).toHaveBeenCalledTimes(1)
    })

    it('should mark record as resolved on success', async () => {
      retryHandler.mockResolvedValue({ success: true })

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      await queue.retry(record.eventId)

      const updated = queue.getByEventId(record.eventId)
      expect(updated?.status).toBe('resolved')
      expect(updated?.resolvedAt).toBeTruthy()
    })

    it('should keep record after retry for audit', async () => {
      retryHandler.mockResolvedValue({ success: true })

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      await queue.retry(record.eventId)

      const exists = queue.getByEventId(record.eventId)
      expect(exists).not.toBeNull()
    })

    it('should remain pending on failure', async () => {
      retryHandler.mockResolvedValue({ success: false, error: 'Still failing' })

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      const result = await queue.retry(record.eventId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Still failing')

      const updated = queue.getByEventId(record.eventId)
      expect(updated?.status).toBe('pending')
      expect(updated?.lastError).toBe('Still failing')
    })

    it('should increment failure count on retry', async () => {
      retryHandler.mockResolvedValue({ success: false, error: 'Fail' })

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      await queue.retry(record.eventId)

      const updated = queue.getByEventId(record.eventId)
      expect(updated?.failureCount).toBe(1)
    })

    it('should return error for non-existent record', async () => {
      const result = await queue.retry('non-existent')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Record not found')
    })

    it('should not retry discarded records', async () => {
      const record = queue.enqueue('module-a', 'id-1', 'reason')
      queue.discard(record.eventId)

      const result = await queue.retry(record.eventId)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Cannot retry discarded record')
    })

    it('should handle handler throwing an error', async () => {
      retryHandler.mockRejectedValue(new Error('Boom'))

      const record = queue.enqueue('module-a', 'id-1', 'reason')
      const result = await queue.retry(record.eventId)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Boom')

      const updated = queue.getByEventId(record.eventId)
      expect(updated?.status).toBe('pending')
      expect(updated?.lastError).toBe('Boom')
    })
  })

  describe('discard', () => {
    it('should mark record as discarded', () => {
      const record = queue.enqueue('module-a', 'id-1', 'reason')
      queue.discard(record.eventId)

      const updated = queue.getByEventId(record.eventId)
      expect(updated?.status).toBe('discarded')
      expect(updated?.discardedAt).toBeTruthy()
    })

    it('should be no-op for non-existent records', () => {
      expect(() => queue.discard('non-existent')).not.toThrow()
    })

    it('should keep discarded records for audit', () => {
      const record = queue.enqueue('module-a', 'id-1', 'reason')
      queue.discard(record.eventId)

      const exists = queue.getByEventId(record.eventId)
      expect(exists).not.toBeNull()
    })
  })

  describe('idempotency', () => {
    it('should reject duplicate eventId at store level', () => {
      const now = new Date().toISOString()
      store.enqueue({
        eventId: 'idempotent-key-1',
        sourceModule: 'module-a',
        sourceId: 'id-1',
        reason: 'reason',
        status: 'pending',
        failureCount: 0,
        enqueuedAt: now,
        updatedAt: now,
      })

      store.enqueue({
        eventId: 'idempotent-key-1',
        sourceModule: 'module-a',
        sourceId: 'id-2',
        reason: 'duplicate',
        status: 'pending',
        failureCount: 0,
        enqueuedAt: now,
        updatedAt: now,
      })

      const found = store.findByEventId('idempotent-key-1')
      expect(found).not.toBeNull()
      expect(found?.sourceId).toBe('id-1')
      expect(queue.count()).toBe(1)
    })
  })

  describe('getByEventId', () => {
    it('should return record by eventId', () => {
      const record = queue.enqueue('module-a', 'id-1', 'reason')
      const found = queue.getByEventId(record.eventId)
      expect(found).not.toBeNull()
      expect(found?.eventId).toBe(record.eventId)
    })

    it('should return null for non-existent eventId', () => {
      const found = queue.getByEventId('non-existent')
      expect(found).toBeNull()
    })
  })

  describe('count', () => {
    it('should count all records', () => {
      queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-b', 'id-2', 'reason 2')

      expect(queue.count()).toBe(2)
    })

    it('should count filtered by module', () => {
      queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-b', 'id-2', 'reason 2')

      expect(queue.count({ module: 'module-a' })).toBe(1)
    })

    it('should count filtered by status', () => {
      const r1 = queue.enqueue('module-a', 'id-1', 'reason 1')
      queue.enqueue('module-b', 'id-2', 'reason 2')
      queue.discard(r1.eventId)

      expect(queue.count({ status: 'discarded' })).toBe(1)
      expect(queue.count({ status: 'pending' })).toBe(1)
    })
  })
})
