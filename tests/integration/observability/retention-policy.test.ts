import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createMetricStore } from '../../../src/observability/metric-store.js';
import { createLongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js';
import { createToolResultStore } from '../../../src/storage/tool-result-store.js';
import { createRetentionPolicy } from '../../../src/observability/retention-policy.js';
import type { AuditRecord } from '../../../src/observability/audit-types.js';

const migrationsList: Migration[] = [
  {
    version: 1,
    name: 'create_audit_records_table',
    up: `
      CREATE TABLE audit_records (
        audit_id TEXT PRIMARY KEY,
        audit_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        source_module TEXT NOT NULL,
        source_action TEXT NOT NULL,
        action_summary TEXT NOT NULL,
        target_type TEXT,
        target_ref TEXT,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        input_hash TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        approval_id TEXT,
        tool_call_id TEXT,
        permission_decision_id TEXT,
        risk_level TEXT NOT NULL,
        sensitivity TEXT NOT NULL
      );
      CREATE INDEX idx_audit_records_user_timestamp ON audit_records(user_id, timestamp DESC);
    `,
    down: `DROP TABLE IF EXISTS audit_records;`,
  },
  {
    version: 2,
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
    version: 3,
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
  {
    version: 4,
    name: 'create_long_term_memories_table',
    up: `
      CREATE TABLE long_term_memories (
        memory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        entities TEXT,
        source_refs TEXT NOT NULL,
        scope TEXT NOT NULL,
        confidence REAL NOT NULL,
        importance TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        retrieval TEXT NOT NULL,
        fingerprint TEXT,
        source_window_hash TEXT,
        lifecycle_status TEXT NOT NULL DEFAULT 'active'
      );
    `,
    down: `DROP TABLE IF EXISTS long_term_memories;`,
  },
  {
    version: 5,
    name: 'create_tool_results_table',
    up: `
      CREATE TABLE tool_results (
        id TEXT PRIMARY KEY,
        result_ref TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        preview TEXT,
        raw_blob_ref TEXT,
        structured_content TEXT,
        sensitivity TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
    down: `DROP TABLE IF EXISTS tool_results;`,
  },
  {
    version: 6,
    name: 'create_retention_config_table',
    up: `
      CREATE TABLE retention_config (
        config_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        ttl_days INTEGER NOT NULL,
        policy TEXT NOT NULL DEFAULT 'soft_delete',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_retention_config_entity ON retention_config(entity_type);
    `,
    down: `
      DROP INDEX IF EXISTS idx_retention_config_entity;
      DROP TABLE IF EXISTS retention_config;
    `,
  },
];

function createAuditRecord(overrides: Partial<AuditRecord> & { timestamp: string }): AuditRecord {
  return {
    auditId: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    auditType: 'user_input',
    userId: 'user-001',
    sourceModule: 'gateway',
    sourceAction: 'test',
    actionSummary: 'Test audit record',
    status: 'completed',
    payload: {},
    riskLevel: 'low',
    sensitivity: 'low',
    ...overrides,
  };
}

describe('Retention Policy Integration', () => {
  let connection: ConnectionManager;
  let auditStore: ReturnType<typeof createAuditStore>;
  let traceStore: ReturnType<typeof createTraceStore>;
  let metricStore: ReturnType<typeof createMetricStore>;
  let memoryStore: ReturnType<typeof createLongTermMemoryStore>;
  let toolResultStore: ReturnType<typeof createToolResultStore>;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(migrationsList);

    auditStore = createAuditStore(connection);
    traceStore = createTraceStore(connection);
    metricStore = createMetricStore(connection);
    memoryStore = createLongTermMemoryStore(connection);
    toolResultStore = createToolResultStore(connection);
  });

  afterEach(() => {
    connection?.close();
  });

  describe('dry run', () => {
    it('reports eligible count without modifying rows', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      auditStore.record(createAuditRecord({ timestamp: oldTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: freshTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: freshTimestamp }));

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const report = retentionPolicy.dryRun('audit');

      expect(report.entityType).toBe('audit');
      expect(report.dryRun).toBe(true);
      expect(report.eligibleCount).toBe(3);
      expect(report.totalCount).toBe(5);

      const countAfter = auditStore.count({});
      expect(countAfter).toBe(5);
    });

    it('excludes records with high sensitivity from eligible count', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();

      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'low' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'medium' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'high' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'restricted' }));

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const report = retentionPolicy.dryRun('audit');

      expect(report.eligibleCount).toBe(2);
      expect(report.totalCount).toBe(4);
    });
  });

  describe('apply retention', () => {
    it('deletes eligible records while preserving protected sensitivity', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'low' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'medium' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'high' }));
      auditStore.record(createAuditRecord({ timestamp: oldTimestamp, sensitivity: 'restricted' }));
      auditStore.record(createAuditRecord({ timestamp: freshTimestamp, sensitivity: 'low' }));

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const result = retentionPolicy.apply('audit');

      expect(result.entityType).toBe('audit');
      expect(result.dryRun).toBe(false);
      expect(result.audited).toBe(true);
      expect(result.affectedCount).toBe(2);

      const countAfter = auditStore.count({});
      expect(countAfter).toBe(4);

      const remaining = auditStore.query({});
      const sensitivities = remaining.map((r: AuditRecord) => r.sensitivity);
      expect(sensitivities).toContain('high');
      expect(sensitivities).toContain('restricted');
      expect(sensitivities.filter((s: string) => s === 'low')).toHaveLength(2);
    });

    it('audits the retention action itself', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();

      auditStore.record(createAuditRecord({ timestamp: oldTimestamp }));

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      retentionPolicy.apply('audit');

      const auditRecords = auditStore.query({ sourceModule: 'system' });
      const retentionAudits = auditRecords.filter((r: AuditRecord) => r.sourceAction === 'retention_policy_apply');
      expect(retentionAudits.length).toBe(1);
      expect(retentionAudits[0]?.auditType).toBe('workflow_change');
      expect(retentionAudits[0]?.payload).toHaveProperty('entityType', 'audit');
      expect(retentionAudits[0]?.payload).toHaveProperty('affectedCount');
    });
  });

  describe('trace retention', () => {
    it('deletes traces and their spans', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      traceStore.createTrace({
        traceId: 'trace-old',
        rootSpanId: 'span-old-1',
        startedAt: oldTimestamp,
        status: 'completed',
      });
      traceStore.createSpan({
        spanId: 'span-old-1',
        traceId: 'trace-old',
        spanType: 'tool_execution',
        module: 'tool',
        operation: 'test',
        status: 'completed',
        startTime: oldTimestamp,
      });

      traceStore.createTrace({
        traceId: 'trace-fresh',
        rootSpanId: 'span-fresh-1',
        startedAt: freshTimestamp,
        status: 'active',
      });
      traceStore.createSpan({
        spanId: 'span-fresh-1',
        traceId: 'trace-fresh',
        spanType: 'tool_execution',
        module: 'tool',
        operation: 'test',
        status: 'started',
        startTime: freshTimestamp,
      });

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const result = retentionPolicy.apply('traces');

      expect(result.affectedCount).toBe(1);
      expect(traceStore.getTrace('trace-old')).toBeNull();
      expect(traceStore.getSpan('span-old-1')).toBeNull();
      expect(traceStore.getTrace('trace-fresh')).not.toBeNull();
      expect(traceStore.getSpan('span-fresh-1')).not.toBeNull();
    });
  });

  describe('metric retention', () => {
    it('deletes old metrics', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      metricStore.recordMetric({
        metricId: 'metric-old',
        module: 'tool',
        metricType: 'counter',
        name: 'test.metric',
        value: 1,
        timestamp: oldTimestamp,
      });
      metricStore.recordMetric({
        metricId: 'metric-fresh',
        module: 'tool',
        metricType: 'counter',
        name: 'test.metric',
        value: 1,
        timestamp: freshTimestamp,
      });

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const result = retentionPolicy.apply('metrics');

      expect(result.affectedCount).toBe(1);
      expect(metricStore.getMetric('metric-old')).toBeNull();
      expect(metricStore.getMetric('metric-fresh')).not.toBeNull();
    });
  });

  describe('blob retention', () => {
    it('deletes old blobs while preserving protected sensitivity', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();

      connection.exec(
        `INSERT INTO tool_results (id, result_ref, tool_call_id, tool_name, user_id, sensitivity, created_at)
         VALUES 
           ('blob-old-low', 'ref-1', 'tool-1', 'test', 'user-001', 'low', ?),
           ('blob-old-high', 'ref-2', 'tool-2', 'test', 'user-001', 'high', ?),
           ('blob-fresh', 'ref-3', 'tool-3', 'test', 'user-001', 'low', ?)`,
        [oldTimestamp, oldTimestamp, freshTimestamp]
      );

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const result = retentionPolicy.apply('blobs');

      expect(result.affectedCount).toBe(1);
      expect(toolResultStore.findById('blob-old-low')).toBeUndefined();
      expect(toolResultStore.findById('blob-old-high')).not.toBeUndefined();
      expect(toolResultStore.findById('blob-fresh')).not.toBeUndefined();
    });
  });

  describe('custom TTL configuration', () => {
    it('uses configured TTL from retention_config table', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const midTimestamp = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const freshTimestamp = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

      connection.exec(
        `INSERT INTO retention_config (config_id, entity_type, ttl_days, policy, created_at, updated_at)
         VALUES (?, 'audit', ?, 'soft_delete', ?, ?)`,
        ['config-1', 60, now.toISOString(), now.toISOString()]
      );

      auditStore.record(createAuditRecord({ timestamp: oldTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: midTimestamp }));
      auditStore.record(createAuditRecord({ timestamp: freshTimestamp }));

      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const report = retentionPolicy.dryRun('audit');

      expect(report.eligibleCount).toBe(1);
    });
  });

  describe('dryRunAll and applyAll', () => {
    it('runs dry-run for all entity types', () => {
      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const reports = retentionPolicy.dryRunAll();

      expect(reports).toHaveLength(5);
      expect(reports.map(r => r.entityType)).toEqual(['audit', 'traces', 'metrics', 'memory', 'blobs']);
      expect(reports.every(r => r.dryRun === true)).toBe(true);
    });

    it('applies retention for all entity types', () => {
      const retentionPolicy = createRetentionPolicy({
        auditStore,
        traceStore,
        metricStore,
        memoryStore,
        toolResultStore,
        connection,
        defaultTtlDays: 30,
      });

      const results = retentionPolicy.applyAll();

      expect(results).toHaveLength(5);
      expect(results.map(r => r.entityType)).toEqual(['audit', 'traces', 'metrics', 'memory', 'blobs']);
      expect(results.every(r => r.dryRun === false)).toBe(true);
      expect(results.every(r => r.audited === true)).toBe(true);
    });
  });
});
