import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js'
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js'
import { createSummaryManager, type SummaryManager } from '../../../src/memory/summary-manager.js'
import type { PlannerRunSummaryContent } from '../../../src/memory/types.js'

describe('writePlannerRunSummary', () => {
  let connection: ConnectionManager
  let summaryStore: SummaryStore
  let transcriptStore: TranscriptStore
  let manager: SummaryManager

  const validSourceRefs = {
    transcriptRefs: ['trans-001', 'trans-002'],
  }

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    summaryStore = createSummaryStore(connection)
    transcriptStore = createTranscriptStore(connection)
    manager = createSummaryManager(summaryStore, transcriptStore)
  })

  afterEach(() => {
    connection.close()
  })

  describe('write and read', () => {
    it('should write planner run summary and store correct summaryType', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Planner executed successfully',
        plannerRunId: 'planner-run-001',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('planner_run_summary')
        expect(result.data.summary).toBe('Planner executed successfully')
      }
    })

    it('should store plannerRunId in relatedRefs', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Planner summary content',
        plannerRunId: 'planner-run-abc',
        planStatus: 'in_progress',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.relatedRefs?.plannerRunId).toBe('planner-run-abc')
      }
    })

    it('should store planStatus in structuredState', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Planner status test',
        plannerRunId: 'planner-run-002',
        planStatus: 'failed',
      }

      const result = await manager.writePlannerRunSummary('user-456', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.planStatus).toBe('failed')
      }
    })
  })

  describe('sourceRefs validation', () => {
    it('should reject write with empty sourceRefs (MISSING_SOURCE_REFS)', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Test summary',
        plannerRunId: 'planner-run-003',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: {} as never })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS')
        expect(result.message).toContain('sourceRefs must contain at least one')
      }
    })

    it('should reject write with missing sourceRefs', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Test summary',
        plannerRunId: 'planner-run-004',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: undefined as never })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS')
      }
    })

    it('should accept write with valid transcriptRefs', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Valid transcript refs',
        plannerRunId: 'planner-run-005',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, {
        sourceRefs: { transcriptRefs: ['trans-001'] },
      })

      expect(result.success).toBe(true)
    })

    it('should accept write with eventRange sourceRefs', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Event range refs',
        plannerRunId: 'planner-run-006',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, {
        sourceRefs: { eventRange: { startEventId: 'evt-001', endEventId: 'evt-002' } },
      })

      expect(result.success).toBe(true)
    })

    it('should accept write with previousSummaryRefs sourceRefs', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Previous summary refs',
        plannerRunId: 'planner-run-007',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, {
        sourceRefs: { previousSummaryRefs: ['sum-001', 'sum-002'] },
      })

      expect(result.success).toBe(true)
    })
  })

  describe('deterministic fields protection', () => {
    it('should preserve createdAt when multiple writes occur for same plannerRunId', async () => {
      const firstResult = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'First planner run summary',
          plannerRunId: 'planner-run-dup',
          planStatus: 'in_progress',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(firstResult.success).toBe(true)
      if (!firstResult.success) return

      const firstCreatedAt = firstResult.data.createdAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const secondResult = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Second planner run summary',
          plannerRunId: 'planner-run-dup',
          planStatus: 'completed',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(secondResult.success).toBe(true)
      if (!secondResult.success) return

      const firstRecord = summaryStore.getBySummaryId(firstResult.data.summaryId)
      expect(firstRecord?.createdAt).toBe(firstCreatedAt)

      expect(secondResult.data.createdAt).not.toBe(firstCreatedAt)
    })

    it('should create independent records for each write', async () => {
      const result1 = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Summary 1',
          plannerRunId: 'planner-multi',
          planStatus: 'pending',
        },
        { sourceRefs: validSourceRefs },
      )

      const result2 = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Summary 2',
          plannerRunId: 'planner-multi',
          planStatus: 'completed',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      if (result1.success && result2.success) {
        expect(result1.data.summaryId).not.toBe(result2.data.summaryId)

        const record1 = summaryStore.getBySummaryId(result1.data.summaryId)
        const record2 = summaryStore.getBySummaryId(result2.data.summaryId)

        expect(record1).not.toBeNull()
        expect(record2).not.toBeNull()
        expect(record1?.summary).toBe('Summary 1')
        expect(record2?.summary).toBe('Summary 2')
      }
    })
  })

  describe('version tracking', () => {
    it('should start with version 1 on first write', async () => {
      const result = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Version test',
          plannerRunId: 'planner-run-ver',
          planStatus: 'completed',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.version).toBe(1)
      }
    })

    it('should track version history', async () => {
      const result = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'History test',
          plannerRunId: 'planner-run-hist',
          planStatus: 'completed',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) return

      const history = manager.getVersionHistory(result.data.summaryId)
      expect(history).toHaveLength(1)
      expect(history[0]?.version).toBe(1)
      expect(history[0]?.createdBy).toBe('system')
    })

    it('should return current version via getCurrentVersion', async () => {
      const result = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Current version test',
          plannerRunId: 'planner-run-cv',
          planStatus: 'completed',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) return

      const currentVersion = manager.getCurrentVersion(result.data.summaryId)
      expect(currentVersion).toBe(1)
    })
  })

  describe('stepSummary storage', () => {
    it('should store stepSummary in structuredState when provided', async () => {
      const stepSummary = {
        step1: { status: 'completed', duration: 100 },
        step2: { status: 'completed', duration: 200 },
        step3: { status: 'skipped', reason: 'condition not met' },
      }

      const content: PlannerRunSummaryContent = {
        summary: 'Planner with step summary',
        plannerRunId: 'planner-run-steps',
        planStatus: 'completed',
        stepSummary,
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.stepSummary).toEqual(stepSummary)
      }
    })

    it('should handle missing stepSummary gracefully', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Planner without step summary',
        plannerRunId: 'planner-run-no-steps',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.stepSummary).toBeUndefined()
      }
    })

    it('should store complex nested stepSummary', async () => {
      const stepSummary = {
        phases: {
          planning: { completed: true, substeps: ['analyze', 'design', 'validate'] },
          execution: { completed: true, attempts: 3 },
          cleanup: { completed: false, reason: 'not_required' },
        },
        metrics: {
          totalTime: 5000,
          retryCount: 2,
        },
      }

      const content: PlannerRunSummaryContent = {
        summary: 'Complex step summary',
        plannerRunId: 'planner-run-complex',
        planStatus: 'completed',
        stepSummary,
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.stepSummary).toEqual(stepSummary)
      }
    })
  })

  describe('retrieval metadata', () => {
    it('should store retrieval metadata when provided', async () => {
      const retrieval = {
        keywords: ['planner', 'execution', 'task'],
        importance: 'high' as const,
      }

      const content: PlannerRunSummaryContent = {
        summary: 'Planner with retrieval',
        plannerRunId: 'planner-run-retrieval',
        planStatus: 'completed',
        retrieval,
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.retrieval).toEqual(retrieval)
      }
    })

    it('should default retrieval to empty keywords and medium importance', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Planner without retrieval',
        plannerRunId: 'planner-run-default-retrieval',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.retrieval).toEqual({
          keywords: [],
          importance: 'medium',
        })
      }
    })

    it('should store custom keywords and importance', async () => {
      const retrieval = {
        keywords: ['critical', 'milestone', 'phase1'],
        importance: 'high' as const,
      }

      const content: PlannerRunSummaryContent = {
        summary: 'High importance planner run',
        plannerRunId: 'planner-run-high',
        planStatus: 'completed',
        retrieval,
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.retrieval?.keywords).toEqual(['critical', 'milestone', 'phase1'])
        expect(result.data.retrieval?.importance).toBe('high')
      }
    })

    it('should store low importance retrieval', async () => {
      const retrieval = {
        keywords: ['draft'],
        importance: 'low' as const,
      }

      const content: PlannerRunSummaryContent = {
        summary: 'Low importance planner run',
        plannerRunId: 'planner-run-low',
        planStatus: 'draft',
        retrieval,
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.retrieval?.importance).toBe('low')
      }
    })
  })

  describe('structuredState merge', () => {
    it('should merge custom structuredState with planStatus and stepSummary', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Merged state test',
        plannerRunId: 'planner-run-merge',
        planStatus: 'completed',
        stepSummary: { step1: 'done' },
        structuredState: {
          customField: 'customValue',
          nestedObject: {
            key1: 'value1',
            key2: 'value2',
          },
        },
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.customField).toBe('customValue')
        expect(result.data.structuredState?.nestedObject).toEqual({
          key1: 'value1',
          key2: 'value2',
        })

        expect(result.data.structuredState?.planStatus).toBe('completed')
        expect(result.data.structuredState?.stepSummary).toEqual({ step1: 'done' })
      }
    })

    it('should allow custom structuredState without planStatus conflict', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Custom state without conflict',
        plannerRunId: 'planner-run-no-conflict',
        planStatus: 'pending',
        structuredState: {
          estimatedDuration: 3600,
          dependencies: ['task-1', 'task-2'],
          metadata: { priority: 'high' },
        },
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.estimatedDuration).toBe(3600)
        expect(result.data.structuredState?.dependencies).toEqual(['task-1', 'task-2'])
        expect(result.data.structuredState?.metadata).toEqual({ priority: 'high' })
        expect(result.data.structuredState?.planStatus).toBe('pending')
      }
    })

    it('should include stepSummary in structuredState when provided', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Step summary included',
        plannerRunId: 'planner-run-include-steps',
        planStatus: 'in_progress',
        stepSummary: {
          completed: ['step1', 'step2'],
          pending: ['step3'],
        },
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.stepSummary).toEqual({
          completed: ['step1', 'step2'],
          pending: ['step3'],
        })
        expect(result.data.structuredState?.planStatus).toBe('in_progress')
      }
    })

    it('should handle empty structuredState', async () => {
      const content: PlannerRunSummaryContent = {
        summary: 'Empty structured state',
        plannerRunId: 'planner-run-empty-state',
        planStatus: 'completed',
      }

      const result = await manager.writePlannerRunSummary('user-123', content, { sourceRefs: validSourceRefs })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.structuredState?.planStatus).toBe('completed')
        expect(result.data.structuredState?.stepSummary).toBeUndefined()
      }
    })
  })
})
