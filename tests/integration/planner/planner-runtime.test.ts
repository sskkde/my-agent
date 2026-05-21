import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js';
import { createPlannerRunStore, type PlannerRunStore } from '../../../src/storage/planner-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { PLANNER_STATES, EXECUTION_PLAN_STATES, RUNTIME_ACTION_STATES } from '../../../src/shared/states.js';


import {
  createPlannerRuntime,
  type PlannerRuntime,
} from '../../../src/planner/planner-runtime.js';
import type {
  PlannerRunInput,
  PlannerResumeEvent,
  ActiveExecutionRef,
} from '../../../src/planner/types.js';

// Migrations for planner runtime tables
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

describe('Planner Runtime Integration', () => {
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

  describe('createPlannerRun', () => {
    it('should create a PlannerRun and ExecutionPlan from input', () => {
      const input: PlannerRunInput = {
        objective: 'Create a user onboarding workflow',
        userId: 'user_001',
        sessionId: 'sess_001',
        contextBundle: {
          requirements: ['user registration', 'email verification', 'profile setup'],
        },
      };

      const result = plannerRuntime.createPlannerRun(input);

      // Verify result structure
      expect(result.plannerRunId).toBeDefined();
      expect(result.planId).toBeDefined();
      expect(result.status).toBe(PLANNER_STATES.INITIALIZING);
      expect(result.actions).toBeInstanceOf(Array);
      expect(result.error).toBeUndefined();

      // Verify PlannerRun was created in store
      const plannerRun = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === result.plannerRunId);
      expect(plannerRun).toBeDefined();
      expect(plannerRun?.status).toBe(PLANNER_STATES.INITIALIZING);
      expect(plannerRun?.planId).toBe(result.planId);

      // Verify ExecutionPlan was created in store
      const plan = planStore.getPlan(result.planId);
      expect(plan).not.toBeNull();
      expect(plan?.objective).toBe(input.objective);
      expect(plan?.userId).toBe(input.userId);
      expect(plan?.status).toBe(EXECUTION_PLAN_STATES.DRAFT);
      expect(plan?.steps).toBeInstanceOf(Array);
    });

    it('should generate RuntimeAction for plan execution', () => {
      const input: PlannerRunInput = {
        objective: 'Analyze sales data',
        userId: 'user_002',
        sessionId: 'sess_002',
      };

      const result = plannerRuntime.createPlannerRun(input);

      // Verify RuntimeAction was emitted (not directly invoked)
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]?.targetRuntime).toBe('agent_kernel');
      expect(result.actions[0]?.targetAction).toBe('start_agent_run');
      expect(result.actions[0]?.payload.planId).toBe(result.planId);
      expect(result.actions[0]?.status).toBe(RUNTIME_ACTION_STATES.CREATED);
    });

    it('should persist checkpoint with initial state', () => {
      const input: PlannerRunInput = {
        objective: 'Generate monthly report',
        userId: 'user_003',
        contextBundle: { month: 'January' },
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRun = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === result.plannerRunId);

      expect(plannerRun?.checkpoint).toBeDefined();
      expect(plannerRun?.checkpoint).toMatchObject({
        step: 'initialization',
        objective: input.objective,
      });
    });
  });

  describe('State Machine Transitions', () => {
    it('should transition from initializing -> planning', () => {
      const input: PlannerRunInput = {
        objective: 'Test state transitions',
        userId: 'user_004',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      // Initial state
      let run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.INITIALIZING);

      // Transition to planning
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

      run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.PLANNING);
    });

    it('should transition from planning -> waiting_for_execution_result', () => {
      const input: PlannerRunInput = {
        objective: 'Test planning to waiting',
        userId: 'user_005',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT);

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT);
    });

    it('should transition from planning -> completed', () => {
      const input: PlannerRunInput = {
        objective: 'Test completion',
        userId: 'user_006',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.COMPLETED);

      const run = plannerRunStore.getById(plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.COMPLETED);
    });

    it('should transition from planning -> failed', () => {
      const input: PlannerRunInput = {
        objective: 'Test failure',
        userId: 'user_007',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.FAILED);

      const run = plannerRunStore.getById(plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.FAILED);
    });

    it('should throw error for invalid state transition', () => {
      const input: PlannerRunInput = {
        objective: 'Test invalid transition',
        userId: 'user_008',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      // Cannot go from initializing directly to completed
      expect(() => {
        plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.COMPLETED);
      }).toThrow('Invalid state transition');
    });

    it('should transition from waiting_for_approval -> replanning on rejection', () => {
      const input: PlannerRunInput = {
        objective: 'Test approval rejection',
        userId: 'user_009',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_APPROVAL);

      // Rejection should trigger replanning
      plannerRuntime.handleApprovalRejection(plannerRunId, 'User rejected the plan');

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.REPLANNING);
    });

    it('should transition from replanning -> planning', () => {
      const input: PlannerRunInput = {
        objective: 'Test replan to planning',
        userId: 'user_010',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.REPLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.PLANNING);
    });
  });

  describe('Approval Rejection and Replanning', () => {
    it('should trigger replanning when approval is rejected', () => {
      const input: PlannerRunInput = {
        objective: 'Build feature X',
        userId: 'user_011',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_APPROVAL);

      // User rejects
      plannerRuntime.handleApprovalRejection(plannerRunId, 'Too expensive');

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.REPLANNING);

      // A new action should be generated for replanning
      const actions = runtimeActionStore.query({ plannerRunId });
      const replanAction = actions.find(a => a.payload.action === 'replan');
      expect(replanAction).toBeDefined();
    });

    it('should create PlanPatch when replanning is triggered', () => {
      const input: PlannerRunInput = {
        objective: 'Update database schema',
        userId: 'user_012',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;
      const planId = result.planId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.REPLANNING);

      // Apply a patch during replanning
      plannerRuntime.applyPlanPatch(plannerRunId, {
        objective: 'Update database schema (revised)',
        steps: [{ stepId: '1', description: 'Backup first', status: 'pending' }],
      });

      const plan = planStore.getPlan(planId);
      expect(plan?.currentVersion).toBe(2);
      expect(plan?.objective).toBe('Update database schema (revised)');

      const patches = planStore.getPatches(planId);
      expect(patches).toHaveLength(1);
      expect(patches[0]?.sourcePlannerRunId).toBe(plannerRunId);
    });
  });

  describe('Cancellation', () => {
    it('should update activeExecutionRefs cancellation status on cancel', () => {
      const input: PlannerRunInput = {
        objective: 'Long running task',
        userId: 'user_013',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

      // Add some active execution refs
      plannerRuntime.addActiveExecutionRef(plannerRunId, {
        refId: 'bg_run_001',
        refType: 'background_run',
        status: 'running',
        cancellationRequested: false,
      });

      plannerRuntime.addActiveExecutionRef(plannerRunId, {
        refId: 'wf_run_001',
        refType: 'workflow_run',
        status: 'running',
        cancellationRequested: false,
      });

      // Cancel the planner run
      plannerRuntime.cancelPlannerRun(plannerRunId);

      const run = plannerRunStore.getById(plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.CANCELLED);

      // Verify active refs have cancellation requested
      const checkpoint = run?.checkpoint as { activeExecutionRefs?: ActiveExecutionRef[] };
      expect(checkpoint?.activeExecutionRefs).toBeDefined();
      expect(checkpoint?.activeExecutionRefs).toHaveLength(2);
      expect(checkpoint?.activeExecutionRefs?.[0]?.cancellationRequested).toBe(true);
      expect(checkpoint?.activeExecutionRefs?.[1]?.cancellationRequested).toBe(true);
    });

    it('should emit cancellation RuntimeAction for active refs', () => {
      const input: PlannerRunInput = {
        objective: 'Task with child runs',
        userId: 'user_014',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

      // Add active refs
      plannerRuntime.addActiveExecutionRef(plannerRunId, {
        refId: 'bg_run_002',
        refType: 'background_run',
        status: 'running',
        cancellationRequested: false,
      });

      // Cancel
      plannerRuntime.cancelPlannerRun(plannerRunId);

      // Verify cancellation action was emitted
      const allActions = runtimeActionStore.query({ plannerRunId });
      const cancelAction = allActions.find(
        a => a.payload.action === 'cancel' && a.payload.targetRefId === 'bg_run_002'
      );
      expect(cancelAction).toBeDefined();
    });
  });

  describe('RuntimeAction Emission', () => {
    it('should emit RuntimeAction rather than directly invoking', () => {
      const input: PlannerRunInput = {
        objective: 'Test action emission',
        userId: 'user_015',
      };

      const result = plannerRuntime.createPlannerRun(input);
      // Action should be stored, not executed
      expect(result.actions).toHaveLength(1);
      const action = result.actions[0];
      expect(action?.actionId).toBeDefined();

      // Verify action is persisted in store
      const storedAction = runtimeActionStore.findById(action!.actionId);
      expect(storedAction).not.toBeNull();
      expect(storedAction?.status).toBe(RUNTIME_ACTION_STATES.CREATED);
    });

    it('should emit multiple actions during plan execution', () => {
      const input: PlannerRunInput = {
        objective: 'Multi-step plan',
        userId: 'user_016',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      // Emit additional actions
      plannerRuntime.emitRuntimeAction(plannerRunId, {
        targetRuntime: 'tool_executor',
        targetAction: 'execute_tool',
        payload: { tool: 'read_file', params: { path: '/tmp/test.txt' } },
      });

      plannerRuntime.emitRuntimeAction(plannerRunId, {
        targetRuntime: 'background_runner',
        targetAction: 'launch_subagent',
        payload: { agentType: 'analyzer' },
      });

      // Query all actions for this planner run
      const actions = runtimeActionStore.query({ plannerRunId });
      expect(actions.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Checkpoint Persistence', () => {
    it('should persist checkpoint on state transition', () => {
      const input: PlannerRunInput = {
        objective: 'Checkpoint test',
        userId: 'user_017',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING, {
        planningStep: 'analyzing_requirements',
        iterations: 1,
      });

      let run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.checkpoint).toMatchObject({
        planningStep: 'analyzing_requirements',
        iterations: 1,
      });

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT, {
        planningStep: 'awaiting_results',
        pendingActions: ['act_001'],
      });

      run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.checkpoint).toMatchObject({
        planningStep: 'awaiting_results',
        pendingActions: ['act_001'],
      });
    });

    it('should support checkpoint recovery data', () => {
      const input: PlannerRunInput = {
        objective: 'Recovery test',
        userId: 'user_018',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.saveCheckpoint(plannerRunId, {
        stateVersion: 3,
        lastSuccessfulStep: 'step_002',
        contextSnapshot: { messages: [], variables: {} },
        recoveryPoint: 'after_validation',
      });

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.checkpoint).toMatchObject({
        stateVersion: 3,
        lastSuccessfulStep: 'step_002',
        recoveryPoint: 'after_validation',
      });
    });
  });

  describe('resumePlannerRun', () => {
    it('should resume from waiting_for_user state', () => {
      const input: PlannerRunInput = {
        objective: 'User interaction test',
        userId: 'user_019',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_USER);

      const resumeEvent: PlannerResumeEvent = {
        eventType: 'user_response',
        payload: { response: 'Continue with option A' },
      };

      const resumeResult = plannerRuntime.resumePlannerRun(plannerRunId, resumeEvent);

      expect(resumeResult.status).toBe(PLANNER_STATES.PLANNING);

      const run = plannerRunStore.findActive(input.userId)
        .find(r => r.plannerRunId === plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.PLANNING);
    });

    it('should resume from waiting_for_execution_result with result', () => {
      const input: PlannerRunInput = {
        objective: 'Execution result test',
        userId: 'user_020',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT);

      const resumeEvent: PlannerResumeEvent = {
        eventType: 'execution_complete',
        payload: { success: true, output: 'Task done' },
      };

      const resumeResult = plannerRuntime.resumePlannerRun(plannerRunId, resumeEvent);

      expect(resumeResult.status).not.toBe(PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT);
    });
  });

  describe('archivePlannerRun', () => {
    it('should archive completed planner run', () => {
      const input: PlannerRunInput = {
        objective: 'Archive test',
        userId: 'user_021',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.COMPLETED);

      plannerRuntime.archivePlannerRun(plannerRunId);

      const run = plannerRunStore.getById(plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.ARCHIVED);
    });

    it('should archive failed planner run', () => {
      const input: PlannerRunInput = {
        objective: 'Archive failed test',
        userId: 'user_022',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.FAILED);

      plannerRuntime.archivePlannerRun(plannerRunId);

      const run = plannerRunStore.getById(plannerRunId);
      expect(run?.status).toBe(PLANNER_STATES.ARCHIVED);
    });

    it('should not archive active runs', () => {
      const input: PlannerRunInput = {
        objective: 'Cannot archive active',
        userId: 'user_023',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      expect(() => {
        plannerRuntime.archivePlannerRun(plannerRunId);
      }).toThrow('Cannot archive run in state');
    });
  });

  describe('PlannerStatePatch emission', () => {
    it('should emit state patches during transitions', () => {
      const input: PlannerRunInput = {
        objective: 'State patch test',
        userId: 'user_024',
      };

      const result = plannerRuntime.createPlannerRun(input);
      const plannerRunId = result.plannerRunId;

      // Transition should emit patch
      plannerRuntime.transitionState(plannerRunId, PLANNER_STATES.PLANNING);

      // Check for state patch event
      const events = eventStore.query({
        eventType: 'planner_state_patch',
        plannerRunId,
      });

      expect(events.length).toBeGreaterThan(0);
      const patchEvent = events.find(e => e.eventType === 'planner_state_patch');
      expect(patchEvent?.payload.patchType).toBe('state_transition');
    });
  });
});
