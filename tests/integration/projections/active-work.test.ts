import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createPlannerRunStore, type PlannerRunStore, type PlannerRunRecord } from '../../../src/storage/planner-run-store.js';
import { createApprovalStore, type ApprovalStore, type CreateApprovalRequest, APPROVAL_STATES } from '../../../src/storage/approval-store.js';
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js';
import type { PlannerState } from '../../../src/shared/states.js';
import {
  createActiveWorkProjectionBuilder,
  type ActiveWorkProjectionBuilder,
  type BuildProjectionOptions,
} from '../../../src/projections/active-work-projection.js';
import type {
  ProjectionSource,
  BackgroundRunSource,
  WorkflowRunSource,
} from '../../../src/projections/types.js';

describe('ActiveWorkProjection', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let plannerRunStore: PlannerRunStore;
  let approvalStore: ApprovalStore;
  let planStore: PlanStore;
  let eventStore: EventStore;
  let summaryStore: SummaryStore;
  let projectionBuilder: ActiveWorkProjectionBuilder;

  beforeEach(async () => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    // Apply required table migrations
    const tableMigrations = [
      {
        version: 1,
        name: 'create_planner_runs_table',
        up: `
          CREATE TABLE planner_runs (
            planner_run_id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT,
            status TEXT NOT NULL,
            checkpoint TEXT,
            background_run_id TEXT,
            workflow_run_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_planner_runs_user_status ON planner_runs(user_id, status);
          CREATE INDEX idx_planner_runs_session_status ON planner_runs(session_id, status);
        `,
        down: `
          DROP INDEX IF EXISTS idx_planner_runs_user_status;
          DROP INDEX IF EXISTS idx_planner_runs_session_status;
          DROP TABLE IF EXISTS planner_runs;
        `,
      },
      {
        version: 2,
        name: 'create_plans_table',
        up: `
          CREATE TABLE plans (
            plan_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            session_id TEXT,
            objective TEXT NOT NULL,
            objective_hash TEXT,
            status TEXT NOT NULL,
            current_version INTEGER DEFAULT 1,
            planner_run_ids TEXT,
            steps TEXT NOT NULL,
            constraints TEXT,
            assumptions TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_plans_user_id ON plans(user_id);
          CREATE INDEX idx_plans_session_id ON plans(session_id);
        `,
        down: `
          DROP INDEX IF EXISTS idx_plans_user_id;
          DROP INDEX IF EXISTS idx_plans_session_id;
          DROP TABLE IF EXISTS plans;
        `,
      },
      {
        version: 3,
        name: 'create_approval_requests_table',
        up: `
          CREATE TABLE approval_requests (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            risk_level TEXT,
            scope TEXT,
            action_type TEXT NOT NULL,
            resource TEXT,
            justification TEXT,
            requested_by TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            expires_at TEXT,
            responded_at TEXT,
            response_by TEXT,
            response_reason TEXT,
            idempotency_key TEXT UNIQUE,
            metadata TEXT,
            source_context TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_approval_user_status ON approval_requests(user_id, status);
          CREATE INDEX idx_approval_session_status ON approval_requests(session_id, status);
        `,
        down: `
          DROP INDEX IF EXISTS idx_approval_user_status;
          DROP INDEX IF EXISTS idx_approval_session_status;
          DROP TABLE IF EXISTS approval_requests;
        `,
      },
      {
        version: 4,
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
        `,
        down: `
          DROP INDEX IF EXISTS idx_events_session;
          DROP INDEX IF EXISTS idx_events_user;
          DROP INDEX IF EXISTS idx_events_correlation;
          DROP TABLE IF EXISTS events;
        `,
      },
      {
        version: 5,
        name: 'create_summaries_table',
        up: `
          CREATE TABLE summaries (
            summary_id TEXT PRIMARY KEY,
            summary_type TEXT NOT NULL,
            user_id TEXT NOT NULL,
            session_id TEXT,
            run_id TEXT,
            related_refs TEXT,
            source_refs TEXT NOT NULL,
            summary TEXT NOT NULL,
            structured_state TEXT,
            status TEXT NOT NULL,
            retrieval TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
          );
          CREATE INDEX idx_summaries_session_type ON summaries(session_id, summary_type);
          CREATE INDEX idx_summaries_user_type ON summaries(user_id, summary_type);
        `,
        down: `
          DROP INDEX IF EXISTS idx_summaries_session_type;
          DROP INDEX IF EXISTS idx_summaries_user_type;
          DROP TABLE IF EXISTS summaries;
        `,
      },
    ];

    migrations.apply(tableMigrations);

    // Initialize stores
    plannerRunStore = createPlannerRunStore(connection);
    approvalStore = createApprovalStore(connection);
    planStore = createPlanStore(connection);
    eventStore = createEventStore(connection);
    summaryStore = createSummaryStore(connection);

    // Create projection builder
    projectionBuilder = createActiveWorkProjectionBuilder({
      plannerRunStore,
      approvalStore,
      planStore,
      eventStore,
      summaryStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('buildProjection', () => {
    it('should include active planner runs in projection', async () => {
      const userId = 'user_test_active';
      const planId = `plan_${Date.now()}`;

      // Create a plan first
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create an active planner run
      const plannerRun: PlannerRunRecord = {
        plannerRunId: `run_${Date.now()}`,
        planId,
        userId,
        status: 'planning' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(plannerRun);

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activePlannerRuns).toHaveLength(1);
      expect(projection.activePlannerRuns[0].plannerRunId).toBe(plannerRun.plannerRunId);
      expect(projection.lastUpdated).toBeDefined();
    });

    it('should include pending approvals in projection', async () => {
      const userId = 'user_test_approval';

      // Create a pending approval request
      const approvalRequest: CreateApprovalRequest = {
        id: `appr_${Date.now()}`,
        userId,
        sessionId: 'sess_test',
        status: APPROVAL_STATES.PENDING,
        actionType: 'tool_execution',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      };
      approvalStore.create(approvalRequest);

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.pendingApprovals).toHaveLength(1);
      expect(projection.pendingApprovals[0].id).toBe(approvalRequest.id);
      expect(projection.pendingApprovals[0].status).toBe(APPROVAL_STATES.PENDING);
    });

    it('should exclude terminal runs by default', async () => {
      const userId = 'user_test_terminal';
      const planId = `plan_${Date.now()}`;

      // Create a plan first
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create a completed planner run
      const completedRun: PlannerRunRecord = {
        plannerRunId: `run_completed_${Date.now()}`,
        planId,
        userId,
        status: 'completed' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(completedRun);

      // Create a cancelled planner run
      const cancelledRun: PlannerRunRecord = {
        plannerRunId: `run_cancelled_${Date.now() + 1}`,
        planId,
        userId,
        status: 'cancelled' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(cancelledRun);

      // Create an active planner run
      const activeRun: PlannerRunRecord = {
        plannerRunId: `run_active_${Date.now() + 2}`,
        planId,
        userId,
        status: 'planning' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(activeRun);

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activePlannerRuns).toHaveLength(1);
      expect(projection.activePlannerRuns[0].plannerRunId).toBe(activeRun.plannerRunId);
    });

    it('should include terminal runs when explicitly requested', async () => {
      const userId = 'user_test_include_terminal';
      const planId = `plan_${Date.now()}`;

      // Create a plan first
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create a completed planner run
      const completedRun: PlannerRunRecord = {
        plannerRunId: `run_completed_${Date.now()}`,
        planId,
        userId,
        status: 'completed' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(completedRun);

      const options: BuildProjectionOptions = {
        includeTerminal: true,
      };

      const projection = await projectionBuilder.buildProjection(userId, options);

      expect(projection.activePlannerRuns).toHaveLength(1);
      expect(projection.activePlannerRuns[0].plannerRunId).toBe(completedRun.plannerRunId);
    });

    it('should aggregate data from multiple sources', async () => {
      const userId = 'user_test_aggregate';
      const planId = `plan_${Date.now()}`;

      // Create a plan
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create an active planner run
      const plannerRun: PlannerRunRecord = {
        plannerRunId: `run_${Date.now()}`,
        planId,
        userId,
        status: 'waiting_for_approval' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(plannerRun);

      // Create a pending approval request
      const approvalRequest: CreateApprovalRequest = {
        id: `appr_${Date.now()}`,
        userId,
        sessionId: 'sess_test',
        status: APPROVAL_STATES.PENDING,
        actionType: 'tool_execution',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      };
      approvalStore.create(approvalRequest);

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activePlannerRuns).toHaveLength(1);
      expect(projection.pendingApprovals).toHaveLength(1);
      expect(projection.activeBackgroundRuns).toHaveLength(0);
      expect(projection.activeWorkflowRuns).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('should return cached projection when fresh', async () => {
      const userId = 'user_test_cache';
      const planId = `plan_${Date.now()}`;

      // Create a plan and run
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const plannerRun: PlannerRunRecord = {
        plannerRunId: `run_${Date.now()}`,
        planId,
        userId,
        status: 'planning' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(plannerRun);

      // Build first projection (should cache)
      const projection1 = await projectionBuilder.buildProjection(userId);

      // Get cached projection
      const cached = projectionBuilder.getCachedProjection(userId);

      expect(cached).not.toBeNull();
      expect(cached?.projection.activePlannerRuns).toHaveLength(1);
      expect(cached?.timestamp).toBe(projection1.lastUpdated);
    });

    it('should return null for expired cache', async () => {
      const userId = 'user_test_cache_expired';

      // Create builder with short TTL
      const shortTtlBuilder = createActiveWorkProjectionBuilder({
        plannerRunStore,
        approvalStore,
        planStore,
        eventStore,
        summaryStore,
      }, {
        defaultTtlMs: 0, // Immediate expiration
      });

      const planId = `plan_${Date.now()}`;
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const plannerRun: PlannerRunRecord = {
        plannerRunId: `run_${Date.now()}`,
        planId,
        userId,
        status: 'planning' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(plannerRun);

      // Build projection
      await shortTtlBuilder.buildProjection(userId);

      // Wait a bit and try to get cache
      await new Promise(resolve => setTimeout(resolve, 10));

      const cached = shortTtlBuilder.getCachedProjection(userId);

      expect(cached).toBeNull();
    });

    it('should invalidate cache on demand', async () => {
      const userId = 'user_test_invalidate';
      const planId = `plan_${Date.now()}`;

      // Create a plan and run
      planStore.createPlan({
        planId,
        userId,
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const plannerRun: PlannerRunRecord = {
        plannerRunId: `run_${Date.now()}`,
        planId,
        userId,
        status: 'planning' as PlannerState,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      plannerRunStore.create(plannerRun);

      // Build and cache projection
      await projectionBuilder.buildProjection(userId);

      // Verify cache exists
      expect(projectionBuilder.getCachedProjection(userId)).not.toBeNull();

      // Invalidate cache
      projectionBuilder.invalidateCache(userId);

      // Verify cache is cleared
      expect(projectionBuilder.getCachedProjection(userId)).toBeNull();
    });
  });

  describe('projection sources', () => {
    it('should support custom projection sources', async () => {
      const userId = 'user_test_custom_source';

      // Create a custom source
      const customSource: ProjectionSource = {
        name: 'custom_test_source',
        getActiveWork: async (uid: string) => {
          if (uid === userId) {
            return {
              activeBackgroundRuns: [
                {
                  runId: 'custom_bg_run_1',
                  status: 'running',
                  startedAt: new Date().toISOString(),
                },
              ],
            };
          }
          return {};
        },
      };

      // Create builder with custom source
      const customBuilder = createActiveWorkProjectionBuilder({
        plannerRunStore,
        approvalStore,
        planStore,
        eventStore,
        summaryStore,
      });

      customBuilder.registerSource(customSource);

      const projection = await customBuilder.buildProjection(userId);

      expect(projection.activeBackgroundRuns).toHaveLength(1);
      expect(projection.activeBackgroundRuns[0].runId).toBe('custom_bg_run_1');
    });

    it('should have background run source stub interface', () => {
      // Verify the BackgroundRunSource interface exists and is usable
      const mockBackgroundSource: BackgroundRunSource = {
        name: 'background_run_source',
        getActiveWork: async () => ({
          activeBackgroundRuns: [],
        }),
      };

      expect(mockBackgroundSource.name).toBe('background_run_source');
      expect(typeof mockBackgroundSource.getActiveWork).toBe('function');
    });

    it('should have workflow run source stub interface', () => {
      // Verify the WorkflowRunSource interface exists and is usable
      const mockWorkflowSource: WorkflowRunSource = {
        name: 'workflow_run_source',
        getActiveWork: async () => ({
          activeWorkflowRuns: [],
        }),
      };

      expect(mockWorkflowSource.name).toBe('workflow_run_source');
      expect(typeof mockWorkflowSource.getActiveWork).toBe('function');
    });
  });

  describe('projection structure', () => {
    it('should have all required projection fields', async () => {
      const userId = 'user_test_structure';

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection).toHaveProperty('activePlannerRuns');
      expect(projection).toHaveProperty('pendingApprovals');
      expect(projection).toHaveProperty('activeBackgroundRuns');
      expect(projection).toHaveProperty('activeWorkflowRuns');
      expect(projection).toHaveProperty('lastUpdated');

      expect(Array.isArray(projection.activePlannerRuns)).toBe(true);
      expect(Array.isArray(projection.pendingApprovals)).toBe(true);
      expect(Array.isArray(projection.activeBackgroundRuns)).toBe(true);
      expect(Array.isArray(projection.activeWorkflowRuns)).toBe(true);
      expect(typeof projection.lastUpdated).toBe('string');
    });

    it('should return empty arrays when no active work exists', async () => {
      const userId = 'user_test_empty';

      const projection = await projectionBuilder.buildProjection(userId);

      expect(projection.activePlannerRuns).toHaveLength(0);
      expect(projection.pendingApprovals).toHaveLength(0);
      expect(projection.activeBackgroundRuns).toHaveLength(0);
      expect(projection.activeWorkflowRuns).toHaveLength(0);
    });
  });
});
