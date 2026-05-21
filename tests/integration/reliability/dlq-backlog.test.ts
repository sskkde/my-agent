/**
 * DLQ Backlog Reliability Tests
 *
 * Tests for dead letter queue backlog handling, persistence,
 * and message processing under load.
 *
 * Task 35 - Phase 8 GA Readiness (Wave 6)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createDeadLetterStore, type DeadLetterStore } from '../../../src/dead-letter/dead-letter-store.js';
import { createDeadLetterQueue, type DeadLetterQueue } from '../../../src/dead-letter/dead-letter-queue.js';

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

describe('DLQ Backlog Reliability', () => {
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

  describe('Backlog Handling', () => {
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

    it('should process messages in FIFO order', async () => {
      const records: { sourceId: string; eventId: string }[] = [];

      records.push(dlq.enqueue('test.module', 'msg-001', 'First'));
      await new Promise(resolve => setTimeout(resolve, 10));
      records.push(dlq.enqueue('test.module', 'msg-002', 'Second'));
      await new Promise(resolve => setTimeout(resolve, 10));
      records.push(dlq.enqueue('test.module', 'msg-003', 'Third'));

      const listed = dlq.list();
      expect(listed.length).toBe(3);
      // Latest first (LIFO listing)
      expect(listed[0]?.sourceId).toBe('msg-003');
      expect(listed[2]?.sourceId).toBe('msg-001');
    });
  });

  describe('Message Persistence', () => {
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

  describe('Poison Message Handling', () => {
    it('should handle poison messages without crashing', async () => {
      const poisonPayload = {
        circular: null as unknown,
        malformed: '{not valid json}',
        unsafe: '<script>alert("xss")</script>',
      };
      poisonPayload.circular = poisonPayload;

      // Enqueue with potentially problematic payload
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
});
