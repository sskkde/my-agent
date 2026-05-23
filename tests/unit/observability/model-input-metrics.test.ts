import { describe, it, expect, beforeEach } from 'vitest';
import { createModelInputMetrics } from '../../../src/observability/model-input-metrics.js';
import type { CacheMetricsRecord } from '../../../src/observability/model-input-metrics.js';

function makeMetrics(overrides: Partial<CacheMetricsRecord> = {}): CacheMetricsRecord {
  return {
    agentKind: 'foreground',
    model: 'deepseek-chat',
    providerFamily: 'deepseek',
    segmentAHash: 'hash-a-123',
    segmentBHash: 'hash-b-456',
    segmentCHash: 'hash-c-789',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    promptCacheHitTokens: 80,
    promptCacheMissTokens: 20,
    cacheHitRate: 0.8,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('ModelInputMetrics', () => {
  let metrics: ReturnType<typeof createModelInputMetrics>;

  beforeEach(() => {
    metrics = createModelInputMetrics();
  });

  describe('record', () => {
    it('records a cache metrics record', () => {
      const record = makeMetrics();
      metrics.record(record);

      const results = metrics.getByAgent('foreground');
      expect(results.length).toBe(1);
      expect(results[0].promptTokens).toBe(100);
    });

    it('uses provided timestamp or generates one', () => {
      const customTimestamp = '2024-01-15T10:30:00Z';
      metrics.record(makeMetrics({ timestamp: customTimestamp }));

      const results = metrics.getByAgent('foreground');
      expect(results[0].timestamp).toBe(customTimestamp);
    });
  });

  describe('getByAgent', () => {
    it('filters records by agent kind', () => {
      metrics.record(makeMetrics({ agentKind: 'foreground' }));
      metrics.record(makeMetrics({ agentKind: 'foreground' }));
      metrics.record(makeMetrics({ agentKind: 'search' }));

      const foregroundRecords = metrics.getByAgent('foreground');
      const searchRecords = metrics.getByAgent('search');

      expect(foregroundRecords.length).toBe(2);
      expect(searchRecords.length).toBe(1);
    });

    it('returns empty array for unknown agent', () => {
      metrics.record(makeMetrics({ agentKind: 'foreground' }));
      expect(metrics.getByAgent('unknown')).toEqual([]);
    });
  });

  describe('getBySegmentAHash', () => {
    it('filters records by segment A hash', () => {
      metrics.record(makeMetrics({ segmentAHash: 'hash-a-111' }));
      metrics.record(makeMetrics({ segmentAHash: 'hash-a-222' }));
      metrics.record(makeMetrics({ segmentAHash: 'hash-a-111' }));

      const records = metrics.getBySegmentAHash('hash-a-111');

      expect(records.length).toBe(2);
      records.forEach((r: CacheMetricsRecord) => {
        expect(r.segmentAHash).toBe('hash-a-111');
      });
    });
  });

  describe('getByTimeRange', () => {
    it('filters records by time range', () => {
      metrics.record(makeMetrics({ timestamp: '2024-01-10T10:00:00Z' }));
      metrics.record(makeMetrics({ timestamp: '2024-01-15T10:00:00Z' }));
      metrics.record(makeMetrics({ timestamp: '2024-01-20T10:00:00Z' }));

      const results = metrics.getByTimeRange('2024-01-12T00:00:00Z', '2024-01-18T00:00:00Z');

      expect(results.length).toBe(1);
      expect(results[0].timestamp).toBe('2024-01-15T10:00:00Z');
    });

    it('includes records at boundary times', () => {
      metrics.record(makeMetrics({ timestamp: '2024-01-15T10:00:00Z' }));

      const results = metrics.getByTimeRange('2024-01-15T10:00:00Z', '2024-01-15T10:00:00Z');

      expect(results.length).toBe(1);
    });
  });

  describe('getAggregateByAgent', () => {
    it('aggregates metrics by agent kind', () => {
      metrics.record(makeMetrics({
        agentKind: 'foreground',
        totalTokens: 100,
        cacheHitRate: 0.8,
      }));
      metrics.record(makeMetrics({
        agentKind: 'foreground',
        totalTokens: 200,
        cacheHitRate: 0.6,
      }));
      metrics.record(makeMetrics({
        agentKind: 'search',
        totalTokens: 150,
        cacheHitRate: 0.9,
      }));

      const aggregates = metrics.getAggregateByAgent();

      expect(aggregates.length).toBe(2);

      const foregroundAgg = aggregates.find((a: { agentKind: string; count: number; avgCacheHitRate: number; totalTokens: number }) => a.agentKind === 'foreground');
      expect(foregroundAgg?.count).toBe(2);
      expect(foregroundAgg?.totalTokens).toBe(300);
      expect(foregroundAgg?.avgCacheHitRate).toBeCloseTo(0.7);

      const searchAgg = aggregates.find((a: { agentKind: string; count: number; avgCacheHitRate: number; totalTokens: number }) => a.agentKind === 'search');
      expect(searchAgg?.count).toBe(1);
      expect(searchAgg?.totalTokens).toBe(150);
      expect(searchAgg?.avgCacheHitRate).toBe(0.9);
    });

    it('handles records without cacheHitRate', () => {
      metrics.record(makeMetrics({
        agentKind: 'test',
        cacheHitRate: undefined,
      }));
      metrics.record(makeMetrics({
        agentKind: 'test',
        cacheHitRate: 0.5,
      }));

      const aggregates = metrics.getAggregateByAgent();
      const testAgg = aggregates.find((a: { agentKind: string; count: number; avgCacheHitRate: number; totalTokens: number }) => a.agentKind === 'test');

      expect(testAgg?.count).toBe(2);
      expect(testAgg?.avgCacheHitRate).toBe(0.25);
    });

    it('returns empty array when no records exist', () => {
      expect(metrics.getAggregateByAgent()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('clears all records', () => {
      metrics.record(makeMetrics());
      metrics.record(makeMetrics());

      expect(metrics.getByAgent('foreground').length).toBe(2);

      metrics.clear();

      expect(metrics.getByAgent('foreground').length).toBe(0);
    });
  });

  describe('DeepSeek cache metrics', () => {
    it('records prompt cache hit tokens', () => {
      metrics.record(makeMetrics({
        promptCacheHitTokens: 500,
        promptCacheMissTokens: 100,
        cacheHitRate: 0.833,
      }));

      const results = metrics.getByAgent('foreground');
      expect(results[0].promptCacheHitTokens).toBe(500);
    });

    it('records prompt cache miss tokens', () => {
      metrics.record(makeMetrics({
        promptCacheHitTokens: 500,
        promptCacheMissTokens: 100,
      }));

      const results = metrics.getByAgent('foreground');
      expect(results[0].promptCacheMissTokens).toBe(100);
    });

    it('cacheHitRate is computable', () => {
      const hit = 500;
      const miss = 100;
      const expectedHitRate = hit / (hit + miss);

      metrics.record(makeMetrics({
        promptCacheHitTokens: hit,
        promptCacheMissTokens: miss,
        cacheHitRate: expectedHitRate,
      }));

      const results = metrics.getByAgent('foreground');
      expect(results[0].cacheHitRate).toBeCloseTo(expectedHitRate);

      const aggregates = metrics.getAggregateByAgent();
      expect(aggregates[0].avgCacheHitRate).toBeCloseTo(expectedHitRate);
    });

    it('tracks cache efficiency over multiple calls', () => {
      metrics.record(makeMetrics({
        agentKind: 'foreground',
        promptCacheHitTokens: 400,
        promptCacheMissTokens: 100,
        cacheHitRate: 0.8,
        segmentAHash: 'static-prefix-v1',
      }));
      metrics.record(makeMetrics({
        agentKind: 'foreground',
        promptCacheHitTokens: 450,
        promptCacheMissTokens: 50,
        cacheHitRate: 0.9,
        segmentAHash: 'static-prefix-v1',
      }));

      const aggregates = metrics.getAggregateByAgent();
      expect(aggregates[0].avgCacheHitRate).toBeCloseTo(0.85);
    });
  });
});
