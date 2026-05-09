import type {
  RollingSummaryContext,
  RollingSummaryConfig,
  RollingSummaryDecision
} from './types.js';
import type { SourceRefs } from '../storage/summary-store.js';

export type { RollingSummaryPolicy } from './types.js';

const DEFAULT_MIN_TURNS = 5;
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TOPIC_SHIFT_THRESHOLD = 0.7;

export type RollingSummaryTriggerEvent =
  | 'turn_completed'
  | 'approval_resolved'
  | 'artifact_switch'
  | 'workflow_completed'
  | 'background_completed'
  | 'token_pressure';

export type RollingSummaryEvaluationContext = {
  turnCount: number;
  lastSummaryTurn: number;
  topicShiftConfidence: number;
  eventType: RollingSummaryTriggerEvent;
  sourceRefs: SourceRefs;
  sessionId: string;
  userId: string;
};

export type RollingSummaryEvaluationResult = {
  shouldSummarize: boolean;
  reason: 'maxTurns' | 'topicShift' | 'eventType' | 'minTurnsNotReached' | 'alreadySummarized' | 'noTrigger';
  turnRange?: { startTurn: number; endTurn: number };
};

export type RollingSummaryIdempotencyKey = {
  sessionId: string;
  sourceRefsHash: string;
  triggerReason: string;
};

export type ExtendedRollingSummaryPolicy = {
  shouldTrigger(context: RollingSummaryContext, config: RollingSummaryConfig): RollingSummaryDecision;
  getDefaultConfig(): RollingSummaryConfig;
  evaluate(context: RollingSummaryEvaluationContext): RollingSummaryEvaluationResult;
  getConfig(): RollingSummaryConfig;
  isTriggerEvent(eventType: RollingSummaryTriggerEvent): boolean;
  generateIdempotencyKey(sessionId: string, sourceRefs: SourceRefs, reason: string): RollingSummaryIdempotencyKey;
  hasSummaryForKey(key: RollingSummaryIdempotencyKey): boolean;
  markSummaryCreated(key: RollingSummaryIdempotencyKey): void;
};

function hashSourceRefs(sourceRefs: SourceRefs): string {
  const parts: string[] = [];
  if (sourceRefs.transcriptRefs && sourceRefs.transcriptRefs.length > 0) {
    parts.push(`transcript:${sourceRefs.transcriptRefs.sort().join(',')}`);
  }
  if (sourceRefs.eventRange) {
    parts.push(`events:${sourceRefs.eventRange.startEventId}-${sourceRefs.eventRange.endEventId}`);
  }
  if (sourceRefs.previousSummaryRefs && sourceRefs.previousSummaryRefs.length > 0) {
    parts.push(`summaries:${sourceRefs.previousSummaryRefs.sort().join(',')}`);
  }
  return parts.join('|');
}

