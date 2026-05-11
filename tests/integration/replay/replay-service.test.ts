import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createEventStore, type EventStore, type EventRecord } from '../../../src/storage/event-store.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createTimelineBuilder, type TimelineBuilder } from '../../../src/observability/timeline.js';
import {
  createReplayService,
  type ReplayService,
  type ReplayRequest,
  type SafetyPolicy,
  DEFAULT_SAFETY_POLICY,
} from '../../../src/observability/replay.js';
import type { AuditStore, AuditRecord } from '../../../src/observability/audit-types.js';
import type { TraceStore, TraceContext, RuntimeSpan } from '../../../src/observability/types.js';

const replayMigrations: Migration[] = [
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
        created_at TEXT NOT NULL
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

describe('Replay Service Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let eventStore: EventStore;
  let auditStore: AuditStore;
  let traceStore: TraceStore;
  let actionStore: RuntimeActionStore;
  let timelineBuilder: TimelineBuilder;
  let replayService: ReplayService;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(replayMigrations);

    eventStore = createEventStore(connection);
    auditStore = createAuditStore(connection);
    traceStore = createTraceStore(connection);
    actionStore = createRuntimeActionStore(connection);

    timelineBuilder = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore,
    });

    replayService = createReplayService({
      timelineBuilder,
      eventStore,
      auditStore,
      traceStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Timeline-only replay for background run', () => {
    it('should build timeline for background run in timeline_only mode', () => {
      const backgroundRunId = 'bg_run_001';
      const correlationId = 'corr_bg_001';

      // Create background run events
      const startEvent: EventRecord = {
        eventId: 'evt_bg_start',
        eventType: 'background_task_started',
        sourceModule: 'subagent',
        userId: 'user_001',
        correlationId,
        relatedRefs: { backgroundRunId },
        payload: { taskType: 'data_processing', parameters: { file: 'data.csv' } },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
      };

      const progressEvent: EventRecord = {
        eventId: 'evt_bg_progress',
        eventType: 'background_task_progress',
        sourceModule: 'subagent',
        userId: 'user_001',
        correlationId,
        relatedRefs: { backgroundRunId },
        payload: { progress: { percent: 50 } },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:05:00Z').toISOString(),
      };

      const completeEvent: EventRecord = {
        eventId: 'evt_bg_complete',
        eventType: 'background_task_completed',
        sourceModule: 'subagent',
        userId: 'user_001',
        correlationId,
        relatedRefs: { backgroundRunId },
        payload: { results: { recordsProcessed: 1000 } },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date('2024-01-01T10:10:00Z').toISOString(),
      };

      eventStore.append([startEvent, progressEvent, completeEvent]);

      const request: ReplayRequest = {
        rootType: 'background_run',
        rootId: backgroundRunId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.timeline.rootType).toBe('background_run');
      expect(result.timeline.rootId).toBe(backgroundRunId);
      expect(result.timeline.events).toHaveLength(3);
      expect(result.blockedActions).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return timeline ordered by timestamp', () => {
      const backgroundRunId = 'bg_run_002';
      const correlationId = 'corr_bg_002';

      const events: EventRecord[] = [
        {
          eventId: 'evt_003',
          eventType: 'background_task_completed',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:10:00Z').toISOString(),
        },
        {
          eventId: 'evt_001',
          eventType: 'background_task_started',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_002',
          eventType: 'background_task_progress',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:05:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'background_run',
        rootId: backgroundRunId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.timeline.events[0]?.eventId).toBe('evt_001');
      expect(result.timeline.events[1]?.eventId).toBe('evt_002');
      expect(result.timeline.events[2]?.eventId).toBe('evt_003');
    });
  });

  describe('State rebuild reconstructs active state snapshot', () => {
    it('should reconstruct workflow run state from events', () => {
      const workflowRunId = 'wf_run_001';
      const correlationId = 'corr_wf_001';

      const events: EventRecord[] = [
        {
          eventId: 'evt_wf_start',
          eventType: 'workflow_started',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: { workflowId: 'wf_001' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_step1_start',
          eventType: 'workflow_step_started',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId, workflowStepRunId: 'step_run_001' },
          payload: { stepRunId: 'step_run_001', stepId: 'step_001', input: { data: 'test' } },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:01:00Z').toISOString(),
        },
        {
          eventId: 'evt_step1_complete',
          eventType: 'workflow_step_completed',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId, workflowStepRunId: 'step_run_001' },
          payload: { stepRunId: 'step_run_001', output: { result: 'success' } },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:02:00Z').toISOString(),
        },
        {
          eventId: 'evt_wf_complete',
          eventType: 'workflow_completed',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:05:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'workflow_run',
        rootId: workflowRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.stateSnapshot).toBeDefined();
      expect(result.stateSnapshot?.workflowRun).toBeDefined();
      expect(result.stateSnapshot?.workflowRun?.workflowRunId).toBe(workflowRunId);
      expect(result.stateSnapshot?.workflowRun?.status).toBe('completed');
      expect(result.stateSnapshot?.workflowRun?.steps).toHaveLength(1);
      expect(result.stateSnapshot?.workflowRun?.steps[0]?.status).toBe('completed');
    });

    it('should reconstruct background run state from events', () => {
      const backgroundRunId = 'bg_run_003';
      const correlationId = 'corr_bg_003';

      const events: EventRecord[] = [
        {
          eventId: 'evt_bg_start',
          eventType: 'background_task_started',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: { taskType: 'data_sync', parameters: { source: 'db1', target: 'db2' } },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_bg_complete',
          eventType: 'background_task_completed',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: { results: { synced: 500 } },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:10:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'background_run',
        rootId: backgroundRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.stateSnapshot).toBeDefined();
      expect(result.stateSnapshot?.backgroundRun).toBeDefined();
      expect(result.stateSnapshot?.backgroundRun?.backgroundRunId).toBe(backgroundRunId);
      expect(result.stateSnapshot?.backgroundRun?.status).toBe('completed');
      expect(result.stateSnapshot?.backgroundRun?.taskType).toBe('data_sync');
      expect(result.stateSnapshot?.backgroundRun?.results).toEqual({ synced: 500 });
    });

    it('should reconstruct planner run state from events', () => {
      const plannerRunId = 'planner_run_001';
      const correlationId = 'corr_planner_001';

      const events: EventRecord[] = [
        {
          eventId: 'evt_planner_start',
          eventType: 'planner_started',
          sourceModule: 'planner',
          correlationId,
          relatedRefs: { plannerRunId },
          payload: { objective: 'Create a data pipeline', planId: 'plan_001', totalSteps: 5 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_planner_step1',
          eventType: 'planner_step_completed',
          sourceModule: 'planner',
          correlationId,
          relatedRefs: { plannerRunId },
          payload: { stepNumber: 1 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:05:00Z').toISOString(),
        },
        {
          eventId: 'evt_planner_step2',
          eventType: 'planner_step_completed',
          sourceModule: 'planner',
          correlationId,
          relatedRefs: { plannerRunId },
          payload: { stepNumber: 2 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:10:00Z').toISOString(),
        },
        {
          eventId: 'evt_planner_complete',
          eventType: 'planner_completed',
          sourceModule: 'planner',
          correlationId,
          relatedRefs: { plannerRunId },
          payload: { totalSteps: 5 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:30:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'planner_run',
        rootId: plannerRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('partial');
      expect(result.stateSnapshot).toBeDefined();
      expect(result.stateSnapshot?.plannerRun).toBeDefined();
      expect(result.stateSnapshot?.plannerRun?.plannerRunId).toBe(plannerRunId);
      expect(result.stateSnapshot?.plannerRun?.status).toBe('completed');
      expect(result.stateSnapshot?.plannerRun?.objective).toBe('Create a data pipeline');
      expect(result.stateSnapshot?.plannerRun?.stepsCompleted).toBe(5);
      expect(result.stateSnapshot?.plannerRun?.totalSteps).toBe(5);
    });

    it('should handle failed workflow state reconstruction', () => {
      const workflowRunId = 'wf_run_002';
      const correlationId = 'corr_wf_002';

      const events: EventRecord[] = [
        {
          eventId: 'evt_wf_start',
          eventType: 'workflow_started',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_wf_failed',
          eventType: 'workflow_failed',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: { error: 'Connection timeout' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:01:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'workflow_run',
        rootId: workflowRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.stateSnapshot?.workflowRun?.status).toBe('failed');
    });
  });

  describe('External write replay is blocked unless approved policy allows', () => {
    it('should block external write actions by default', () => {
      const sessionId = 'session_001';
      const correlationId = 'corr_ext_001';

      const audit: AuditRecord = {
        auditId: 'audit_ext_write',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write_file',
        actionSummary: 'Write data to external file',
        status: 'completed',
        payload: { filePath: '/tmp/data.txt' },
        riskLevel: 'high',
        sensitivity: 'medium',
        correlationId,
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('partial');
      expect(result.blockedActions).toHaveLength(1);
      expect(result.blockedActions[0]?.action).toContain('external');
      expect(result.blockedActions[0]?.reason).toContain('blocked by default safety policy');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should allow external writes when policy explicitly allows', () => {
      const sessionId = 'session_002';
      const correlationId = 'corr_ext_002';

      const audit: AuditRecord = {
        auditId: 'audit_ext_write',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write_file',
        actionSummary: 'Write data to external file',
        status: 'completed',
        payload: { filePath: '/tmp/data.txt' },
        riskLevel: 'high',
        sensitivity: 'medium',
        correlationId,
      };

      auditStore.record(audit);

      const permissivePolicy: SafetyPolicy = {
        allowExternalWrites: true,
        allowToolExecution: false,
        allowConnectorAccess: false,
        maxReplayDepth: 10,
        requireApprovalForSideEffects: false,
      };

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: permissivePolicy,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.blockedActions).toHaveLength(0);
    });

    it('should block database write events by default', () => {
      const workflowRunId = 'wf_run_003';
      const correlationId = 'corr_db_001';

      const event: EventRecord = {
        eventId: 'evt_db_write',
        eventType: 'database_write',
        sourceModule: 'connector',
        correlationId,
        relatedRefs: { workflowRunId },
        payload: { table: 'users', operation: 'insert' },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const request: ReplayRequest = {
        rootType: 'workflow_run',
        rootId: workflowRunId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('partial');
      expect(result.blockedActions.length).toBeGreaterThan(0);
      expect(result.blockedActions[0]?.reason).toContain('blocked by default replay safety policy');
    });
  });

  describe('Side effect blocked actions reported', () => {
    it('should report blocked tool execution actions', () => {
      const sessionId = 'session_003';
      const correlationId = 'corr_tool_001';

      const audit: AuditRecord = {
        auditId: 'audit_tool_call',
        auditType: 'tool_call',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'execute_tool',
        actionSummary: 'Execute external API call',
        status: 'completed',
        payload: { toolName: 'api_call' },
        riskLevel: 'medium',
        sensitivity: 'low',
        correlationId,
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.length).toBeGreaterThan(0);
      const blockedTool = result.blockedActions.find(
        (action) => action.action.includes('external') || action.reason.includes('Tool execution')
      );
      expect(blockedTool).toBeDefined();
    });

    it('should report blocked connector access actions', () => {
      const sessionId = 'session_004';
      const correlationId = 'corr_conn_001';

      const audit: AuditRecord = {
        auditId: 'audit_connector',
        auditType: 'connector_access',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'connector',
        sourceAction: 'call_connector',
        actionSummary: 'Access external system',
        status: 'completed',
        payload: { connectorId: 'salesforce' },
        riskLevel: 'medium',
        sensitivity: 'medium',
        correlationId,
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.length).toBeGreaterThan(0);
      const blockedConnector = result.blockedActions.find(
        (action) => action.reason.includes('Connector access')
      );
      expect(blockedConnector).toBeDefined();
    });

    it('should include all blocking details in blocked actions', () => {
      const workflowRunId = 'wf_run_004';
      // For workflow_run, audits are looked up by correlationId matching rootId
      const correlationId = workflowRunId;

      const audits: AuditRecord[] = [
        {
          auditId: 'audit_001',
          auditType: 'external_write',
          timestamp: new Date('2024-01-01T10:00:00Z').toISOString(),
          userId: 'user_001',
          sourceModule: 'tool',
          sourceAction: 'write_file',
          actionSummary: 'Write to file system',
          status: 'completed',
          payload: {},
          riskLevel: 'high',
          sensitivity: 'medium',
          correlationId,
        },
        {
          auditId: 'audit_002',
          auditType: 'connector_access',
          timestamp: new Date('2024-01-01T10:05:00Z').toISOString(),
          userId: 'user_001',
          sourceModule: 'connector',
          sourceAction: 'query_database',
          actionSummary: 'Query external database',
          status: 'completed',
          payload: {},
          riskLevel: 'medium',
          sensitivity: 'low',
          correlationId,
        },
      ];

      audits.forEach((audit) => auditStore.record(audit));

      const request: ReplayRequest = {
        rootType: 'workflow_run',
        rootId: workflowRunId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.blockedActions.length).toBeGreaterThanOrEqual(2);
      result.blockedActions.forEach((action) => {
        expect(action.eventId).toBeDefined();
        expect(action.eventType).toBeDefined();
        expect(action.action).toBeDefined();
        expect(action.reason).toBeDefined();
        expect(action.module).toBeDefined();
      });
    });
  });

  describe('Original trace refs preserved', () => {
    it('should preserve trace references from events', () => {
      const sessionId = 'session_trace_001';
      const correlationId = 'corr_trace_001';
      const traceId = 'trace_001';

      const event: EventRecord = {
        eventId: 'evt_trace',
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
        traceId,
        rootSpanId: 'span_root',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'completed',
      };

      traceStore.createTrace(traceContext);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.originalTraceRefs.length).toBeGreaterThan(0);
      expect(result.originalTraceRefs.some((ref) => ref.traceId === traceId)).toBe(true);
      expect(result.originalTraceRefs.some((ref) => ref.correlationId === correlationId)).toBe(true);
    });

    it('should preserve span references from timeline events', () => {
      const sessionId = 'session_span_001';
      const correlationId = 'corr_span_001';
      const traceId = 'trace_002';
      const spanId = 'span_001';

      const event: EventRecord = {
        eventId: 'evt_span',
        eventType: 'processing',
        sourceModule: 'kernel',
        sessionId,
        correlationId,
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const traceContext: TraceContext = {
        traceId,
        rootSpanId: 'span_root',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'completed',
      };

      traceStore.createTrace(traceContext);

      const span: RuntimeSpan = {
        spanId,
        traceId,
        parentSpanId: 'span_root',
        spanType: 'kernel_run',
        module: 'kernel',
        operation: 'process',
        status: 'completed',
        startTime: new Date().toISOString(),
      };

      traceStore.createSpan(span);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.originalTraceRefs.some((ref) => ref.spanId === spanId)).toBe(true);
    });

    it('should deduplicate trace references', () => {
      const sessionId = 'session_dedup_001';
      const correlationId = 'corr_dedup_001';

      // Create multiple events with same correlation ID
      const events: EventRecord[] = [
        {
          eventId: 'evt_001',
          eventType: 'start',
          sourceModule: 'gateway',
          sessionId,
          correlationId,
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
        {
          eventId: 'evt_002',
          eventType: 'processing',
          sourceModule: 'kernel',
          sessionId,
          correlationId,
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:01:00Z').toISOString(),
        },
        {
          eventId: 'evt_003',
          eventType: 'end',
          sourceModule: 'kernel',
          sessionId,
          correlationId,
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:02:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const traceContext: TraceContext = {
        traceId: 'trace_dedup',
        rootSpanId: 'span_root',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'completed',
      };

      traceStore.createTrace(traceContext);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      // Should have only one unique trace reference despite multiple events
      const traceRefsForCorrelation = result.originalTraceRefs.filter(
        (ref) => ref.correlationId === correlationId
      );
      expect(traceRefsForCorrelation.length).toBe(1);
    });
  });

  describe('Sensitive payload redaction in replay output', () => {
    it('should redact sensitive data by default', () => {
      const sessionId = 'session_redact_001';

      const event: EventRecord = {
        eventId: 'evt_sensitive',
        eventType: 'user_input',
        sourceModule: 'gateway',
        sessionId,
        payload: { password: 'secret123', apiKey: 'abc123', normal: 'data' },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
        includeSensitiveData: false,
      };

      const result = replayService.replay(request);

      const sensitiveEvent = result.timeline.events.find((e) => e.eventId === 'evt_sensitive');
      expect(sensitiveEvent).toBeDefined();
      const sourceData = sensitiveEvent?.sourceData as EventRecord | undefined;
      expect(sourceData?.payload).toBe('[REDACTED]');
    });

    it('should include sensitive data when explicitly requested', () => {
      const sessionId = 'session_noredact_001';

      const event: EventRecord = {
        eventId: 'evt_sensitive',
        eventType: 'user_input',
        sourceModule: 'gateway',
        sessionId,
        payload: { password: 'secret123', normal: 'data' },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
        includeSensitiveData: true,
      };

      const result = replayService.replay(request);

      const sensitiveEvent = result.timeline.events.find((e) => e.eventId === 'evt_sensitive');
      const sourceData = sensitiveEvent?.sourceData as EventRecord | undefined;
      expect(sourceData?.payload).not.toBe('[REDACTED]');
      const payload = sourceData?.payload as Record<string, unknown> | undefined;
      expect(payload?.password).toBe('secret123');
    });

    it('should redact sensitive fields in payload while preserving non-sensitive fields', () => {
      const sessionId = 'session_partial_001';

      const event: EventRecord = {
        eventId: 'evt_partial',
        eventType: 'api_call',
        sourceModule: 'connector',
        sessionId,
        payload: {
          endpoint: '/api/users',
          apiKey: 'super_secret_key',
          token: 'bearer_token_123',
          userId: 'user_123',
          data: { name: 'John' },
        },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
        includeSensitiveData: false,
      };

      const result = replayService.replay(request);

      const partialEvent = result.timeline.events.find((e) => e.eventId === 'evt_partial');
      const sourceData = partialEvent?.sourceData as EventRecord | undefined;
      const payload = sourceData?.payload as Record<string, unknown> | undefined;

      expect(payload?.apiKey).toBe('[REDACTED]');
      expect(payload?.token).toBe('[REDACTED]');
      expect(payload?.endpoint).toBe('/api/users');
      expect(payload?.userId).toBe('user_123');
    });

    it('should redact sensitive fields in state snapshot', () => {
      const backgroundRunId = 'bg_run_redact_001';
      const correlationId = 'corr_redact_001';

      const events: EventRecord[] = [
        {
          eventId: 'evt_bg_start',
          eventType: 'background_task_started',
          sourceModule: 'subagent',
          correlationId,
          relatedRefs: { backgroundRunId },
          payload: {
            taskType: 'sync',
            parameters: { apiKey: 'secret_key', databaseUrl: 'db://host', batchSize: 100 },
          },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const request: ReplayRequest = {
        rootType: 'background_run',
        rootId: backgroundRunId,
        replayMode: 'state_rebuild',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
        includeSensitiveData: false,
      };

      const result = replayService.replay(request);

      expect(result.stateSnapshot?.backgroundRun?.parameters.apiKey).toBe('[REDACTED]');
      expect(result.stateSnapshot?.backgroundRun?.parameters.databaseUrl).toBe('db://host');
      expect(result.stateSnapshot?.backgroundRun?.parameters.batchSize).toBe(100);
    });
  });

  describe('Replay service methods', () => {
    it('should expose buildTimelineOnly method', () => {
      const backgroundRunId = 'bg_run_method_001';
      const correlationId = 'corr_method_001';

      const event: EventRecord = {
        eventId: 'evt_method',
        eventType: 'background_task_started',
        sourceModule: 'subagent',
        correlationId,
        relatedRefs: { backgroundRunId },
        payload: {},
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      };

      eventStore.append(event);

      const timeline = replayService.buildTimelineOnly('background_run', backgroundRunId);

      expect(timeline.rootType).toBe('background_run');
      expect(timeline.rootId).toBe(backgroundRunId);
      expect(timeline.events.length).toBeGreaterThan(0);
    });

    it('should expose buildStateRebuild method', () => {
      const workflowRunId = 'wf_run_method_001';
      const correlationId = 'corr_method_002';

      const events: EventRecord[] = [
        {
          eventId: 'evt_wf_start',
          eventType: 'workflow_started',
          sourceModule: 'workflow',
          correlationId,
          relatedRefs: { workflowRunId },
          payload: {},
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
        },
      ];

      eventStore.append(events);

      const stateSnapshot = replayService.buildStateRebuild('workflow_run', workflowRunId);

      expect(stateSnapshot.workflowRun).toBeDefined();
      expect(stateSnapshot.timestamp).toBeDefined();
    });

    it('should expose checkSafety method', () => {
      const sessionId = 'session_safety_001';

      const audit: AuditRecord = {
        auditId: 'audit_safety',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write',
        actionSummary: 'External write',
        status: 'completed',
        payload: {},
        riskLevel: 'high',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const timeline = replayService.buildTimelineOnly('session', sessionId);
      const blockedActions = replayService.checkSafety(timeline, DEFAULT_SAFETY_POLICY);

      expect(blockedActions.length).toBeGreaterThan(0);
      expect(blockedActions[0]?.reason).toContain('blocked');
    });

    it('should expose preserveTraceRefs method', () => {
      const sessionId = 'session_refs_001';
      const correlationId = 'corr_refs_001';
      const traceId = 'trace_refs_001';

      const event: EventRecord = {
        eventId: 'evt_refs',
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

      // Create a trace with the correlationId so it can be found
      const traceContext: TraceContext = {
        traceId,
        rootSpanId: 'span_root_refs',
        correlationId,
        sessionId,
        startedAt: new Date().toISOString(),
        status: 'completed',
      };

      traceStore.createTrace(traceContext);

      const timeline = replayService.buildTimelineOnly('session', sessionId);
      const traceRefs = replayService.preserveTraceRefs(timeline);

      expect(traceRefs.length).toBeGreaterThan(0);
      expect(traceRefs.some((ref) => ref.correlationId === correlationId)).toBe(true);
      expect(traceRefs.some((ref) => ref.traceId === traceId)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle empty timeline gracefully', () => {
      const request: ReplayRequest = {
        rootType: 'session',
        rootId: 'nonexistent_session',
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('success');
      expect(result.timeline.events).toHaveLength(0);
      expect(result.blockedActions).toHaveLength(0);
    });

    it('should include warnings in result', () => {
      const sessionId = 'session_warn_001';

      const audit: AuditRecord = {
        auditId: 'audit_warn',
        auditType: 'external_write',
        timestamp: new Date().toISOString(),
        userId: 'user_001',
        sessionId,
        sourceModule: 'tool',
        sourceAction: 'write',
        actionSummary: 'External write',
        status: 'completed',
        payload: {},
        riskLevel: 'high',
        sensitivity: 'medium',
      };

      auditStore.record(audit);

      const request: ReplayRequest = {
        rootType: 'session',
        rootId: sessionId,
        replayMode: 'timeline_only',
        safetyPolicy: DEFAULT_SAFETY_POLICY,
      };

      const result = replayService.replay(request);

      expect(result.status).toBe('partial');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('blocked');
    });
  });
});
