import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js'
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js'
import { createSummaryManager, type SummaryManager } from '../../../src/memory/summary-manager.js'

describe('SummaryManager Source-bound Write Controls', () => {
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

  describe('sourceRefs validation', () => {
    it('should reject write with empty sourceRefs (MISSING_SOURCE_REFS)', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: {} as never },
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS')
        expect(result.message).toContain('sourceRefs must contain at least one')
      }
    })

    it('should reject write with missing sourceRefs', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: undefined as never },
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS')
      }
    })

    it('should accept write with transcriptRefs', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: { transcriptRefs: ['trans-001'] } },
      )

      expect(result.success).toBe(true)
    })

    it('should accept write with eventRange', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: { eventRange: { startEventId: 'evt-001', endEventId: 'evt-002' } } },
      )

      expect(result.success).toBe(true)
    })

    it('should accept write with previousSummaryRefs', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: { previousSummaryRefs: ['sum-001'] } },
      )

      expect(result.success).toBe(true)
    })
  })

  describe('deterministic fields protection', () => {
    it('should protect createdAt from LLM overwrite', async () => {
      const originalTime = '2024-01-01T00:00:00.000Z'

      summaryStore.save({
        summaryId: 'sum-existing',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        sourceRefs: validSourceRefs,
        summary: 'Original summary',
        status: 'active',
        createdAt: originalTime,
      })

      const result = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated by LLM' },
        {
          sourceRefs: validSourceRefs,
          isLlmGenerated: true,
        },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAt).toBe(originalTime)
      }
    })

    it('should protect userId from LLM overwrite', async () => {
      summaryStore.save({
        summaryId: 'sum-existing',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        sourceRefs: validSourceRefs,
        summary: 'Original summary',
        status: 'active',
        createdAt: new Date().toISOString(),
      })

      const result = await manager.writeSessionMemory(
        'session-001',
        'user-456',
        { summary: 'Updated by LLM' },
        {
          sourceRefs: validSourceRefs,
          isLlmGenerated: true,
        },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.userId).toBe('user-123')
      }
    })

    it('should protect sourceRefs from LLM overwrite', async () => {
      const originalRefs = { transcriptRefs: ['trans-001'] }

      summaryStore.save({
        summaryId: 'sum-existing',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        sourceRefs: originalRefs,
        summary: 'Original summary',
        status: 'active',
        createdAt: new Date().toISOString(),
      })

      const newRefs = { transcriptRefs: ['trans-999'] }
      const result = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated by LLM' },
        {
          sourceRefs: newRefs,
          isLlmGenerated: true,
        },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.sourceRefs).toEqual(originalRefs)
      }
    })

    it('should allow system writes to update fields', async () => {
      const originalTime = '2024-01-01T00:00:00.000Z'

      summaryStore.save({
        summaryId: 'sum-existing',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        sourceRefs: validSourceRefs,
        summary: 'Original summary',
        status: 'active',
        createdAt: originalTime,
      })

      const result = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated by system' },
        {
          sourceRefs: validSourceRefs,
          isLlmGenerated: false,
        },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.createdAt).toBe(originalTime)
        expect(result.data.summary).toBe('Updated by system')
      }
    })
  })

  describe('versioning', () => {
    it('should start with version 1 on first write', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'First summary' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.version).toBe(1)
      }
    })

    it('should increment version on updates', async () => {
      const createResult = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'First summary' },
        { sourceRefs: validSourceRefs },
      )

      expect(createResult.success).toBe(true)
      if (!createResult.success) return

      const updateResult = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated summary' },
        { sourceRefs: validSourceRefs },
      )

      expect(updateResult.success).toBe(true)
      if (updateResult.success) {
        expect(updateResult.version).toBe(2)
      }
    })

    it('should track version history', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) return

      const history = manager.getVersionHistory(result.data.summaryId)
      expect(history).toHaveLength(1)
      expect(history[0]?.version).toBe(1)
    })

    it('should track changed fields in version history', async () => {
      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'First summary' },
        { sourceRefs: validSourceRefs },
      )

      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated summary' },
        { sourceRefs: validSourceRefs },
      )

      const memory = summaryStore.getSessionMemory('session-001')
      expect(memory).not.toBeNull()

      if (memory) {
        const history = manager.getVersionHistory(memory.summaryId)
        expect(history.length).toBeGreaterThanOrEqual(2)

        const lastEntry = history[0]
        expect(lastEntry?.changedFields).toContain('summary')
      }
    })

    it('should return current version number', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Test summary' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (!result.success) return

      const currentVersion = manager.getCurrentVersion(result.data.summaryId)
      expect(currentVersion).toBe(1)
    })
  })

  describe('low-confidence fallback', () => {
    it('should store low-confidence fallback for invalid schema', () => {
      const rawContent = { invalid: 'data', missing: 'required fields' }
      const validationErrors = ['Missing required field: summary', 'Invalid type for structuredState']

      const record = manager.storeLowConfidenceFallback('session_memory', 'user-123', rawContent, validationErrors, {
        sourceRefs: validSourceRefs,
      })

      expect(record.status).toBe('candidate')
      expect(record.retrieval?.importance).toBe('low')
      expect(record.summary).toContain('LOW_CONFIDENCE')
      expect(record.summary).toContain('Schema validation failed')
      expect(record.structuredState?.validationErrors).toEqual(validationErrors)
      expect(record.structuredState?.rawContent).toEqual(rawContent)
    })

    it('should not corrupt canonical summary with invalid data', () => {
      summaryStore.save({
        summaryId: 'sum-canonical',
        summaryType: 'session_memory',
        userId: 'user-123',
        sessionId: 'session-001',
        sourceRefs: validSourceRefs,
        summary: 'Valid canonical summary',
        status: 'active',
        createdAt: new Date().toISOString(),
      })

      manager.storeLowConfidenceFallback('session_memory', 'user-123', { bad: 'data' }, ['Invalid schema'], {
        sourceRefs: validSourceRefs,
      })

      const canonical = summaryStore.getSessionMemory('session-001')
      expect(canonical?.summary).toBe('Valid canonical summary')
      expect(canonical?.status).toBe('active')
    })
  })

  describe('write methods for all summary types', () => {
    it('should write working summary', async () => {
      const result = await manager.writeWorkingSummary(
        'session-001',
        'run-001',
        'user-123',
        { summary: 'Working summary content' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('working_summary')
        expect(result.data.summary).toBe('Working summary content')
      }
    })

    it('should write session memory', async () => {
      const result = await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Session memory content' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('session_memory')
        expect(result.data.sessionId).toBe('session-001')
      }
    })

    it('should write rolling summary (5 turns)', async () => {
      const result = await manager.writeRollingSummary(
        'session-001',
        'user-123',
        'rolling_5_turns',
        {
          summary: 'Rolling summary',
          turnRange: { startTurn: 1, endTurn: 5 },
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('rolling_5_turns')
        expect(result.data.structuredState?.turnRange).toEqual({ startTurn: 1, endTurn: 5 })
      }
    })

    it('should write rolling summary (10 turns)', async () => {
      const result = await manager.writeRollingSummary(
        'session-001',
        'user-123',
        'rolling_10_turns',
        {
          summary: 'Rolling summary',
          turnRange: { startTurn: 1, endTurn: 10 },
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('rolling_10_turns')
      }
    })

    it('should write daily summary', async () => {
      const result = await manager.writeDailySummary(
        'user-123',
        { summary: 'Daily summary content' },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('daily_summary')
      }
    })

    it('should write workflow run summary', async () => {
      const result = await manager.writeWorkflowRunSummary(
        'workflow-run-001',
        'user-123',
        {
          summary: 'Workflow summary',
          workflowStatus: 'completed',
          stepSummary: { step1: 'done', step2: 'done' },
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('workflow_run_summary')
        expect(result.data.relatedRefs?.workflowRunId).toBe('workflow-run-001')
        expect(result.data.structuredState?.workflowStatus).toBe('completed')
      }
    })

    it('should write background subagent summary', async () => {
      const result = await manager.writeBackgroundSubagentSummary(
        'bg-run-001',
        'user-123',
        {
          summary: 'Background subagent summary',
          subagentType: 'explore',
          taskDescription: 'Search for files',
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('background_subagent_summary')
        expect(result.data.relatedRefs?.backgroundRunId).toBe('bg-run-001')
        expect(result.data.structuredState?.subagentType).toBe('explore')
      }
    })

    it('should write compact summary', async () => {
      const result = await manager.writeCompactSummary(
        'session-001',
        'user-123',
        {
          summary: 'Compact summary',
          compactedSummaryIds: ['sum-001', 'sum-002'],
          compressionRatio: 0.5,
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('compact_summary')
        expect(result.data.structuredState?.compactedSummaryIds).toEqual(['sum-001', 'sum-002'])
        expect(result.data.structuredState?.compressionRatio).toBe(0.5)
      }
    })

    it('should write weekly summary', async () => {
      const result = await manager.writeWeeklySummary(
        'user-123',
        {
          summary: 'Weekly summary',
          weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' },
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('weekly_summary')
        expect(result.data.structuredState?.weekRange).toEqual({ startDate: '2024-01-01', endDate: '2024-01-07' })
      }
    })

    it('should write planner run summary', async () => {
      const result = await manager.writePlannerRunSummary(
        'user-123',
        {
          summary: 'Planner run summary',
          plannerRunId: 'planner-run-001',
          planStatus: 'completed',
          stepSummary: { step1: 'done', step2: 'done' },
        },
        { sourceRefs: validSourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('planner_run_summary')
        expect(result.data.relatedRefs?.plannerRunId).toBe('planner-run-001')
        expect(result.data.structuredState?.planStatus).toBe('completed')
      }
    })
  })

  describe('diff-based updates', () => {
    it('should only update changed fields', async () => {
      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        {
          summary: 'Original summary',
          structuredState: { key1: 'value1', key2: 'value2' },
        },
        { sourceRefs: validSourceRefs },
      )

      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        {
          summary: 'Updated summary',
          structuredState: { key1: 'value1', key2: 'value2' },
        },
        { sourceRefs: validSourceRefs },
      )

      const memory = summaryStore.getSessionMemory('session-001')
      expect(memory).not.toBeNull()

      if (memory) {
        const history = manager.getVersionHistory(memory.summaryId)
        const lastEntry = history[0]
        expect(lastEntry?.changedFields).toContain('summary')
        expect(lastEntry?.changedFields).not.toContain('structuredState')
      }
    })

    it('should track previous values in diff', async () => {
      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Original summary' },
        { sourceRefs: validSourceRefs },
      )

      await manager.writeSessionMemory(
        'session-001',
        'user-123',
        { summary: 'Updated summary' },
        { sourceRefs: validSourceRefs },
      )

      const memory = summaryStore.getSessionMemory('session-001')
      expect(memory).not.toBeNull()

      if (memory) {
        const history = manager.getVersionHistory(memory.summaryId)
        const lastEntry = history[0]
        expect(lastEntry?.previousValues.summary).toBe('Original summary')
      }
    })
  })

  describe('validateSourceRefs', () => {
    it('should return true for valid transcriptRefs', () => {
      expect(manager.validateSourceRefs({ transcriptRefs: ['trans-001'] })).toBe(true)
    })

    it('should return true for valid eventRange', () => {
      expect(
        manager.validateSourceRefs({
          eventRange: { startEventId: 'evt-001', endEventId: 'evt-002' },
        }),
      ).toBe(true)
    })

    it('should return true for valid previousSummaryRefs', () => {
      expect(manager.validateSourceRefs({ previousSummaryRefs: ['sum-001'] })).toBe(true)
    })

    it('should return false for empty sourceRefs', () => {
      expect(manager.validateSourceRefs({})).toBe(false)
    })

    it('should return false for null sourceRefs', () => {
      expect(manager.validateSourceRefs(null as never)).toBe(false)
    })

    it('should return false for undefined sourceRefs', () => {
      expect(manager.validateSourceRefs(undefined as never)).toBe(false)
    })

    it('should return false for empty arrays', () => {
      expect(manager.validateSourceRefs({ transcriptRefs: [] })).toBe(false)
      expect(manager.validateSourceRefs({ previousSummaryRefs: [] })).toBe(false)
    })
  })
})
