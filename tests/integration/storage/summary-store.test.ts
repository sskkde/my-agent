import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createSummaryStore, type SummaryStore, type SummaryRecord, type SummaryType } from '../../../src/storage/summary-store.js';

describe('Summary Store', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let store: SummaryStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    const summaryMigration = createSummaryMigration();
    migrations.apply([summaryMigration]);
    
    store = createSummaryStore(connection);
  });

  afterEach(() => {
    connection?.close();
  });

  describe('SummaryRecord lifecycle', () => {
    it('should save a working_summary with sourceRefs', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-001',
        sourceRefs: {
          transcriptRefs: ['evt-001', 'evt-002'],
          eventRange: {
            startEventId: 'evt-001',
            endEventId: 'evt-010'
          }
        },
        summary: 'This is a working summary of the conversation',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getWorkingSummary('run-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summaryId).toBe('ws-001');
      expect(retrieved?.summaryType).toBe('working_summary');
      expect(retrieved?.summary).toBe('This is a working summary of the conversation');
    });

    it('should reject source-less summaries', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-002',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-002',
        sourceRefs: {},
        summary: 'Summary without sources',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      expect(() => store.save(record)).toThrow('sourceRefs');
    });

    it('should reject summaries with null sourceRefs', () => {
      const record = {
        summaryId: 'ws-003',
        summaryType: 'working_summary',
        userId: 'user-001',
        runId: 'run-003',
        sourceRefs: null,
        summary: 'Summary with null sources',
        status: 'active',
        createdAt: new Date().toISOString()
      } as unknown as SummaryRecord;

      expect(() => store.save(record)).toThrow('sourceRefs');
    });

    it('should save a session_memory with sourceRefs', () => {
      const record: SummaryRecord = {
        summaryId: 'sm-001',
        summaryType: 'session_memory' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-001',
        sourceRefs: {
          transcriptRefs: ['evt-001', 'evt-002', 'evt-003'],
          previousSummaryRefs: ['ws-001']
        },
        summary: 'Session memory summary',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getSessionMemory('sess-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summaryId).toBe('sm-001');
      expect(retrieved?.summaryType).toBe('session_memory');
    });
  });

  describe('SummaryType indexing', () => {
    it('should index working_summary type', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-idx-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-idx-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Working summary for indexing test',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const byType = store.getByType('working_summary');
      expect(byType.length).toBeGreaterThan(0);
      expect(byType.some(r => r.summaryId === 'ws-idx-001')).toBe(true);
    });

    it('should index session_memory type', () => {
      const record: SummaryRecord = {
        summaryId: 'sm-idx-001',
        summaryType: 'session_memory' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-idx-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Session memory for indexing test',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const byType = store.getByType('session_memory');
      expect(byType.some(r => r.summaryId === 'sm-idx-001')).toBe(true);
    });

    it('should index rolling_5_turns type', () => {
      const record: SummaryRecord = {
        summaryId: 'r5-idx-001',
        summaryType: 'rolling_5_turns' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-idx-002',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Rolling 5 turns summary',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const byType = store.getByType('rolling_5_turns');
      expect(byType.some(r => r.summaryId === 'r5-idx-001')).toBe(true);
    });

    it('should index rolling_10_turns type', () => {
      const record: SummaryRecord = {
        summaryId: 'r10-idx-001',
        summaryType: 'rolling_10_turns' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-idx-003',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Rolling 10 turns summary',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const byType = store.getByType('rolling_10_turns');
      expect(byType.some(r => r.summaryId === 'r10-idx-001')).toBe(true);
    });
  });

  describe('WorkingSummary retrieval by runId', () => {
    it('should retrieve working summary by runId', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-run-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-specific-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Working summary for specific run',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getWorkingSummary('run-specific-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summaryId).toBe('ws-run-001');
      expect(retrieved?.runId).toBe('run-specific-001');
    });

    it('should return null for non-existent runId', () => {
      const retrieved = store.getWorkingSummary('non-existent-run');
      expect(retrieved).toBeNull();
    });

    it('should return most recent working summary for runId', () => {
      const record1: SummaryRecord = {
        summaryId: 'ws-run-old',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-multi-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Old working summary',
        status: 'active',
        createdAt: new Date(Date.now() - 10000).toISOString()
      };

      const record2: SummaryRecord = {
        summaryId: 'ws-run-new',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-multi-001',
        sourceRefs: { transcriptRefs: ['evt-002'] },
        summary: 'New working summary',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record1);
      store.save(record2);

      const retrieved = store.getWorkingSummary('run-multi-001');
      expect(retrieved?.summaryId).toBe('ws-run-new');
    });
  });

  describe('SessionMemory retrieval by sessionId', () => {
    it('should retrieve session memory by sessionId', () => {
      const record: SummaryRecord = {
        summaryId: 'sm-sess-001',
        summaryType: 'session_memory' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-specific-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Session memory for specific session',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getSessionMemory('sess-specific-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summaryId).toBe('sm-sess-001');
      expect(retrieved?.sessionId).toBe('sess-specific-001');
    });

    it('should return null for non-existent sessionId', () => {
      const retrieved = store.getSessionMemory('non-existent-session');
      expect(retrieved).toBeNull();
    });

    it('should return most recent session memory for sessionId', () => {
      const record1: SummaryRecord = {
        summaryId: 'sm-sess-old',
        summaryType: 'session_memory' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-multi-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Old session memory',
        status: 'active',
        createdAt: new Date(Date.now() - 10000).toISOString()
      };

      const record2: SummaryRecord = {
        summaryId: 'sm-sess-new',
        summaryType: 'session_memory' as SummaryType,
        userId: 'user-001',
        sessionId: 'sess-multi-001',
        sourceRefs: { transcriptRefs: ['evt-002'] },
        summary: 'New session memory',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record1);
      store.save(record2);

      const retrieved = store.getSessionMemory('sess-multi-001');
      expect(retrieved?.summaryId).toBe('sm-sess-new');
    });
  });

  describe('Versioning/patch support', () => {
    it('should support applyPatch for partial updates', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-patch-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-patch-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Initial summary',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const patch = {
        summary: 'Updated summary via patch',
        status: 'validated' as const
      };

      const updated = store.applyPatch('ws-patch-001', patch);
      expect(updated.summary).toBe('Updated summary via patch');
      expect(updated.status).toBe('validated');
      expect(updated.updatedAt).toBeDefined();
    });

    it('should throw error when patching non-existent summary', () => {
      expect(() => {
        store.applyPatch('non-existent-id', { summary: 'update' });
      }).toThrow('not found');
    });

    it('should preserve unpatched fields', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-patch-002',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-patch-002',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Original summary',
        structuredState: { key1: 'value1', key2: 'value2' },
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const patch = {
        summary: 'Only summary updated'
      };

      const updated = store.applyPatch('ws-patch-002', patch);
      expect(updated.summary).toBe('Only summary updated');
      expect(updated.structuredState).toEqual({ key1: 'value1', key2: 'value2' });
      expect(updated.runId).toBe('run-patch-002');
    });

    it('should update updatedAt timestamp on patch', () => {
      const originalTime = new Date(Date.now() - 10000).toISOString();
      const record: SummaryRecord = {
        summaryId: 'ws-patch-003',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-patch-003',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Summary for timestamp test',
        status: 'active',
        createdAt: originalTime
      };

      store.save(record);

      const beforePatch = new Date().toISOString();
      const updated = store.applyPatch('ws-patch-003', { summary: 'Updated' });
      const afterPatch = new Date().toISOString();

      expect(updated.updatedAt).toBeDefined();
      expect(new Date(updated.updatedAt!).getTime()).toBeGreaterThanOrEqual(new Date(beforePatch).getTime());
      expect(new Date(updated.updatedAt!).getTime()).toBeLessThanOrEqual(new Date(afterPatch).getTime());
    });
  });

  describe('Related refs support', () => {
    it('should store and retrieve relatedRefs', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-rel-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-rel-001',
        relatedRefs: {
          plannerRunId: 'planner-001',
          planId: 'plan-001',
          workflowRunId: 'wf-001'
        },
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Summary with related refs',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getBySummaryId('ws-rel-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.relatedRefs?.plannerRunId).toBe('planner-001');
      expect(retrieved?.relatedRefs?.planId).toBe('plan-001');
      expect(retrieved?.relatedRefs?.workflowRunId).toBe('wf-001');
    });
  });

  describe('Retrieval metadata support', () => {
    it('should store and retrieve retrieval metadata', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-ret-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-ret-001',
        sourceRefs: { transcriptRefs: ['evt-001'] },
        summary: 'Summary with retrieval metadata',
        status: 'active',
        retrieval: {
          keywords: ['test', 'summary', 'memory'],
          embeddingRef: 'emb-001',
          importance: 'high'
        },
        createdAt: new Date().toISOString()
      };

      store.save(record);

      const retrieved = store.getBySummaryId('ws-ret-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.retrieval?.keywords).toEqual(['test', 'summary', 'memory']);
      expect(retrieved?.retrieval?.embeddingRef).toBe('emb-001');
      expect(retrieved?.retrieval?.importance).toBe('high');
    });
  });

  describe('Status field support', () => {
    it('should support all status values', () => {
      const statuses = ['candidate', 'validated', 'active', 'superseded', 'archived', 'expired'] as const;
      
      statuses.forEach((status, index) => {
        const record: SummaryRecord = {
          summaryId: `ws-status-${index}`,
          summaryType: 'working_summary' as SummaryType,
          userId: 'user-001',
          runId: `run-status-${index}`,
          sourceRefs: { transcriptRefs: ['evt-001'] },
          summary: `Summary with status ${status}`,
          status,
          createdAt: new Date().toISOString()
        };

        store.save(record);
      });

      statuses.forEach((status, index) => {
        const retrieved = store.getBySummaryId(`ws-status-${index}`);
        expect(retrieved?.status).toBe(status);
      });
    });
  });

  describe('sourceRefs validation', () => {
    it('should accept transcriptRefs as valid source', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-src-001',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-src-001',
        sourceRefs: { transcriptRefs: ['evt-001', 'evt-002'] },
        summary: 'Summary with transcript refs',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      expect(() => store.save(record)).not.toThrow();
    });

    it('should accept eventRange as valid source', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-src-002',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-src-002',
        sourceRefs: {
          eventRange: {
            startEventId: 'evt-001',
            endEventId: 'evt-010'
          }
        },
        summary: 'Summary with event range',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      expect(() => store.save(record)).not.toThrow();
    });

    it('should accept previousSummaryRefs as valid source', () => {
      const record: SummaryRecord = {
        summaryId: 'ws-src-003',
        summaryType: 'working_summary' as SummaryType,
        userId: 'user-001',
        runId: 'run-src-003',
        sourceRefs: { previousSummaryRefs: ['ws-prev-001'] },
        summary: 'Summary with previous summary refs',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      expect(() => store.save(record)).not.toThrow();
    });
  });
});

