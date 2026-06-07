import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js'
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js'
import { createSummaryManager, type SummaryManager } from '../../../src/memory/summary-manager.js'
import {
  createRollingSummaryPolicy,
  type RollingSummaryEvaluationContext,
  type ExtendedRollingSummaryPolicy,
} from '../../../src/memory/rolling-summary-policy.js'
import { createTopicShiftDetector, type TopicShiftDetector } from '../../../src/memory/topic-shift-detector.js'
import type { SourceRefs } from '../../../src/storage/summary-store.js'

describe('Rolling Summary Runtime Integration', () => {
  let connection: ConnectionManager
  let summaryStore: SummaryStore
  let transcriptStore: TranscriptStore
  let manager: SummaryManager
  let policy: ExtendedRollingSummaryPolicy
  let topicDetector: TopicShiftDetector

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    summaryStore = createSummaryStore(connection)
    transcriptStore = createTranscriptStore(connection)
    manager = createSummaryManager(summaryStore, transcriptStore)
    policy = createRollingSummaryPolicy()
    topicDetector = createTopicShiftDetector()
  })

  afterEach(() => {
    connection.close()
  })

  describe('maxTurns trigger integration', () => {
    it('should create rolling summary when maxTurns reached', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: Array.from({ length: 10 }, (_, i) => `turn-${i + 1}`),
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 10,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs,
        sessionId: 'session-maxturns',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('maxTurns')

      const result = await manager.writeRollingSummary(
        context.sessionId,
        context.userId,
        'rolling_10_turns',
        {
          summary: 'Summary of 10 turns',
          turnRange: evaluation.turnRange!,
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.summaryType).toBe('rolling_10_turns')
        expect(result.data.structuredState?.turnRange).toEqual({ startTurn: 1, endTurn: 10 })
      }
    })
  })

  describe('topic shift trigger integration', () => {
    it('should trigger rolling summary on topic shift with high confidence', async () => {
      const currentTopic = ['machine learning', 'neural networks', 'deep learning']
      const previousTopic = ['weather', 'forecast', 'temperature']

      const topicResult = topicDetector.detect(currentTopic, previousTopic)

      expect(topicResult.shiftDetected).toBe(true)
      expect(topicResult.confidence).toBeGreaterThan(0.7)

      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: topicResult.confidence,
        eventType: 'turn_completed',
        sourceRefs,
        sessionId: 'session-topicshift',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('topicShift')
    })

    it('should not trigger on low confidence topic shift', async () => {
      const currentTopic = ['coding', 'programming', 'typescript']
      const previousTopic = ['coding', 'javascript', 'programming']

      const topicResult = topicDetector.detect(currentTopic, previousTopic)

      expect(topicResult.shiftDetected).toBe(false)

      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: topicResult.confidence,
        eventType: 'turn_completed',
        sourceRefs,
        sessionId: 'session-notopicshift',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(false)
    })
  })

  describe('approval resolved trigger integration', () => {
    it('should trigger rolling summary on approval_resolved event with minTurns', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'approval_resolved',
        sourceRefs,
        sessionId: 'session-approval',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('eventType')

      const result = await manager.writeRollingSummary(
        context.sessionId,
        context.userId,
        'rolling_5_turns',
        {
          summary: 'Summary after approval resolved',
          turnRange: evaluation.turnRange!,
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
    })

    it('should not trigger on approval_resolved below minTurns', () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'approval_resolved',
        sourceRefs,
        sessionId: 'session-approval-low',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(false)
      expect(evaluation.reason).toBe('minTurnsNotReached')
    })
  })

  describe('idempotency - duplicate trigger prevention', () => {
    it('should prevent duplicate summaries for same sourceRefs and reason', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: [
          'turn-1',
          'turn-2',
          'turn-3',
          'turn-4',
          'turn-5',
          'turn-6',
          'turn-7',
          'turn-8',
          'turn-9',
          'turn-10',
        ],
      }

      const key = policy.generateIdempotencyKey('session-duplicate', sourceRefs, 'eventType')

      expect(policy.hasSummaryForKey(key)).toBe(false)

      policy.markSummaryCreated(key)

      expect(policy.hasSummaryForKey(key)).toBe(true)

      const result = await manager.writeRollingSummary(
        'session-duplicate',
        'user-1',
        'rolling_10_turns',
        {
          summary: 'First summary',
          turnRange: { startTurn: 1, endTurn: 10 },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)

      expect(policy.hasSummaryForKey(key)).toBe(true)
    })

    it('should allow different summaries for different sourceRefs', async () => {
      const sourceRefs1: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
      }
      const sourceRefs2: SourceRefs = {
        transcriptRefs: ['turn-6', 'turn-7', 'turn-8', 'turn-9', 'turn-10'],
      }

      const key1 = policy.generateIdempotencyKey('session-multi', sourceRefs1, 'eventType')
      const key2 = policy.generateIdempotencyKey('session-multi', sourceRefs2, 'eventType')

      expect(key1.sourceRefsHash).not.toBe(key2.sourceRefsHash)
      expect(policy.hasSummaryForKey(key1)).toBe(false)
      expect(policy.hasSummaryForKey(key2)).toBe(false)

      policy.markSummaryCreated(key1)

      expect(policy.hasSummaryForKey(key1)).toBe(true)
      expect(policy.hasSummaryForKey(key2)).toBe(false)
    })
  })

  describe('workflow and background completion triggers', () => {
    it('should trigger on workflow_completed regardless of turn count', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 2,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'workflow_completed',
        sourceRefs,
        sessionId: 'session-workflow',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('eventType')
    })

    it('should trigger on background_completed regardless of turn count', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'background_completed',
        sourceRefs,
        sessionId: 'session-background',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('eventType')
    })
  })

  describe('token pressure trigger', () => {
    it('should trigger on token_pressure with minTurns reached', () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'token_pressure',
        sourceRefs,
        sessionId: 'session-token',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(true)
      expect(evaluation.reason).toBe('eventType')
    })

    it('should not trigger on token_pressure below minTurns', () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3'],
      }

      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'token_pressure',
        sourceRefs,
        sessionId: 'session-token-low',
        userId: 'user-1',
      }

      const evaluation = policy.evaluate(context)

      expect(evaluation.shouldSummarize).toBe(false)
      expect(evaluation.reason).toBe('minTurnsNotReached')
    })
  })

  describe('summary persistence', () => {
    it('should persist rolling summary with correct turn range', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: Array.from({ length: 10 }, (_, i) => `turn-${i + 1}`),
      }

      const result = await manager.writeRollingSummary(
        'session-persist',
        'user-1',
        'rolling_10_turns',
        {
          summary: 'Test rolling summary',
          turnRange: { startTurn: 1, endTurn: 10 },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        const stored = summaryStore.getBySummaryId(result.data.summaryId)
        expect(stored).not.toBeNull()
        expect(stored?.summaryType).toBe('rolling_10_turns')
        expect(stored?.structuredState?.turnRange).toEqual({ startTurn: 1, endTurn: 10 })
      }
    })

    it('should track version history for rolling summaries', async () => {
      const sourceRefs: SourceRefs = {
        transcriptRefs: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
      }

      const result = await manager.writeRollingSummary(
        'session-version',
        'user-1',
        'rolling_5_turns',
        {
          summary: 'Version 1 summary',
          turnRange: { startTurn: 1, endTurn: 5 },
        },
        { sourceRefs },
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.version).toBe(1)

        const history = manager.getVersionHistory(result.data.summaryId)
        expect(history.length).toBe(1)
        expect(history[0]?.version).toBe(1)
      }
    })
  })
})
