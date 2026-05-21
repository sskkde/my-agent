import { describe, expect, it } from 'vitest';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createReplayService, DEFAULT_SAFETY_POLICY } from '../../../src/observability/replay.js';
import { createTimelineBuilder } from '../../../src/observability/timeline.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createConnectionManager } from '../../../src/storage/connection.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createMigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createRuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import type { AuditRecord } from '../../../src/observability/audit-types.js';

const migrations: Migration[] = [
  {
    version: 1,
    name: 'replay_minimum_tables',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, source_module TEXT NOT NULL,
        user_id TEXT, session_id TEXT, correlation_id TEXT, causation_id TEXT, idempotency_key TEXT,
        planner_run_id TEXT, plan_id TEXT, run_id TEXT, workflow_run_id TEXT, workflow_step_run_id TEXT,
        background_run_id TEXT, subagent_run_id TEXT, tool_call_id TEXT, approval_id TEXT,
        wait_condition_id TEXT, artifact_id TEXT, memory_id TEXT, payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL, retention_class TEXT NOT NULL, created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE TABLE audit_records (
        audit_id TEXT PRIMARY KEY, audit_type TEXT NOT NULL, timestamp TEXT NOT NULL, user_id TEXT NOT NULL,
        session_id TEXT, source_module TEXT NOT NULL, source_action TEXT NOT NULL, action_summary TEXT NOT NULL,
        target_type TEXT, target_ref TEXT, status TEXT NOT NULL, payload TEXT NOT NULL, input_hash TEXT,
        correlation_id TEXT, causation_id TEXT, approval_id TEXT, tool_call_id TEXT, permission_decision_id TEXT,
        risk_level TEXT NOT NULL, sensitivity TEXT NOT NULL
      );
      CREATE TABLE trace_contexts (
        trace_id TEXT PRIMARY KEY, root_span_id TEXT NOT NULL, correlation_id TEXT, user_id TEXT,
        session_id TEXT, started_at TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE trace_spans (
        span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT, span_type TEXT NOT NULL,
        module TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, start_time TEXT NOT NULL,
        end_time TEXT, duration_ms INTEGER, error TEXT, metadata TEXT
      );
      CREATE TABLE runtime_actions (
        action_id TEXT PRIMARY KEY, action_type TEXT NOT NULL, idempotency_key TEXT, source_module TEXT NOT NULL,
        source_action TEXT, target_runtime TEXT NOT NULL, target_action TEXT NOT NULL, payload TEXT NOT NULL,
        correlation_id TEXT, causation_id TEXT, session_id TEXT, user_id TEXT, planner_run_id TEXT, plan_id TEXT,
        run_id TEXT, workflow_run_id TEXT, workflow_step_run_id TEXT, background_run_id TEXT, subagent_run_id TEXT,
        tool_call_id TEXT, status TEXT NOT NULL, status_message TEXT, result TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    down: `
      DROP TABLE runtime_actions;
      DROP TABLE trace_spans;
      DROP TABLE trace_contexts;
      DROP TABLE audit_records;
      DROP TABLE events;
    `,
  },
];

describe('timeline_only replay safety', () => {
  it('returns redacted connector write timeline without dispatching external writes', () => {
    const connection = createConnectionManager(':memory:');
    connection.open();
    try {
      const runner = createMigrationRunner(connection);
      runner.init();
      runner.apply(migrations);

      const eventStore = createEventStore(connection);
      const auditStore = createAuditStore(connection);
      const traceStore = createTraceStore(connection);
      const actionStore = createRuntimeActionStore(connection);
      const timelineBuilder = createTimelineBuilder({ eventStore, auditStore, traceStore, actionStore });
      const replayService = createReplayService({ timelineBuilder, eventStore, auditStore, traceStore });
      const mockConnector = { sendCount: 0 };
      const sessionId = 'session-replay-safe';
      const audit: AuditRecord = {
        auditId: 'audit-write-1',
        auditType: 'external_write',
        timestamp: '2024-01-01T00:00:00.000Z',
        userId: 'user-1',
        sessionId,
        sourceModule: 'connector',
        sourceAction: 'send_email',
        actionSummary: 'send_email external_write',
        status: 'completed',
        payload: { to: 'user@example.test', token: 'secret-token' },
        riskLevel: 'high',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const result = replayService.replay({
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      });

      expect(mockConnector.sendCount).toBe(0);
      expect(result.blockedActions).toHaveLength(1);
      const timelineEvent = result.timeline.events.find((event) => event.eventId === audit.auditId);
      const sourceData = timelineEvent?.sourceData as AuditRecord | undefined;
      expect(sourceData?.payload.token).toBe('[REDACTED]');
      expect(timelineEvent?.description).toContain('external_write');
    } finally {
      connection.close();
    }
  });
});
