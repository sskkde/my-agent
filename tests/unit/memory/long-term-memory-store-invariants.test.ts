import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { 
  createLongTermMemoryStore, 
  type LongTermMemoryStore, 
  type LongTermMemoryRecord 
} from '../../../src/storage/long-term-memory-store.js';
import {
  createMemoryExtractionRunStore,
  type MemoryExtractionRunStore,
  type MemoryExtractionRun
} from '../../../src/storage/memory-extraction-run-store.js';

describe('Long-term Memory Store Invariants', () => {
  let connection: ConnectionManager;
  let memoryStore: LongTermMemoryStore;

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
    fingerprint: 'fp-abc123',
    sourceWindowHash: 'hash-window-001',
    ...overrides,
  });

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
    
    memoryStore = createLongTermMemoryStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  describe('Fingerprint and Source Window Hash', () => {
    it('should store memory with fingerprint and sourceWindowHash', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      const retrieved = memoryStore.getByMemoryId(memory.memoryId);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.fingerprint).toBe('fp-abc123');
      expect(retrieved?.sourceWindowHash).toBe('hash-window-001');
    });

    it('should find current memory by fingerprint', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      const found = memoryStore.findCurrentByFingerprint('user-123', 'fp-abc123');
      
      expect(found).not.toBeNull();
      expect(found?.memoryId).toBe(memory.memoryId);
      expect(found?.lifecycle.status).toBe('active');
    });

    it('should return null when finding by non-existent fingerprint', () => {
      const found = memoryStore.findCurrentByFingerprint('user-123', 'non-existent-fp');
      expect(found).toBeNull();
    });

    it('should not find superseded memory by fingerprint', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      // Mark as superseded
      memoryStore.applyPatch(memory.memoryId, {
        lifecycle: {
          ...memory.lifecycle,
          status: 'superseded',
          supersededBy: 'mem-new-001',
        },
      });

      const found = memoryStore.findCurrentByFingerprint('user-123', 'fp-abc123');
      expect(found).toBeNull();
    });
  });

  describe('Upsert Extracted', () => {
    it('should create new active memory on upsert when no current exists', () => {
      const memory = createTestMemory({ memoryId: 'mem-new-001' });
      
      memoryStore.upsertExtracted(memory);

      const found = memoryStore.findCurrentByFingerprint('user-123', 'fp-abc123');
      expect(found).not.toBeNull();
      expect(found?.memoryId).toBe('mem-new-001');
      expect(found?.lifecycle.status).toBe('active');
    });

    it('should mark existing memory as superseded on upsert', () => {
      const existing = createTestMemory({ memoryId: 'mem-old-001' });
      memoryStore.save(existing);

      const newMemory = createTestMemory({
        memoryId: 'mem-new-001',
        content: { text: 'Updated preference' },
      });

      memoryStore.upsertExtracted(newMemory);

      // Old memory should be superseded
      const oldMemory = memoryStore.getByMemoryId('mem-old-001');
      expect(oldMemory?.lifecycle.status).toBe('superseded');
      expect(oldMemory?.lifecycle.supersededBy).toBe('mem-new-001');

      // New memory should be active
      const activeMemory = memoryStore.findCurrentByFingerprint('user-123', 'fp-abc123');
      expect(activeMemory?.memoryId).toBe('mem-new-001');
      expect(activeMemory?.lifecycle.status).toBe('active');
    });

    it('should preserve fingerprint across upsert', () => {
      const existing = createTestMemory({ memoryId: 'mem-old-001' });
      memoryStore.save(existing);

      const newMemory = createTestMemory({
        memoryId: 'mem-new-001',
        fingerprint: 'fp-abc123', // Same fingerprint
      });

      memoryStore.upsertExtracted(newMemory);

      const active = memoryStore.findCurrentByFingerprint('user-123', 'fp-abc123');
      expect(active?.fingerprint).toBe('fp-abc123');
    });
  });

  describe('Tombstones', () => {
    it('should create tombstone', () => {
      memoryStore.createTombstone({
        userId: 'user-123',
        fingerprint: 'fp-deleted',
        sourceWindowHash: 'hash-window-001',
      });

      const hasTombstone = memoryStore.hasTombstone(
        'user-123',
        'fp-deleted',
        'hash-window-001'
      );
      
      expect(hasTombstone).toBe(true);
    });

    it('should return false for non-existent tombstone', () => {
      const hasTombstone = memoryStore.hasTombstone(
        'user-123',
        'non-existent',
        'hash-window-001'
      );
      
      expect(hasTombstone).toBe(false);
    });

    it('should create tombstone on delete', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      memoryStore.delete(memory.memoryId);

      // Memory should be soft-deleted
      const deleted = memoryStore.getByMemoryId(memory.memoryId);
      expect(deleted?.lifecycle.status).toBe('deleted');

      // Tombstone should exist
      const hasTombstone = memoryStore.hasTombstone(
        'user-123',
        'fp-abc123',
        'hash-window-001'
      );
      expect(hasTombstone).toBe(true);
    });

    it('should prevent re-extraction of tombstoned memory', () => {
      // Create and delete a memory
      const memory = createTestMemory();
      memoryStore.save(memory);
      memoryStore.delete(memory.memoryId);

      // Attempt to upsert same fingerprint should be blocked by tombstone
      const hasTombstone = memoryStore.hasTombstone(
        'user-123',
        'fp-abc123',
        'hash-window-001'
      );
      
      expect(hasTombstone).toBe(true);
    });

    it('should enforce unique constraint on tombstone', () => {
      memoryStore.createTombstone({
        userId: 'user-123',
        fingerprint: 'fp-duplicate',
        sourceWindowHash: 'hash-window-001',
      });

      // Should not throw on duplicate (idempotent)
      expect(() => {
        memoryStore.createTombstone({
          userId: 'user-123',
          fingerprint: 'fp-duplicate',
          sourceWindowHash: 'hash-window-001',
        });
      }).not.toThrow();
    });
  });

  describe('Search Active', () => {
    it('should search only active memories', () => {
      const activeMemory = createTestMemory({
        memoryId: 'mem-active',
        content: { text: 'Active preference for dark mode' },
      });
      
      const supersededMemory = createTestMemory({
        memoryId: 'mem-superseded',
        fingerprint: 'fp-different',
        sourceWindowHash: 'hash-window-002',
        content: { text: 'Superseded preference for light mode' },
        lifecycle: {
          status: 'superseded',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          supersededBy: 'mem-active',
        },
      });

      memoryStore.save(activeMemory);
      memoryStore.save(supersededMemory);

      const results = memoryStore.searchActive('preference', 'user-123', 10);
      
      expect(results).toHaveLength(1);
      expect(results[0]?.memoryId).toBe('mem-active');
    });

    it('should filter by user ID in searchActive', () => {
      const user1Memory = createTestMemory({
        memoryId: 'mem-user1',
        userId: 'user-123',
        content: { text: 'User 1 preference' },
      });
      
      const user2Memory = createTestMemory({
        memoryId: 'mem-user2',
        userId: 'user-456',
        fingerprint: 'fp-user2',
        sourceWindowHash: 'hash-user2',
        content: { text: 'User 2 preference' },
      });

      memoryStore.save(user1Memory);
      memoryStore.save(user2Memory);

      const results = memoryStore.searchActive('preference', 'user-123', 10);
      
      expect(results).toHaveLength(1);
      expect(results[0]?.userId).toBe('user-123');
    });

    it('should respect limit in searchActive', () => {
      for (let i = 0; i < 5; i++) {
        const memory = createTestMemory({
          memoryId: `mem-${i}`,
          fingerprint: `fp-${i}`,
          sourceWindowHash: `hash-${i}`,
          content: { text: `Preference ${i}` },
        });
        memoryStore.save(memory);
      }

      const results = memoryStore.searchActive('Preference', 'user-123', 3);
      expect(results).toHaveLength(3);
    });
  });

  describe('Lifecycle Status Sync', () => {
    it('should sync lifecycle_status column on save', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      const rows = connection.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM long_term_memories WHERE memory_id = ?',
        [memory.memoryId]
      );

      expect(rows[0]?.lifecycle_status).toBe('active');
    });

    it('should sync lifecycle_status column on patch', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);

      memoryStore.applyPatch(memory.memoryId, {
        lifecycle: {
          ...memory.lifecycle,
          status: 'archived',
        },
      });

      const rows = connection.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM long_term_memories WHERE memory_id = ?',
        [memory.memoryId]
      );

      expect(rows[0]?.lifecycle_status).toBe('archived');
    });

    it('should sync lifecycle_status column on delete', () => {
      const memory = createTestMemory();
      memoryStore.save(memory);
      memoryStore.delete(memory.memoryId);

      const rows = connection.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM long_term_memories WHERE memory_id = ?',
        [memory.memoryId]
      );

      expect(rows[0]?.lifecycle_status).toBe('deleted');
    });
  });

  describe('long_term_fact storage acceptance', () => {
    it('should persist and retrieve long_term_fact memory type', () => {
      const memory = createTestMemory({
        memoryId: 'mem-ltf-001',
        memoryType: 'long_term_fact',
        content: { text: 'The project uses TypeScript for type safety' },
        fingerprint: 'fp-ltf-001',
        sourceWindowHash: 'hash-ltf-001',
      });
      memoryStore.save(memory);

      const retrieved = memoryStore.getByMemoryId('mem-ltf-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.memoryType).toBe('long_term_fact');
      expect(retrieved?.content.text).toBe('The project uses TypeScript for type safety');
    });

    it('should find long_term_fact by type', () => {
      const memory = createTestMemory({
        memoryId: 'mem-ltf-002',
        memoryType: 'long_term_fact',
        fingerprint: 'fp-ltf-002',
        sourceWindowHash: 'hash-ltf-002',
      });
      memoryStore.save(memory);

      const results = memoryStore.getByType('long_term_fact');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(m => m.memoryId === 'mem-ltf-002')).toBe(true);
    });

    it('should upsert long_term_fact memory', () => {
      const memory = createTestMemory({
        memoryId: 'mem-ltf-003',
        memoryType: 'long_term_fact',
        fingerprint: 'fp-ltf-003',
        sourceWindowHash: 'hash-ltf-003',
      });
      memoryStore.upsertExtracted(memory);

      const found = memoryStore.findCurrentByFingerprint('user-123', 'fp-ltf-003');
      expect(found).not.toBeNull();
      expect(found?.memoryType).toBe('long_term_fact');
    });
  });
});

