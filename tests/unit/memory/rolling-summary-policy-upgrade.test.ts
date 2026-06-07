import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRollingSummaryPolicy,
  type RollingSummaryEvaluationContext,
  type ExtendedRollingSummaryPolicy,
  type RollingSummaryTriggerEvent,
} from '../../../src/memory/rolling-summary-policy.js'
import type { RollingSummaryContext, RollingSummaryConfig } from '../../../src/memory/types.js'
import type { SourceRefs } from '../../../src/storage/summary-store.js'

describe('RollingSummaryPolicy Upgrade (PM-13)', () => {
  let policy: ExtendedRollingSummaryPolicy

  beforeEach(() => {
    policy = createRollingSummaryPolicy()
  })

  describe('new trigger events: topic_shift and plan_update', () => {
    it('should trigger on topic_shift event with minTurns reached', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0.8,
        eventType: 'topic_shift',
        sourceRefs: { transcriptRefs: ['t1', 't2'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('topicShift')
      expect(result.turnRange).toEqual({ startTurn: 1, endTurn: 6 })
    })

    it('should not trigger on topic_shift below minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0.9,
        eventType: 'topic_shift',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(false)
      expect(result.reason).toBe('minTurnsNotReached')
    })

    it('should trigger on plan_update event with minTurns reached', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'plan_update',
        sourceRefs: { transcriptRefs: ['t1', 't2'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
      expect(result.turnRange).toEqual({ startTurn: 1, endTurn: 6 })
    })

    it('should not trigger on plan_update below minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'plan_update',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(false)
      expect(result.reason).toBe('minTurnsNotReached')
    })
  })

  describe('backward compatibility: all 6 existing events still work', () => {
    const existingEvents: RollingSummaryTriggerEvent[] = [
      'turn_completed',
      'approval_resolved',
      'artifact_switch',
      'workflow_completed',
      'background_completed',
      'token_pressure',
    ]

    it.each(existingEvents)('should recognize existing event: %s', (eventType) => {
      expect(policy.isTriggerEvent(eventType)).toBe(true)
    })

    it('turn_completed triggers at maxTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 10,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('maxTurns')
    })

    it('approval_resolved triggers with minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'approval_resolved',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
    })

    it('artifact_switch triggers with minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'artifact_switch',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
    })

    it('workflow_completed triggers regardless of turn count', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 2,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'workflow_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
    })

    it('background_completed triggers regardless of turn count', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 2,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'background_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
    })

    it('token_pressure triggers with minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'token_pressure',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1',
      }

      const result = policy.evaluate(context)

      expect(result.shouldSummarize).toBe(true)
      expect(result.reason).toBe('eventType')
    })
  })

  describe('idempotency: same event does not trigger twice', () => {
    it('topic_shift idempotency: same sourceRefs only triggers once', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2', 't3'] }
      const key = policy.generateIdempotencyKey('session-1', sourceRefs, 'topicShift')

      expect(policy.hasSummaryForKey(key)).toBe(false)

      policy.markSummaryCreated(key)

      expect(policy.hasSummaryForKey(key)).toBe(true)
    })

    it('plan_update idempotency: same sourceRefs only triggers once', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2', 't3'] }
      const key = policy.generateIdempotencyKey('session-1', sourceRefs, 'eventType')

      expect(policy.hasSummaryForKey(key)).toBe(false)

      policy.markSummaryCreated(key)

      expect(policy.hasSummaryForKey(key)).toBe(true)
    })

    it('different sessions have separate idempotency keys', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2'] }
      const key1 = policy.generateIdempotencyKey('session-1', sourceRefs, 'topicShift')
      const key2 = policy.generateIdempotencyKey('session-2', sourceRefs, 'topicShift')

      policy.markSummaryCreated(key1)

      expect(policy.hasSummaryForKey(key1)).toBe(true)
      expect(policy.hasSummaryForKey(key2)).toBe(false)
    })
  })

  describe('minTurnsBetweenSummaries prevents too-frequent triggers', () => {
    it('shouldTrigger respects minTurnsBetweenSummaries for topic_shift', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 7,
        lastSummaryTurnCount: 5,
        recentTranscriptSegments: ['user asked about weather', 'assistant talked about forecast'],
        currentTopicKeywords: ['weather', 'forecast'],
        previousTopicKeywords: ['coding', 'typescript'],
      }

      const config: RollingSummaryConfig = {
        maxTurns: 10,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        minTurnsBetweenSummaries: 5,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(false)
      expect(result.reason).toBe('no_trigger')
    })

    it('shouldTrigger allows topic_shift when minTurnsBetweenSummaries satisfied', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 10,
        lastSummaryTurnCount: 3,
        recentTranscriptSegments: ['user asked about weather', 'assistant talked about forecast'],
        currentTopicKeywords: ['weather', 'forecast'],
        previousTopicKeywords: ['coding', 'typescript'],
      }

      const config: RollingSummaryConfig = {
        maxTurns: 15,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        minTurnsBetweenSummaries: 5,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(true)
      expect(result.reason).toBe('topic_shift_detected')
    })
  })

  describe('token_pressure_triggered reason', () => {
    it('shouldTrigger returns token_pressure_triggered when pressure exceeds threshold', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 8,
        lastSummaryTurnCount: 2,
        recentTranscriptSegments: ['some content'],
        currentTopicKeywords: ['topic'],
        previousTopicKeywords: ['topic'],
        currentTokenPressure: 0.85,
      }

      const config: RollingSummaryConfig = {
        maxTurns: 15,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        maxTokenPressure: 0.8,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(true)
      expect(result.reason).toBe('token_pressure_triggered')
    })

    it('shouldTrigger does not trigger when token pressure below threshold', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 8,
        lastSummaryTurnCount: 2,
        recentTranscriptSegments: ['some content'],
        currentTopicKeywords: ['topic'],
        previousTopicKeywords: ['topic'],
        currentTokenPressure: 0.5,
      }

      const config: RollingSummaryConfig = {
        maxTurns: 15,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        maxTokenPressure: 0.8,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(false)
      expect(result.reason).toBe('no_trigger')
    })
  })

  describe('plan_update_detected reason', () => {
    it('shouldTrigger returns plan_update_detected when transcript contains plan update', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 8,
        lastSummaryTurnCount: 2,
        recentTranscriptSegments: ['user updated the plan', 'assistant acknowledged plan update'],
        currentTopicKeywords: ['plan'],
        previousTopicKeywords: ['plan'],
        lastSummaryTurn: 2,
      }

      const config: RollingSummaryConfig = {
        maxTurns: 15,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        minTurnsBetweenSummaries: 3,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(true)
      expect(result.reason).toBe('plan_update_detected')
    })

    it('shouldTrigger does not trigger plan_update below minTurnsBetweenSummaries', () => {
      const context: RollingSummaryContext = {
        currentTurnCount: 4,
        lastSummaryTurnCount: 2,
        recentTranscriptSegments: ['user updated the plan'],
        currentTopicKeywords: ['plan'],
        previousTopicKeywords: ['plan'],
        lastSummaryTurn: 2,
      }

      const config: RollingSummaryConfig = {
        maxTurns: 15,
        enableTopicShiftTrigger: true,
        topicShiftThreshold: 0.7,
        minTurnsBetweenSummaries: 5,
      }

      const result = policy.shouldTrigger(context, config)

      expect(result.shouldTrigger).toBe(false)
      expect(result.reason).toBe('no_trigger')
    })
  })

  describe('new trigger events are recognized', () => {
    it('isTriggerEvent returns true for topic_shift', () => {
      expect(policy.isTriggerEvent('topic_shift')).toBe(true)
    })

    it('isTriggerEvent returns true for plan_update', () => {
      expect(policy.isTriggerEvent('plan_update')).toBe(true)
    })
  })
})
