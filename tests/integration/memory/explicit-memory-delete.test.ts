import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js';
import { createLongTermMemoryRecallService } from '../../../src/memory/long-term-memory-recall.js';
import {
  applyDeterministicLifecyclePolicy,
  createExplicitMemoryService,
} from '../../../src/memory/explicit-memory-save-delete.js';

describe('explicit memory delete', () => {
  let connection: ConnectionManager;
  let store: LongTermMemoryStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
    store = createLongTermMemoryStore(connection);
  });

  afterEach(() => {
    connection.close();
  });

  it('deletes memory, removes it from recall, and creates tombstone', async () => {
    const explicitMemory = createExplicitMemoryService(store);
    const recall = createLongTermMemoryRecallService(store);

    const saved = explicitMemory.saveMemory(
      'user-delete-1',
      'prefers concise Chinese replies',
      { keywords: ['Chinese', 'replies'], sourceFingerprint: 'fp-delete-1', sourceWindowHash: 'source-delete-1' },
      { transcriptRefs: ['turn-delete-1'] }
    );

    explicitMemory.deleteMemory(saved.memoryId);

    const results = await recall.recall('user-delete-1', 'Chinese replies');
    const tombstone = explicitMemory.getTombstone(saved.memoryId);

    expect(results).toHaveLength(0);
    expect(tombstone).not.toBeNull();
    expect(tombstone?.fingerprint).toBe('fp-delete-1');
    expect(tombstone?.sourceWindowHash).toBe('source-delete-1');
    expect(() => explicitMemory.saveMemory(
      'user-delete-1',
      'prefers concise Chinese replies',
      { keywords: ['Chinese'], sourceFingerprint: 'fp-delete-1', sourceWindowHash: 'source-delete-1' },
      { transcriptRefs: ['turn-delete-1'] }
    )).toThrow('Memory source is tombstoned');
  });

  it('applies deterministic lifecycle transitions', () => {
    const explicitMemory = createExplicitMemoryService(store);
    const now = new Date('2026-05-09T12:00:00.000Z');

    const active = explicitMemory.saveMemory(
      'user-life-1',
      'active memory that ages',
      { keywords: ['active'], sourceWindowHash: 'life-active' },
      { transcriptRefs: ['life-turn-1'] }
    );
    store.save({
      ...active,
      lifecycle: {
        ...active.lifecycle,
        updatedAt: '2026-05-09T10:00:00.000Z',
      },
    });

    const low = explicitMemory.saveMemory(
      'user-life-1',
      'low memory that ages',
      { keywords: ['low'], sourceWindowHash: 'life-low' },
      { transcriptRefs: ['life-turn-2'] }
    );
    store.save({
      ...low,
      lifecycle: {
        ...low.lifecycle,
        status: 'low_priority',
        updatedAt: '2026-05-09T09:00:00.000Z',
      },
    });

    const transitions = applyDeterministicLifecyclePolicy(store, 'user-life-1', {
      activeTtlMs: 60 * 60 * 1000,
      lowPriorityTtlMs: 2 * 60 * 60 * 1000,
      lowPriorityTarget: 'compressed',
      now,
    });

    expect(transitions).toEqual(expect.arrayContaining([
      { memoryId: active.memoryId, from: 'active', to: 'low_priority' },
      { memoryId: low.memoryId, from: 'low_priority', to: 'compressed' },
    ]));
    expect(transitions).toHaveLength(2);
    expect(store.getByMemoryId(active.memoryId)?.lifecycle.status).toBe('low_priority');
    expect(store.getByMemoryId(low.memoryId)?.lifecycle.status).toBe('compressed');
  });
});
