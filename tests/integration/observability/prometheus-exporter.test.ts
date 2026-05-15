import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createMetricStore } from '../../../src/observability/metric-store.js';
import { createPrometheusExporter, type PrometheusExporter } from '../../../src/observability/prometheus-exporter.js';
import type { MetricStore } from '../../../src/observability/types.js';
import type { PrometheusConfig } from '../../../src/observability/export-types.js';

const observabilityMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_metrics_table',
    up: `
      CREATE TABLE metrics (
        metric_id TEXT PRIMARY KEY,
        trace_id TEXT,
        span_id TEXT,
        module TEXT NOT NULL CHECK(module IN ('gateway', 'foreground_agent', 'planner', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
        metric_type TEXT NOT NULL CHECK(metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        labels TEXT
      );
      CREATE INDEX idx_metrics_name ON metrics(name);
      CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_metrics_timestamp;
      DROP INDEX IF EXISTS idx_metrics_name;
      DROP TABLE IF EXISTS metrics;
    `,
  },
];

describe('Prometheus Exporter Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let metricStore: MetricStore;
  let exporter: PrometheusExporter;

  const defaultConfig: PrometheusConfig = {
    defaultLabels: {
      service_name: 'agent-platform',
      version: '0.6.0',
      instance: 'local-1',
    },
    metricPrefix: 'agent_platform_',
    includeTimestamp: false,
  };

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(observabilityMigrations);

    metricStore = createMetricStore(connection);
    exporter = createPrometheusExporter({
      metricStore,
      config: defaultConfig,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Counter metric output', () => {
    it('should export counter metric in Prometheus format', () => {
      // Record counter values
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 100,
        timestamp: new Date().toISOString(),
        labels: { method: 'GET', status: '200' },
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 50,
        timestamp: new Date().toISOString(),
        labels: { method: 'POST', status: '201' },
      });

      const output = exporter.export();

      // Should have HELP and TYPE comments
      expect(output).toContain('# HELP agent_platform_request_total Total request count');
      expect(output).toContain('# TYPE agent_platform_request_total counter');

      // Should include default labels
      expect(output).toContain('service_name="agent-platform"');
      expect(output).toContain('version="0.6.0"');
      expect(output).toContain('instance="local-1"');

      // Should include metric labels
      expect(output).toContain('method="GET"');
      expect(output).toContain('status="200"');
      expect(output).toContain('method="POST"');
      expect(output).toContain('status="201"');

      // Should have metric values
      expect(output).toMatch(/agent_platform_request_total\{[^}]+\} 100/);
      expect(output).toMatch(/agent_platform_request_total\{[^}]+\} 50/);
    });

    it('should aggregate counter values with same labels', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 100,
        timestamp: new Date().toISOString(),
        labels: { method: 'GET' },
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 50,
        timestamp: new Date().toISOString(),
        labels: { method: 'GET' },
      });

      const output = exporter.export();

      // Should sum values with same labels (counter is cumulative)
      expect(output).toMatch(/agent_platform_request_total\{[^}]+\} 150/);
    });
  });

  describe('Gauge metric output', () => {
    it('should export gauge metric in Prometheus format', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'memory',
        metricType: 'gauge',
        name: 'memory_usage_bytes',
        value: 1024000,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      expect(output).toContain('# HELP agent_platform_memory_usage_bytes Current memory usage in bytes');
      expect(output).toContain('# TYPE agent_platform_memory_usage_bytes gauge');
      expect(output).toMatch(/agent_platform_memory_usage_bytes\{[^}]+\} 1024000/);
    });

    it('should use latest value for gauge', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'memory',
        metricType: 'gauge',
        name: 'memory_usage_bytes',
        value: 1024000,
        timestamp: new Date(Date.now() - 1000).toISOString(),
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'memory',
        metricType: 'gauge',
        name: 'memory_usage_bytes',
        value: 2048000,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      // Gauge should show latest value
      expect(output).toMatch(/agent_platform_memory_usage_bytes\{[^}]+\} 2048000/);
    });

    it('should export active_sessions gauge', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'gauge',
        name: 'active_sessions',
        value: 5,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      expect(output).toContain('# HELP agent_platform_active_sessions Number of active sessions');
      expect(output).toContain('# TYPE agent_platform_active_sessions gauge');
      expect(output).toMatch(/agent_platform_active_sessions\{[^}]+\} 5/);
    });

    it('should export budget_usage_percent gauge', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'memory',
        metricType: 'gauge',
        name: 'budget_usage_percent',
        value: 75.5,
        timestamp: new Date().toISOString(),
        labels: { budget_type: 'daily' },
      });

      const output = exporter.export();

      expect(output).toContain('# HELP agent_platform_budget_usage_percent Current budget usage percentage');
      expect(output).toContain('# TYPE agent_platform_budget_usage_percent gauge');
      expect(output).toContain('budget_type="daily"');
      expect(output).toMatch(/agent_platform_budget_usage_percent\{[^}]+\} 75\.5/);
    });
  });

  describe('Histogram metric output', () => {
    it('should export histogram metric with buckets, sum, and count', () => {
      // Record timer values for histogram
      metricStore.recordMetric({
        metricId: 'h1',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.1,
        timestamp: new Date().toISOString(),
        labels: { endpoint: '/api/v1/sessions' },
      });

      metricStore.recordMetric({
        metricId: 'h2',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.25,
        timestamp: new Date().toISOString(),
        labels: { endpoint: '/api/v1/sessions' },
      });

      metricStore.recordMetric({
        metricId: 'h3',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.5,
        timestamp: new Date().toISOString(),
        labels: { endpoint: '/api/v1/sessions' },
      });

      const output = exporter.export();

      // Should have histogram type
      expect(output).toContain('# HELP agent_platform_request_duration_seconds Request duration in seconds');
      expect(output).toContain('# TYPE agent_platform_request_duration_seconds histogram');

      // Should have bucket entries
      expect(output).toContain('le="0.1"');
      expect(output).toContain('le="0.25"');
      expect(output).toContain('le="0.5"');
      expect(output).toContain('le="1"');
      expect(output).toContain('le="+Inf"');

      // Should have sum and count
      expect(output).toContain('agent_platform_request_duration_seconds_sum');
      expect(output).toContain('agent_platform_request_duration_seconds_count');
    });

    it('should calculate histogram buckets correctly', () => {
      // Record values: 0.05, 0.15, 0.3
      metricStore.recordMetric({
        metricId: 'h1',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.05,
        timestamp: new Date().toISOString(),
      });

      metricStore.recordMetric({
        metricId: 'h2',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.15,
        timestamp: new Date().toISOString(),
      });

      metricStore.recordMetric({
        metricId: 'h3',
        module: 'gateway',
        metricType: 'timer',
        name: 'request_duration_seconds',
        value: 0.3,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      // Extract bucket counts from output
      const lines = output.split('\n');

      // Find bucket values
      const getBucketValue = (le: string): number | null => {
        const line = lines.find(l => l.includes(`le="${le}"`) && l.includes('request_duration_seconds_bucket'));
        if (!line) return null;
        const match = line.match(/} (\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
      };

      // le=0.1 should have 1 value (0.05)
      expect(getBucketValue('0.1')).toBe(1);

      // le=0.25 should have 2 values (0.05, 0.15)
      expect(getBucketValue('0.25')).toBe(2);

      // le=0.5 should have 3 values (all)
      expect(getBucketValue('0.5')).toBe(3);

      // +Inf should have all values
      expect(getBucketValue('+Inf')).toBe(3);
    });
  });

  describe('Workflow and connector metrics', () => {
    it('should export workflow_runs_total counter', () => {
      metricStore.recordMetric({
        metricId: 'w1',
        module: 'workflow',
        metricType: 'counter',
        name: 'workflow_runs_total',
        value: 10,
        timestamp: new Date().toISOString(),
        labels: { workflow_id: 'wf_001', status: 'completed' },
      });

      const output = exporter.export();

      expect(output).toContain('# HELP agent_platform_workflow_runs_total Total workflow runs');
      expect(output).toContain('# TYPE agent_platform_workflow_runs_total counter');
      expect(output).toContain('workflow_id="wf_001"');
      expect(output).toContain('status="completed"');
    });

    it('should export connector_requests_total counter', () => {
      metricStore.recordMetric({
        metricId: 'c1',
        module: 'connector',
        metricType: 'counter',
        name: 'connector_requests_total',
        value: 25,
        timestamp: new Date().toISOString(),
        labels: { connector_id: 'slack', operation: 'send_message' },
      });

      const output = exporter.export();

      expect(output).toContain('# HELP agent_platform_connector_requests_total Total connector requests');
      expect(output).toContain('# TYPE agent_platform_connector_requests_total counter');
      expect(output).toContain('connector_id="slack"');
      expect(output).toContain('operation="send_message"');
    });
  });

  describe('Default labels', () => {
    it('should include all default labels in every metric', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      expect(output).toContain('service_name="agent-platform"');
      expect(output).toContain('version="0.6.0"');
      expect(output).toContain('instance="local-1"');
    });

    it('should merge metric labels with default labels', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
        labels: { method: 'POST' },
      });

      const output = exporter.export();

      // Default labels should be present
      expect(output).toContain('service_name="agent-platform"');
      expect(output).toContain('version="0.6.0"');
      expect(output).toContain('instance="local-1"');
      // Metric labels should be present
      expect(output).toContain('method="POST"');
    });
  });

  describe('Metric prefix', () => {
    it('should apply metric prefix to all metric names', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'memory',
        metricType: 'gauge',
        name: 'active_sessions',
        value: 5,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      expect(output).toContain('agent_platform_request_total');
      expect(output).toContain('agent_platform_active_sessions');
    });

    it('should handle custom prefix', () => {
      const customExporter = createPrometheusExporter({
        metricStore,
        config: {
          defaultLabels: { service_name: 'custom-service' },
          metricPrefix: 'custom_prefix_',
        },
      });

      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
      });

      const output = customExporter.export();

      expect(output).toContain('custom_prefix_request_total');
      expect(output).not.toContain('agent_platform_request_total');
    });
  });

  describe('Output format', () => {
    it('should return valid Prometheus exposition format', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 100,
        timestamp: new Date().toISOString(),
        labels: { method: 'GET' },
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'memory',
        metricType: 'gauge',
        name: 'active_sessions',
        value: 5,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      // Should be plain text
      expect(typeof output).toBe('string');

      // Each metric should have HELP and TYPE lines
      const lines = output.split('\n');
      expect(lines.some(l => l.startsWith('# HELP'))).toBe(true);
      expect(lines.some(l => l.startsWith('# TYPE'))).toBe(true);

      // Should have metric lines
      expect(lines.some(l => l.includes('agent_platform_') && !l.startsWith('#'))).toBe(true);
    });

    it('should escape special characters in label values', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
        labels: { path: '/api/v1/users?name=test', error: 'failed: "timeout"' },
      });

      const output = exporter.export();

      // Should escape quotes and special chars
      expect(output).toContain('path="/api/v1/users?name=test"');
      expect(output).toContain('error="failed: \\"timeout\\""');
    });

    it('should handle empty metrics gracefully', () => {
      const output = exporter.export();

      // Should return empty string or valid empty format
      expect(typeof output).toBe('string');
    });
  });

  describe('Timestamp handling', () => {
    it('should not include timestamp by default', () => {
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date().toISOString(),
      });

      const output = exporter.export();

      const lines = output.split('\n');
      const metricLine = lines.find(l => l.includes('request_total') && !l.startsWith('#'));
      expect(metricLine).toBeDefined();

      // Without timestamp, line ends with value (no trailing timestamp number)
      // Format: metric{labels} value
      const match = metricLine!.match(/} (\d+(?:\.\d+)?)(?: \d+)?$/);
      expect(match).toBeDefined();
      expect(match![1]).toBe('1');
      expect(metricLine!.endsWith('} 1')).toBe(true);
    });

    it('should include timestamp when configured', () => {
      const exporterWithTimestamp = createPrometheusExporter({
        metricStore,
        config: {
          ...defaultConfig,
          includeTimestamp: true,
        },
      });

      const ts = Date.now();
      metricStore.recordMetric({
        metricId: 'm1',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 1,
        timestamp: new Date(ts).toISOString(),
      });

      const output = exporterWithTimestamp.export();
      const lines = output.split('\n');
      
      const metricLine = lines.find(l => l.includes('request_total') && !l.startsWith('#'));
      expect(metricLine).toBeDefined();

      const match = metricLine!.match(/} (\d+(?:\.\d+)?) (\d+)$/);
      expect(match).toBeDefined();
      expect(match![1]).toBe('1');
      expect(match![2]).toMatch(/^\d+$/);
    });
  });

  describe('Core 7 metrics', () => {
    it('should export all 7 core metrics', () => {
      const coreMetrics = [
        { name: 'request_total', type: 'counter', value: 100, module: 'gateway' as const },
        { name: 'request_duration_seconds', type: 'timer', value: 0.5, module: 'gateway' as const },
        { name: 'active_sessions', type: 'gauge', value: 5, module: 'gateway' as const },
        { name: 'workflow_runs_total', type: 'counter', value: 10, module: 'workflow' as const },
        { name: 'connector_requests_total', type: 'counter', value: 25, module: 'connector' as const },
        { name: 'memory_usage_bytes', type: 'gauge', value: 1024000, module: 'memory' as const },
        { name: 'budget_usage_percent', type: 'gauge', value: 75, module: 'memory' as const },
      ];

      coreMetrics.forEach((m, i) => {
        metricStore.recordMetric({
          metricId: `core_${i}`,
          module: m.module,
          metricType: m.type as 'counter' | 'gauge' | 'timer',
          name: m.name,
          value: m.value,
          timestamp: new Date().toISOString(),
        });
      });

      const output = exporter.export();

      expect(output).toContain('agent_platform_request_total');
      expect(output).toContain('agent_platform_request_duration_seconds');
      expect(output).toContain('agent_platform_active_sessions');
      expect(output).toContain('agent_platform_workflow_runs_total');
      expect(output).toContain('agent_platform_connector_requests_total');
      expect(output).toContain('agent_platform_memory_usage_bytes');
      expect(output).toContain('agent_platform_budget_usage_percent');
    });
  });
});
