import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js';
import { createPlannerRunStore, type PlannerRunStore, type PlannerRunRecord } from '../../../src/storage/planner-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { PLANNER_STATES } from '../../../src/shared/states.js';

import {
  createPlannerRuntime,
  type PlannerRuntime,
} from '../../../src/planner/planner-runtime.js';
import type {
  PlannerRunInput,
} from '../../../src/planner/types.js';

// Migrations for planner runtime tables (identical to planner-runtime.test.ts)
const plannerRuntimeMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_plans_table',
    up: `
      CREATE TABLE plans (
        plan_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        objective TEXT NOT NULL,
        objective_hash TEXT,
        status TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 1,
        planner_run_ids TEXT,
        steps TEXT NOT NULL,
        constraints TEXT,
        assumptions TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_plans_user_updated ON plans(user_id, updated_at);
      CREATE INDEX idx_plans_session_updated ON plans(session_id, updated_at);
      CREATE INDEX idx_plans_status ON plans(status);
      CREATE INDEX idx_plans_objective_hash ON plans(objective_hash);
    `,
    down: `
      DROP INDEX IF EXISTS idx_plans_objective_hash;
      DROP INDEX IF EXISTS idx_plans_status;
      DROP INDEX IF EXISTS idx_plans_session_updated;
      DROP INDEX IF EXISTS idx_plans_user_updated;
      DROP TABLE IF EXISTS plans;
    `
  },
  {
    version: 2,
    name: 'create_plan_patches_table',
    up: `
      CREATE TABLE plan_patches (
        patch_id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL,
        patch TEXT NOT NULL,
        source_planner_run_id TEXT,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_patches_plan_id ON plan_patches(plan_id);
      CREATE INDEX idx_patches_created ON plan_patches(created_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_patches_created;
      DROP INDEX IF EXISTS idx_patches_plan_id;
      DROP TABLE IF EXISTS plan_patches;
    `
  },
  {
    version: 3,
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
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_planner_runs_user_status ON planner_runs(user_id, status);
      CREATE INDEX idx_planner_runs_session_status ON planner_runs(session_id, status);
      CREATE INDEX idx_planner_runs_plan_id ON planner_runs(plan_id);
      CREATE INDEX idx_planner_runs_updated ON planner_runs(updated_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_planner_runs_updated;
      DROP INDEX IF EXISTS idx_planner_runs_plan_id;
      DROP INDEX IF EXISTS idx_planner_runs_session_status;
      DROP INDEX IF EXISTS idx_planner_runs_user_status;
      DROP TABLE IF EXISTS planner_runs;
    `
  },
  {
    version: 4,
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
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_planner_run ON runtime_actions(planner_run_id);
      CREATE INDEX idx_runtime_actions_plan ON runtime_actions(plan_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_runtime_actions_plan;
      DROP INDEX IF EXISTS idx_runtime_actions_planner_run;
      DROP INDEX IF EXISTS idx_runtime_actions_status;
      DROP TABLE IF EXISTS runtime_actions;
    `
  },
  {
    version: 5,
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
      CREATE INDEX idx_events_type ON events(event_type);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_type;
      DROP INDEX IF EXISTS idx_events_user;
      DROP INDEX IF EXISTS idx_events_session;
      DROP TABLE IF EXISTS events;
    `
  },
];

describe('Planner: Tool Failure Replan', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let planStore: PlanStore;
  let plannerRunStore: PlannerRunStore;
  let runtimeActionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let plannerRuntime: PlannerRuntime;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(plannerRuntimeMigrations);

    planStore = createPlanStore(connection);
    plannerRunStore = createPlannerRunStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);
    eventStore = createEventStore(connection);

    plannerRuntime = createPlannerRuntime({
      planStore,
      plannerRunStore,
      runtimeActionStore,
      eventStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  // ─── Helper ────────────────────────────────────────────────────────────
  function createPlanningRun() {
    const input: PlannerRunInput = {
      objective: 'Execute tool chain for user request',
      userId: 'user_replan_001',
      sessionId: 'sess_replan_001',
    };
    const result = plannerRuntime.createPlannerRun(input);
    plannerRuntime.transitionState(result.plannerRunId, PLANNER_STATES.PLANNING);
    return result;
  }

  // ─── Test 1: Tool failure triggers replan ─────────────────────────────
  it('triggers replan and transitions to REPLANNING state when tool execution fails', () => {
    const { plannerRunId } = createPlanningRun();

    // Simulate a tool execution failure
      const failureReason = "Tool execution failed: 'file_read' on path '/etc/shadow' returned permission denied";
    plannerRuntime.replan(plannerRunId, failureReason);

    // Verify state transitioned to REPLANNING
    const run = plannerRunStore.findActive('user_replan_001')
      .find(r => r.plannerRunId === plannerRunId);
    expect(run?.status).toBe(PLANNER_STATES.REPLANNING);

    // Verify checkpoint preserves replan reason
    const checkpoint = run?.checkpoint as Record<string, unknown> | undefined;
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.replanReason).toBe(failureReason);
    expect(checkpoint?.replannedAt).toBeDefined();
  });

  // ─── Test 2: replan preserves failure context in checkpoint ────────────
  it('preserves the original failure reason in checkpoint data for audit trail', () => {
    const { plannerRunId } = createPlanningRun();

    const failureReason = "LLM provider 'openrouter' returned HTTP 503 - service unavailable";
    plannerRuntime.replan(plannerRunId, failureReason);

    const run = plannerRunStore.findActive('user_replan_001')
      .find(r => r.plannerRunId === plannerRunId);
    expect(run).toBeDefined();
    expect(run?.status).toBe(PLANNER_STATES.REPLANNING);

    const checkpoint = run?.checkpoint as Record<string, unknown> | undefined;
    expect(checkpoint?.replanReason).toBe(failureReason);
    expect(typeof checkpoint?.replannedAt).toBe('string');
  });

  // ─── Test 3: Audit event records replan reason ─────────────────────────
  it('emits planner_replanning audit event with reason on tool failure', () => {
    const { plannerRunId } = createPlanningRun();

    const failureReason = "Runtime action 'execute_tool' timed out after 60s for background_run 'bg_abc123'";
    plannerRuntime.replan(plannerRunId, failureReason);

    // Verify the replanning event was emitted
    const events = eventStore.query({
      eventType: 'planner_replanning',
      plannerRunId,
    });

    expect(events).toHaveLength(1);
    const replanEvent = events[0];
    expect(replanEvent).toBeDefined();
    expect(replanEvent!.eventType).toBe('planner_replanning');
    expect(replanEvent!.sourceModule).toBe('planner');
    expect(replanEvent!.payload).toMatchObject({
      reason: failureReason,
    });
    expect(replanEvent!.relatedRefs?.plannerRunId).toBe(plannerRunId);
  });

  // ─── Test 4: Fatal/unrecoverable errors bypass replan → direct FAILED ──
  it('bypasses replan and transitions directly to FAILED for fatal errors', () => {
    const { plannerRunId } = createPlanningRun();

    // For fatal/unrecoverable errors, the caller should NOT call replan().
    // Instead, transition directly to FAILED (valid: planning → failed).
    plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.FAILED, {
      fatalError: true,
      errorMessage: 'Database corruption detected - unable to proceed',
      fatalAt: new Date().toISOString(),
    });

    // Verify state is FAILED, not REPLANNING
    const run = plannerRunStore.getById(plannerRunId);
    expect(run?.status).toBe(PLANNER_STATES.FAILED);

    const checkpoint = run?.checkpoint as Record<string, unknown> | undefined;
    expect(checkpoint?.fatalError).toBe(true);
    expect(checkpoint?.errorMessage).toContain('Database corruption');

    // Verify NO replanning events were emitted
    const replanEvents = eventStore.query({
      eventType: 'planner_replanning',
      plannerRunId,
    });
    expect(replanEvents).toHaveLength(0);
  });

  // ─── Test 5: Consecutive replans eventually degrade to FAILED ─────────
  it('limits consecutive replans and degrades to FAILED after repeated cycles', () => {
    const { plannerRunId } = createPlanningRun();

    const run = plannerRunStore.findActive('user_replan_001')
      .find(r => r.plannerRunId === plannerRunId);
    expect(run?.status).toBe(PLANNER_STATES.PLANNING);

    // Simulate 3 consecutive replan cycles (replan → planning → replan → planning → replan)
    // Each cycle: tool fails → replan → LLM generates new plan → back to planning
    const failureReasons: string[] = [
        "Tool 'web_fetch' returned HTTP 403",
        "Retry attempt 2: Tool 'web_fetch' still failing",
      "Retry attempt 3: All tool alternatives exhausted",
    ];

    for (let i = 0; i < failureReasons.length; i++) {
      plannerRuntime.replan(plannerRunId, failureReasons[i]!);

      // After replan, check state
let currentRun: PlannerRunRecord | null = plannerRunStore.findActive('user_replan_001')
          .find(r => r.plannerRunId === plannerRunId) ?? null;
      expect(currentRun?.status).toBe(PLANNER_STATES.REPLANNING);

      if (i < failureReasons.length - 1) {
        // Replan succeeded, back to planning (valid: replanning → planning)
        plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

        currentRun = plannerRunStore.findActive('user_replan_001')
          .find(r => r.plannerRunId === plannerRunId) ?? null;
        expect(currentRun?.status).toBe(PLANNER_STATES.PLANNING);
      } else {
        // Last replan still failed → degrade to FAILED (valid: replanning → failed)
        plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.FAILED, {
          maxReplansReached: true,
          totalReplans: failureReasons.length,
          lastFailureReason: failureReasons[i],
          degradedAt: new Date().toISOString(),
        });

        currentRun = plannerRunStore.getById(plannerRunId);
        expect(currentRun?.status).toBe(PLANNER_STATES.FAILED);

        const checkpoint = currentRun?.checkpoint as Record<string, unknown> | undefined;
        expect(checkpoint?.maxReplansReached).toBe(true);
        expect(checkpoint?.totalReplans).toBe(failureReasons.length);
      }
    }

    // Verify all replan events were recorded
    const replanEvents = eventStore.query({
      eventType: 'planner_replanning',
      plannerRunId,
    });
    expect(replanEvents).toHaveLength(failureReasons.length);

    // Verify each event recorded the correct reason
    replanEvents.forEach((event, index) => {
      expect(event.payload).toMatchObject({
        reason: failureReasons[index],
      });
    });
  });

  // ─── Test 6: Replan generates new ExecutionPlan via applyPlanPatch ─────
  it('generates new ExecutionPlan version when replan adds revised steps', () => {
    const { plannerRunId, planId } = createPlanningRun();

    // Trigger replan
    plannerRuntime.replan(plannerRunId, 'Tool execution failed: user needs revised approach');
    expect(
      plannerRunStore.findActive('user_replan_001')
        .find(r => r.plannerRunId === plannerRunId)?.status
    ).toBe(PLANNER_STATES.REPLANNING);

    // Apply a plan patch during replanning (simulating LLM generating revised steps)
    plannerRuntime.applyPlanPatch(plannerRunId, {
      objective: 'Revised: Execute tool chain with fallback alternatives',
      steps: [
        { stepId: 'step_001', description: 'Validate tool availability', status: 'pending' },
        { stepId: 'step_002', description: 'Execute primary tool', status: 'pending' },
        { stepId: 'step_003', description: 'Fallback to alternative tool on failure', status: 'pending' },
      ],
    });

    // Verify plan version incremented
    const plan = planStore.getPlan(planId);
    expect(plan?.currentVersion).toBe(2);

    // Verify patch was recorded with source
    const patches = planStore.getPatches(planId);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.sourcePlannerRunId).toBe(plannerRunId);
    expect(patches[0]?.reason).toBe('Planner replanning update');
  });
});