export function createRollingSummaryPolicy(
  configOverrides: Partial<RollingSummaryConfig> = {}
): ExtendedRollingSummaryPolicy {
  const effectiveConfig: RollingSummaryConfig = {
    maxTurns: configOverrides.maxTurns ?? DEFAULT_MAX_TURNS,
    enableTopicShiftTrigger: configOverrides.enableTopicShiftTrigger ?? true,
    topicShiftThreshold: configOverrides.topicShiftThreshold ?? DEFAULT_TOPIC_SHIFT_THRESHOLD
  };

  const createdSummaries = new Set<string>();

  const triggerEvents: RollingSummaryTriggerEvent[] = [
    'turn_completed',
    'approval_resolved',
    'artifact_switch',
    'workflow_completed',
    'background_completed',
    'token_pressure'
  ];

  return {
    shouldTrigger,
    getDefaultConfig,
    evaluate,
    getConfig,
    isTriggerEvent,
    generateIdempotencyKey,
    hasSummaryForKey,
    markSummaryCreated
  };

  function shouldTrigger(
    context: RollingSummaryContext,
    config: RollingSummaryConfig
  ): RollingSummaryDecision {
    const turnsSinceLastSummary = context.currentTurnCount - context.lastSummaryTurnCount;

    if (turnsSinceLastSummary >= config.maxTurns) {
      return {
        shouldTrigger: true,
        reason: 'max_turns_reached',
        recommendedType: getRecommendedType(turnsSinceLastSummary)
      };
    }

    if (config.enableTopicShiftTrigger) {
      const topicShiftResult = detectTopicShift(context, config.topicShiftThreshold);

      if (topicShiftResult.detected) {
        return {
          shouldTrigger: true,
          reason: 'topic_shift_detected',
          topicShiftConfidence: topicShiftResult.confidence,
          recommendedType: 'rolling_5_turns'
        };
      }
    }

    return {
      shouldTrigger: false,
      reason: 'no_trigger',
      recommendedType: null
    };
  }

  function getDefaultConfig(): RollingSummaryConfig {
    return {
      maxTurns: DEFAULT_MAX_TURNS,
      enableTopicShiftTrigger: true,
      topicShiftThreshold: DEFAULT_TOPIC_SHIFT_THRESHOLD
    };
  }

  function evaluate(context: RollingSummaryEvaluationContext): RollingSummaryEvaluationResult {
    const { turnCount, lastSummaryTurn, topicShiftConfidence, eventType } = context;
    const turnsSinceLastSummary = turnCount - lastSummaryTurn;

    if (turnCount >= effectiveConfig.maxTurns) {
      return {
        shouldSummarize: true,
        reason: 'maxTurns',
        turnRange: { startTurn: lastSummaryTurn + 1, endTurn: turnCount }
      };
    }

    if (topicShiftConfidence >= effectiveConfig.topicShiftThreshold) {
      if (turnsSinceLastSummary >= DEFAULT_MIN_TURNS) {
        return {
          shouldSummarize: true,
          reason: 'topicShift',
          turnRange: { startTurn: lastSummaryTurn + 1, endTurn: turnCount }
        };
      }
    }

    if (triggerEvents.includes(eventType)) {
      if (eventType === 'approval_resolved' || eventType === 'artifact_switch') {
        if (turnsSinceLastSummary >= DEFAULT_MIN_TURNS) {
          return {
            shouldSummarize: true,
            reason: 'eventType',
            turnRange: { startTurn: lastSummaryTurn + 1, endTurn: turnCount }
          };
        }
      }

      if (eventType === 'workflow_completed' || eventType === 'background_completed') {
        if (turnCount > lastSummaryTurn) {
          return {
            shouldSummarize: true,
            reason: 'eventType',
            turnRange: { startTurn: lastSummaryTurn + 1, endTurn: turnCount }
          };
        }
      }

      if (eventType === 'token_pressure') {
        if (turnsSinceLastSummary >= DEFAULT_MIN_TURNS) {
          return {
            shouldSummarize: true,
            reason: 'eventType',
            turnRange: { startTurn: lastSummaryTurn + 1, endTurn: turnCount }
          };
        }
      }
    }

    if (turnsSinceLastSummary < DEFAULT_MIN_TURNS) {
      return { shouldSummarize: false, reason: 'minTurnsNotReached' };
    }

    return { shouldSummarize: false, reason: 'noTrigger' };
  }

  function getConfig(): RollingSummaryConfig {
    return { ...effectiveConfig };
  }

  function isTriggerEvent(eventType: RollingSummaryTriggerEvent): boolean {
    return triggerEvents.includes(eventType);
  }

  function generateIdempotencyKey(
    sessionId: string,
    sourceRefs: SourceRefs,
    reason: string
  ): RollingSummaryIdempotencyKey {
    return {
      sessionId,
      sourceRefsHash: hashSourceRefs(sourceRefs),
      triggerReason: reason
    };
  }

  function hasSummaryForKey(key: RollingSummaryIdempotencyKey): boolean {
    const keyString = `${key.sessionId}:${key.sourceRefsHash}:${key.triggerReason}`;
    return createdSummaries.has(keyString);
  }

  function markSummaryCreated(key: RollingSummaryIdempotencyKey): void {
    const keyString = `${key.sessionId}:${key.sourceRefsHash}:${key.triggerReason}`;
    createdSummaries.add(keyString);
  }

  function detectTopicShift(
    context: RollingSummaryContext,
    threshold: number
  ): { detected: boolean; confidence: number } {
    if (
      context.currentTopicKeywords.length === 0 &&
      context.previousTopicKeywords.length === 0
    ) {
      return { detected: false, confidence: 0 };
    }

    const currentSet = new Set(context.currentTopicKeywords.map(k => k.toLowerCase()));
    const previousSet = new Set(context.previousTopicKeywords.map(k => k.toLowerCase()));

    let commonCount = 0;
    for (const keyword of currentSet) {
      if (previousSet.has(keyword)) {
        commonCount++;
      }
    }

    const totalUnique = new Set([...currentSet, ...previousSet]).size;

    if (totalUnique === 0) {
      return { detected: false, confidence: 0 };
    }

    const overlapRatio = commonCount / totalUnique;
    const confidence = 1 - overlapRatio;

    return {
      detected: confidence >= threshold,
      confidence
    };
  }

  function getRecommendedType(turnsSinceLastSummary: number): 'rolling_5_turns' | 'rolling_10_turns' {
    return turnsSinceLastSummary >= 15 ? 'rolling_10_turns' : 'rolling_5_turns';
  }
}

export const defaultRollingSummaryPolicy = createRollingSummaryPolicy();