function createSummaryMigration() {
  return {
    version: 1,
    name: 'create_summaries_table',
    up: `
      CREATE TABLE IF NOT EXISTS summaries (
        summary_id TEXT PRIMARY KEY,
        summary_type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        run_id TEXT,
        related_refs TEXT,
        source_refs TEXT NOT NULL,
        summary TEXT NOT NULL,
        structured_state TEXT,
        status TEXT NOT NULL,
        retrieval TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_summaries_user_type_updated 
        ON summaries(user_id, summary_type, updated_at);
      
      CREATE INDEX IF NOT EXISTS idx_summaries_session_type_updated 
        ON summaries(session_id, summary_type, updated_at);
      
      CREATE INDEX IF NOT EXISTS idx_summaries_plan_id 
        ON summaries(json_extract(related_refs, '$.planId')) 
        WHERE related_refs IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_summaries_planner_run_id 
        ON summaries(json_extract(related_refs, '$.plannerRunId')) 
        WHERE related_refs IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_summaries_workflow_run_id 
        ON summaries(json_extract(related_refs, '$.workflowRunId')) 
        WHERE related_refs IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_summaries_status 
        ON summaries(status);
      
      CREATE INDEX IF NOT EXISTS idx_summaries_run_id 
        ON summaries(run_id) 
        WHERE run_id IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_summaries_session_id 
        ON summaries(session_id) 
        WHERE session_id IS NOT NULL;
    `,
    down: `
      DROP INDEX IF EXISTS idx_summaries_user_type_updated;
      DROP INDEX IF EXISTS idx_summaries_session_type_updated;
      DROP INDEX IF EXISTS idx_summaries_plan_id;
      DROP INDEX IF EXISTS idx_summaries_planner_run_id;
      DROP INDEX IF EXISTS idx_summaries_workflow_run_id;
      DROP INDEX IF EXISTS idx_summaries_status;
      DROP INDEX IF EXISTS idx_summaries_run_id;
      DROP INDEX IF EXISTS idx_summaries_session_id;
      DROP TABLE IF EXISTS summaries;
    `
  };
}
