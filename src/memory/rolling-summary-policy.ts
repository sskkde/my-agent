import type {
  RollingSummaryContext,
  RollingSummaryConfig,
  RollingSummaryDecision
} from './types.js';

export type { RollingSummaryPolicy } from './types.js';

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_TOPIC_SHIFT_THRESHOLD = 0.5;

type RollingSummaryPolicyType = {
  shouldTrigger(context: RollingSummaryContext, config: RollingSummaryConfig): RollingSummaryDecision;
  getDefaultConfig(): RollingSummaryConfig;
};

export function createRollingSummaryPolicy(): RollingSummaryPolicyType {
  return {
    shouldTrigger,
    getDefaultConfig
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
