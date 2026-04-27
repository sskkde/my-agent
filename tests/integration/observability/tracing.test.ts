import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createMetricStore } from '../../../src/observability/metric-store.js';
import { createTracingCollector, createTracingHooks } from '../../../src/observability/tracing.js';
import type { TraceStore, MetricStore, TracingCollector, TracingHooks } from '../../../src/observability/types.js';

const observabilityMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_trace_contexts_table',
    up: `
      CREATE TABLE trace_contexts (
        trace_id TEXT PRIMARY KEY,
        root_span_id TEXT NOT NULL,
        correlation_id TEXT,
        user_id TEXT,
        session_id TEXT,
        started_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'failed', 'cancelled'))
      );
      CREATE INDEX idx_trace_contexts_correlation ON trace_contexts(correlation_id);
      CREATE INDEX idx_trace_contexts_user ON trace_contexts(user_id);
      CREATE INDEX idx_trace_contexts_session ON trace_contexts(session_id);
      CREATE INDEX idx_trace_contexts_status ON trace_contexts(status);
      CREATE INDEX idx_trace_contexts_started ON trace_contexts(started_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_trace_contexts_started;
      DROP INDEX IF EXISTS idx_trace_contexts_status;
      DROP INDEX IF EXISTS idx_trace_contexts_session;
      DROP INDEX IF EXISTS idx_trace_contexts_user;
      DROP INDEX IF EXISTS idx_trace_contexts_correlation;
      DROP TABLE IF EXISTS trace_contexts;
    `
  },
  {
    version: 2,
    name: 'create_trace_spans_table',
    up: `
      CREATE TABLE trace_spans (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        span_type TEXT NOT NULL CHECK(span_type IN ('dispatch', 'tool_execution', 'kernel_run', 'planner_run', 'workflow_run', 'background_run', 'trigger', 'connector_call', 'permission_check')),
        module TEXT NOT NULL CHECK(module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
        operation TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed', 'cancelled')),
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms INTEGER,
        error TEXT,
        metadata TEXT
      );
      CREATE INDEX idx_trace_spans_trace ON trace_spans(trace_id);
      CREATE INDEX idx_trace_spans_parent ON trace_spans(parent_span_id);
      CREATE INDEX idx_trace_spans_module ON trace_spans(module);
      CREATE INDEX idx_trace_spans_type ON trace_spans(span_type);
      CREATE INDEX idx_trace_spans_status ON trace_spans(status);
      CREATE INDEX idx_trace_spans_start_time ON trace_spans(start_time DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_trace_spans_start_time;
      DROP INDEX IF EXISTS idx_trace_spans_status;
      DROP INDEX IF EXISTS idx_trace_spans_type;
      DROP INDEX IF EXISTS idx_trace_spans_module;
      DROP INDEX IF EXISTS idx_trace_spans_parent;
      DROP INDEX IF EXISTS idx_trace_spans_trace;
      DROP TABLE IF EXISTS trace_spans;
    `
  },
  {
    version: 3,
    name: 'create_metrics_table',
    up: `
      CREATE TABLE metrics (
        metric_id TEXT PRIMARY KEY,
        trace_id TEXT,
        span_id TEXT,
        module TEXT NOT NULL CHECK(module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
        metric_type TEXT NOT NULL CHECK(metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
        name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT NOT NULL,
        labels TEXT
      );
      CREATE INDEX idx_metrics_trace ON metrics(trace_id);
      CREATE INDEX idx_metrics_span ON metrics(span_id);
      CREATE INDEX idx_metrics_module ON metrics(module);
      CREATE INDEX idx_metrics_type ON metrics(metric_type);
      CREATE INDEX idx_metrics_name ON metrics(name);
      CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
      CREATE INDEX idx_metrics_module_name ON metrics(module, name, timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_metrics_module_name;
      DROP INDEX IF EXISTS idx_metrics_timestamp;
      DROP INDEX IF EXISTS idx_metrics_name;
      DROP INDEX IF EXISTS idx_metrics_type;
      DROP INDEX IF EXISTS idx_metrics_module;
      DROP INDEX IF EXISTS idx_metrics_span;
      DROP INDEX IF EXISTS idx_metrics_trace;
      DROP TABLE IF EXISTS metrics;
    `
  },
];

