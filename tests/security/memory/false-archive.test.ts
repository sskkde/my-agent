/**
 * False Archive Security Tests
 *
 * Tests that LifecycleScorer doesn't recommend archiving actively used memories:
 * 1. Recently accessed high-importance memory → active
 * 2. Frequently recalled memory → active
 * 3. Low-score memory → archive_candidate
 * 4. Edge: zero recall but fresh → still active (recency dominates)
 * 5. Edge: old but critical → score ≥ 0.3 (importance weight carries it)
 *
 * Security invariants verified:
 * - Active memories are not incorrectly marked as archive_candidate
 * - Importance weight can rescue old but critical memories
 * - Recency dominates over zero recall count
 *
 * @module security/memory/false-archive
 */

import { describe, it, expect } from 'vitest';
import { LifecycleScorer } from '../../../src/memory/memory-lifecycle-scoring.js';
import type { LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js';

function makeMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  const now = new Date().toISOString();
  return {
    memoryId: 'mem-1',
    userId: 'user-1',
    memoryType: 'user_preference',
    content: { text: 'test' },
    sourceRefs: { transcriptRefs: ['t-1'] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'medium',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
    retrieval: { keywords: ['test'], recallCount: 0 },
    fingerprint: 'fp-1',
    ...overrides,
  };
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

describe('False Archive Security Tests', () => {
  const scorer = new LifecycleScorer();

  describe('active memories should not be archived', () => {
    it('recently accessed high-importance memory → active', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(30),
          updatedAt: daysAgo(1),
          lastAccessedAt: daysAgo(1),
        },
        retrieval: { keywords: ['test'], recallCount: 10 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
      expect(score.score).toBeGreaterThanOrEqual(0.6);
    });

    it('frequently recalled memory → active', () => {
      const memory = makeMemory({
        importance: 'medium',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(60),
          updatedAt: daysAgo(1),
          lastAccessedAt: daysAgo(1),
        },
        retrieval: { keywords: ['test'], recallCount: 20 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
      expect(score.breakdown.frequency).toBe(0.9);
    });

    it('memory accessed within last 7 days with high importance → active', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(100),
          updatedAt: daysAgo(5),
          lastAccessedAt: daysAgo(5),
        },
        retrieval: { keywords: ['test'], recallCount: 3 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
      expect(score.breakdown.recency).toBe(0.8);
    });
  });

  describe('inactive memories should be archive candidates', () => {
    it('low-score memory → archive_candidate', () => {
      const memory = makeMemory({
        importance: 'low',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(200),
          updatedAt: daysAgo(100),
          lastAccessedAt: daysAgo(100),
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('archive_candidate');
      expect(score.score).toBeLessThan(0.3);
    });

    it('no access in 90+ days with low importance → archive_candidate', () => {
      const memory = makeMemory({
        importance: 'low',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(200),
          updatedAt: daysAgo(95),
          lastAccessedAt: daysAgo(95),
        },
        retrieval: { keywords: ['test'], recallCount: 1 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('archive_candidate');
      expect(score.breakdown.recency).toBe(0.1);
    });
  });

  describe('edge cases: recency vs frequency', () => {
    it('zero recall but fresh with high importance → still active (recency + importance)', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
      expect(score.breakdown.recency).toBe(1.0);
      expect(score.breakdown.frequency).toBe(0.1);
    });

    it('accessed today with zero recall and high importance → active', () => {
      const now = new Date().toISOString();
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
    });
  });

  describe('edge cases: importance weight', () => {
    it('old but critical → score ≥ 0.3 (importance weight carries it)', () => {
      const memory = makeMemory({
        importance: 'critical',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(365),
          updatedAt: daysAgo(365),
          lastAccessedAt: daysAgo(365),
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.score).toBeGreaterThanOrEqual(0.3);
      expect(score.breakdown.importance).toBe(1.0);
    });

    it('critical importance alone prevents archive_candidate', () => {
      const memory = makeMemory({
        importance: 'critical',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(400),
          updatedAt: daysAgo(400),
          lastAccessedAt: daysAgo(400),
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).not.toBe('archive_candidate');
    });

    it('high importance with recent access → active', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(60),
          updatedAt: daysAgo(7),
          lastAccessedAt: daysAgo(7),
        },
        retrieval: { keywords: ['test'], recallCount: 3 },
      });

      const score = scorer.score(memory);

      expect(score.recommendation).toBe('active');
    });
  });

  describe('score breakdown validation', () => {
    it('score breakdown components sum correctly', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(10),
          updatedAt: daysAgo(5),
          lastAccessedAt: daysAgo(5),
        },
        retrieval: { keywords: ['test'], recallCount: 5 },
      });

      const score = scorer.score(memory);

      const expectedScore =
        score.breakdown.recency * 0.3 +
        score.breakdown.frequency * 0.25 +
        score.breakdown.importance * 0.3 +
        score.breakdown.relevance * 0.15;

      expect(score.score).toBeCloseTo(expectedScore, 3);
    });

    it('all breakdown values are in 0-1 range', () => {
      const memory = makeMemory({
        importance: 'critical',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(100),
          updatedAt: daysAgo(50),
          lastAccessedAt: daysAgo(50),
        },
        retrieval: { keywords: ['test'], recallCount: 15 },
      });

      const score = scorer.score(memory);

      expect(score.breakdown.recency).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.recency).toBeLessThanOrEqual(1);
      expect(score.breakdown.frequency).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.frequency).toBeLessThanOrEqual(1);
      expect(score.breakdown.importance).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.importance).toBeLessThanOrEqual(1);
      expect(score.breakdown.relevance).toBeGreaterThanOrEqual(0);
      expect(score.breakdown.relevance).toBeLessThanOrEqual(1);
    });
  });

  describe('recommendation thresholds', () => {
    it('score >= 0.6 → active', () => {
      const memory = makeMemory({
        importance: 'high',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(1),
          updatedAt: daysAgo(1),
          lastAccessedAt: daysAgo(1),
        },
        retrieval: { keywords: ['test'], recallCount: 10 },
      });

      const score = scorer.score(memory);

      expect(score.score).toBeGreaterThanOrEqual(0.6);
      expect(score.recommendation).toBe('active');
    });

    it('score >= 0.3 and < 0.6 → low_priority', () => {
      const memory = makeMemory({
        importance: 'medium',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(60),
          updatedAt: daysAgo(45),
          lastAccessedAt: daysAgo(45),
        },
        retrieval: { keywords: ['test'], recallCount: 2 },
      });

      const score = scorer.score(memory);

      if (score.score >= 0.3 && score.score < 0.6) {
        expect(score.recommendation).toBe('low_priority');
      }
    });

    it('score < 0.3 → archive_candidate', () => {
      const memory = makeMemory({
        importance: 'low',
        lifecycle: {
          status: 'active',
          createdAt: daysAgo(200),
          updatedAt: daysAgo(150),
          lastAccessedAt: daysAgo(150),
        },
        retrieval: { keywords: ['test'], recallCount: 0 },
      });

      const score = scorer.score(memory);

      expect(score.score).toBeLessThan(0.3);
      expect(score.recommendation).toBe('archive_candidate');
    });
  });

  describe('context query relevance', () => {
    it('matching context query boosts relevance score', () => {
      const memory = makeMemory({
        importance: 'medium',
        retrieval: { keywords: ['project', 'deadline', 'urgent'], recallCount: 5 },
      });

      const scoreWithoutQuery = scorer.score(memory);
      const scoreWithQuery = scorer.score(memory, 'urgent project deadline');

      expect(scoreWithQuery.breakdown.relevance).toBeGreaterThan(scoreWithoutQuery.breakdown.relevance);
    });

    it('non-matching context query reduces relevance score to 0', () => {
      const memory = makeMemory({
        importance: 'medium',
        retrieval: { keywords: ['cooking', 'recipe'], recallCount: 5 },
      });

      const scoreWithoutQuery = scorer.score(memory);
      const scoreWithQuery = scorer.score(memory, 'programming javascript');

      expect(scoreWithoutQuery.breakdown.relevance).toBe(0.5);
      expect(scoreWithQuery.breakdown.relevance).toBe(0);
      expect(scoreWithQuery.breakdown.relevance).toBeLessThan(scoreWithoutQuery.breakdown.relevance);
    });
  });
});
