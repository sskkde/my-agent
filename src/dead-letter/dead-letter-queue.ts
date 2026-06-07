import type { DeadLetterStore } from './dead-letter-store.js'
import type { DeadLetterRecord, DeadLetterListFilters, RetryResult } from './types.js'
import { generateId } from '../shared/ids.js'

export type RetryHandler = (record: DeadLetterRecord) => Promise<RetryResult>

export interface DeadLetterQueue {
  enqueue(sourceModule: string, sourceId: string, reason: string, payload?: Record<string, unknown>): DeadLetterRecord
  list(filters?: DeadLetterListFilters): DeadLetterRecord[]
  retry(eventId: string): Promise<RetryResult>
  discard(eventId: string): void
  getByEventId(eventId: string): DeadLetterRecord | null
  count(filters?: DeadLetterListFilters): number
}

class DeadLetterQueueImpl implements DeadLetterQueue {
  private store: DeadLetterStore
  private retryHandler: RetryHandler

  constructor(store: DeadLetterStore, retryHandler: RetryHandler) {
    this.store = store
    this.retryHandler = retryHandler
  }

  enqueue(sourceModule: string, sourceId: string, reason: string, payload?: Record<string, unknown>): DeadLetterRecord {
    const now = new Date().toISOString()
    const record: DeadLetterRecord = {
      eventId: generateId('dlq_'),
      sourceModule,
      sourceId,
      reason,
      payload,
      status: 'pending',
      failureCount: 0,
      enqueuedAt: now,
      updatedAt: now,
    }

    this.store.enqueue(record)
    return record
  }

  list(filters?: DeadLetterListFilters): DeadLetterRecord[] {
    return this.store.list(filters)
  }

  async retry(eventId: string): Promise<RetryResult> {
    const record = this.store.findByEventId(eventId)
    if (!record) {
      return { success: false, error: 'Record not found' }
    }

    if (record.status === 'discarded') {
      return { success: false, error: 'Cannot retry discarded record' }
    }

    this.store.updateStatus(eventId, 'retrying')

    try {
      const result = await this.retryHandler(record)

      if (result.success) {
        this.store.updateStatus(eventId, 'resolved')
        return { success: true }
      }

      this.store.updateStatus(eventId, 'pending', result.error)
      return result
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.store.updateStatus(eventId, 'pending', errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  discard(eventId: string): void {
    const record = this.store.findByEventId(eventId)
    if (!record) {
      return
    }

    this.store.updateStatus(eventId, 'discarded')
  }

  getByEventId(eventId: string): DeadLetterRecord | null {
    return this.store.findByEventId(eventId)
  }

  count(filters?: DeadLetterListFilters): number {
    return this.store.count(filters)
  }
}

export function createDeadLetterQueue(store: DeadLetterStore, retryHandler: RetryHandler): DeadLetterQueue {
  return new DeadLetterQueueImpl(store, retryHandler)
}
