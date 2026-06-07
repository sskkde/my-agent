import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type Migration } from '../../../src/storage/migrations.js'
import { createMetricsRollup } from '../../../src/observability/metrics-rollup.js'

const migrationsList: Migration[] = [
  {
    version: 1,
    name: 'create_trace_tables',
    up: `
      CREATE TABLE trace_contexts (
        trace_id TEXT PRIMARY KEY,
        root_span_id TEXT NOT NULL,
        correlation_id TEXT,
        user_id TEXT,
        session_id TEXT,
        started_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE trace_spans (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        span_type TEXT NOT NULL,
        module TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms INTEGER,
        error TEXT,
        metadata TEXT
      );
    `,
    down: `
      DROP TABLE IF EXISTS trace_spans;
      DROP TABLE IF EXISTS trace_contexts;
    `,
  },
  {
    version: 2,
    name: 'create_metrics_table',
    up: `
      CREATE TABLE metrics (
        metric_id TEXT PRIMARY KEY,
        trace_id TEXT,
        span_id TEXT,
        module TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        labels TEXT
      );
    `,
    down: `DROP TABLE IF EXISTS metrics;`,
  },
]

describe('Metrics Rollup Unit Tests', () => {
  let connection: ConnectionManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    const migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(migrationsList)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('latency metrics', () => {
    it('calculates avg/min/max latency from connector spans', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, duration_ms)
         VALUES 
           ('span-1', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, 100),
           ('span-2', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, 200),
           ('span-3', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, 300)`,
        [periodStart, periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.latency.avgMs).toBe(200)
      expect(report.latency.minMs).toBe(100)
      expect(report.latency.maxMs).toBe(300)
      expect(report.latency.count).toBe(3)
    })

    it('calculates percentiles correctly', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      for (let i = 0; i < durations.length; i++) {
        connection.exec(
          `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, duration_ms)
           VALUES (?, 'trace-1', 'tool_execution', 'tool', 'test', 'completed', ?, ?)`,
          [`span-${i}`, periodStart, durations[i]],
        )
      }

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.latency.p50Ms).toBe(50)
      expect(report.latency.p95Ms).toBe(100)
      expect(report.latency.p99Ms).toBe(100)
    })

    it('handles empty spans gracefully', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.latency.avgMs).toBe(0)
      expect(report.latency.minMs).toBe(0)
      expect(report.latency.maxMs).toBe(0)
      expect(report.latency.count).toBe(0)
    })
  })

  describe('connector call metrics', () => {
    it('counts connector calls by connector and operation', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, metadata)
         VALUES 
           ('span-1', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, '{"connectorId": "mock_email"}'),
           ('span-2', 'trace-1', 'connector_call', 'connector', 'read', 'completed', ?, '{"connectorId": "mock_email"}'),
           ('span-3', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, '{"connectorId": "mock_calendar"}')`,
        [periodStart, periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.connectorCalls.total).toBe(3)
      expect(report.connectorCalls.byConnector['mock_email']).toBe(2)
      expect(report.connectorCalls.byConnector['mock_calendar']).toBe(1)
      expect(report.connectorCalls.byOperation['search']).toBe(2)
      expect(report.connectorCalls.byOperation['read']).toBe(1)
      expect(report.connectorCalls.successCount).toBe(3)
      expect(report.connectorCalls.failureCount).toBe(0)
    })

    it('counts rate-limited connector calls', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, error, metadata)
         VALUES 
           ('span-1', 'trace-1', 'connector_call', 'connector', 'search', 'failed', ?, 'Rate limit exceeded (429)', '{"errorCategory": "rate_limited"}'),
           ('span-2', 'trace-1', 'connector_call', 'connector', 'search', 'completed', ?, null, '{}')`,
        [periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.connectorCalls.total).toBe(2)
      expect(report.connectorCalls.failureCount).toBe(1)
      expect(report.connectorCalls.rateLimitedCount).toBe(1)
    })
  })

  describe('failure metrics', () => {
    it('categorizes failures by category', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, error, metadata)
         VALUES 
           ('span-1', 'trace-1', 'connector_call', 'connector', 'search', 'failed', ?, 'Rate limit exceeded', '{"errorCategory": "rate_limited"}'),
           ('span-2', 'trace-1', 'connector_call', 'connector', 'search', 'failed', ?, 'Connection timeout', '{"errorCategory": "timeout"}'),
           ('span-3', 'trace-1', 'tool_execution', 'tool', 'test', 'failed', ?, 'Tool failed', '{}')`,
        [periodStart, periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.failures.total).toBe(3)
      expect(report.failures.byCategory['connector_rate_limited']).toBe(1)
      expect(report.failures.byCategory['connector_timeout']).toBe(1)
      expect(report.failures.byCategory['tool_execution_error']).toBe(1)
    })

    it('counts recoverable vs non-recoverable failures', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, metadata)
         VALUES 
           ('span-1', 'trace-1', 'connector_call', 'connector', 'search', 'failed', ?, '{"recoverable": true}'),
           ('span-2', 'trace-1', 'connector_call', 'connector', 'search', 'failed', ?, '{"recoverable": false}')`,
        [periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.failures.recoverableCount).toBe(1)
      expect(report.failures.nonRecoverableCount).toBe(1)
    })
  })

  describe('tool call metrics', () => {
    it('counts tool calls by category and tool name', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, metadata)
         VALUES 
           ('span-1', 'trace-1', 'tool_execution', 'tool', 'file_read', 'completed', ?, '{"category": "read"}'),
           ('span-2', 'trace-1', 'tool_execution', 'tool', 'file_read', 'completed', ?, '{"category": "read"}'),
           ('span-3', 'trace-1', 'tool_execution', 'tool', 'file_write', 'completed', ?, '{"category": "write"}')`,
        [periodStart, periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.toolCalls.total).toBe(3)
      expect(report.toolCalls.byCategory['read']).toBe(2)
      expect(report.toolCalls.byCategory['write']).toBe(1)
      expect(report.toolCalls.byTool['file_read']).toBe(2)
      expect(report.toolCalls.byTool['file_write']).toBe(1)
      expect(report.toolCalls.successCount).toBe(3)
    })

    it('counts failed tool calls', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, metadata)
         VALUES 
           ('span-1', 'trace-1', 'tool_execution', 'tool', 'test', 'completed', ?, '{}'),
           ('span-2', 'trace-1', 'tool_execution', 'tool', 'test', 'failed', ?, '{}')`,
        [periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.toolCalls.successCount).toBe(1)
      expect(report.toolCalls.failureCount).toBe(1)
    })
  })

  describe('approval metrics', () => {
    it('counts approvals by risk level', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, duration_ms, metadata)
         VALUES 
           ('span-1', 'trace-1', 'permission_check', 'permission', 'check', 'completed', ?, 100, '{"decision": "approved", "riskLevel": "low"}'),
           ('span-2', 'trace-1', 'permission_check', 'permission', 'check', 'completed', ?, 200, '{"decision": "approved", "riskLevel": "high"}'),
           ('span-3', 'trace-1', 'permission_check', 'permission', 'check', 'completed', ?, 150, '{"decision": "rejected", "riskLevel": "medium"}')`,
        [periodStart, periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.approvals.totalCount).toBe(3)
      expect(report.approvals.approvedCount).toBe(2)
      expect(report.approvals.rejectedCount).toBe(1)
      expect(report.approvals.byRiskLevel['low']).toBe(1)
      expect(report.approvals.byRiskLevel['high']).toBe(1)
      expect(report.approvals.byRiskLevel['medium']).toBe(1)
      expect(report.approvals.avgLatencyMs).toBe(150)
    })
  })

  describe('retry metrics', () => {
    it('counts retries by category', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const periodEnd = now.toISOString()

      connection.exec(
        `INSERT INTO metrics (metric_id, module, metric_type, name, value, timestamp, labels)
         VALUES 
           ('metric-1', 'connector', 'counter', 'retry_count', 3, ?, '{"category": "connector_rate_limited"}'),
           ('metric-2', 'connector', 'counter', 'retry_count', 2, ?, '{"category": "connector_timeout"}')`,
        [periodStart, periodStart],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.retries.totalRetries).toBe(5)
      expect(report.retries.byCategory['connector_rate_limited']).toBe(3)
      expect(report.retries.byCategory['connector_timeout']).toBe(2)
    })
  })

  describe('period filtering', () => {
    it('only includes spans within the period', () => {
      const now = new Date()
      const periodStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
      const periodEnd = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
      const beforePeriod = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
      const afterPeriod = new Date(now.getTime() - 5 * 60 * 1000).toISOString()

      connection.exec(
        `INSERT INTO trace_spans (span_id, trace_id, span_type, module, operation, status, start_time, duration_ms)
         VALUES 
           ('span-before', 'trace-1', 'tool_execution', 'tool', 'test', 'completed', ?, 100),
           ('span-in', 'trace-1', 'tool_execution', 'tool', 'test', 'completed', ?, 200),
           ('span-after', 'trace-1', 'tool_execution', 'tool', 'test', 'completed', ?, 300)`,
        [beforePeriod, periodStart, afterPeriod],
      )

      const rollup = createMetricsRollup({ connection })
      const report = rollup.rollup(periodStart, periodEnd)

      expect(report.latency.count).toBe(1)
      expect(report.latency.avgMs).toBe(200)
    })
  })
})
