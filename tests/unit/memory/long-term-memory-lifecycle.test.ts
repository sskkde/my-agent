import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createLongTermMemoryStore, type LongTermMemoryStore, type LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';

describe('Long-term Memory Lifecycle', () => {
  let connection: ConnectionManager;
  let store: LongTermMemoryStore;

  const testMemory: LongTermMemoryRecord = {
    memoryId: 'mem-test-001',
    userId: 'user-123',
    memoryType: 'user_preference',
    content: {
      text: 'User prefers dark mode in all applications',
      structured: { theme: 'dark', applications: 'all' }
    },
    sourceRefs: {
      transcriptRefs: ['trans-001', 'trans-002']
    },
    scope: {
      visibility: 'private_user'
    },
    confidence: 0.95,
    importance: 'high',
    sensitivity: 'low',
    lifecycle: {
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    retrieval: {
      keywords: ['dark mode', 'preference', 'theme'],
      recallCount: 0
    }
  };

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

  describe('Write', () => {
    it('should store a memory record', () => {
      store.save(testMemory);
      
      const retrieved = store.getByMemoryId(testMemory.memoryId);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.memoryId).toBe(testMemory.memoryId);
      expect(retrieved?.userId).toBe(testMemory.userId);
      expect(retrieved?.memoryType).toBe(testMemory.memoryType);
      expect(retrieved?.content.text).toBe(testMemory.content.text);
      expect(retrieved?.lifecycle.status).toBe('active');
    });

    it('should store memory with entities', () => {
      const memoryWithEntities: LongTermMemoryRecord = {
        ...testMemory,
        memoryId: 'mem-test-002',
        entities: [
          { entityType: 'project', displayName: 'My Project' }
        ]
      };
      
      store.save(memoryWithEntities);
      
      const retrieved = store.getByMemoryId(memoryWithEntities.memoryId);
      
      expect(retrieved?.entities).toHaveLength(1);
      expect(retrieved?.entities?.[0]?.displayName).toBe('My Project');
    });

    it('should update existing memory on save', () => {
      store.save(testMemory);
      
      const updated: LongTermMemoryRecord = {
        ...testMemory,
        content: {
          text: 'User prefers light mode',
          structured: { theme: 'light' }
        },
        lifecycle: {
          ...testMemory.lifecycle,
          updatedAt: new Date().toISOString()
        }
      };
      
      store.save(updated);
      
      const retrieved = store.getByMemoryId(testMemory.memoryId);
      
      expect(retrieved?.content.text).toBe('User prefers light mode');
      expect(retrieved?.content.structured?.theme).toBe('light');
    });
  });

  describe('Retrieve', () => {
    it('should retrieve memory by ID', () => {
      store.save(testMemory);
      
      const retrieved = store.getByMemoryId(testMemory.memoryId);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.memoryId).toBe(testMemory.memoryId);
    });

    it('should return null for non-existent memory', () => {
      const retrieved = store.getByMemoryId('non-existent');
      
      expect(retrieved).toBeNull();
    });

    it('should retrieve memories by user ID', () => {
      const memory1 = { ...testMemory, memoryId: 'mem-001' };
      const memory2 = { ...testMemory, memoryId: 'mem-002', userId: 'user-456' };
      
      store.save(memory1);
      store.save(memory2);
      
      const userMemories = store.getByUserId(testMemory.userId);
      
      expect(userMemories).toHaveLength(1);
      expect(userMemories[0]?.memoryId).toBe('mem-001');
    });

    it('should retrieve memories by type', () => {
      const memory1 = { ...testMemory, memoryId: 'mem-001', memoryType: 'user_preference' as const };
      const memory2 = { ...testMemory, memoryId: 'mem-002', memoryType: 'durable_fact' as const };
      
      store.save(memory1);
      store.save(memory2);
      
      const preferences = store.getByType('user_preference');
      
      expect(preferences).toHaveLength(1);
      expect(preferences[0]?.memoryType).toBe('user_preference');
    });

    it('should search memories by query', () => {
      const memory1 = { 
        ...testMemory, 
        memoryId: 'mem-001',
        content: { text: 'User prefers dark mode' },
        retrieval: {
          keywords: ['dark', 'mode', 'preference'],
          recallCount: 0
        }
      };
      const memory2 = { 
        ...testMemory, 
        memoryId: 'mem-002',
        content: { text: 'User likes Python programming' },
        retrieval: {
          keywords: ['python', 'programming', 'language'],
          recallCount: 0
        }
      };
      
      store.save(memory1);
      store.save(memory2);
      
      const results = store.search('dark mode', testMemory.userId);
      
      expect(results).toHaveLength(1);
      expect(results[0]?.memoryId).toBe('mem-001');
    });
  });

  describe('Delete', () => {
    it('should soft delete a memory record', () => {
      store.save(testMemory);
      
      store.delete(testMemory.memoryId);
      
      const retrieved = store.getByMemoryId(testMemory.memoryId);
      
      expect(retrieved?.lifecycle.status).toBe('deleted');
    });

    it('should throw error when deleting non-existent memory', () => {
      expect(() => store.delete('non-existent')).toThrow(
        'Memory with id "non-existent" not found'
      );
    });

    it('should exclude deleted memories from retrieval', () => {
      store.save(testMemory);
      store.delete(testMemory.memoryId);
      
      const userMemories = store.getByUserId(testMemory.userId);
      
      expect(userMemories).toHaveLength(0);
    });

    it('should exclude deleted memories from search', () => {
      store.save(testMemory);
      store.delete(testMemory.memoryId);
      
      const results = store.search('dark mode', testMemory.userId);
      
      expect(results).toHaveLength(0);
    });

    it('should exclude deleted memories from type query', () => {
      store.save(testMemory);
      store.delete(testMemory.memoryId);
      
      const memories = store.getByType(testMemory.memoryType);
      
      expect(memories).toHaveLength(0);
    });
  });

  describe('Patch', () => {
    it('should patch memory fields', () => {
      store.save(testMemory);
      
      const patched = store.applyPatch(testMemory.memoryId, {
        content: { text: 'Updated preference' },
        importance: 'critical'
      });
      
      expect(patched.content.text).toBe('Updated preference');
      expect(patched.importance).toBe('critical');
    });

    it('should preserve immutable fields on patch', () => {
      store.save(testMemory);
      
      const patched = store.applyPatch(testMemory.memoryId, {
        content: { text: 'Updated' }
      });
      
      expect(patched.memoryId).toBe(testMemory.memoryId);
      expect(patched.userId).toBe(testMemory.userId);
    });

    it('should update lifecycle updatedAt on patch', () => {
      store.save(testMemory);
      
      const before = store.getByMemoryId(testMemory.memoryId);
      
      const patched = store.applyPatch(testMemory.memoryId, {
        importance: 'low'
      });
      
      expect(patched.lifecycle.updatedAt).not.toBe(before?.lifecycle.updatedAt);
    });

    it('should throw error when patching non-existent memory', () => {
      expect(() => 
        store.applyPatch('non-existent', { importance: 'low' })
      ).toThrow('Memory with id "non-existent" not found');
    });
  });

  describe('Lifecycle Transitions', () => {
    it('should transition from active to archived', () => {
      store.save(testMemory);
      
      const archived = store.applyPatch(testMemory.memoryId, {
        lifecycle: {
          ...testMemory.lifecycle,
          status: 'archived'
        }
      });
      
      expect(archived.lifecycle.status).toBe('archived');
    });

    it('should track superseded memories', () => {
      store.save(testMemory);
      
      const newMemory: LongTermMemoryRecord = {
        ...testMemory,
        memoryId: 'mem-superseding',
        lifecycle: {
          ...testMemory.lifecycle,
          supersededBy: undefined
        }
      };
      
      store.save(newMemory);
      
      store.applyPatch(testMemory.memoryId, {
        lifecycle: {
          ...testMemory.lifecycle,
          status: 'superseded',
          supersededBy: newMemory.memoryId
        }
      });
      
      const superseded = store.getByMemoryId(testMemory.memoryId);
      
      expect(superseded?.lifecycle.status).toBe('superseded');
      expect(superseded?.lifecycle.supersededBy).toBe(newMemory.memoryId);
    });

    it('should increment recall count on retrieval', () => {
      store.save(testMemory);
      
      const before = store.getByMemoryId(testMemory.memoryId);
      const beforeCount = before?.retrieval.recallCount || 0;
      
      const updated = store.applyPatch(testMemory.memoryId, {
        retrieval: {
          ...testMemory.retrieval,
          recallCount: beforeCount + 1,
          lastRecalledAt: new Date().toISOString()
        }
      });
      
      expect(updated.retrieval.recallCount).toBe(beforeCount + 1);
      expect(updated.retrieval.lastRecalledAt).toBeDefined();
    });
  });
});
