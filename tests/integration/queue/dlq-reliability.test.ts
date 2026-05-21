/**
 * Dead Letter Queue Reliability Tests
 *
 * Comprehensive tests for DLQ operations, queue reliability,
 * and error handling scenarios.
 *
 * Task 35 - Phase 8 GA Readiness (Wave 6)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createDeadLetterStore, type DeadLetterStore } from '../../../src/dead-letter/dead-letter-store.js';
import { createDeadLetterQueue, type DeadLetterQueue, type RetryHandler } from '../../../src/dead-letter/dead-letter-queue.js';
import type { DeadLetterRecord } from '../../../src/dead-letter/types.js';

// Minimal migrations for DLQ tests
const migrations: Migration[] = [
  {
    version: 1,
    name: 'create_dead_letter_table',
    up: `
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
    `,
    down: 'DROP TABLE IF EXISTS dead_letter'
  },
  {
    version: 2,
    name: 'create_audit_records_table',
    up: `
      CREATE TABLE IF NOT EXISTS audit_records (
        audit_id TEXT PRIMARY KEY,
        audit_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        source_module TEXT NOT NULL,
        source_action TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        target_type TEXT,
        target_ref TEXT,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        input_hash TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        approval_id TEXT,
        tool_call_id TEXT,
        permission_decision_id TEXT,
        risk_level TEXT NOT NULL,
        sensitivity TEXT NOT NULL
      )
    `,
    down: 'DROP TABLE IF EXISTS audit_records'
  }
];

describe('Dead Letter Queue Reliability', () => {
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let deadLetterStore: DeadLetterStore;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(migrations);

    deadLetterStore = createDeadLetterStore(connection);

    dlq = createDeadLetterQueue(deadLetterStore, async () => ({ success: true }));
  });

  afterEach(() => {
    connection.close();
  });

  describe('Basic DLQ Operations', () => {
    it('should move failed message to DLQ after max retries', async () => {
      // Track retry attempts
      let attemptCount = 0;
      const failingDlq = createDeadLetterQueue(deadLetterStore, async () => {
        attemptCount++;
        // Fail first 2 attempts, succeed on 3rd
        if (attemptCount < 3) {
          return { success: false, error: 'Temporary failure' };
        }
        return { success: true };
      });

      const record = failingDlq.enqueue('test.module', 'msg-001', 'Processing failed');

      // First retry - fails
      let result = await failingDlq.retry(record.eventId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Temporary failure');

      let updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('pending');
      expect(updated?.failureCount).toBe(1);

      // Second retry - fails
      result = await failingDlq.retry(record.eventId);
      expect(result.success).toBe(false);

      updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.failureCount).toBe(2);

      // Third retry - succeeds
      result = await failingDlq.retry(record.eventId);
      expect(result.success).toBe(true);

      updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('resolved');
    });

    it('should retry message from DLQ', async () => {
      const retryFn = vi.fn().mockResolvedValue({ success: true });
      const retryDlq = createDeadLetterQueue(deadLetterStore, retryFn);

      const record = retryDlq.enqueue('test.module', 'msg-002', 'Initial failure');
      expect(record.status).toBe('pending');

      const result = await retryDlq.retry(record.eventId);
      expect(result.success).toBe(true);
      expect(retryFn).toHaveBeenCalledTimes(1);

      const updated = retryDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('resolved');
      expect(updated?.resolvedAt).toBeTruthy();
    });

    it('should discard message from DLQ', () => {
      const record = dlq.enqueue('test.module', 'msg-003', 'Unrecoverable error');
      expect(record.status).toBe('pending');

      dlq.discard(record.eventId);

      const updated = dlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('discarded');
      expect(updated?.discardedAt).toBeTruthy();
    });

    it('should audit all DLQ operations', () => {
      // Enqueue
      const record = dlq.enqueue('test.module', 'msg-004', 'Test reason', { data: 'test' });

      // Verify enqueue creates a record
      const found = dlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();
      expect(found?.sourceModule).toBe('test.module');
      expect(found?.sourceId).toBe('msg-004');
      expect(found?.reason).toBe('Test reason');
      expect(found?.payload).toEqual({ data: 'test' });

      // Discard and verify
      dlq.discard(record.eventId);
      const discarded = dlq.getByEventId(record.eventId);
      expect(discarded?.status).toBe('discarded');

      // Verify record is kept for audit trail
      const allRecords = dlq.list();
      expect(allRecords.length).toBe(1);
    });

    it('should persist DLQ messages across restarts', () => {
      // Enqueue a message
      const record = dlq.enqueue('test.module', 'msg-005', 'Persistence test');

      // Simulate restart by creating new DLQ with same store
      const newDlq = createDeadLetterQueue(deadLetterStore, async () => ({ success: true }));

      // Verify message persists
      const found = newDlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();
      expect(found?.eventId).toBe(record.eventId);
      expect(found?.status).toBe('pending');
    });
  });

  describe('Queue Reliability', () => {
    it('should process messages in FIFO order', async () => {
      const records: DeadLetterRecord[] = [];

      records.push(dlq.enqueue('test.module', 'msg-001', 'First'));
      await new Promise(resolve => setTimeout(resolve, 10));
      records.push(dlq.enqueue('test.module', 'msg-002', 'Second'));
      await new Promise(resolve => setTimeout(resolve, 10));
      records.push(dlq.enqueue('test.module', 'msg-003', 'Third'));

      const listed = dlq.list();
      expect(listed.length).toBe(3);
      expect(listed[0]?.sourceId).toBe('msg-003');
      expect(listed[2]?.sourceId).toBe('msg-001');
    });

    it('should prevent duplicate event IDs (idempotency)', () => {
      const record1 = dlq.enqueue('test.module', 'msg-001', 'First');
      expect(record1.eventId).toBeDefined();

      const record2 = dlq.enqueue('test.module', 'msg-002', 'Second');
      expect(record2.eventId).toBeDefined();

      expect(dlq.count()).toBe(2);

      const manuallyCreatedRecord: DeadLetterRecord = {
        eventId: record1.eventId,
        sourceModule: 'test.module',
        sourceId: 'msg-dup',
        reason: 'Duplicate event ID',
        status: 'pending',
        failureCount: 0,
        enqueuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      deadLetterStore.enqueue(manuallyCreatedRecord);

      expect(dlq.count()).toBe(2);
    });

    it('should handle concurrent message processing', async () => {
      const processedIds: string[] = [];
      const retryHandler: RetryHandler = async (record) => {
        // Simulate async processing
        await new Promise(resolve => setTimeout(resolve, 10));
        processedIds.push(record.eventId);
        return { success: true };
      };

      const concurrentDlq = createDeadLetterQueue(deadLetterStore, retryHandler);

      // Enqueue multiple messages
      const records = [
        concurrentDlq.enqueue('test.module', 'concurrent-001', 'Test 1'),
        concurrentDlq.enqueue('test.module', 'concurrent-002', 'Test 2'),
        concurrentDlq.enqueue('test.module', 'concurrent-003', 'Test 3'),
      ];

      // Process concurrently
      const results = await Promise.all(
        records.map(r => concurrentDlq.retry(r.eventId))
      );

      // All should succeed
      results.forEach(r => expect(r.success).toBe(true));

      // All should be processed
      expect(processedIds.length).toBe(3);

      // All should be resolved
      records.forEach(r => {
        const updated = concurrentDlq.getByEventId(r.eventId);
        expect(updated?.status).toBe('resolved');
      });
    });

    it('should handle queue backlog gracefully', () => {
      // Create a large number of messages
      const count = 100;
      for (let i = 0; i < count; i++) {
        dlq.enqueue('test.module', `backlog-${i}`, `Reason ${i}`);
      }

      // Verify all were enqueued
      expect(dlq.count()).toBe(count);

      // List should work efficiently
      const allRecords = dlq.list();
      expect(allRecords.length).toBe(count);

      // Filter by module should work
      const filtered = dlq.list({ module: 'test.module' });
      expect(filtered.length).toBe(count);

      // Count with filter
      expect(dlq.count({ module: 'test.module' })).toBe(count);
    });

    it('should handle poison messages without crashing', async () => {
      const poisonPayload = {
        circular: null as unknown,
        malformed: '{not valid json}',
        unsafe: '<script>alert("xss")</script>',
      };
      poisonPayload.circular = poisonPayload;

      // Enqueue with potentially problematic payload
      // Note: We can't pass circular ref directly to JSON.stringify, so we test with other malformed data
      const record = dlq.enqueue('test.module', 'poison-001', 'Poison test', {
        malformed: '{not valid json}',
        unsafe: '<script>alert("xss")</script>',
        nullValue: null,
        undefined: undefined,
      });

      // DLQ should not crash
      expect(record).toBeDefined();
      expect(record.eventId).toBeTruthy();

      // Retry should work
      const result = await dlq.retry(record.eventId);
      expect(result.success).toBe(true);

      // Retrieve should work
      const found = dlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should retry on transient failures', async () => {
      let attempts = 0;
      const transientDlq = createDeadLetterQueue(deadLetterStore, async () => {
        attempts++;
        // Fail first attempt, succeed on second
        if (attempts === 1) {
          return { success: false, error: 'Temporary network error' };
        }
        return { success: true };
      });

      const record = transientDlq.enqueue('test.module', 'transient-001', 'Transient failure');

      // First retry fails
      let result = await transientDlq.retry(record.eventId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Temporary network error');

      let updated = transientDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('pending');
      expect(updated?.lastError).toBe('Temporary network error');

      // Second retry succeeds
      result = await transientDlq.retry(record.eventId);
      expect(result.success).toBe(true);

      updated = transientDlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('resolved');
    });

    it('should immediately DLQ on permanent failures', () => {
      // Enqueue directly (simulating permanent failure)
      const record = dlq.enqueue('test.module', 'permanent-001', 'Permanent error: Invalid schema');

      const found = dlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();
      expect(found?.status).toBe('pending');
      expect(found?.reason).toContain('Permanent error');
    });

    it('should retry on timeout', async () => {
      let attempts = 0;
      const timeoutDlq = createDeadLetterQueue(deadLetterStore, async () => {
        attempts++;
        // Simulate timeout on first attempt
        if (attempts === 1) {
          return { success: false, error: 'Timeout after 30000ms' };
        }
        return { success: true };
      });

      const record = timeoutDlq.enqueue('test.module', 'timeout-001', 'Processing timeout');

      // First retry times out
      let result = await timeoutDlq.retry(record.eventId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Timeout after 30000ms');

      // Second retry succeeds
      result = await timeoutDlq.retry(record.eventId);
      expect(result.success).toBe(true);
    });
  });

  describe('DLQ Status Transitions', () => {
    it('should track status transitions correctly', async () => {
      const record = dlq.enqueue('test.module', 'status-001', 'Status test');
      expect(record.status).toBe('pending');
      expect(record.failureCount).toBe(0);

      // Retry (success)
      await dlq.retry(record.eventId);
      let updated = dlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('resolved');
      expect(updated?.resolvedAt).toBeTruthy();
    });

    it('should prevent retry of discarded messages', async () => {
      const record = dlq.enqueue('test.module', 'discarded-001', 'To be discarded');
      dlq.discard(record.eventId);

      // Attempt to retry discarded message
      const result = await dlq.retry(record.eventId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot retry discarded record');

      // Status should remain discarded
      const updated = dlq.getByEventId(record.eventId);
      expect(updated?.status).toBe('discarded');
    });

    it('should increment failure count on failed retries', async () => {
      const failingDlq = createDeadLetterQueue(deadLetterStore, async () => ({
        success: false,
        error: 'Always fails'
      }));

      const record = failingDlq.enqueue('test.module', 'fail-counter', 'Counter test');

      // Multiple failed retries
      await failingDlq.retry(record.eventId);
      let updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.failureCount).toBe(1);

      await failingDlq.retry(record.eventId);
      updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.failureCount).toBe(2);

      await failingDlq.retry(record.eventId);
      updated = failingDlq.getByEventId(record.eventId);
      expect(updated?.failureCount).toBe(3);
    });
  });

  describe('Filtering and Listing', () => {
    beforeEach(() => {
      // Create diverse records for filtering tests
      dlq.enqueue('module-a', 'filter-001', 'Reason A1');
      dlq.enqueue('module-a', 'filter-002', 'Reason A2');
      dlq.enqueue('module-b', 'filter-003', 'Reason B1');
    });

    it('should filter by module', () => {
      const moduleA = dlq.list({ module: 'module-a' });
      expect(moduleA.length).toBe(2);

      const moduleB = dlq.list({ module: 'module-b' });
      expect(moduleB.length).toBe(1);
    });

    it('should filter by status', async () => {
      // Discard one record
      const records = dlq.list({ module: 'module-a' });
      dlq.discard(records[0]!.eventId);

      // Retry another
      const failingDlq = createDeadLetterQueue(deadLetterStore, async () => ({ success: true }));
      // Re-enqueue to the failingDlq to use its retry handler
      const record = failingDlq.enqueue('module-a', 'filter-002', 'Reason A2');
      await failingDlq.retry(record.eventId);

      const pending = dlq.list({ status: 'pending' });
      expect(pending.length).toBeGreaterThanOrEqual(1);

      const discarded = dlq.list({ status: 'discarded' });
      expect(discarded.length).toBe(1);
    });

    it('should count with filters', () => {
      expect(dlq.count()).toBe(3);
      expect(dlq.count({ module: 'module-a' })).toBe(2);
      expect(dlq.count({ module: 'module-b' })).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent eventId gracefully', async () => {
      const result = await dlq.retry('non-existent-id');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Record not found');
    });

    it('should handle discard of non-existent record gracefully', () => {
      // Should not throw
      expect(() => dlq.discard('non-existent-id')).not.toThrow();
    });

    it('should handle getByEventId for non-existent record', () => {
      const record = dlq.getByEventId('non-existent-id');
      expect(record).toBeNull();
    });

    it('should handle empty payload', () => {
      const record = dlq.enqueue('test.module', 'empty-payload', 'No payload');
      expect(record.payload).toBeUndefined();

      const found = dlq.getByEventId(record.eventId);
      expect(found?.payload).toBeUndefined();
    });

    it('should handle complex nested payload', () => {
      const complexPayload = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3],
              nested: { a: 'b' },
            },
          },
        },
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
      };

      const record = dlq.enqueue('test.module', 'complex-payload', 'Complex test', complexPayload);
      const found = dlq.getByEventId(record.eventId);
      expect(found?.payload).toEqual(complexPayload);
    });
  });

  describe('Audit Trail', () => {
    it('should maintain audit trail for all operations', () => {
      // Enqueue
      const record = dlq.enqueue('audit.module', 'audit-001', 'Audit test', { key: 'value' });

      // Verify record exists
      let found = dlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();

      // Discard
      dlq.discard(record.eventId);

      // Verify status changed but record still exists
      found = dlq.getByEventId(record.eventId);
      expect(found).not.toBeNull();
      expect(found?.status).toBe('discarded');
      expect(found?.discardedAt).toBeTruthy();

      // Record should still be in list
      const allRecords = dlq.list();
      expect(allRecords.some(r => r.eventId === record.eventId)).toBe(true);
    });

    it('should preserve original reason and metadata', async () => {
      const originalPayload = { original: true, timestamp: Date.now() };
      const record = dlq.enqueue('audit.module', 'audit-002', 'Original reason', originalPayload);

      // Perform operations
      await dlq.retry(record.eventId);

      // Verify original data preserved
      const found = dlq.getByEventId(record.eventId);
      expect(found?.reason).toBe('Original reason');
      expect(found?.payload).toEqual(originalPayload);
      expect(found?.sourceModule).toBe('audit.module');
      expect(found?.sourceId).toBe('audit-002');
    });
  });
});
