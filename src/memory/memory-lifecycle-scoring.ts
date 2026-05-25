import type { LongTermMemoryRecord, Importance, MemoryStatus } from '../storage/long-term-memory-store.js';

/**
 * Lifecycle Scoring - Shadow Mode
 * PM-19: Score memories based on recency/frequency/importance/relevance
 * WITHOUT modifying lifecycle state (pure function).
 */

export interface LifecycleScore {
  score: number; // Weighted average 0-1
  recommendation: 'active' | 'low_priority' | 'archive_candidate';
  breakdown: {
    recency: number; // 0-1 sub-score
    frequency: number; // 0-1 sub-score
    importance: number; // 0-1 sub-score
    relevance: number; // 0-1 sub-score (heuristic)
  };
}

const WEIGHTS = {
  recency: 0.3,
  frequency: 0.25,
  importance: 0.3,
  relevance: 0.15,
} as const;

const IMPORTANCE_SCORE: Record<Importance, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

/**
 * Feature flag for lifecycle scoring shadow mode.
 * When OFF, LifecycleScorer can still be used in tests,
 * but should not be wired into production paths.
 */
export function isLifecycleScoringShadowEnabled(): boolean {
  return process.env.LIFECYCLE_SCORING_SHADOW === 'true';
}

export function isLifecyclePolicyEnabled(): boolean {
  return process.env.LIFECYCLE_POLICY_ENABLED === 'true';
}

export type LifecyclePolicyPhase = 'score_only' | 'low_priority_only' | 'full_rollout';

export function getLifecyclePolicyPhase(): LifecyclePolicyPhase {
  const phase = process.env.LIFECYCLE_POLICY_PHASE;
  if (phase === 'low_priority_only') return 'low_priority_only';
  if (phase === 'full_rollout') return 'full_rollout';
  return 'score_only'; // default
}

/**
 * Apply lifecycle policy to transition memory status based on score and phase.
 * Returns the new MemoryStatus (or the original status if no transition occurs).
 */
export function applyLifecyclePolicy(
  score: LifecycleScore,
  memory: LongTermMemoryRecord,
  phase?: LifecyclePolicyPhase,
): { newStatus: MemoryStatus; transitioned: boolean } {
  const effectivePhase = phase ?? getLifecyclePolicyPhase();

  if (!isLifecyclePolicyEnabled() || effectivePhase === 'score_only') {
    return { newStatus: memory.lifecycle.status, transitioned: false };
  }

  if (effectivePhase === 'low_priority_only') {
    if (score.recommendation === 'archive_candidate' && score.score < 0.3) {
      return { newStatus: 'low_priority', transitioned: true };
    }
    return { newStatus: memory.lifecycle.status, transitioned: false };
  }

  // full_rollout — follow recommendation exactly
  if (score.recommendation === 'archive_candidate') {
    return { newStatus: 'archived', transitioned: true };
  }
  if (score.recommendation === 'low_priority') {
    return { newStatus: 'low_priority', transitioned: true };
  }
  // active recommendation — no change
  return { newStatus: memory.lifecycle.status, transitioned: false };
}

export class LifecycleScorer {
  /**
   * Score a memory record based on lifecycle factors.
   * This is a PURE FUNCTION - it does NOT modify the memory record.
   */
  score(memory: LongTermMemoryRecord, contextQuery?: string): LifecycleScore {
    const recency = this.scoreRecency(memory);
    const frequency = this.scoreFrequency(memory);
    const importance = this.scoreImportance(memory);
    const relevance = this.scoreRelevance(memory, contextQuery);

    const weightedScore =
      recency * WEIGHTS.recency +
      frequency * WEIGHTS.frequency +
      importance * WEIGHTS.importance +
      relevance * WEIGHTS.relevance;

    return {
      score: Math.round(weightedScore * 1000) / 1000, // round to 3 decimals
      recommendation: this.getRecommendation(weightedScore),
      breakdown: { recency, frequency, importance, relevance },
    };
  }

  /**
   * Recency score based on last accessed time.
   * - Last 24h: 1.0
   * - Last 7d: 0.8
   * - Last 30d: 0.5
   * - Last 90d: 0.3
   * - Older: 0.1
   * - No access time: 0.5 (neutral)
   */
  private scoreRecency(memory: LongTermMemoryRecord): number {
    const accessTime = memory.lifecycle.lastAccessedAt ?? memory.lifecycle.updatedAt;
    if (!accessTime) {
      return 0.5; // neutral if no access time available
    }

    const accessDate = new Date(accessTime);
    const now = new Date();
    const elapsedDays = (now.getTime() - accessDate.getTime()) / (1000 * 60 * 60 * 24);
    const daysSinceAccess = Math.max(0, Math.floor(elapsedDays));

    if (daysSinceAccess <= 1) return 1.0; // last 24h
    if (daysSinceAccess <= 7) return 0.8; // last 7 days
    if (daysSinceAccess <= 30) return 0.5; // last 30 days
    if (daysSinceAccess <= 90) return 0.3; // last 90 days
    return 0.1; // older than 90 days
  }

  /**
   * Frequency score based on recall count.
   * - 0 recalls: 0.1
   * - 1-2: 0.3
   * - 3-5: 0.5
   * - 6-10: 0.7
   * - 10+: 0.9
   */
  private scoreFrequency(memory: LongTermMemoryRecord): number {
    const recallCount = memory.retrieval.recallCount;

    if (recallCount === 0) return 0.1;
    if (recallCount <= 2) return 0.3;
    if (recallCount <= 5) return 0.5;
    if (recallCount <= 10) return 0.7;
    return 0.9;
  }

  /**
   * Importance score - direct mapping from importance field.
   * - critical: 1.0
   * - high: 0.75
   * - medium: 0.5
   * - low: 0.25
   */
  private scoreImportance(memory: LongTermMemoryRecord): number {
    return IMPORTANCE_SCORE[memory.importance];
  }

  /**
   * Relevance score based on keyword overlap with context query.
   * - No contextQuery or no keywords: 0.5 (neutral)
   * - Otherwise: ratio of matching keywords to total keywords
   */
  private scoreRelevance(memory: LongTermMemoryRecord, contextQuery?: string): number {
    if (!contextQuery || memory.retrieval.keywords.length === 0) {
      return 0.5; // neutral
    }

    const queryLower = contextQuery.toLowerCase();
    const matchingKeywords = memory.retrieval.keywords.filter((keyword) =>
      queryLower.includes(keyword.toLowerCase())
    );

    const ratio = matchingKeywords.length / memory.retrieval.keywords.length;
    return Math.min(1, Math.max(0, ratio)); // clamp to 0-1
  }

  /**
   * Determine recommendation based on weighted score.
   * - >= 0.6: active
   * - >= 0.3: low_priority
   * - < 0.3: archive_candidate
   */
  private getRecommendation(score: number): 'active' | 'low_priority' | 'archive_candidate' {
    if (score >= 0.6) return 'active';
    if (score >= 0.3) return 'low_priority';
    return 'archive_candidate';
  }
}
