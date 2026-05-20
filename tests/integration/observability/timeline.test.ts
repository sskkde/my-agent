import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createEventStore, type EventStore, type EventRecord } from '../../../src/storage/event-store.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createRuntimeActionStore, type RuntimeActionStore, type RuntimeAction } from '../../../src/storage/runtime-action-store.js';
import { createTimelineBuilder, TimelineBuilder } from '../../../src/observability/timeline.js';
import type { AuditStore, AuditRecord } from '../../../src/observability/audit-types.js';
import type { TraceStore, TraceContext, RuntimeSpan } from '../../../src/observability/types.js';

const timelineMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source_module TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        idempotency_key TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        wait_condition_id TEXT,
        artifact_id TEXT,
        memory_id TEXT,
        payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_user ON events(user_id);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
      CREATE INDEX idx_events_planner_run ON events(planner_run_id);
      CREATE INDEX idx_events_workflow_run ON events(workflow_run_id);
      CREATE INDEX idx_events_background_run ON events(background_run_id);
      CREATE INDEX idx_events_subagent_run ON events(subagent_run_id);
      CREATE INDEX idx_events_tool_call ON events(tool_call_id);
      CREATE INDEX idx_events_approval ON events(approval_id);
      CREATE INDEX idx_events_memory ON events(memory_id);
      CREATE INDEX idx_events_created ON events(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_created;
      DROP INDEX IF EXISTS idx_events_memory;
      DROP INDEX IF EXISTS idx_events_approval;
      DROP INDEX IF EXISTS idx_events_tool_call;
      DROP INDEX IF EXISTS idx_events_subagent_run;
      DROP INDEX IF EXISTS idx_events_background_run;
      DROP INDEX IF EXISTS idx_events_workflow_run;
      DROP INDEX IF EXISTS idx_events_planner_run;
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_user;
      DROP INDEX IF EXISTS idx_events_session;
      DROP TABLE IF EXISTS events;
    `
  },
  {
    version: 2,
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
      CREATE INDEX idx_audit_user ON audit_records(user_id);
      CREATE INDEX idx_audit_session ON audit_records(session_id);
      CREATE INDEX idx_audit_correlation ON audit_records(correlation_id);
      CREATE INDEX idx_audit_approval ON audit_records(approval_id);
      CREATE INDEX idx_audit_tool_call ON audit_records(tool_call_id);
      CREATE INDEX idx_audit_timestamp ON audit_records(timestamp DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_audit_timestamp;
      DROP INDEX IF EXISTS idx_audit_tool_call;
      DROP INDEX IF EXISTS idx_audit_approval;
      DROP INDEX IF EXISTS idx_audit_correlation;
      DROP INDEX IF EXISTS idx_audit_session;
      DROP INDEX IF EXISTS idx_audit_user;
      DROP TABLE IF EXISTS audit_records;
    `
  },
  {
    version: 3,
    name: 'create_trace_contexts_table',
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
      CREATE INDEX idx_trace_correlation ON trace_contexts(correlation_id);
      CREATE INDEX idx_trace_session ON trace_contexts(session_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_trace_session;
      DROP INDEX IF EXISTS idx_trace_correlation;
      DROP TABLE IF EXISTS trace_contexts;
    `
  },
  {
    version: 4,
    name: 'create_trace_spans_table',
    up: `
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
      CREATE INDEX idx_spans_trace ON trace_spans(trace_id);
      CREATE INDEX idx_spans_start ON trace_spans(start_time DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_spans_start;
      DROP INDEX IF EXISTS idx_spans_trace;
      DROP TABLE IF EXISTS trace_spans;
    `
  },
  {
    version: 5,
    name: 'create_runtime_actions_table',
    up: `
      CREATE TABLE runtime_actions (
        action_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        idempotency_key TEXT,
        source_module TEXT NOT NULL,
        source_action TEXT,
        target_runtime TEXT NOT NULL,
        target_action TEXT NOT NULL,
        payload TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        session_id TEXT,
        user_id TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        status TEXT NOT NULL,
        status_message TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_actions_planner_run ON runtime_actions(planner_run_id);
      CREATE INDEX idx_actions_workflow_run ON runtime_actions(workflow_run_id);
      CREATE INDEX IF NOT EXISTS idx_actions_session ON runtime_actions(session_id);
      CREATE INDEX idx_actions_created ON runtime_actions(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_actions_created;
      DROP INDEX IF EXISTS idx_actions_session;
      DROP INDEX IF EXISTS idx_actions_workflow_run;
      DROP INDEX IF EXISTS idx_actions_planner_run;
      DROP TABLE IF EXISTS runtime_actions;
    `
  },
];

describe('Observability Timeline Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let eventStore: EventStore;
  let auditStore: AuditStore;
  let traceStore: TraceStore;
  let actionStore: RuntimeActionStore;
  let builder: TimelineBuilder;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(timelineMigrations);

    eventStore = createEventStore(connection);
    auditStore = createAuditStore(connection);
    traceStore = createTraceStore(connection);
    actionStore = createRuntimeActionStore(connection);

    builder = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Timeline by session', () => {
    it('should build timeline for a session with events', () => {
      const sessionId = 'session_001';
      const userId = 'user_001';

      const event1: EventRecord = {
        eventId: 'evt_001',
        eventType: 'user_input',
        sourceModule: 'gateway',
        userId,
        sessionId,
        correlationId: 'corr_001',
        payload: { input: 'Hello' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      const event2: EventRecord = {
        eventId: 'evt_002',
        eventType: 'assistant_response',
        sourceModule: 'kernel',
        userId,
        sessionId,
        correlationId: 'corr_001',
        payload: { output: 'Hi there!' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date(Date.now() + 1000).toISOString(),
      };

      eventStore.append([event1, event2]);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.rootType).toBe('session');
      expect(timeline.rootId).toBe(sessionId);
      expect(timeline.events).toHaveLength(2);
      expect(timeline.status).toBe('completed');
    });

    it('should order session events by timestamp', () => {
      const sessionId = 'session_002';

      const event1: EventRecord = {
        eventId: 'evt_003',
        eventType: 'user_input',
        sourceModule: 'gateway',
        sessionId,
        payload: { input: 'First' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
      };

      const event2: EventRecord = {
        eventId: 'evt_004',
        eventType: 'tool_call',
        sourceModule: 'tool',
        sessionId,
        payload: { tool: 'search' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:05Z').toISOString(),
      };

      const event3: EventRecord = {
        eventId: 'evt_005',
        eventType: 'assistant_response',
        sourceModule: 'kernel',
        sessionId,
        payload: { output: 'Result' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:03Z').toISOString(),
      };

      eventStore.append([event1, event2, event3]);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.events[0]?.eventId).toBe('evt_003');
      expect(timeline.events[1]?.eventId).toBe('evt_005');
      expect(timeline.events[2]?.eventId).toBe('evt_004');
    });
  });

  describe('Timeline by planner_run', () => {
    it('should build timeline for planner run with events', () => {
      const plannerRunId = 'planner_run_001';

      const event: EventRecord = {
        eventId: 'evt_006',
        eventType: 'planner_started',
        sourceModule: 'planner',
        correlationId: 'corr_002',
        relatedRefs: { plannerRunId },
        payload: { planId: 'plan_001' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('planner_run', plannerRunId);

      expect(timeline.rootType).toBe('planner_run');
      expect(timeline.rootId).toBe(plannerRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });

    it('should include actions for planner run timeline', () => {
      const plannerRunId = 'planner_run_002';

      const event: EventRecord = {
        eventId: 'evt_007',
        eventType: 'planner_started',
        sourceModule: 'planner',
        correlationId: 'corr_003',
        relatedRefs: { plannerRunId },
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const action: RuntimeAction = {
        actionId: 'action_001',
        actionType: 'dispatch',
        source: { sourceModule: 'planner' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { task: 'do_something' },
        targetRef: { plannerRunId },
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('planner_run', plannerRunId);

      const actionEvents = timeline.events.filter(e => e.eventType === 'action');
      expect(actionEvents.length).toBeGreaterThan(0);
      expect(actionEvents[0]?.eventId).toBe('action_001');
    });

    it('should show planner run actions with results', () => {
      const plannerRunId = 'planner_run_003';

      const action: RuntimeAction = {
        actionId: 'action_002',
        actionType: 'tool_call',
        source: { sourceModule: 'planner' },
        targetRuntime: 'tool',
        targetAction: 'search',
        payload: { query: 'test' },
        targetRef: { plannerRunId },
        status: 'completed',
        result: { results: ['result1', 'result2'] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('planner_run', plannerRunId);

      const actionEvent = timeline.events.find(e => e.eventId === 'action_002');
      expect(actionEvent).toBeDefined();
      expect(actionEvent?.status).toBe('completed');
    });
  });

  describe('Timeline by workflow_run', () => {
    it('should build timeline for workflow run', () => {
      const workflowRunId = 'workflow_run_001';

      const event: EventRecord = {
        eventId: 'evt_008',
        eventType: 'workflow_step_started',
        sourceModule: 'workflow',
        correlationId: 'corr_004',
        relatedRefs: { workflowRunId },
        payload: { stepId: 'step_001' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('workflow_run', workflowRunId);

      expect(timeline.rootType).toBe('workflow_run');
      expect(timeline.rootId).toBe(workflowRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });

    it('should include workflow actions in timeline', () => {
      const workflowRunId = 'workflow_run_002';

      const action: RuntimeAction = {
        actionId: 'action_003',
        actionType: 'workflow_step',
        source: { sourceModule: 'workflow' },
        targetRuntime: 'kernel',
        targetAction: 'run_agent',
        payload: {},
        targetRef: { workflowRunId },
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('workflow_run', workflowRunId);

      const actionEvents = timeline.events.filter(e => e.eventType === 'action');
      expect(actionEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline by background_run', () => {
    it('should build timeline for background run', () => {
      const backgroundRunId = 'bg_run_001';

      const event: EventRecord = {
        eventId: 'evt_009',
        eventType: 'background_task_started',
        sourceModule: 'subagent',
        correlationId: 'corr_005',
        relatedRefs: { backgroundRunId },
        payload: { task: 'background_work' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('background_run', backgroundRunId);

      expect(timeline.rootType).toBe('background_run');
      expect(timeline.rootId).toBe(backgroundRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline by subagent_run', () => {
    it('should build timeline for subagent run', () => {
      const subagentRunId = 'subagent_run_001';

      const event: EventRecord = {
        eventId: 'evt_010',
        eventType: 'subagent_started',
        sourceModule: 'subagent',
        correlationId: 'corr_006',
        relatedRefs: { subagentRunId },
        payload: { agentType: 'helper' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('subagent_run', subagentRunId);

      expect(timeline.rootType).toBe('subagent_run');
      expect(timeline.rootId).toBe(subagentRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline by tool_call', () => {
    it('should build timeline for tool call', () => {
      const toolCallId = 'tool_call_001';

      const event: EventRecord = {
        eventId: 'evt_011',
        eventType: 'tool_execution_started',
        sourceModule: 'tool',
        correlationId: 'corr_007',
        relatedRefs: { toolCallId },
        payload: { toolName: 'search' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('tool_call', toolCallId);

      expect(timeline.rootType).toBe('tool_call');
      expect(timeline.rootId).toBe(toolCallId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline by approval', () => {
    it('should build timeline for approval', () => {
      const approvalId = 'approval_001';

      const event: EventRecord = {
        eventId: 'evt_012',
        eventType: 'approval_requested',
        sourceModule: 'permission',
        correlationId: 'corr_008',
        relatedRefs: { approvalId },
        payload: { action: 'write_file' },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('approval', approvalId);

      expect(timeline.rootType).toBe('approval');
      expect(timeline.rootId).toBe(approvalId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline by memory', () => {
    it('should build timeline for memory access', () => {
      const memoryId = 'memory_001';

      const event: EventRecord = {
        eventId: 'evt_013',
        eventType: 'memory_accessed',
        sourceModule: 'memory',
        correlationId: 'corr_009',
        relatedRefs: { memoryId },
        payload: { operation: 'read' },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('memory', memoryId);

      expect(timeline.rootType).toBe('memory');
      expect(timeline.rootId).toBe(memoryId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });
  });

  describe('Timeline event ordering', () => {
    it('should order events chronologically regardless of source', () => {
      const sessionId = 'session_ordering';

      const audit: AuditRecord = {
        auditId: 'audit_001',
        auditType: 'user_input',
        timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'gateway',
        sourceAction: 'receive_input',
        actionSummary: 'User sent message',
        status: 'completed',
        payload: {},
        riskLevel: 'low',
        sensitivity: 'low',
      };

      auditStore.record(audit);

      const event: EventRecord = {
        eventId: 'evt_014',
        eventType: 'processing',
        sourceModule: 'kernel',
        sessionId,
        correlationId: 'corr_010',
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:02Z').toISOString(),
      };

      eventStore.append(event);

      const action: RuntimeAction = {
        actionId: 'action_004',
        actionType: 'dispatch',
        source: { sourceModule: 'dispatcher' },
        targetRuntime: 'kernel',
        targetAction: 'process',
        payload: {},
        sessionId,
        status: 'completed',
        createdAt: new Date('2024-01-01T10:00:01Z').toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('session', sessionId);

      const timestamps = timeline.events.map(e => new Date(e.timestamp).getTime());
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1] ?? timestamps[0]);
      expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2] ?? timestamps[1]);
    });
  });

  describe('Related audit/span refs', () => {
    it('should attach audit refs to events via correlationId', () => {
      const sessionId = 'session_refs';
      const correlationId = 'corr_011';

      const event: EventRecord = {
        eventId: 'evt_015',
        eventType: 'tool_call',
        sourceModule: 'tool',
        sessionId,
        correlationId,
        payload: { tool: 'file_write' },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const audit: AuditRecord = {
        auditId: 'audit_002',
        auditType: 'tool_call',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'execute_tool',
        actionSummary: 'File write operation',
        status: 'completed',
        payload: {},
        correlationId,
        riskLevel: 'high',
        sensitivity: 'high',
      };

      auditStore.record(audit);

      const timeline = builder.buildTimeline('session', sessionId);

      const eventWithRef = timeline.events.find(e => e.eventId === 'evt_015');
      expect(eventWithRef?.relatedRefs).toBeDefined();
      expect(eventWithRef?.relatedRefs?.some(r => r.refType === 'audit' && r.refId === 'audit_002')).toBe(true);
    });

    it('should attach span refs to events via correlationId', () => {
      const sessionId = 'session_span_refs';
      const correlationId = 'corr_012';

      const event: EventRecord = {
        eventId: 'evt_016',
        eventType: 'request',
        sourceModule: 'gateway',
        sessionId,
        correlationId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const traceContext: TraceContext = {
        traceId: 'trace_001',
        rootSpanId: 'span_root',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'active',
      };

      traceStore.createTrace(traceContext);

      const span: RuntimeSpan = {
        spanId: 'span_001',
        traceId: 'trace_001',
        parentSpanId: 'span_root',
        spanType: 'tool_execution',
        module: 'tool',
        operation: 'execute',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 100,
      };

      traceStore.createSpan(span);

      const timeline = builder.buildTimeline('session', sessionId);

      const eventWithRef = timeline.events.find(e => e.eventId === 'evt_016');
      expect(eventWithRef?.relatedRefs).toBeDefined();
      expect(eventWithRef?.relatedRefs?.some(r => r.refType === 'span' && r.refId === 'span_001')).toBe(true);
    });
  });

  describe('Timeline metadata', () => {
    it('should calculate correct start and end times', () => {
      const sessionId = 'session_metadata';

      const event1: EventRecord = {
        eventId: 'evt_017',
        eventType: 'start',
        sourceModule: 'gateway',
        sessionId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
      };

      const event2: EventRecord = {
        eventId: 'evt_018',
        eventType: 'end',
        sourceModule: 'kernel',
        sessionId,
        payload: { status: 'completed' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:10Z').toISOString(),
      };

      eventStore.append([event1, event2]);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.startTime).toBe(event1.createdAt);
      expect(timeline.endTime).toBe(event2.createdAt);
      expect(timeline.durationMs).toBe(10000);
    });

    it('should calculate status based on event statuses', () => {
      const sessionId = 'session_status';

      const event1: EventRecord = {
        eventId: 'evt_019',
        eventType: 'operation',
        sourceModule: 'tool',
        sessionId,
        payload: { error: 'Connection failed' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event1);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.status).toBe('failed');
    });

    it('should handle cancelled status', () => {
      const sessionId = 'session_cancelled';

      const action: RuntimeAction = {
        actionId: 'action_005',
        actionType: 'dispatch',
        source: { sourceModule: 'dispatcher' },
        targetRuntime: 'kernel',
        targetAction: 'run',
        payload: {},
        sessionId,
        status: 'cancelled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.status).toBe('cancelled');
    });

    it('should handle active status', () => {
      const sessionId = 'session_active';

      const action: RuntimeAction = {
        actionId: 'action_006',
        actionType: 'dispatch',
        source: { sourceModule: 'dispatcher' },
        targetRuntime: 'kernel',
        targetAction: 'run',
        payload: {},
        sessionId,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.status).toBe('active');
    });
  });

  describe('Timeline event types', () => {
    it('should include event type information', () => {
      const sessionId = 'session_event_types';

      const event: EventRecord = {
        eventId: 'evt_020',
        eventType: 'custom_event',
        sourceModule: 'kernel',
        sessionId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = builder.buildTimeline('session', sessionId);

      const timelineEvent = timeline.events[0];
      expect(timelineEvent?.eventType).toBe('event');
      expect(timelineEvent?.module).toBe('kernel');
      expect(timelineEvent?.description).toContain('custom_event');
    });

    it('should include audit type information', () => {
      const sessionId = 'session_audit_types';

      const audit: AuditRecord = {
        auditId: 'audit_003',
        auditType: 'permission_decision',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'permission',
        sourceAction: 'check_permission',
        actionSummary: 'Permission check for file write',
        status: 'completed',
        payload: { decision: 'allowed' },
        riskLevel: 'medium',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const timeline = builder.buildTimeline('session', sessionId);

      const auditEvent = timeline.events.find(e => e.eventType === 'audit');
      expect(auditEvent).toBeDefined();
      expect(auditEvent?.description).toBe('Permission check for file write');
    });

    it('should include span type information', () => {
      const sessionId = 'session_span_types';
      const correlationId = 'corr_013';

      const event: EventRecord = {
        eventId: 'evt_021',
        eventType: 'request',
        sourceModule: 'gateway',
        sessionId,
        correlationId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const traceContext: TraceContext = {
        traceId: 'trace_002',
        rootSpanId: 'span_root_2',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'active',
      };

      traceStore.createTrace(traceContext);

      const span: RuntimeSpan = {
        spanId: 'span_002',
        traceId: 'trace_002',
        parentSpanId: 'span_root_2',
        spanType: 'kernel_run',
        module: 'kernel',
        operation: 'process_request',
        status: 'completed',
        startTime: new Date().toISOString(),
      };

      traceStore.createSpan(span);

      const timeline = builder.buildTimeline('session', sessionId);

      const spanEvent = timeline.events.find(e => e.eventType === 'span');
      expect(spanEvent).toBeDefined();
      expect(spanEvent?.description).toContain('kernel_run');
      expect(spanEvent?.description).toContain('process_request');
    });

    it('should include action type information', () => {
      const sessionId = 'session_action_types';

      const action: RuntimeAction = {
        actionId: 'action_007',
        actionType: 'tool_execution',
        source: { sourceModule: 'kernel' },
        targetRuntime: 'tool',
        targetAction: 'api_call',
        payload: { endpoint: '/api/v1/data' },
        sessionId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      actionStore.save(action);

      const timeline = builder.buildTimeline('session', sessionId);

      const actionEvent = timeline.events.find(e => e.eventType === 'action');
      expect(actionEvent).toBeDefined();
      expect(actionEvent?.description).toContain('tool_execution');
      expect(actionEvent?.description).toContain('tool.api_call');
    });
  });

  describe('Empty timeline handling', () => {
    it('should handle empty timeline gracefully', () => {
      const sessionId = 'nonexistent_session';

      const timeline = builder.buildTimeline('session', sessionId);

      expect(timeline.rootType).toBe('session');
      expect(timeline.rootId).toBe(sessionId);
      expect(timeline.events).toHaveLength(0);
      expect(timeline.status).toBe('completed');
      expect(timeline.startTime).toBeDefined();
    });
  });
});