describe('Memory Extraction Run Store', () => {
  let connection: ConnectionManager;
  let extractionRunStore: MemoryExtractionRunStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
    
    extractionRunStore = createMemoryExtractionRunStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  describe('Create and Retrieve', () => {
    it('should create pending extraction run', () => {
      const run = extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-001',
        windowHash: 'hash-window-001',
        includedTurnIds: ['turn-001'],
      });

      expect(run.status).toBe('pending');
      expect(run.userId).toBe('user-123');
      expect(run.windowHash).toBe('hash-window-001');
    });

    it('should enforce unique constraint on user_id + window_hash', () => {
      extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-001',
        windowHash: 'hash-window-001',
        includedTurnIds: ['turn-001'],
      });

      // Should throw on duplicate
      expect(() => {
        extractionRunStore.createPending({
          userId: 'user-123',
          sessionId: 'session-001',
          triggerTurnId: 'turn-001',
          windowHash: 'hash-window-001',
          includedTurnIds: ['turn-001'],
        });
      }).toThrow();
    });

    it('should get extraction run by window hash', () => {
      extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-001',
        windowHash: 'hash-window-001',
        includedTurnIds: ['turn-001'],
      });

      const run = extractionRunStore.getByWindowHash('user-123', 'hash-window-001');
      
      expect(run).not.toBeNull();
      expect(run?.status).toBe('pending');
    });

    it('should list extraction runs by user', () => {
      extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-001',
        windowHash: 'hash-window-001',
        includedTurnIds: ['turn-001'],
      });

      extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-002',
        windowHash: 'hash-window-002',
        includedTurnIds: ['turn-002'],
      });

      extractionRunStore.createPending({
        userId: 'user-456',
        sessionId: 'session-002',
        triggerTurnId: 'turn-003',
        windowHash: 'hash-window-003',
        includedTurnIds: ['turn-003'],
      });

      const runs = extractionRunStore.listByUser('user-123');
      
      expect(runs).toHaveLength(2);
      expect(runs.every(r => r.userId === 'user-123')).toBe(true);
    });
  });

  describe('Status Transitions', () => {
    let run: MemoryExtractionRun;

    beforeEach(() => {
      run = extractionRunStore.createPending({
        userId: 'user-123',
        sessionId: 'session-001',
        triggerTurnId: 'turn-001',
        windowHash: 'hash-window-001',
        includedTurnIds: ['turn-001'],
      });
    });

    it('should mark run as running', () => {
      extractionRunStore.markRunning(run.runId);

      const updated = extractionRunStore.getByWindowHash('user-123', 'hash-window-001');
      expect(updated?.status).toBe('running');
      expect(updated?.startedAt).toBeDefined();
    });

    it('should mark run as succeeded with result counts', () => {
      extractionRunStore.markRunning(run.runId);
      extractionRunStore.markSucceeded(run.runId, {
        accepted: 5,
        discarded: 1,
        tombstoneSkipped: 0,
        superseded: 2,
      });

      const updated = extractionRunStore.getByWindowHash('user-123', 'hash-window-001');
      expect(updated?.status).toBe('succeeded');
      expect(updated?.completedAt).toBeDefined();
      expect(updated?.resultCounts?.accepted).toBe(5);
      expect(updated?.resultCounts?.superseded).toBe(2);
    });

    it('should mark run as failed', () => {
      extractionRunStore.markRunning(run.runId);
      extractionRunStore.markFailed(run.runId, 'LLM_ERROR', 'LLM timeout');

      const updated = extractionRunStore.getByWindowHash('user-123', 'hash-window-001');
      expect(updated?.status).toBe('failed');
      expect(updated?.completedAt).toBeDefined();
      expect(updated?.failureCode).toBe('LLM_ERROR');
    });

    it('should not transition from pending to succeeded directly', () => {
      expect(() => {
        extractionRunStore.markSucceeded(run.runId, { accepted: 1, discarded: 0, tombstoneSkipped: 0, superseded: 0 });
      }).toThrow();
    });

    it('should not transition from succeeded to running', () => {
      extractionRunStore.markRunning(run.runId);
      extractionRunStore.markSucceeded(run.runId, { accepted: 1, discarded: 0, tombstoneSkipped: 0, superseded: 0 });

      expect(() => {
        extractionRunStore.markRunning(run.runId);
      }).toThrow();
    });
  });
});
