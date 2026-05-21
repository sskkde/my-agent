import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { createTimelineBuilder, type TimelineBuilder } from '../../observability/timeline.js';
import { createTraceStore } from '../../observability/trace-store.js';
import { createMetricStore } from '../../observability/metric-store.js';
import { createPrometheusExporter } from '../../observability/prometheus-exporter.js';
import { createAlertStore } from '../../storage/alert-store.js';
import { createAlertingEngine } from '../../observability/alerting.js';
import type { TraceStore } from '../../observability/types.js';
import type { AlertRule } from '../../storage/alert-store.js';
import {
  createReplayService,
  type ReplayService,
  type SafetyPolicy,
  type ReplayRequest,
} from '../../observability/replay.js';
import type { AuditStore } from '../../observability/audit-types.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

// ============================================================================
// Types
// ============================================================================

interface RunListEntry {
  id: string;
  type: 'planner_run' | 'workflow_run';
  status: string;
  createdAt: string;
  summary: string;
}

interface ConsoleView {
  runId: string;
  runType: 'planner_run' | 'workflow_run';
  timeline: {
    events: Array<{
      eventId: string;
      eventType: string;
      timestamp: string;
      description: string;
      status: string;
      module: string;
    }>;
    startTime: string;
    endTime?: string;
    durationMs?: number;
    status: string;
  };
  audit: {
    totalRecords: number;
    records: Array<{
      auditId: string;
      auditType: string;
      timestamp: string;
      actionSummary: string;
      status: string;
      riskLevel: string;
    }>;
  };
  status: {
    runStatus: string;
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;
  };
}

// ============================================================================
// Strict safety policy for replay preview (READ-ONLY, zero side effects)
// ============================================================================

const REPLAY_PREVIEW_SAFETY_POLICY: SafetyPolicy = {
  allowExternalWrites: false,
  allowToolExecution: false,
  allowConnectorAccess: false,
  maxReplayDepth: 1,
  requireApprovalForSideEffects: true,
  redactSensitivePayloads: true,
};

// ============================================================================
// Helpers
// ============================================================================

