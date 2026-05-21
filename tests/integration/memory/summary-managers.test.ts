import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createSummaryStore, type SummaryStore, type SourceRefs } from '../../../src/storage/summary-store.js';
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js';
import { createSummaryManager } from '../../../src/memory/summary-manager.js';
import { createSessionMemoryManager } from '../../../src/memory/session-memory-manager.js';
import { createRollingSummaryPolicy } from '../../../src/memory/rolling-summary-policy.js';
import { createMemorySearch } from '../../../src/memory/memory-search.js';
import type {
  SummaryManager,
  SessionMemoryManager,
  RollingSummaryPolicy,
  MemorySearch,
  MemorySearchResult,
  WorkingSummaryRequest,
  RollingSummaryContext,
  RollingSummaryConfig,
  MemorySearchOptions
} from '../../../src/memory/types.js';

describe('Memory/Summary Managers Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let summaryStore: SummaryStore;
  let transcriptStore: TranscriptStore;
  let summaryManager: SummaryManager;
  let sessionMemoryManager: SessionMemoryManager;
  let rollingPolicy: RollingSummaryPolicy;
  let memorySearch: MemorySearch;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    const summaryMigration = createSummaryMigration();
    const transcriptMigration = createTranscriptMigration();
    migrations.apply([summaryMigration, transcriptMigration]);

    summaryStore = createSummaryStore(connection);
    transcriptStore = createTranscriptStore(connection);
    summaryManager = createSummaryManager(summaryStore, transcriptStore);
    sessionMemoryManager = createSessionMemoryManager(summaryStore);
    rollingPolicy = createRollingSummaryPolicy();
    memorySearch = createMemorySearch(summaryStore);
  });

  afterEach(() => {
    connection?.close();
  });

  // ============================================================================
  // SummaryManager Tests
  // ============================================================================
  describe('SummaryManager', () => {
    describe('generateWorkingSummary', () => {
      it('should generate a working summary from transcript refs', () => {
        const sourceRefs: SourceRefs = {
          transcriptRefs: ['turn-001', 'turn-002'],
          eventRange: {
            startEventId: 'evt-001',
            endEventId: 'evt-010'
          }
        };

        const request: WorkingSummaryRequest = {
          summaryId: 'ws-test-001',
          userId: 'user-001',
          runId: 'run-001',
          sessionId: 'sess-001',
          sourceRefs,
          currentTurnCount: 5,
          structuredState: { topic: 'testing', priority: 'high' }
        };

        const summary = summaryManager.generateWorkingSummary(request);

        expect(summary.summaryId).toBe('ws-test-001');
        expect(summary.summaryType).toBe('working_summary');
        expect(summary.userId).toBe('user-001');
        expect(summary.runId).toBe('run-001');
        expect(summary.sessionId).toBe('sess-001');
        expect(summary.sourceRefs).toEqual(sourceRefs);
        expect(summary.status).toBe('active');
        expect(summary.structuredState).toEqual({ topic: 'testing', priority: 'high' });
        expect(summary.createdAt).toBeDefined();
        expect(summary.summary.length).toBeGreaterThan(0);
      });

      it('should validate sourceRefs before generating', () => {
        const request: WorkingSummaryRequest = {
          summaryId: 'ws-test-002',
          userId: 'user-001',
          runId: 'run-002',
          sourceRefs: {},
          currentTurnCount: 3
        };

        expect(() => summaryManager.generateWorkingSummary(request)).toThrow('sourceRefs');
      });

      it('should include sourceRefs in generated summary for provenance', () => {
        const sourceRefs: SourceRefs = {
          transcriptRefs: ['turn-003'],
          previousSummaryRefs: ['ws-prev-001']
        };

        const request: WorkingSummaryRequest = {
          summaryId: 'ws-test-003',
          userId: 'user-001',
          runId: 'run-003',
          sourceRefs,
          currentTurnCount: 1
        };

        const summary = summaryManager.generateWorkingSummary(request);
        expect(summary.sourceRefs.transcriptRefs).toContain('turn-003');
        expect(summary.sourceRefs.previousSummaryRefs).toContain('ws-prev-001');
      });
    });

    describe('validateSourceRefs', () => {
      it('should accept transcriptRefs as valid source', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        expect(summaryManager.validateSourceRefs(sourceRefs)).toBe(true);
      });

      it('should accept eventRange as valid source', () => {
        const sourceRefs: SourceRefs = {
          eventRange: { startEventId: 'evt-001', endEventId: 'evt-010' }
        };
        expect(summaryManager.validateSourceRefs(sourceRefs)).toBe(true);
      });

      it('should accept previousSummaryRefs as valid source', () => {
        const sourceRefs: SourceRefs = { previousSummaryRefs: ['ws-001'] };
        expect(summaryManager.validateSourceRefs(sourceRefs)).toBe(true);
      });

      it('should reject empty sourceRefs', () => {
        expect(summaryManager.validateSourceRefs({})).toBe(false);
        expect(summaryManager.validateSourceRefs(null as unknown as SourceRefs)).toBe(false);
        expect(summaryManager.validateSourceRefs(undefined as unknown as SourceRefs)).toBe(false);
      });

      it('should reject sourceRefs with empty arrays', () => {
        expect(summaryManager.validateSourceRefs({ transcriptRefs: [] })).toBe(false);
        expect(summaryManager.validateSourceRefs({ previousSummaryRefs: [] })).toBe(false);
      });
    });
  });

  // ============================================================================
  // SessionMemoryManager Tests
  // ============================================================================
  describe('SessionMemoryManager', () => {
    describe('createSessionMemory', () => {
      it('should create initial session memory', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        const memory = sessionMemoryManager.createSessionMemory('sess-001', 'user-001', sourceRefs);

        expect(memory.summaryId).toBeDefined();
        expect(memory.summaryType).toBe('session_memory');
        expect(memory.sessionId).toBe('sess-001');
        expect(memory.userId).toBe('user-001');
        expect(memory.sourceRefs).toEqual(sourceRefs);
        expect(memory.status).toBe('active');
        expect(memory.summary).toBe('');
        expect(memory.createdAt).toBeDefined();
      });

      it('should store created session memory', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        const memory = sessionMemoryManager.createSessionMemory('sess-002', 'user-001', sourceRefs);

        const retrieved = sessionMemoryManager.getSessionMemory('sess-002');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.summaryId).toBe(memory.summaryId);
        expect(retrieved?.sessionId).toBe('sess-002');
      });
    });

    describe('patchSessionMemory', () => {
      it('should patch session memory summary', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        sessionMemoryManager.createSessionMemory('sess-patch-001', 'user-001', sourceRefs);

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-001', {
          summary: 'Updated session summary'
        });

        expect(patched.summary).toBe('Updated session summary');
        expect(patched.updatedAt).toBeDefined();
      });

      it('should patch session memory structuredState', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        sessionMemoryManager.createSessionMemory('sess-patch-002', 'user-001', sourceRefs);

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-002', {
          structuredState: { key: 'value', count: 42 }
        });

        expect(patched.structuredState).toEqual({ key: 'value', count: 42 });
      });

      it('should preserve system-owned deterministic fields during patch', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        const original = sessionMemoryManager.createSessionMemory('sess-patch-003', 'user-001', sourceRefs);
        const originalId = original.summaryId;
        const originalCreatedAt = original.createdAt;

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-003', {
          summary: 'New summary',
          sessionId: 'hacked-session',
          userId: 'hacked-user',
          summaryId: 'hacked-id',
          createdAt: '2020-01-01T00:00:00Z'
        } as unknown as Parameters<typeof sessionMemoryManager.patchSessionMemory>[1]);

        expect(patched.sessionId).toBe('sess-patch-003');
        expect(patched.userId).toBe('user-001');
        expect(patched.summaryId).toBe(originalId);
        expect(patched.createdAt).toBe(originalCreatedAt);
        expect(patched.summary).toBe('New summary');
      });

      it('should preserve sourceRefs during patch', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001', 'turn-002'] };
        sessionMemoryManager.createSessionMemory('sess-patch-004', 'user-001', sourceRefs);

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-004', {
          summary: 'Updated'
        });

        expect(patched.sourceRefs).toEqual(sourceRefs);
        expect(patched.sourceRefs.transcriptRefs).toEqual(['turn-001', 'turn-002']);
      });

      it('should throw when patching non-existent session memory', () => {
        expect(() => {
          sessionMemoryManager.patchSessionMemory('non-existent-session', { summary: 'test' });
        }).toThrow('not found');
      });

      it('should update status via patch', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        sessionMemoryManager.createSessionMemory('sess-patch-005', 'user-001', sourceRefs);

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-005', {
          status: 'validated'
        });

        expect(patched.status).toBe('validated');
      });

      it('should update retrieval metadata via patch', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        sessionMemoryManager.createSessionMemory('sess-patch-006', 'user-001', sourceRefs);

        const patched = sessionMemoryManager.patchSessionMemory('sess-patch-006', {
          retrieval: {
            keywords: ['test', 'memory'],
            importance: 'high'
          }
        });

        expect(patched.retrieval?.keywords).toEqual(['test', 'memory']);
        expect(patched.retrieval?.importance).toBe('high');
      });
    });

    describe('getSessionMemory', () => {
      it('should return null for non-existent session', () => {
        const result = sessionMemoryManager.getSessionMemory('non-existent');
        expect(result).toBeNull();
      });

      it('should retrieve existing session memory', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        const created = sessionMemoryManager.createSessionMemory('sess-get-001', 'user-001', sourceRefs);

        const retrieved = sessionMemoryManager.getSessionMemory('sess-get-001');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.summaryId).toBe(created.summaryId);
      });
    });
  });

  // ============================================================================
  // RollingSummaryPolicy Tests
  // ============================================================================
  describe('RollingSummaryPolicy', () => {
    describe('shouldTrigger', () => {
      it('should trigger at maxTurns threshold', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 10,
          enableTopicShiftTrigger: false,
          topicShiftThreshold: 0.5
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 10,
          lastSummaryTurnCount: 0,
          recentTranscriptSegments: [],
          currentTopicKeywords: ['topic'],
          previousTopicKeywords: ['topic']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(true);
        expect(decision.reason).toBe('max_turns_reached');
        expect(decision.recommendedType).toBe('rolling_5_turns');
      });

      it('should not trigger before maxTurns', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 10,
          enableTopicShiftTrigger: false,
          topicShiftThreshold: 0.5
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 5,
          lastSummaryTurnCount: 0,
          recentTranscriptSegments: [],
          currentTopicKeywords: ['topic'],
          previousTopicKeywords: ['topic']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(false);
        expect(decision.reason).toBe('no_trigger');
        expect(decision.recommendedType).toBeNull();
      });

      it('should trigger on topic shift when enabled', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 20,
          enableTopicShiftTrigger: true,
          topicShiftThreshold: 0.5
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 5,
          lastSummaryTurnCount: 0,
          recentTranscriptSegments: ['new topic discussion'],
          currentTopicKeywords: ['newtopic', 'discussion'],
          previousTopicKeywords: ['oldtopic', 'context']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(true);
        expect(decision.reason).toBe('topic_shift_detected');
        expect(decision.topicShiftConfidence).toBeGreaterThan(0);
        expect(decision.recommendedType).toBe('rolling_5_turns');
      });

      it('should not trigger on topic shift when disabled', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 20,
          enableTopicShiftTrigger: false,
          topicShiftThreshold: 0.5
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 5,
          lastSummaryTurnCount: 0,
          recentTranscriptSegments: ['new topic discussion'],
          currentTopicKeywords: ['newtopic'],
          previousTopicKeywords: ['oldtopic']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(false);
        expect(decision.reason).toBe('no_trigger');
      });

      it('should calculate topic shift confidence based on keyword overlap', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 20,
          enableTopicShiftTrigger: true,
          topicShiftThreshold: 0.3
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 5,
          lastSummaryTurnCount: 0,
          recentTranscriptSegments: [],
          currentTopicKeywords: ['completely', 'different', 'topic'],
          previousTopicKeywords: ['original', 'subject', 'matter']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(true);
        expect(decision.topicShiftConfidence).toBeGreaterThan(0.5);
      });

      it('should recommend rolling_10_turns for longer sessions', () => {
        const config: RollingSummaryConfig = {
          maxTurns: 20,
          enableTopicShiftTrigger: false,
          topicShiftThreshold: 0.5
        };

        const context: RollingSummaryContext = {
          currentTurnCount: 30,
          lastSummaryTurnCount: 10,
          recentTranscriptSegments: [],
          currentTopicKeywords: ['topic'],
          previousTopicKeywords: ['topic']
        };

        const decision = rollingPolicy.shouldTrigger(context, config);

        expect(decision.shouldTrigger).toBe(true);
        expect(decision.recommendedType).toBe('rolling_10_turns');
      });
    });

    describe('getDefaultConfig', () => {
      it('should return default configuration', () => {
        const config = rollingPolicy.getDefaultConfig();

        expect(config.maxTurns).toBeDefined();
        expect(config.enableTopicShiftTrigger).toBeDefined();
        expect(config.topicShiftThreshold).toBeDefined();
        expect(config.maxTurns).toBeGreaterThan(0);
        expect(config.topicShiftThreshold).toBeGreaterThanOrEqual(0);
        expect(config.topicShiftThreshold).toBeLessThanOrEqual(1);
      });
    });
  });

  // ============================================================================
  // MemorySearch Tests
  // ============================================================================
  describe('MemorySearch', () => {
    beforeEach(() => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };

      summaryStore.save({
        summaryId: 'ws-search-001',
        summaryType: 'working_summary',
        userId: 'user-001',
        runId: 'run-001',
        sourceRefs,
        summary: 'Working summary about JavaScript programming and async patterns',
        status: 'active',
        retrieval: {
          keywords: ['javascript', 'async', 'programming'],
          importance: 'high'
        },
        createdAt: new Date().toISOString()
      });

      summaryStore.save({
        summaryId: 'sm-search-001',
        summaryType: 'session_memory',
        userId: 'user-001',
        sessionId: 'sess-001',
        sourceRefs,
        summary: 'Session memory about TypeScript and type safety',
        status: 'active',
        retrieval: {
          keywords: ['typescript', 'types', 'safety'],
          importance: 'medium'
        },
        createdAt: new Date().toISOString()
      });

      summaryStore.save({
        summaryId: 'ws-search-002',
        summaryType: 'working_summary',
        userId: 'user-002',
        runId: 'run-002',
        sourceRefs,
        summary: 'Another working summary about Python and data processing',
        status: 'validated',
        retrieval: {
          keywords: ['python', 'data', 'processing'],
          importance: 'low'
        },
        createdAt: new Date().toISOString()
      });
    });

    describe('search', () => {
      it('should search by keywords and return results with sourceRefs', () => {
        const options: MemorySearchOptions = {
          keywords: ['javascript', 'async'],
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].sourceRefs).toBeDefined();
        expect(results[0].sourceRefs.transcriptRefs).toContain('turn-001');
        expect(results[0].matchedKeywords).toContain('javascript');
        expect(results[0].relevanceScore).toBeGreaterThan(0);
      });

      it('should filter by userId', () => {
        const options: MemorySearchOptions = {
          userId: 'user-001',
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.every((r: MemorySearchResult) => r.summary.userId === 'user-001')).toBe(true);
      });

      it('should filter by sessionId', () => {
        const options: MemorySearchOptions = {
          sessionId: 'sess-001',
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.every((r: MemorySearchResult) => r.summary.sessionId === 'sess-001')).toBe(true);
      });

      it('should filter by summaryType', () => {
        const options: MemorySearchOptions = {
          summaryTypes: ['working_summary'],
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.every((r: MemorySearchResult) => r.summary.summaryType === 'working_summary')).toBe(true);
      });

      it('should filter by status', () => {
        const options: MemorySearchOptions = {
          statuses: ['validated'],
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.every((r: MemorySearchResult) => r.summary.status === 'validated')).toBe(true);
      });

      it('should filter by importance', () => {
        const options: MemorySearchOptions = {
          importance: 'high',
          limit: 10
        };

        const results = memorySearch.search(options);

        expect(results.every((r: MemorySearchResult) => r.summary.retrieval?.importance === 'high')).toBe(true);
      });

      it('should support pagination with limit and offset', () => {
        const options1: MemorySearchOptions = {
          limit: 1,
          offset: 0
        };

        const options2: MemorySearchOptions = {
          limit: 1,
          offset: 1
        };

        const results1 = memorySearch.search(options1);
        const results2 = memorySearch.search(options2);

        expect(results1.length).toBe(1);
        expect(results2.length).toBe(1);
        expect(results1[0].summary.summaryId).not.toBe(results2[0].summary.summaryId);
      });

      it('should return empty array for no matches', () => {
        const options: MemorySearchOptions = {
          keywords: ['nonexistent', 'keyword'],
          limit: 10
        };

        const results = memorySearch.search(options);
        expect(results).toEqual([]);
      });
    });

    describe('searchByKeywords', () => {
      it('should search by keywords only', () => {
        const results = memorySearch.searchByKeywords(['typescript'], 10);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].matchedKeywords).toContain('typescript');
      });

      it('should respect limit parameter', () => {
        const results = memorySearch.searchByKeywords(['summary'], 1);
        expect(results.length).toBeLessThanOrEqual(1);
      });

      it('should return results with sourceRefs', () => {
        const results = memorySearch.searchByKeywords(['javascript'], 10);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].sourceRefs).toBeDefined();
      });
    });

    describe('getBySourceRefs', () => {
      it('should retrieve memories by transcript refs', () => {
        const sourceRefs: SourceRefs = { transcriptRefs: ['turn-001'] };
        const results = memorySearch.getBySourceRefs(sourceRefs);

        expect(results.length).toBeGreaterThan(0);
        expect(results.every((r: MemorySearchResult) =>
          r.sourceRefs.transcriptRefs?.includes('turn-001')
        )).toBe(true);
      });

      it('should retrieve memories by eventRange', () => {
        const sourceRefs: SourceRefs = {
          eventRange: { startEventId: 'evt-001', endEventId: 'evt-010' }
        };

        summaryStore.save({
          summaryId: 'ws-range-001',
          summaryType: 'working_summary',
          userId: 'user-001',
          runId: 'run-range',
          sourceRefs,
          summary: 'Summary with event range',
          status: 'active',
          createdAt: new Date().toISOString()
        });

        const results = memorySearch.getBySourceRefs(sourceRefs);
        expect(results.some((r: MemorySearchResult) => r.summary.summaryId === 'ws-range-001')).toBe(true);
      });

      it('should retrieve memories by previousSummaryRefs', () => {
        const sourceRefs: SourceRefs = { previousSummaryRefs: ['ws-prev-001'] };

        summaryStore.save({
          summaryId: 'ws-prev-search-001',
          summaryType: 'working_summary',
          userId: 'user-001',
          runId: 'run-prev',
          sourceRefs,
          summary: 'Summary with previous refs',
          status: 'active',
          createdAt: new Date().toISOString()
        });

        const results = memorySearch.getBySourceRefs(sourceRefs);
        expect(results.some((r: MemorySearchResult) => r.summary.summaryId === 'ws-prev-search-001')).toBe(true);
      });
    });
  });
});

// Helper migration functions
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
      DROP INDEX IF EXISTS idx_summaries_status;
      DROP INDEX IF EXISTS idx_summaries_run_id;
      DROP INDEX IF EXISTS idx_summaries_session_id;
      DROP TABLE IF EXISTS summaries;
    `
  };
}

function createTranscriptMigration() {
  return {
    version: 2,
    name: 'create_transcripts_table',
    up: `
      CREATE TABLE IF NOT EXISTS transcripts (
        turnId TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        inboundEventId TEXT,
        userMessageSummary TEXT,
        contentRefs TEXT,
        visibleMessages TEXT NOT NULL,
        artifactRefs TEXT,
        foregroundDecisionId TEXT,
        plannerRunIds TEXT,
        runtimeActionIds TEXT,
        toolCallSummaries TEXT,
        approvalSummaries TEXT,
        startEventId TEXT,
        endEventId TEXT,
        visibility TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transcripts_sessionId
        ON transcripts(sessionId);
    `,
    down: `
      DROP INDEX IF EXISTS idx_transcripts_sessionId;
      DROP TABLE IF EXISTS transcripts;
    `
  };
}