describe('Observability Tracing Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let traceStore: TraceStore;
  let metricStore: MetricStore;
  let collector: TracingCollector;
  let hooks: TracingHooks;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(observabilityMigrations);

    traceStore = createTraceStore(connection);
    metricStore = createMetricStore(connection);

    collector = createTracingCollector({
      traceStore,
      metricStore,
      enabled: true,
      sampleRate: 1.0,
    });

    hooks = createTracingHooks(collector);
  });

  afterEach(() => {
    connection?.close();
  });

  describe('TraceContext creation', () => {
    it('should create a trace with required fields', () => {
      const trace = collector.startTrace({
        userId: 'user_001',
        sessionId: 'session_001',
      });

      expect(trace.traceId).toBeDefined();
      expect(trace.rootSpanId).toBeDefined();
      expect(trace.userId).toBe('user_001');
      expect(trace.sessionId).toBe('session_001');
      expect(trace.status).toBe('active');
      expect(trace.startedAt).toBeDefined();

      const retrieved = traceStore.getTrace(trace.traceId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe('user_001');
    });

    it('should create a trace with correlation ID', () => {
      const trace = collector.startTrace({
        correlationId: 'corr_123',
        userId: 'user_001',
      });

      expect(trace.correlationId).toBe('corr_123');

      const retrieved = traceStore.getTrace(trace.traceId);
      expect(retrieved?.correlationId).toBe('corr_123');
    });

    it('should find traces by correlation ID', () => {
      collector.startTrace({ correlationId: 'corr_abc', userId: 'user_001' });
      collector.startTrace({ correlationId: 'corr_abc', userId: 'user_002' });
      collector.startTrace({ correlationId: 'corr_xyz', userId: 'user_003' });

      const traces = traceStore.findTracesByCorrelation('corr_abc');
      expect(traces).toHaveLength(2);
    });

    it('should find traces by user ID', () => {
      collector.startTrace({ userId: 'user_001' });
      collector.startTrace({ userId: 'user_001' });
      collector.startTrace({ userId: 'user_002' });

      const traces = traceStore.findTracesByUser('user_001');
      expect(traces).toHaveLength(2);
    });
  });

  describe('RuntimeSpan parent/child linkage', () => {
    it('should create a span with parent reference', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const parentSpan = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'execute_agent',
        trace.rootSpanId
      );

      const childSpan = collector.startSpan(
        trace.traceId,
        'tool_execution',
        'tool',
        'call_api',
        parentSpan.spanId
      );

      expect(parentSpan.traceId).toBe(trace.traceId);
      expect(childSpan.parentSpanId).toBe(parentSpan.spanId);

      const retrievedChild = traceStore.getSpan(childSpan.spanId);
      expect(retrievedChild?.parentSpanId).toBe(parentSpan.spanId);
    });

    it('should find child spans by parent ID', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const parentSpan = collector.startSpan(
        trace.traceId,
        'workflow_run',
        'workflow',
        'run_workflow',
        trace.rootSpanId
      );

      collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'step_1',
        parentSpan.spanId
      );

      collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'step_2',
        parentSpan.spanId
      );

      const children = traceStore.findSpansByParent(parentSpan.spanId);
      expect(children).toHaveLength(2);
    });

    it('should find spans by trace ID', () => {
      const trace1 = collector.startTrace({ userId: 'user_001' });
      const trace2 = collector.startTrace({ userId: 'user_002' });

      collector.startSpan(trace1.traceId, 'kernel_run', 'kernel', 'run1', trace1.rootSpanId);
      collector.startSpan(trace1.traceId, 'tool_execution', 'tool', 'tool1', trace1.rootSpanId);
      collector.startSpan(trace2.traceId, 'kernel_run', 'kernel', 'run2', trace2.rootSpanId);

      // startTrace creates a root span automatically, so we have 2 manual + 1 root = 3
      const spans1 = traceStore.findSpansByTrace(trace1.traceId);
      expect(spans1).toHaveLength(3);

      const spans2 = traceStore.findSpansByTrace(trace2.traceId);
      expect(spans2).toHaveLength(2);
    });
  });

  describe('Metric recording', () => {
    it('should record a metric', () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'execute',
        trace.rootSpanId
      );

      collector.recordMetric({
        traceId: trace.traceId,
        spanId: span.spanId,
        module: 'kernel',
        metricType: 'counter',
        name: 'requests_total',
        value: 1,
        unit: 'count',
        labels: { method: 'POST' },
      });

      const metrics = metricStore.queryMetrics({ name: 'requests_total' });
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.value).toBe(1);
      expect(metrics[0]?.module).toBe('kernel');
    });

    it('should query metrics by module', () => {
      collector.recordMetric({
        module: 'kernel',
        metricType: 'gauge',
        name: 'memory_usage',
        value: 1024,
      });

      collector.recordMetric({
        module: 'tool',
        metricType: 'gauge',
        name: 'active_connections',
        value: 5,
      });

      collector.recordMetric({
        module: 'kernel',
        metricType: 'counter',
        name: 'requests_total',
        value: 10,
      });

      const kernelMetrics = metricStore.queryMetrics({ module: 'kernel' });
      expect(kernelMetrics).toHaveLength(2);
    });

    it('should aggregate metrics', () => {
      collector.recordMetric({
        module: 'kernel',
        metricType: 'timer',
        name: 'request_duration_ms',
        value: 100,
      });

      collector.recordMetric({
        module: 'kernel',
        metricType: 'timer',
        name: 'request_duration_ms',
        value: 200,
      });

      collector.recordMetric({
        module: 'kernel',
        metricType: 'timer',
        name: 'request_duration_ms',
        value: 300,
      });

      const aggregations = metricStore.aggregateMetrics({
        module: 'kernel',
        name: 'request_duration_ms',
      });

      expect(aggregations).toHaveLength(1);
      expect(aggregations[0]?.count).toBe(3);
      expect(aggregations[0]?.sum).toBe(600);
      expect(aggregations[0]?.avg).toBe(200);
      expect(aggregations[0]?.min).toBe(100);
      expect(aggregations[0]?.max).toBe(300);
    });
  });

  describe('Dispatch span', () => {
    it('should include target runtime and latency', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const result = await collector.withSpan(
        trace.traceId,
        'dispatch',
        'dispatcher',
        'dispatch_request',
        async (_span) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { success: true };
        },
        trace.rootSpanId,
        { targetRuntime: 'kernel_plane', action: 'run_agent' }
      );

      expect(result.success).toBe(true);

      const spans = traceStore.findSpansByTrace(trace.traceId);
      const dispatchSpan = spans.find((s: { operation: string }) => s.operation === 'dispatch_request');

      expect(dispatchSpan).toBeDefined();
      expect(dispatchSpan?.spanType).toBe('dispatch');
      expect(dispatchSpan?.module).toBe('dispatcher');
      expect(dispatchSpan?.metadata).toEqual({
        targetRuntime: 'kernel_plane',
        action: 'run_agent',
      });
      expect(dispatchSpan?.durationMs).toBeDefined();
      expect(dispatchSpan?.durationMs).toBeGreaterThanOrEqual(50);
    });

    it('should record latency metrics for dispatch', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      await collector.withSpan(
        trace.traceId,
        'dispatch',
        'dispatcher',
        'dispatch_to_kernel',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        },
        trace.rootSpanId,
        { targetRuntime: 'kernel_plane' }
      );

      const metrics = metricStore.queryMetrics({
        module: 'dispatcher',
        name: 'dispatch_to_kernel_duration_ms',
      });

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]?.value).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Failed tool span', () => {
    it('should record error when tool execution fails', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      try {
        await collector.withSpan(
          trace.traceId,
          'tool_execution',
          'tool',
          'execute_tool',
          async () => {
            throw new Error('Tool execution failed: connection timeout');
          },
          trace.rootSpanId,
          { toolName: 'api_call' }
        );
      } catch {
        // Expected to throw
      }

      const spans = traceStore.findSpansByTrace(trace.traceId);
      const toolSpan = spans.find((s: { operation: string }) => s.operation === 'execute_tool');

      expect(toolSpan).toBeDefined();
      expect(toolSpan?.status).toBe('failed');
      expect(toolSpan?.error).toBe('Tool execution failed: connection timeout');
    });

    it('should record error metrics for failed tools', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      try {
        await collector.withSpan(
          trace.traceId,
          'tool_execution',
          'tool',
          'call_api',
          async () => {
            throw new Error('API Error');
          },
          trace.rootSpanId
        );
      } catch {
        // Expected to throw
      }

      const errorMetrics = metricStore.queryMetrics({
        name: 'call_api_errors',
      });

      expect(errorMetrics.length).toBeGreaterThan(0);
      expect(errorMetrics[0]?.value).toBe(1);
    });
  });

  describe('Metrics query by module', () => {
    it('should return metrics filtered by module', () => {
      collector.recordMetric({
        module: 'gateway',
        metricType: 'counter',
        name: 'requests',
        value: 10,
      });

      collector.recordMetric({
        module: 'dispatcher',
        metricType: 'counter',
        name: 'requests',
        value: 8,
      });

      collector.recordMetric({
        module: 'kernel',
        metricType: 'counter',
        name: 'requests',
        value: 5,
      });

      collector.recordMetric({
        module: 'tool',
        metricType: 'counter',
        name: 'requests',
        value: 3,
      });

      const gatewayMetrics = metricStore.queryMetrics({ module: 'gateway' });
      expect(gatewayMetrics).toHaveLength(1);
      expect(gatewayMetrics[0]?.value).toBe(10);

      const dispatcherMetrics = metricStore.queryMetrics({ module: 'dispatcher' });
      expect(dispatcherMetrics).toHaveLength(1);
      expect(dispatcherMetrics[0]?.value).toBe(8);

      const kernelMetrics = metricStore.queryMetrics({ module: 'kernel' });
      expect(kernelMetrics).toHaveLength(1);
      expect(kernelMetrics[0]?.value).toBe(5);

      const toolMetrics = metricStore.queryMetrics({ module: 'tool' });
      expect(toolMetrics).toHaveLength(1);
      expect(toolMetrics[0]?.value).toBe(3);
    });

    it('should aggregate metrics by module', () => {
      collector.recordMetric({
        module: 'kernel',
        metricType: 'counter',
        name: 'requests',
        value: 1,
      });

      collector.recordMetric({
        module: 'kernel',
        metricType: 'counter',
        name: 'requests',
        value: 1,
      });

      const aggregations = metricStore.aggregateMetrics({ module: 'kernel' });
      expect(aggregations).toHaveLength(1);
      expect(aggregations[0]?.count).toBe(2);
    });

    it('should query metrics with time range', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      metricStore.recordMetric({
        metricId: 'm1',
        module: 'kernel',
        metricType: 'gauge',
        name: 'cpu_usage',
        value: 50,
        timestamp: twoHoursAgo.toISOString(),
      });

      metricStore.recordMetric({
        metricId: 'm2',
        module: 'kernel',
        metricType: 'gauge',
        name: 'cpu_usage',
        value: 60,
        timestamp: oneHourAgo.toISOString(),
      });

      const recentMetrics = metricStore.queryMetrics({
        module: 'kernel',
        startTime: oneHourAgo.toISOString(),
      });

      expect(recentMetrics).toHaveLength(1);
      expect(recentMetrics[0]?.value).toBe(60);
    });
  });

  describe('Tracing hooks', () => {
    it('should create dispatch span with hooks', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span = hooks.onDispatch(
        trace.traceId,
        'kernel_plane',
        'run_agent',
        trace.rootSpanId
      );

      expect(span.spanType).toBe('dispatch');
      expect(span.module).toBe('dispatcher');
      expect(span.metadata).toEqual({
        targetRuntime: 'kernel_plane',
        action: 'run_agent',
      });
    });

    it('should create tool execution span with hooks', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span = hooks.onToolExecution(trace.traceId, 'api_client', trace.rootSpanId);

      expect(span.spanType).toBe('tool_execution');
      expect(span.module).toBe('tool');
      expect(span.metadata).toEqual({ toolName: 'api_client' });
    });

    it('should create kernel run span with hooks', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span = hooks.onKernelRun(trace.traceId, 'agent_001', trace.rootSpanId);

      expect(span.spanType).toBe('kernel_run');
      expect(span.module).toBe('kernel');
      expect(span.metadata).toEqual({ agentId: 'agent_001' });
    });

    it('should create workflow run span with hooks', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span = hooks.onWorkflowRun(trace.traceId, 'wf_001', trace.rootSpanId);

      expect(span.spanType).toBe('workflow_run');
      expect(span.module).toBe('workflow');
      expect(span.metadata).toEqual({ workflowId: 'wf_001' });
    });

    it('should create connector call span with hooks', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span = hooks.onConnectorCall(trace.traceId, 'slack', 'send_message', trace.rootSpanId);

      expect(span.spanType).toBe('connector_call');
      expect(span.module).toBe('connector');
      expect(span.metadata).toEqual({ connectorId: 'slack', operation: 'send_message' });
    });
  });

  describe('Trace lifecycle', () => {
    it('should update trace status', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      collector.endTrace(trace.traceId, 'completed');

      const updated = traceStore.getTrace(trace.traceId);
      expect(updated?.status).toBe('completed');
    });

    it('should end active spans when trace ends', () => {
      const trace = collector.startTrace({ userId: 'user_001' });

      const span1 = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'run1',
        trace.rootSpanId
      );

      const span2 = collector.startSpan(
        trace.traceId,
        'tool_execution',
        'tool',
        'tool1',
        span1.spanId
      );

      expect(span1.status).toBe('started');
      expect(span2.status).toBe('started');

      collector.endTrace(trace.traceId, 'completed');

      const updatedSpan1 = traceStore.getSpan(span1.spanId);
      const updatedSpan2 = traceStore.getSpan(span2.spanId);

      expect(updatedSpan1?.status).toBe('completed');
      expect(updatedSpan2?.status).toBe('completed');
    });
  });
});
