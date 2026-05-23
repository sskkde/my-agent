/**
 * Model Input Metrics - DeepSeek cache metrics recorder for observability.
 * @module observability/model-input-metrics
 */

export interface CacheMetricsRecord {
  agentKind: string;
  model: string;
  providerFamily: string;
  segmentAHash: string;
  segmentBHash: string;
  segmentCHash: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  cacheHitRate?: number;
  timestamp: string;
}

export interface ModelInputMetrics {
  record(metrics: CacheMetricsRecord): void;
  getByAgent(agentKind: string): CacheMetricsRecord[];
  getBySegmentAHash(hash: string): CacheMetricsRecord[];
  getByTimeRange(from: string, to: string): CacheMetricsRecord[];
  getAggregateByAgent(): Array<{
    agentKind: string;
    count: number;
    avgCacheHitRate: number;
    totalTokens: number;
  }>;
  clear(): void;
}

class ModelInputMetricsImpl implements ModelInputMetrics {
  private readonly records: CacheMetricsRecord[] = [];

  record(metrics: CacheMetricsRecord): void {
    this.records.push({
      ...metrics,
      timestamp: metrics.timestamp ?? new Date().toISOString(),
    });
  }

  getByAgent(agentKind: string): CacheMetricsRecord[] {
    return this.records.filter((r) => r.agentKind === agentKind);
  }

  getBySegmentAHash(hash: string): CacheMetricsRecord[] {
    return this.records.filter((r) => r.segmentAHash === hash);
  }

  getByTimeRange(from: string, to: string): CacheMetricsRecord[] {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return this.records.filter((r) => {
      const recordDate = new Date(r.timestamp);
      return recordDate >= fromDate && recordDate <= toDate;
    });
  }

  getAggregateByAgent(): Array<{
    agentKind: string;
    count: number;
    avgCacheHitRate: number;
    totalTokens: number;
  }> {
    const agentMap = new Map<
      string,
      { count: number; totalCacheHitRate: number; totalTokens: number }
    >();

    for (const record of this.records) {
      const existing = agentMap.get(record.agentKind) ?? {
        count: 0,
        totalCacheHitRate: 0,
        totalTokens: 0,
      };
      existing.count += 1;
      existing.totalCacheHitRate += record.cacheHitRate ?? 0;
      existing.totalTokens += record.totalTokens;
      agentMap.set(record.agentKind, existing);
    }

    const result: Array<{
      agentKind: string;
      count: number;
      avgCacheHitRate: number;
      totalTokens: number;
    }> = [];

    for (const [agentKind, data] of agentMap) {
      result.push({
        agentKind,
        count: data.count,
        avgCacheHitRate: data.count > 0 ? data.totalCacheHitRate / data.count : 0,
        totalTokens: data.totalTokens,
      });
    }

    return result;
  }

  clear(): void {
    this.records.length = 0;
  }
}

export function createModelInputMetrics(): ModelInputMetrics {
  return new ModelInputMetricsImpl();
}
