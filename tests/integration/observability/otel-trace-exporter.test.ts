import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createTracingCollector } from '../../../src/observability/tracing.js';
import type { TraceStore, TracingCollector } from '../../../src/observability/types.js';
import { createOTelTraceExporter } from '../../../src/observability/otel-trace-exporter.js';
import type { OTelExportConfig } from '../../../src/observability/export-types.js';

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
];

interface CapturedRequest {
  body: string;
  headers: Record<string, string>;
}

async function createMockCollectorServer(port: number): Promise<{ server: Server; getCapturedRequests: () => CapturedRequest[] }> {
  const capturedRequests: CapturedRequest[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      }
      capturedRequests.push({ body, headers });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });

  return {
    server,
    getCapturedRequests: () => capturedRequests,
  };
}

describe('OTel Trace Exporter Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let traceStore: TraceStore;
  let collector: TracingCollector;
  let mockServer: Server;
  let getCapturedRequests: () => CapturedRequest[];
  let mockPort: number;

  beforeEach(async () => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(observabilityMigrations);

    traceStore = createTraceStore(connection);
    collector = createTracingCollector({
      traceStore,
      metricStore: {
        recordMetric: () => {},
        recordMetrics: () => {},
        getMetric: () => null,
        queryMetrics: () => [],
        aggregateMetrics: () => [],
        getLatestMetric: () => null,
      },
      enabled: true,
      sampleRate: 1.0,
    });

    const mock = await createMockCollectorServer(0);
    mockServer = mock.server;
    getCapturedRequests = mock.getCapturedRequests;
    const addr = mockServer.address();
    mockPort = typeof addr === 'object' && addr ? addr.port : 14318;
  });

  afterEach(async () => {
    connection?.close();
    await new Promise<void>((resolve) => {
      if (mockServer) {
        mockServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  });

  describe('OTLP JSON format conversion', () => {
    it('should convert RuntimeSpan to OTLP JSON format', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'execute_agent',
        trace.rootSpanId
      );
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
        headers: { 'X-API-Key': 'test-key' },
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      expect(requests).toHaveLength(1);

      const requestBody = JSON.parse(requests[0]!.body);

      expect(requestBody).toHaveProperty('resourceSpans');
      expect(Array.isArray(requestBody.resourceSpans)).toBe(true);
      expect(requestBody.resourceSpans.length).toBeGreaterThan(0);

      const resourceSpan = requestBody.resourceSpans[0];
      expect(resourceSpan).toHaveProperty('resource');
      expect(resourceSpan).toHaveProperty('scopeSpans');

      const resourceAttrs = resourceSpan.resource.attributes;
      const serviceNameAttr = resourceAttrs.find((a: { key: string }) => a.key === 'service.name');
      expect(serviceNameAttr).toBeDefined();
      expect(serviceNameAttr.value.stringValue).toBe('agent-platform');

      const serviceVersionAttr = resourceAttrs.find((a: { key: string }) => a.key === 'service.version');
      expect(serviceVersionAttr).toBeDefined();
      expect(serviceVersionAttr.value.stringValue).toBe('0.6.0');

      expect(Array.isArray(resourceSpan.scopeSpans)).toBe(true);
      expect(resourceSpan.scopeSpans.length).toBeGreaterThan(0);

      const scopeSpan = resourceSpan.scopeSpans[0];
      expect(scopeSpan).toHaveProperty('scope');
      expect(scopeSpan).toHaveProperty('spans');
      expect(Array.isArray(scopeSpan.spans)).toBe(true);
    });

    it('should include correct span fields in OTLP format', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const parentSpan = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'parent_operation',
        trace.rootSpanId
      );
      collector.endSpan(parentSpan.spanId, 'completed');

      const childSpan = collector.startSpan(
        trace.traceId,
        'tool_execution',
        'tool',
        'child_operation',
        parentSpan.spanId
      );
      collector.endSpan(childSpan.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      const requestBody = JSON.parse(requests[0]!.body);
      const spans = requestBody.resourceSpans[0].scopeSpans[0].spans;

      const childSpanData = spans.find((s: { name: string }) => s.name === 'child_operation');
      expect(childSpanData).toBeDefined();
      expect(childSpanData.traceId).toBeDefined();
      expect(childSpanData.spanId).toBeDefined();
      expect(childSpanData.parentSpanId).toBe(parentSpan.spanId);
      expect(childSpanData.name).toBe('child_operation');
      expect(childSpanData.kind).toBeDefined();
      expect(childSpanData.startTimeUnixNano).toBeDefined();
      expect(childSpanData.endTimeUnixNano).toBeDefined();
      expect(childSpanData.status).toBeDefined();
      expect(childSpanData.attributes).toBeDefined();
    });

    it('should include error status for failed spans', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(
        trace.traceId,
        'tool_execution',
        'tool',
        'failing_operation',
        trace.rootSpanId
      );
      collector.endSpan(span.spanId, 'failed', 'Connection timeout');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      const requestBody = JSON.parse(requests[0]!.body);
      const spans = requestBody.resourceSpans[0].scopeSpans[0].spans;

      const failedSpan = spans.find((s: { name: string }) => s.name === 'failing_operation');
      expect(failedSpan).toBeDefined();
      expect(failedSpan.status.code).toBe('STATUS_CODE_ERROR');
      expect(failedSpan.status.message).toBe('Connection timeout');
    });

    it('should convert span attributes correctly', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(
        trace.traceId,
        'kernel_run',
        'kernel',
        'test_operation',
        trace.rootSpanId,
        { customAttr: 'value', numericAttr: 42, boolAttr: true }
      );
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      const requestBody = JSON.parse(requests[0]!.body);
      const spans = requestBody.resourceSpans[0].scopeSpans[0].spans;

      const exportedSpan = spans.find((s: { name: string }) => s.name === 'test_operation');
      expect(exportedSpan).toBeDefined();
      expect(exportedSpan.attributes).toBeDefined();

      const customAttr = exportedSpan.attributes.find((a: { key: string }) => a.key === 'customAttr');
      expect(customAttr).toBeDefined();
      expect(customAttr.value.stringValue).toBe('value');

      const numericAttr = exportedSpan.attributes.find((a: { key: string }) => a.key === 'numericAttr');
      expect(numericAttr).toBeDefined();
      expect(numericAttr.value.intValue).toBe('42');

      const boolAttr = exportedSpan.attributes.find((a: { key: string }) => a.key === 'boolAttr');
      expect(boolAttr).toBeDefined();
      expect(boolAttr.value.boolValue).toBe(true);

      const moduleAttr = exportedSpan.attributes.find((a: { key: string }) => a.key === 'module');
      expect(moduleAttr).toBeDefined();
      expect(moduleAttr.value.stringValue).toBe('kernel');

      const spanTypeAttr = exportedSpan.attributes.find((a: { key: string }) => a.key === 'span.type');
      expect(spanTypeAttr).toBeDefined();
      expect(spanTypeAttr.value.stringValue).toBe('kernel_run');
    });
  });

  describe('Batch export', () => {
    it('should export spans in batches', async () => {
      const trace1 = collector.startTrace({ userId: 'user_001' });
      const span1 = collector.startSpan(trace1.traceId, 'kernel_run', 'kernel', 'op1', trace1.rootSpanId);
      collector.endSpan(span1.spanId, 'completed');

      const trace2 = collector.startTrace({ userId: 'user_002' });
      const span2 = collector.startSpan(trace2.traceId, 'kernel_run', 'kernel', 'op2', trace2.rootSpanId);
      collector.endSpan(span2.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config, { batchSize: 1 });
      await exporter.exportSpans([trace1.traceId, trace2.traceId]);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThanOrEqual(1);
    });

    it('should not export when no spans are available', async () => {
      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans(['non-existent-trace']);

      const requests = getCapturedRequests();
      expect(requests).toHaveLength(0);
    });

    it('should flush batch on demand', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(trace.traceId, 'kernel_run', 'kernel', 'op', trace.rootSpanId);
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);

      exporter.addToBatch(trace.traceId);

      expect(getCapturedRequests()).toHaveLength(0);

      const result = await exporter.flush();
      expect(result.success).toBe(true);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Custom resource attributes', () => {
    it('should include custom resource attributes', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(trace.traceId, 'kernel_run', 'kernel', 'op', trace.rootSpanId);
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
        resource: {
          'deployment.environment': 'production',
          'service.instance.id': 'instance-123',
        },
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      const requestBody = JSON.parse(requests[0]!.body);
      const resourceAttrs = requestBody.resourceSpans[0].resource.attributes;

      const envAttr = resourceAttrs.find((a: { key: string }) => a.key === 'deployment.environment');
      expect(envAttr).toBeDefined();
      expect(envAttr.value.stringValue).toBe('production');

      const instanceAttr = resourceAttrs.find((a: { key: string }) => a.key === 'service.instance.id');
      expect(instanceAttr).toBeDefined();
      expect(instanceAttr.value.stringValue).toBe('instance-123');
    });
  });

  describe('HTTP headers', () => {
    it('should send custom headers with request', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(trace.traceId, 'kernel_run', 'kernel', 'op', trace.rootSpanId);
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: `http://localhost:${mockPort}/v1/traces`,
        protocol: 'http',
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom-Header': 'custom-value',
        },
      };

      const exporter = createOTelTraceExporter(traceStore, config);
      await exporter.exportSpans([trace.traceId]);

      const requests = getCapturedRequests();
      expect(requests.length).toBeGreaterThan(0);
      
      const headers = requests[0]!.headers;
      expect(headers['authorization']).toBe('Bearer token123');
      expect(headers['x-custom-header']).toBe('custom-value');
      expect(headers['content-type']).toContain('application/json');
    });
  });

  describe('Error handling', () => {
    it('should handle network errors gracefully', async () => {
      const trace = collector.startTrace({ userId: 'user_001' });
      const span = collector.startSpan(trace.traceId, 'kernel_run', 'kernel', 'op', trace.rootSpanId);
      collector.endSpan(span.spanId, 'completed');

      const config: OTelExportConfig = {
        endpoint: 'http://localhost:9999/v1/traces',
        protocol: 'http',
      };

      const exporter = createOTelTraceExporter(traceStore, config);

      const result = await exporter.exportSpans([trace.traceId]);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
