import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LifecycleScorer,
  isLifecycleScoringShadowEnabled,
} from '../../../src/memory/memory-lifecycle-scoring.js';
import type { LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';

function makeMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  const now = new Date().toISOString();
  return {
    memoryId: 'mem-1',
    userId: 'user-1',
    memoryType: 'user_preference',
    content: { text: 'prefers dark mode' },
    sourceRefs: { transcriptRefs: ['t-1'] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'medium',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
    retrieval: { keywords: ['dark', 'mode'], recallCount: 5 },
    ...overrides,
  };
}

describe('LifecycleScorer', () => {
  let scorer: LifecycleScorer;
  let originalEnv: string | undefined;

  beforeEach(() => {
    scorer = new LifecycleScorer();
    originalEnv = process.env.LIFECYCLE_SCORING_SHADOW;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LIFECYCLE_SCORING_SHADOW;
    } else {
      process.env.LIFECYCLE_SCORING_SHADOW = originalEnv;
    }
  });

  describe('recency scoring', () => {
    it('recent memory scores high on recency', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
      });
      const result = scorer.score(memory);
      expect(result.breakdown.recency).toBe(1.0);
    });

    it('old memory scores low on recency', () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: oldDate, updatedAt: oldDate, lastAccessedAt: oldDate },
      });
      const result = scorer.score(memory);
      expect(result.breakdown.recency).toBe(0.1);
    });

    it('memory with no lastAccessedAt uses updatedAt', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: now, updatedAt: now },
      });
      const result = scorer.score(memory);
      expect(result.breakdown.recency).toBe(1.0);
    });
  });

  describe('frequency scoring', () => {
    it('frequently recalled memory scores high on frequency', () => {
      const memory = makeMemory({ retrieval: { keywords: ['dark', 'mode'], recallCount: 15 } });
      const result = scorer.score(memory);
      expect(result.breakdown.frequency).toBe(0.9);
    });

    it('never-recalled memory scores low on frequency', () => {
      const memory = makeMemory({ retrieval: { keywords: ['dark', 'mode'], recallCount: 0 } });
      const result = scorer.score(memory);
      expect(result.breakdown.frequency).toBe(0.1);
    });

    it('recall count 1-2 scores 0.3', () => {
      const memory = makeMemory({ retrieval: { keywords: ['dark', 'mode'], recallCount: 2 } });
      const result = scorer.score(memory);
      expect(result.breakdown.frequency).toBe(0.3);
    });

    it('recall count 3-5 scores 0.5', () => {
      const memory = makeMemory({ retrieval: { keywords: ['dark', 'mode'], recallCount: 5 } });
      const result = scorer.score(memory);
      expect(result.breakdown.frequency).toBe(0.5);
    });

    it('recall count 6-10 scores 0.7', () => {
      const memory = makeMemory({ retrieval: { keywords: ['dark', 'mode'], recallCount: 8 } });
      const result = scorer.score(memory);
      expect(result.breakdown.frequency).toBe(0.7);
    });
  });

  describe('importance scoring', () => {
    it('critical importance scores 1.0', () => {
      const memory = makeMemory({ importance: 'critical' });
      const result = scorer.score(memory);
      expect(result.breakdown.importance).toBe(1.0);
    });

    it('high importance scores 0.75', () => {
      const memory = makeMemory({ importance: 'high' });
      const result = scorer.score(memory);
      expect(result.breakdown.importance).toBe(0.75);
    });

    it('medium importance scores 0.5', () => {
      const memory = makeMemory({ importance: 'medium' });
      const result = scorer.score(memory);
      expect(result.breakdown.importance).toBe(0.5);
    });

    it('low importance scores 0.25', () => {
      const memory = makeMemory({ importance: 'low' });
      const result = scorer.score(memory);
      expect(result.breakdown.importance).toBe(0.25);
    });
  });

  describe('relevance scoring', () => {
    it('keywords overlap boosts relevance', () => {
      const memory = makeMemory({
        retrieval: { keywords: ['dark', 'mode', 'theme'], recallCount: 5 },
      });
      const result = scorer.score(memory, 'dark mode preferences');
      expect(result.breakdown.relevance).toBeGreaterThan(0.5);
    });

    it('no context query gives neutral relevance', () => {
      const memory = makeMemory({
        retrieval: { keywords: ['dark', 'mode'], recallCount: 5 },
      });
      const result = scorer.score(memory);
      expect(result.breakdown.relevance).toBe(0.5);
    });

    it('memory with no keywords gives neutral relevance', () => {
      const memory = makeMemory({
        retrieval: { keywords: [], recallCount: 5 },
      });
      const result = scorer.score(memory, 'dark mode preferences');
      expect(result.breakdown.relevance).toBe(0.5);
    });

    it('all keywords match gives relevance 1.0', () => {
      const memory = makeMemory({
        retrieval: { keywords: ['dark', 'mode'], recallCount: 5 },
      });
      const result = scorer.score(memory, 'dark mode');
      expect(result.breakdown.relevance).toBe(1.0);
    });

    it('partial keyword match gives proportional score', () => {
      const memory = makeMemory({
        retrieval: { keywords: ['dark', 'mode', 'theme', 'preferences'], recallCount: 5 },
      });
      // 2 out of 4 keywords match = 0.5
      const result = scorer.score(memory, 'dark mode');
      expect(result.breakdown.relevance).toBe(0.5);
    });
  });

  describe('recommendation', () => {
    it('high-scoring memory gets active recommendation', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        importance: 'critical',
        lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
        retrieval: { keywords: ['dark', 'mode'], recallCount: 15 },
      });
      const result = scorer.score(memory, 'dark mode');
      expect(result.recommendation).toBe('active');
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    it('low-scoring memory gets archive_candidate', () => {
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(); // 200 days ago
      const memory = makeMemory({
        importance: 'low',
        lifecycle: { status: 'active', createdAt: oldDate, updatedAt: oldDate, lastAccessedAt: oldDate },
        retrieval: { keywords: ['dark', 'mode'], recallCount: 0 },
      });
      // No context query = neutral relevance 0.5
      const result = scorer.score(memory);
      expect(result.recommendation).toBe('archive_candidate');
      expect(result.score).toBeLessThanOrEqual(0.3);
    });

    it('mid-range score gets low_priority recommendation', () => {
      const mediumDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(); // 15 days ago
      const memory = makeMemory({
        importance: 'medium',
        lifecycle: { status: 'active', createdAt: mediumDate, updatedAt: mediumDate, lastAccessedAt: mediumDate },
        retrieval: { keywords: ['dark', 'mode'], recallCount: 3 },
      });
      // No context query
      const result = scorer.score(memory);
      expect(result.recommendation).toBe('low_priority');
    });
  });

  describe('score calculation', () => {
    it('score is rounded to 3 decimal places', () => {
      const memory = makeMemory();
      const result = scorer.score(memory);
      // Verify score has at most 3 decimal places
      const scoreStr = result.score.toString();
      const decimalPart = scoreStr.split('.')[1] ?? '';
      expect(decimalPart.length).toBeLessThanOrEqual(3);
    });

    it('weighted average is calculated correctly', () => {
      const memory = makeMemory({
        importance: 'critical', // 1.0
        retrieval: { keywords: ['dark', 'mode'], recallCount: 15 }, // frequency 0.9
      });
      const result = scorer.score(memory, 'dark mode'); // relevance 1.0
      // recency=1.0 (today), frequency=0.9, importance=1.0, relevance=1.0
      // weighted = 1.0*0.3 + 0.9*0.25 + 1.0*0.3 + 1.0*0.15 = 0.3 + 0.225 + 0.3 + 0.15 = 0.975
      expect(result.score).toBe(0.975);
    });
  });

  describe('shadow mode - no mutation', () => {
    it('score() does not modify memory lifecycle status', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
      });
      const originalStatus = memory.lifecycle.status;

      scorer.score(memory);

      expect(memory.lifecycle.status).toBe(originalStatus);
    });

    it('score() does not modify any memory fields', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
        retrieval: { keywords: ['dark', 'mode'], recallCount: 5 },
      });
      const originalRecallCount = memory.retrieval.recallCount;
      const originalLastAccessedAt = memory.lifecycle.lastAccessedAt;

      scorer.score(memory);

      expect(memory.retrieval.recallCount).toBe(originalRecallCount);
      expect(memory.lifecycle.lastAccessedAt).toBe(originalLastAccessedAt);
    });
  });
});

describe('isLifecycleScoringShadowEnabled', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LIFECYCLE_SCORING_SHADOW;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LIFECYCLE_SCORING_SHADOW;
    } else {
      process.env.LIFECYCLE_SCORING_SHADOW = originalEnv;
    }
  });

  it('returns false by default', () => {
    delete process.env.LIFECYCLE_SCORING_SHADOW;
    expect(isLifecycleScoringShadowEnabled()).toBe(false);
  });

  it('returns true when set to "true"', () => {
    process.env.LIFECYCLE_SCORING_SHADOW = 'true';
    expect(isLifecycleScoringShadowEnabled()).toBe(true);
  });

  it('returns false when set to other values', () => {
    process.env.LIFECYCLE_SCORING_SHADOW = 'false';
    expect(isLifecycleScoringShadowEnabled()).toBe(false);

    process.env.LIFECYCLE_SCORING_SHADOW = '1';
    expect(isLifecycleScoringShadowEnabled()).toBe(false);
  });
});
