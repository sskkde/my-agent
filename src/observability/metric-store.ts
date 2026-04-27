import type { ConnectionManager } from '../storage/connection.js';
import type {
  MetricRecord,
  MetricStore,
  MetricQuery,
  MetricAggregation,
} from './types.js';

interface MetricRow {
  metric_id: string;
  trace_id: string | null;
  span_id: string | null;
  module: string;
  metric_type: string;
  name: string;
  value: number;
  unit: string | null;
  timestamp: string;
  labels: string | null;
}



function rowToMetricRecord(row: MetricRow): MetricRecord {
  return {
    metricId: row.metric_id,
    traceId: row.trace_id ?? undefined,
    spanId: row.span_id ?? undefined,
    module: row.module as MetricRecord['module'],
    metricType: row.metric_type as MetricRecord['metricType'],
    name: row.name,
    value: row.value,
    unit: row.unit ?? undefined,
    timestamp: row.timestamp,
    labels: row.labels ? JSON.parse(row.labels) : undefined,
  };
}

class MetricStoreImpl implements MetricStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  recordMetric(metric: MetricRecord): void {
    const sql = `
      INSERT INTO metrics (
        metric_id, trace_id, span_id, module, metric_type, name,
        value, unit, timestamp, labels
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      metric.metricId,
      metric.traceId ?? null,
      metric.spanId ?? null,
      metric.module,
      metric.metricType,
      metric.name,
      metric.value,
      metric.unit ?? null,
      metric.timestamp,
      metric.labels ? JSON.stringify(metric.labels) : null,
    ];
    this.connection.exec(sql, params);
  }

  recordMetrics(metrics: MetricRecord[]): void {
    for (const metric of metrics) {
      this.recordMetric(metric);
    }
  }

  getMetric(metricId: string): MetricRecord | null {
    const sql = 'SELECT * FROM metrics WHERE metric_id = ?';
    const rows = this.connection.query<MetricRow>(sql, [metricId]);
    if (rows.length === 0) {
      return null;
    }
    return rowToMetricRecord(rows[0]);
  }

  queryMetrics(query: MetricQuery): MetricRecord[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.module !== undefined) {
      conditions.push('module = ?');
      params.push(query.module);
    }

    if (query.metricType !== undefined) {
      conditions.push('metric_type = ?');
      params.push(query.metricType);
    }

    if (query.name !== undefined) {
      conditions.push('name = ?');
      params.push(query.name);
    }

    if (query.traceId !== undefined) {
      conditions.push('trace_id = ?');
      params.push(query.traceId);
    }

    if (query.spanId !== undefined) {
      conditions.push('span_id = ?');
      params.push(query.spanId);
    }

    if (query.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime);
    }

    if (query.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime);
    }

    if (query.labels !== undefined) {
      for (const [key, value] of Object.entries(query.labels)) {
        conditions.push(`json_extract(labels, '$.${key}') = ?`);
        params.push(value);
      }
    }

    let sql = 'SELECT * FROM metrics';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY timestamp DESC';

    if (query.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = this.connection.query<MetricRow>(sql, params);
    return rows.map(rowToMetricRecord);
  }

  aggregateMetrics(query: MetricQuery): MetricAggregation[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.module !== undefined) {
      conditions.push('module = ?');
      params.push(query.module);
    }

    if (query.metricType !== undefined) {
      conditions.push('metric_type = ?');
      params.push(query.metricType);
    }

    if (query.name !== undefined) {
      conditions.push('name = ?');
      params.push(query.name);
    }

    if (query.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime);
    }

    if (query.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime);
    }

    let sql = `
      SELECT
        name,
        module,
        metric_type,
        COUNT(*) as count,
        SUM(value) as sum,
        AVG(value) as avg,
        MIN(value) as min,
        MAX(value) as max,
        MIN(timestamp) as start_time,
        MAX(timestamp) as end_time
      FROM metrics
    `;

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY name, module, metric_type';

    const rows = this.connection.query<{
      name: string;
      module: string;
      metric_type: string;
      count: number;
      sum: number;
      avg: number;
      min: number;
      max: number;
      start_time: string;
      end_time: string;
    }>(sql, params);

    return rows.map((row) => ({
      name: row.name,
      module: row.module as MetricAggregation['module'],
      metricType: row.metric_type as MetricAggregation['metricType'],
      count: row.count,
      sum: row.sum,
      avg: row.avg,
      min: row.min,
      max: row.max,
      startTime: row.start_time,
      endTime: row.end_time,
    }));
  }

  getLatestMetric(name: string, module: string): MetricRecord | null {
    const sql = `
      SELECT * FROM metrics
      WHERE name = ? AND module = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    const rows = this.connection.query<MetricRow>(sql, [name, module]);
    if (rows.length === 0) {
      return null;
    }
    return rowToMetricRecord(rows[0]);
  }
}

export function createMetricStore(connection: ConnectionManager): MetricStore {
  return new MetricStoreImpl(connection);
}
