/**
 * Phase 3 E2E: Memory, Observability, and Replay
 *
 * Tests memory lifecycle and replay safety:
 * - Memory save/recall operations
 * - Memory delete/tombstone tracking
 * - Replay no-write safety enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js';
import { createMigrationRunner } from '../../src/storage/migrations.js';
import { allStoreMigrations } from '../../src/storage/all-stores-migrations.js';
import { createEventStore, type EventStore } from '../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../src/storage/runtime-action-store.js';
import { createAuditStore } from '../../src/observability/audit-store.js';
import { createTraceStore } from '../../src/observability/trace-store.js';
import type { AuditStore } from '../../src/observability/audit-types.js';
import type { TraceStore } from '../../src/observability/types.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../src/storage/long-term-memory-store.js';
import { createTimelineBuilder, type TimelineBuilder } from '../../src/observability/timeline.js';
import {
  createReplayService,
  type ReplayService,
  type ReplayRequest,
  DEFAULT_SAFETY_POLICY,
  type SafetyPolicy,
} from '../../src/observability/replay.js';
import type { LongTermMemoryRecord, MemoryType, Importance, Sensitivity } from '../../src/storage/long-term-memory-store.js';
import type { AuditRecord } from '../../src/observability/audit-types.js';
import type { TraceContext } from '../../src/observability/types.js';
import type { EventRecord } from '../../src/storage/event-store.js';

describe('Phase 3 E2E: Memory, Observability, and Replay', () => {
  let connection: ConnectionManager;
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let auditStore: AuditStore;
  let traceStore: TraceStore;
  let memoryStore: LongTermMemoryStore;
  let timelineBuilder: TimelineBuilder;
  let replayService: ReplayService;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    auditStore = createAuditStore(connection);
    traceStore = createTraceStore(connection);
    memoryStore = createLongTermMemoryStore(connection);

    timelineBuilder = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore: runtimeActionStore,
    });

    replayService = createReplayService({
      timelineBuilder,
      eventStore,
      auditStore,
      traceStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Memory save/recall', () => {
    it('should save a memory record and retrieve it by ID', () => {
      const userId = 'test-user-memory-001';
      const memoryId = 'mem_001';

      const record: LongTermMemoryRecord = {
        memoryId,
        userId,
        memoryType: 'user_preference' as MemoryType,
        content: {
          text: 'User prefers dark mode in all applications',
          structured: { theme: 'dark', autoSwitch: false },
        },
        sourceRefs: {
          transcriptRefs: ['transcript_001'],
        },
        scope: {
          visibility: 'private_user',
        },
        confidence: 0.95,
        importance: 'high' as Importance,
        sensitivity: 'low' as Sensitivity,
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        retrieval: {
          keywords: ['theme', 'dark mode', 'preference'],
          recallCount: 0,
        },
        fingerprint: 'fp_001',
        sourceWindowHash: 'hash_001',
      };

      memoryStore.save(record);

      const retrieved = memoryStore.getByMemoryId(memoryId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.memoryId).toBe(memoryId);
      expect(retrieved?.userId).toBe(userId);
      expect(retrieved?.memoryType).toBe('user_preference');
      expect(retrieved?.content.text).toBe('User prefers dark mode in all applications');
      expect(retrieved?.confidence).toBe(0.95);
    });

    it('should recall memories by user ID', () => {
      const userId = 'test-user-recall-001';

      const records: LongTermMemoryRecord[] = [
        createMemoryRecord('mem_recall_001', userId, 'user_preference', 'Prefers morning meetings'),
        createMemoryRecord('mem_recall_002', userId, 'user_profile', 'Works in engineering team'),
        createMemoryRecord('mem_recall_003', userId, 'durable_fact', 'Timezone is UTC-8'),
      ];

      records.forEach(r => memoryStore.save(r));

      const userMemories = memoryStore.getByUserId(userId);

      expect(userMemories.length).toBe(3);
      expect(userMemories.every(m => m.userId === userId)).toBe(true);
    });

    it('should search memories by content', () => {
      const userId = 'test-user-search-001';

      memoryStore.save(createMemoryRecord('mem_search_001', userId, 'user_preference', 'Prefers dark mode'));
      memoryStore.save(createMemoryRecord('mem_search_002', userId, 'user_preference', 'Prefers morning meetings'));
      memoryStore.save(createMemoryRecord('mem_search_003', userId, 'durable_fact', 'Works remotely from home'));

      const results = memoryStore.search('dark', userId, 10);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(m => m.content.text.includes('dark'))).toBe(true);
    });

    it('should track recall count and last recalled timestamp', () => {
      const userId = 'test-user-recall-track-001';
      const memoryId = 'mem_recall_track_001';

      const record = createMemoryRecord(memoryId, userId, 'user_preference', 'Important preference');
      record.retrieval = {
        keywords: ['important'],
        recallCount: 0,
      };

      memoryStore.save(record);

      const beforeRecall = memoryStore.getByMemoryId(memoryId);
      expect(beforeRecall?.retrieval.recallCount).toBe(0);

      const patch = {
        retrieval: {
          ...beforeRecall!.retrieval,
          recallCount: beforeRecall!.retrieval.recallCount + 1,
          lastRecalledAt: new Date().toISOString(),
        },
      };
      memoryStore.applyPatch(memoryId, patch);

      const afterRecall = memoryStore.getByMemoryId(memoryId);
      expect(afterRecall?.retrieval.recallCount).toBe(1);
      expect(afterRecall?.retrieval.lastRecalledAt).toBeDefined();
    });
  });

  describe('Memory delete/tombstone', () => {
    it('should soft delete memory and mark status as deleted', () => {
      const userId = 'test-user-delete-001';
      const memoryId = 'mem_delete_001';

      const record = createMemoryRecord(memoryId, userId, 'user_preference', 'Temporary preference');
      record.fingerprint = 'fp_delete_001';
      record.sourceWindowHash = 'hash_delete_001';

      memoryStore.save(record);

      memoryStore.delete(memoryId);

      const deleted = memoryStore.getByMemoryId(memoryId);
      expect(deleted?.lifecycle.status).toBe('deleted');

      const userMemories = memoryStore.getByUserId(userId);
      const activeMemories = userMemories.filter(m => m.lifecycle.status !== 'deleted');
      expect(activeMemories.some(m => m.memoryId === memoryId)).toBe(false);
    });

    it('should create tombstone when memory is deleted', () => {
      const userId = 'test-user-tombstone-001';
      const memoryId = 'mem_tombstone_001';
      const fingerprint = 'fp_tombstone_001';
      const sourceWindowHash = 'hash_tombstone_001';

      const record = createMemoryRecord(memoryId, userId, 'user_preference', 'To be deleted');
      record.fingerprint = fingerprint;
      record.sourceWindowHash = sourceWindowHash;

      memoryStore.save(record);
      memoryStore.delete(memoryId);

      const hasTombstone = memoryStore.hasTombstone(userId, fingerprint, sourceWindowHash);
      expect(hasTombstone).toBe(true);
    });

    it('should prevent re-extraction of tombstoned memory', () => {
      const userId = 'test-user-reextract-001';
      const fingerprint = 'fp_reextract_001';
      const sourceWindowHash = 'hash_reextract_001';

      memoryStore.createTombstone({
        userId,
        fingerprint,
        sourceWindowHash,
        reason: 'user_delete',
      });

      const newRecord = createMemoryRecord('mem_new_001', userId, 'user_preference', 'New attempt');
      newRecord.fingerprint = fingerprint;
      newRecord.sourceWindowHash = sourceWindowHash;

      memoryStore.upsertExtracted(newRecord);

      const memories = memoryStore.getByUserId(userId);
      const newMemory = memories.find(m => m.memoryId === 'mem_new_001');
      expect(newMemory).toBeUndefined();
    });

    it('should upsert new memory version and supersede existing', () => {
      const userId = 'test-user-upsert-001';
      const fingerprint = 'fp_upsert_001';
      const sourceWindowHash = 'hash_upsert_001';

      const existingRecord = createMemoryRecord('mem_upsert_old', userId, 'user_preference', 'Old value');
      existingRecord.fingerprint = fingerprint;
      existingRecord.sourceWindowHash = sourceWindowHash;

      memoryStore.save(existingRecord);

      const newRecord = createMemoryRecord('mem_upsert_new', userId, 'user_preference', 'Updated value');
      newRecord.fingerprint = fingerprint;
      newRecord.sourceWindowHash = sourceWindowHash;

      memoryStore.upsertExtracted(newRecord);

      const oldMemory = memoryStore.getByMemoryId('mem_upsert_old');
      expect(oldMemory?.lifecycle.status).toBe('superseded');
      expect(oldMemory?.lifecycle.supersededBy).toBe('mem_upsert_new');

      const newMemory = memoryStore.getByMemoryId('mem_upsert_new');
      expect(newMemory?.lifecycle.status).toBe('active');
      expect(newMemory?.content.text).toBe('Updated value');
    });
  });

  describe('Replay no-write safety', () => {
    it('should build timeline from session events', () => {
      const sessionId = 'session_replay_001';
      const correlationId = 'corr_replay_001';

      const events: EventRecord[] = [
        {
          eventId: 'evt_replay_001',
          eventType: 'user_input',
          sourceModule: 'gateway',
          sessionId,
          correlationId,
          payload: { message: 'Test message' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_replay_002',
          eventType: 'processing',
          sourceModule: 'kernel',
          sessionId,
          correlationId,
          payload: { action: 'process_input' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:01:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.timeline.rootType).toBe('session');
      expect(result.timeline.rootId).toBe(sessionId);
      expect(result.timeline.events).toHaveLength(2);
    });

    it('should block external write operations by default', () => {
      const sessionId = 'session_blocked_001';

      const audit: AuditRecord = {
        auditId: 'audit_blocked_001',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'test-user-blocked-001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write_file',
        actionSummary: 'Write to external file',
        status: 'completed',
        payload: { filePath: '/tmp/test.txt' },
        riskLevel: 'high',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('partial');
      expect(result.blockedActions.length).toBeGreaterThan(0);
      expect(result.blockedActions[0]?.action).toContain('external');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should block tool execution operations by default', () => {
      const sessionId = 'session_tool_blocked_001';

      const audit: AuditRecord = {
        auditId: 'audit_tool_blocked_001',
        auditType: 'tool_call',
        timestamp: new Date().toISOString(),
        userId: 'test-user-tool-blocked-001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'execute_tool',
        actionSummary: 'Execute external API',
        status: 'completed',
        payload: { toolName: 'external_api' },
        riskLevel: 'medium',
        sensitivity: 'low',
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.length).toBeGreaterThan(0);
    });

    it('should block connector access operations by default', () => {
      const sessionId = 'session_connector_blocked_001';

      const audit: AuditRecord = {
        auditId: 'audit_connector_blocked_001',
        auditType: 'connector_access',
        timestamp: new Date().toISOString(),
        userId: 'test-user-connector-blocked-001',
        sessionId,
        sourceModule: 'connector',
        sourceAction: 'call_connector',
        actionSummary: 'Access external connector',
        status: 'completed',
        payload: { connectorId: 'salesforce' },
        riskLevel: 'medium',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should allow external writes when policy explicitly permits', () => {
      const sessionId = 'session_allowed_001';

      const audit: AuditRecord = {
        auditId: 'audit_allowed_001',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'test-user-allowed-001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write_file',
        actionSummary: 'Write to external file',
        status: 'completed',
        payload: { filePath: '/tmp/allowed.txt' },
        riskLevel: 'high',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const permissivePolicy: SafetyPolicy = {
        allowExternalWrites: true,
        allowToolExecution: false,
        allowConnectorAccess: false,
        maxReplayDepth: 10,
      };

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: permissivePolicy,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.filter(a => a.action.includes('external_write')).length).toBe(0);
    });

    it('should preserve trace references during replay', () => {
      const sessionId = 'session_trace_001';
      const correlationId = 'corr_trace_001';
      const traceId = 'trace_replay_001';

      const event: EventRecord = {
        eventId: 'evt_trace_replay',
        eventType: 'request',
        sourceModule: 'gateway',
        sessionId,
        correlationId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const traceContext: TraceContext = {
        traceId,
        rootSpanId: 'span_root_replay',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'completed',
      };

      traceStore.createTrace(traceContext);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.originalTraceRefs.length).toBeGreaterThan(0);
      expect(result.originalTraceRefs.some(ref => ref.traceId === traceId)).toBe(true);
      expect(result.originalTraceRefs.some(ref => ref.correlationId === correlationId)).toBe(true);
    });

    it('should rebuild state from workflow events', () => {
      const workflowRunId = 'wf_run_replay_001';
      const correlationId = 'corr_wf_replay_001';

      const events: EventRecord[] = [
        {
          eventId: 'evt_wf_start_replay',
          eventType: 'workflow_started',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: { workflowId: 'wf_001' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_wf_complete_replay',
          eventType: 'workflow_completed',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: { result: 'success' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:10:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'workflow_run',
        rootId: workflowRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.stateSnapshot).toBeDefined();
      expect(result.stateSnapshot?.workflowRun).toBeDefined();
      expect(result.stateSnapshot?.workflowRun?.workflowRunId).toBe(workflowRunId);
      expect(result.stateSnapshot?.workflowRun?.status).toBe('completed');
    });
  });
});

function createMemoryRecord(
  memoryId: string,
  userId: string,
  memoryType: MemoryType,
  text: string
): LongTermMemoryRecord {
  const now = new Date().toISOString();
  return {
    memoryId,
    userId,
    memoryType,
    content: { text },
    sourceRefs: {},
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'medium',
    sensitivity: 'low',
    lifecycle: {
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    retrieval: {
      keywords: [],
      recallCount: 0,
    },
  };
}
