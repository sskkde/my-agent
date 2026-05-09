import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRollingSummaryPolicy,
  type RollingSummaryEvaluationContext,
  type ExtendedRollingSummaryPolicy
} from '../../../src/memory/rolling-summary-policy.js';
import type { SourceRefs } from '../../../src/storage/summary-store.js';

describe('RollingSummaryPolicy', () => {
  let policy: ExtendedRollingSummaryPolicy;

  beforeEach(() => {
    policy = createRollingSummaryPolicy();
  });

  describe('maxTurns trigger', () => {
    it('should trigger at maxTurns=10 with reason "maxTurns"', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 10,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1', 't2'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('maxTurns');
      expect(result.turnRange).toEqual({ startTurn: 1, endTurn: 10 });
    });

    it('should trigger at turnCount > maxTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 12,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('maxTurns');
    });

    it('should not trigger before maxTurns without other conditions', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 8,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(false);
      expect(result.reason).toBe('noTrigger');
    });
  });

  describe('topic shift trigger', () => {
    it('should trigger on topic shift with confidence >= threshold', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 7,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0.8,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1', 't2'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('topicShift');
    });

    it('should not trigger on topic shift below minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0.9,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(false);
      expect(result.reason).toBe('minTurnsNotReached');
    });

    it('should not trigger on low confidence topic shift', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 7,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0.3,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(false);
      expect(result.reason).toBe('noTrigger');
    });
  });

  describe('event type triggers', () => {
    it('should trigger on approval_resolved with minTurns reached', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'approval_resolved',
        sourceRefs: { transcriptRefs: ['t1', 't2'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('eventType');
    });

    it('should trigger on workflow_completed regardless of turn count', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 2,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'workflow_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('eventType');
    });

    it('should trigger on background_completed regardless of turn count', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'background_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('eventType');
    });

    it('should trigger on token_pressure with minTurns reached', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 6,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'token_pressure',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.reason).toBe('eventType');
    });

    it('should not trigger on approval_resolved below minTurns', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 3,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'approval_resolved',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(false);
      expect(result.reason).toBe('minTurnsNotReached');
    });
  });

  describe('idempotency', () => {
    it('should generate unique idempotency keys for different sourceRefs', () => {
      const sourceRefs1: SourceRefs = { transcriptRefs: ['t1', 't2'] };
      const sourceRefs2: SourceRefs = { transcriptRefs: ['t3', 't4'] };

      const key1 = policy.generateIdempotencyKey('session-1', sourceRefs1, 'maxTurns');
      const key2 = policy.generateIdempotencyKey('session-1', sourceRefs2, 'maxTurns');

      expect(key1.sourceRefsHash).not.toBe(key2.sourceRefsHash);
    });

    it('should detect duplicate summary requests', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2'] };
      const key = policy.generateIdempotencyKey('session-1', sourceRefs, 'maxTurns');

      expect(policy.hasSummaryForKey(key)).toBe(false);

      policy.markSummaryCreated(key);

      expect(policy.hasSummaryForKey(key)).toBe(true);
    });

    it('should not mark duplicate for different sessions', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2'] };
      const key1 = policy.generateIdempotencyKey('session-1', sourceRefs, 'maxTurns');
      const key2 = policy.generateIdempotencyKey('session-2', sourceRefs, 'maxTurns');

      policy.markSummaryCreated(key1);

      expect(policy.hasSummaryForKey(key1)).toBe(true);
      expect(policy.hasSummaryForKey(key2)).toBe(false);
    });

    it('approval resolved triggers once - emit same event twice, assert one summary created', () => {
      const sourceRefs: SourceRefs = { transcriptRefs: ['t1', 't2', 't3', 't4', 't5', 't6'] };
      const key = policy.generateIdempotencyKey('session-1', sourceRefs, 'eventType');

      expect(policy.hasSummaryForKey(key)).toBe(false);

      policy.markSummaryCreated(key);

      expect(policy.hasSummaryForKey(key)).toBe(true);

      expect(policy.hasSummaryForKey(key)).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should return default config with minTurns=5, maxTurns=10', () => {
      const config = policy.getConfig();

      expect(config.maxTurns).toBe(10);
      expect(config.topicShiftThreshold).toBe(0.7);
      expect(config.enableTopicShiftTrigger).toBe(true);
    });

    it('should accept custom config overrides', () => {
      const customPolicy = createRollingSummaryPolicy({
        maxTurns: 15,
        topicShiftThreshold: 0.8
      });

      const config = customPolicy.getConfig();

      expect(config.maxTurns).toBe(15);
      expect(config.topicShiftThreshold).toBe(0.8);
    });

    it('should identify trigger events correctly', () => {
      expect(policy.isTriggerEvent('turn_completed')).toBe(true);
      expect(policy.isTriggerEvent('approval_resolved')).toBe(true);
      expect(policy.isTriggerEvent('artifact_switch')).toBe(true);
      expect(policy.isTriggerEvent('workflow_completed')).toBe(true);
      expect(policy.isTriggerEvent('background_completed')).toBe(true);
      expect(policy.isTriggerEvent('token_pressure')).toBe(true);
    });
  });

  describe('turn range calculation', () => {
    it('should calculate correct turn range after previous summary', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 15,
        lastSummaryTurn: 5,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.turnRange).toEqual({ startTurn: 6, endTurn: 15 });
    });

    it('should calculate turn range from start when no previous summary', () => {
      const context: RollingSummaryEvaluationContext = {
        turnCount: 10,
        lastSummaryTurn: 0,
        topicShiftConfidence: 0,
        eventType: 'turn_completed',
        sourceRefs: { transcriptRefs: ['t1'] },
        sessionId: 'session-1',
        userId: 'user-1'
      };

      const result = policy.evaluate(context);

      expect(result.shouldSummarize).toBe(true);
      expect(result.turnRange).toEqual({ startTurn: 1, endTurn: 10 });
    });
  });
});

describe('TopicShiftDetector', () => {
  it('should be importable and usable', async () => {
    const { createTopicShiftDetector } = await import('../../../src/memory/topic-shift-detector.js');

    const detector = createTopicShiftDetector();

    const result = detector.detect(['coding', 'programming', 'typescript'], ['weather', 'forecast', 'rain']);

    expect(result.shiftDetected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should not detect shift for similar topics', async () => {
    const { createTopicShiftDetector } = await import('../../../src/memory/topic-shift-detector.js');

    const detector = createTopicShiftDetector();

    const result = detector.detect(['coding', 'programming', 'typescript'], ['coding', 'javascript', 'programming']);

    expect(result.shiftDetected).toBe(false);
    expect(result.confidence).toBeLessThan(0.7);
  });
});