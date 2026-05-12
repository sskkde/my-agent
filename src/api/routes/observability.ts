import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { createTimelineBuilder, type TimelineBuilder } from '../../observability/timeline.js';
import { createTraceStore } from '../../observability/trace-store.js';
import type { TraceStore } from '../../observability/types.js';
import {
  createReplayService,
  type ReplayService,
  type SafetyPolicy,
  type ReplayRequest,
} from '../../observability/replay.js';
import type { AuditStore } from '../../observability/audit-types.js';

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
    '/api/observability/runs',
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
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
    '/api/observability/runs/:runId/console',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
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
    '/api/observability/runs/:runId/replay-preview',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
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
}
