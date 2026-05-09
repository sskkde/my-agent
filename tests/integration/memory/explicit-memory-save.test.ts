import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js';
import { createLongTermMemoryRecallService } from '../../../src/memory/long-term-memory-recall.js';
import { createExplicitMemoryService } from '../../../src/memory/explicit-memory-save-delete.js';

describe('explicit memory save', () => {
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

  it('saves source refs and metadata for recall', async () => {
    const explicitMemory = createExplicitMemoryService(store);
    const recall = createLongTermMemoryRecallService(store);

    const saved = explicitMemory.saveMemory(
      'user-save-1',
      'prefers concise Chinese replies',
      {
        confidence: 0.93,
        sensitivity: 'low',
        keywords: ['concise', 'Chinese', 'replies'],
        entities: [{ entityType: 'person', displayName: 'user-save-1' }],
        timeAnchors: [{ label: 'captured', value: '2026-05-09' }],
      },
      { transcriptRefs: ['turn-save-1'] }
    );

    const results = await recall.recall('user-save-1', 'Chinese replies', { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].memoryId).toBe(saved.memoryId);
    expect(results[0].retrieval.keywords).toContain('Chinese');
    expect(results[0].sourceRefs.transcriptRefs).toEqual(['turn-save-1']);
    expect(results[0].confidence).toBe(0.93);
    expect(results[0].sensitivity).toBe('low');
    expect(results[0].content.structured?.timeAnchors).toEqual([
      { label: 'captured', value: '2026-05-09' },
    ]);
  });
});