function buildTimelineServices(context: ApiContext): {
  timelineBuilder: TimelineBuilder;
  auditStore: AuditStore;
  traceStore: TraceStore;
  replayService: ReplayService;
} {
  const auditStore = context.auditRecorder.getStore();
  const traceStore = createTraceStore(context.connection);
  const timelineBuilder = createTimelineBuilder({
    eventStore: context.stores.eventStore,
    auditStore,
    traceStore,
    actionStore: context.stores.runtimeActionStore,
  });
  const replayService = createReplayService({
    timelineBuilder,
    eventStore: context.stores.eventStore,
    auditStore,
    traceStore,
  });

  return { timelineBuilder, auditStore, traceStore, replayService };
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerObservabilityRoutes(server: FastifyInstance, context: ApiContext): void {
  // --------------------------------------------------------------------------
  // GET /api/observability/runs
  // --------------------------------------------------------------------------
  server.get<{ Querystring: { status?: string } }>(
    '/api/v1/observability/runs',
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      const { status: statusFilter } = request.query;

      try {
        const plannerRows = context.connection.query<{
          id: string;
          type: string;
          status: string;
          created_at: string;
          plan_id: string;
        }>(
          statusFilter
            ? `SELECT planner_run_id as id, 'planner_run' as type, status, created_at, plan_id FROM planner_runs WHERE status = ?`
            : `SELECT planner_run_id as id, 'planner_run' as type, status, created_at, plan_id FROM planner_runs`,
          statusFilter ? [statusFilter] : undefined,
        );

        const workflowRows = context.connection.query<{
          id: string;
          type: string;
          status: string;
          created_at: string;
          workflow_id: string;
        }>(
          statusFilter
            ? `SELECT workflow_run_id as id, 'workflow_run' as type, status, created_at, workflow_id FROM workflow_runs WHERE status = ?`
            : `SELECT workflow_run_id as id, 'workflow_run' as type, status, created_at, workflow_id FROM workflow_runs`,
          statusFilter ? [statusFilter] : undefined,
        );

        const runs: RunListEntry[] = [
          ...plannerRows.map((r) => ({
            id: r.id,
            type: 'planner_run' as const,
            status: r.status,
            createdAt: r.created_at,
            summary: `Plan: ${r.plan_id}`,
          })),
          ...workflowRows.map((r) => ({
            id: r.id,
            type: 'workflow_run' as const,
            status: r.status,
            createdAt: r.created_at,
            summary: `Workflow: ${r.workflow_id}`,
          })),
        ];

        runs.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        return reply.code(200).send(success({ runs }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list runs';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/observability/runs/:runId/console
  // --------------------------------------------------------------------------
  server.get<{ Params: { runId: string } }>(
    '/api/v1/observability/runs/:runId/console',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      const { runId } = request.params;

      // Determine run type by checking both stores
      const plannerRun = context.stores.plannerRunStore.getById(runId);
      const workflowRun = context.stores.workflowRunStore.getWorkflowRunById(runId);

      if (!plannerRun && !workflowRun) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Run not found: ${runId}`, request.requestId));
      }

      const runType: 'planner_run' | 'workflow_run' = plannerRun ? 'planner_run' : 'workflow_run';
      const run = plannerRun ?? workflowRun!;

      try {
        const { timelineBuilder, auditStore } = buildTimelineServices(context);

        // Build timeline
        const timeline = timelineBuilder.buildTimeline(runType, runId);

        // Get audit records
        const auditRecords = auditStore.findByCorrelationId(runId);

        // Assemble console view
        const consoleView: ConsoleView = {
          runId,
          runType,
          timeline: {
            events: timeline.events.map((e) => ({
              eventId: e.eventId,
              eventType: e.eventType,
              timestamp: e.timestamp,
              description: e.description,
              status: e.status,
              module: e.module,
            })),
            startTime: timeline.startTime,
            endTime: timeline.endTime,
            durationMs: timeline.durationMs,
            status: timeline.status,
          },
          audit: {
            totalRecords: auditRecords.length,
            records: auditRecords.map((a) => ({
              auditId: a.auditId,
              auditType: a.auditType,
              timestamp: a.timestamp,
              actionSummary: a.actionSummary,
              status: a.status,
              riskLevel: a.riskLevel,
            })),
          },
          status: {
            runStatus: run.status,
            startedAt: 'startedAt' in (run as unknown as Record<string, unknown>) ? (run as unknown as Record<string, unknown>).startedAt as string | undefined : undefined,
            completedAt: 'completedAt' in (run as unknown as Record<string, unknown>) ? (run as unknown as Record<string, unknown>).completedAt as string | undefined : undefined,
            errorMessage: 'errorMessage' in (run as unknown as Record<string, unknown>) ? (run as unknown as Record<string, unknown>).errorMessage as string | undefined : undefined,
          },
        };

        return reply.code(200).send(success(consoleView, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to build console view';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/observability/runs/:runId/replay-preview
  // --------------------------------------------------------------------------
  server.get<{ Params: { runId: string } }>(
    '/api/v1/observability/runs/:runId/replay-preview',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      const { runId } = request.params;

      // Determine run type by checking both stores
      const plannerRun = context.stores.plannerRunStore.getById(runId);
      const workflowRun = context.stores.workflowRunStore.getWorkflowRunById(runId);

      if (!plannerRun && !workflowRun) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Run not found: ${runId}`, request.requestId));
      }

      const runType = plannerRun ? 'planner_run' : 'workflow_run';

      try {
        const { replayService } = buildTimelineServices(context);

        const replayRequest: ReplayRequest = {
          rootType: runType,
          rootId: runId,
          replayMode: 'timeline_only',
          safetyPolicy: REPLAY_PREVIEW_SAFETY_POLICY,
          includeSensitiveData: false,
        };

        const result = replayService.replay(replayRequest);

        return reply.code(200).send(success({
          runId,
          runType,
          status: result.status,
          timeline: {
            events: result.timeline.events.map((e) => ({
              eventId: e.eventId,
              eventType: e.eventType,
              timestamp: e.timestamp,
              description: e.description,
              status: e.status,
              module: e.module,
            })),
            startTime: result.timeline.startTime,
            endTime: result.timeline.endTime,
            durationMs: result.timeline.durationMs,
            rootStatus: result.timeline.status,
          },
          blockedActions: result.blockedActions,
          stateSnapshot: result.stateSnapshot ?? null,
          warnings: result.warnings,
        }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Replay preview failed';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/v1/metrics (Prometheus scraping endpoint - unauthenticated)
  // --------------------------------------------------------------------------
  server.get(
    '/api/v1/metrics',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const metricStore = createMetricStore(context.connection);
        const exporter = createPrometheusExporter({
          metricStore,
          config: {
            defaultLabels: {
              service_name: 'agent-platform',
              version: process.env.npm_package_version || '0.8.0-ga-candidate',
              instance: process.env.HOSTNAME || 'local-1',
            },
            metricPrefix: 'agent_platform_',
            includeTimestamp: false,
          },
        });

        const output = exporter.export();

        return reply
          .code(200)
          .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
          .send(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export metrics';
        return reply.code(500).send(message);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Alert Routes
  // --------------------------------------------------------------------------

  // GET /api/v1/alerts/rules
  server.get(
    '/api/v1/alerts/rules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      try {
        const alertStore = createAlertStore(context.connection);
        const rules = alertStore.listRules();
        return reply.code(200).send(success({ rules }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list alert rules';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // GET /api/v1/alerts/rules/:ruleId
  server.get<{ Params: { ruleId: string } }>(
    '/api/v1/alerts/rules/:ruleId',
    async (request: FastifyRequest<{ Params: { ruleId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      const { ruleId } = request.params;
      try {
        const alertStore = createAlertStore(context.connection);
        const rule = alertStore.getRule(ruleId);
        if (!rule) {
          return reply.code(404).send(envelopeError('NOT_FOUND', `Rule not found: ${ruleId}`, request.requestId));
        }
        return reply.code(200).send(success({ rule }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get alert rule';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // POST /api/v1/alerts/rules
  server.post<{ Body: Partial<AlertRule> }>(
    '/api/v1/alerts/rules',
    async (request: FastifyRequest<{ Body: Partial<AlertRule> }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.create)) {
        return reply;
      }
      try {
        const body = request.body;
        if (!body.id || !body.name || !body.metricName || !body.conditionType || body.threshold === undefined || !body.windowSeconds || !body.severity) {
          return reply.code(400).send(envelopeError('VALIDATION_ERROR', 'Missing required fields', request.requestId));
        }

        const rule: AlertRule = {
          id: body.id,
          name: body.name,
          description: body.description,
          metricName: body.metricName,
          metricModule: body.metricModule,
          conditionType: body.conditionType,
          operator: body.operator,
          threshold: body.threshold,
          windowSeconds: body.windowSeconds,
          severity: body.severity,
          webhookUrl: body.webhookUrl,
          labels: body.labels ?? {},
          enabled: body.enabled ?? true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const alertStore = createAlertStore(context.connection);
        alertStore.createRule(rule);

        return reply.code(201).send(success({ rule }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create alert rule';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // DELETE /api/v1/alerts/rules/:ruleId
  server.delete<{ Params: { ruleId: string } }>(
    '/api/v1/alerts/rules/:ruleId',
    async (request: FastifyRequest<{ Params: { ruleId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.delete)) {
        return reply;
      }
      const { ruleId } = request.params;
      try {
        const alertStore = createAlertStore(context.connection);
        const rule = alertStore.getRule(ruleId);
        if (!rule) {
          return reply.code(404).send(envelopeError('NOT_FOUND', `Rule not found: ${ruleId}`, request.requestId));
        }
        alertStore.deleteRule(ruleId);
        return reply.code(200).send(success({ deleted: true }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete alert rule';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // GET /api/v1/alerts/state
  server.get(
    '/api/v1/alerts/state',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply;
      }
      try {
        const alertStore = createAlertStore(context.connection);
        const states = alertStore.getAllStates();
        return reply.code(200).send(success({ states }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get alert states';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );

  // POST /api/v1/alerts/evaluate
  server.post(
    '/api/v1/alerts/evaluate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.execute)) {
        return reply;
      }
      try {
        const alertStore = createAlertStore(context.connection);
        const metricStore = createMetricStore(context.connection);
        const engine = createAlertingEngine({ alertStore, metricStore });
        const notifications = engine.evaluateAllRules();
        return reply.code(200).send(success({ notifications, count: notifications.length }, request.requestId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to evaluate alerts';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', message, request.requestId));
      }
    },
  );
}
