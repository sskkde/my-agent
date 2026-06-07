import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { createPlanStore, type PlanStore } from '../../../src/storage/plan-store.js'
import { createPlannerRunStore, type PlannerRunStore } from '../../../src/storage/planner-run-store.js'
import type { PlanStep, PlanPatch } from '../../../src/storage/plan-store.js'
import { EXECUTION_PLAN_STATES, PLANNER_STATES } from '../../../src/shared/states.js'

describe('Plan Store + PlannerRun Store', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let planStore: PlanStore
  let plannerRunStore: PlannerRunStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()

    // Apply migrations for plan and planner run tables
    // These will be created by the migrations file
    const planMigrations = getPlanMigrations()
    migrations.apply(planMigrations)

    planStore = createPlanStore(connection)
    plannerRunStore = createPlannerRunStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('ExecutionPlan creation', () => {
    it('should create a new plan with PlanStep array', () => {
      const steps: PlanStep[] = [
        {
          stepId: 'step_001',
          description: 'Step 1: Initialize the task',
          status: 'pending',
          dependencies: [],
        },
        {
          stepId: 'step_002',
          description: 'Step 2: Process data',
          status: 'pending',
          dependencies: ['step_001'],
        },
      ]

      const plan = planStore.createPlan({
        planId: 'plan_001',
        userId: 'user_001',
        sessionId: 'sess_001',
        objective: 'Test objective',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps,
        constraints: ['constraint_1'],
        assumptions: ['assumption_1'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      expect(plan.planId).toBe('plan_001')
      expect(plan.userId).toBe('user_001')
      expect(plan.sessionId).toBe('sess_001')
      expect(plan.objective).toBe('Test objective')
      expect(plan.status).toBe(EXECUTION_PLAN_STATES.DRAFT)
      expect(plan.currentVersion).toBe(1)
      expect(plan.steps).toHaveLength(2)
      expect(plan.steps[0]?.stepId).toBe('step_001')
      expect(plan.steps[1]?.stepId).toBe('step_002')
      expect(plan.constraints).toEqual(['constraint_1'])
      expect(plan.assumptions).toEqual(['assumption_1'])
    })

    it('should retrieve a plan by ID', () => {
      const steps: PlanStep[] = [
        {
          stepId: 'step_001',
          description: 'Test step',
          status: 'pending',
        },
      ]

      planStore.createPlan({
        planId: 'plan_002',
        userId: 'user_002',
        objective: 'Another objective',
        status: EXECUTION_PLAN_STATES.APPROVED,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const retrieved = planStore.getPlan('plan_002')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.planId).toBe('plan_002')
      expect(retrieved?.userId).toBe('user_002')
      expect(retrieved?.objective).toBe('Another objective')
      expect(retrieved?.status).toBe(EXECUTION_PLAN_STATES.APPROVED)
      expect(retrieved?.steps).toHaveLength(1)
    })

    it('should return null for non-existent plan', () => {
      const result = planStore.getPlan('non_existent_plan')
      expect(result).toBeNull()
    })
  })

  describe('PlanStep status updates', () => {
    it('should update step status within a plan', () => {
      const steps: PlanStep[] = [
        {
          stepId: 'step_001',
          description: 'Step to update',
          status: 'pending',
        },
      ]

      planStore.createPlan({
        planId: 'plan_003',
        userId: 'user_001',
        objective: 'Test step updates',
        status: EXECUTION_PLAN_STATES.IN_EXECUTION,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Update step status
      planStore.updateStepStatus('plan_003', 'step_001', 'in_progress')

      const updated = planStore.getPlan('plan_003')
      expect(updated?.steps[0]?.status).toBe('in_progress')

      // Complete the step
      planStore.updateStepStatus('plan_003', 'step_001', 'completed')

      const completed = planStore.getPlan('plan_003')
      expect(completed?.steps[0]?.status).toBe('completed')
    })

    it('should throw error for non-existent step', () => {
      const steps: PlanStep[] = [
        {
          stepId: 'step_001',
          description: 'Step',
          status: 'pending',
        },
      ]

      planStore.createPlan({
        planId: 'plan_004',
        userId: 'user_001',
        objective: 'Test step error',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      expect(() => {
        planStore.updateStepStatus('plan_004', 'non_existent_step', 'in_progress')
      }).toThrow('Step not found')
    })
  })

  describe('PlanPatch versioning', () => {
    it('should apply patch and increment version atomically', () => {
      const steps: PlanStep[] = [
        {
          stepId: 'step_001',
          description: 'Original step',
          status: 'pending',
        },
      ]

      planStore.createPlan({
        planId: 'plan_005',
        userId: 'user_001',
        objective: 'Original objective',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const patch: PlanPatch = {
        planId: 'plan_005',
        fromVersion: 1,
        toVersion: 2,
        patch: JSON.stringify({
          objective: 'Updated objective',
          stepsAdded: [{ stepId: 'step_002', description: 'New step', status: 'pending' }],
        }),
        sourcePlannerRunId: 'pl_run_001',
        reason: 'User requested changes',
        createdAt: new Date().toISOString(),
      }

      const result = planStore.applyPatch(patch)

      expect(result.currentVersion).toBe(2)
      expect(result.objective).toBe('Updated objective')

      // Verify the patch was recorded
      const patches = planStore.getPatches('plan_005')
      expect(patches).toHaveLength(1)
      expect(patches[0]?.fromVersion).toBe(1)
      expect(patches[0]?.toVersion).toBe(2)
    })

    it('should reject patch with incorrect fromVersion', () => {
      const steps: PlanStep[] = []

      planStore.createPlan({
        planId: 'plan_006',
        userId: 'user_001',
        objective: 'Test objective',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const patch: PlanPatch = {
        planId: 'plan_006',
        fromVersion: 2, // Wrong version - should be 1
        toVersion: 3,
        patch: JSON.stringify({ objective: 'Changed' }),
        sourcePlannerRunId: 'pl_run_001',
        reason: 'Test',
        createdAt: new Date().toISOString(),
      }

      expect(() => {
        planStore.applyPatch(patch)
      }).toThrow('Version mismatch')
    })

    it('should maintain patch history', () => {
      const steps: PlanStep[] = []

      planStore.createPlan({
        planId: 'plan_007',
        userId: 'user_001',
        objective: 'V1',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Apply multiple patches
      for (let i = 1; i <= 3; i++) {
        planStore.applyPatch({
          planId: 'plan_007',
          fromVersion: i,
          toVersion: i + 1,
          patch: JSON.stringify({ version: i + 1 }),
          sourcePlannerRunId: `pl_run_00${i}`,
          reason: `Update ${i}`,
          createdAt: new Date().toISOString(),
        })
      }

      const patches = planStore.getPatches('plan_007')
      expect(patches).toHaveLength(3)
      expect(patches[0]?.fromVersion).toBe(1)
      expect(patches[0]?.toVersion).toBe(2)
      expect(patches[1]?.fromVersion).toBe(2)
      expect(patches[1]?.toVersion).toBe(3)
      expect(patches[2]?.fromVersion).toBe(3)
      expect(patches[2]?.toVersion).toBe(4)

      const plan = planStore.getPlan('plan_007')
      expect(plan?.currentVersion).toBe(4)
    })
  })

  describe('PlannerRun creation', () => {
    beforeEach(() => {
      planStore.createPlan({
        planId: 'plan_001',
        userId: 'user_001',
        objective: 'Reference plan',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })

    it('should create a new PlannerRun', () => {
      const run = plannerRunStore.create({
        plannerRunId: 'pl_run_001',
        planId: 'plan_001',
        userId: 'user_001',
        sessionId: 'sess_001',
        status: PLANNER_STATES.INITIALIZING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      expect(run.plannerRunId).toBe('pl_run_001')
      expect(run.planId).toBe('plan_001')
      expect(run.userId).toBe('user_001')
      expect(run.sessionId).toBe('sess_001')
      expect(run.status).toBe(PLANNER_STATES.INITIALIZING)
      expect(run.checkpoint).toBeNull()
    })

    it('should allow creating PlannerRun without sessionId', () => {
      const run = plannerRunStore.create({
        plannerRunId: 'pl_run_002',
        planId: 'plan_001',
        userId: 'user_001',
        status: PLANNER_STATES.PLANNING,
        checkpoint: { step: 'initializing' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      expect(run.plannerRunId).toBe('pl_run_002')
      expect(run.sessionId).toBeUndefined()
      expect(run.checkpoint).toEqual({ step: 'initializing' })
    })
  })

  describe('PlannerRun status updates', () => {
    beforeEach(() => {
      planStore.createPlan({
        planId: 'plan_001',
        userId: 'user_001',
        objective: 'Reference plan',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })

    it('should update PlannerRun status', () => {
      plannerRunStore.create({
        plannerRunId: 'pl_run_003',
        planId: 'plan_001',
        userId: 'user_001',
        status: PLANNER_STATES.INITIALIZING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.updateStatus('pl_run_003', PLANNER_STATES.PLANNING)

      const runs = plannerRunStore.findActive('user_001')
      const run = runs.find((r) => r.plannerRunId === 'pl_run_003')
      expect(run?.status).toBe(PLANNER_STATES.PLANNING)
    })

    it('should update checkpoint along with status', () => {
      plannerRunStore.create({
        plannerRunId: 'pl_run_004',
        planId: 'plan_001',
        userId: 'user_001',
        status: PLANNER_STATES.PLANNING,
        checkpoint: { step: 1 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.updateStatus('pl_run_004', PLANNER_STATES.WAITING_FOR_USER, {
        step: 2,
        waitingFor: 'user_input',
      })

      const runs = plannerRunStore.findActive('user_001')
      const run = runs.find((r) => r.plannerRunId === 'pl_run_004')
      expect(run?.status).toBe(PLANNER_STATES.WAITING_FOR_USER)
      expect(run?.checkpoint).toEqual({ step: 2, waitingFor: 'user_input' })
    })
  })

  describe('PlannerRun active lookup', () => {
    beforeEach(() => {
      planStore.createPlan({
        planId: 'plan_001',
        userId: 'user_001',
        objective: 'Reference plan 1',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      planStore.createPlan({
        planId: 'plan_002',
        userId: 'user_001',
        objective: 'Reference plan 2',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      planStore.createPlan({
        planId: 'plan_003',
        userId: 'user_001',
        objective: 'Reference plan 3',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })

    it('should find active runs by userId', () => {
      // Create multiple runs for the same user
      plannerRunStore.create({
        plannerRunId: 'pl_run_005',
        planId: 'plan_001',
        userId: 'user_001',
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.create({
        plannerRunId: 'pl_run_006',
        planId: 'plan_002',
        userId: 'user_001',
        status: PLANNER_STATES.REPLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Create a completed run (should not appear in active)
      plannerRunStore.create({
        plannerRunId: 'pl_run_007',
        planId: 'plan_003',
        userId: 'user_001',
        status: PLANNER_STATES.COMPLETED,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const activeRuns = plannerRunStore.findActive('user_001')

      expect(activeRuns).toHaveLength(2)
      expect(activeRuns.map((r) => r.plannerRunId)).toContain('pl_run_005')
      expect(activeRuns.map((r) => r.plannerRunId)).toContain('pl_run_006')
      expect(activeRuns.map((r) => r.plannerRunId)).not.toContain('pl_run_007')
    })

    it('should find active runs by userId and status filter', () => {
      plannerRunStore.create({
        plannerRunId: 'pl_run_008',
        planId: 'plan_001',
        userId: 'user_002',
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.create({
        plannerRunId: 'pl_run_009',
        planId: 'plan_002',
        userId: 'user_002',
        status: PLANNER_STATES.WAITING_FOR_USER,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const planningRuns = plannerRunStore.findActive('user_002', PLANNER_STATES.PLANNING)

      expect(planningRuns).toHaveLength(1)
      expect(planningRuns[0]?.plannerRunId).toBe('pl_run_008')
    })

    it('should find active runs by sessionId', () => {
      plannerRunStore.create({
        plannerRunId: 'pl_run_010',
        planId: 'plan_001',
        userId: 'user_003',
        sessionId: 'sess_001',
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.create({
        plannerRunId: 'pl_run_011',
        planId: 'plan_002',
        userId: 'user_003',
        sessionId: 'sess_002',
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const sessionRuns = plannerRunStore.findActiveBySession('sess_001')

      expect(sessionRuns).toHaveLength(1)
      expect(sessionRuns[0]?.plannerRunId).toBe('pl_run_010')
    })
  })

  describe('ObjectiveHash lookup', () => {
    it('should find plans by objective hash', () => {
      const objective = 'Test objective for hashing'
      // Simple hash function for testing
      const hashObjective = (obj: string) => {
        let hash = 0
        for (let i = 0; i < obj.length; i++) {
          const char = obj.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
        }
        return hash.toString(16)
      }
      const objectiveHash = hashObjective(objective)

      planStore.createPlan({
        planId: 'plan_hash_001',
        userId: 'user_001',
        objective,
        objectiveHash,
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const plans = planStore.findByObjectiveHash(objectiveHash)

      expect(plans).toHaveLength(1)
      expect(plans[0]?.planId).toBe('plan_hash_001')
      expect(plans[0]?.objective).toBe(objective)
    })

    it('should return multiple plans with same objective hash', () => {
      const objective = 'Shared objective'
      const hashObjective = (obj: string) => {
        let hash = 0
        for (let i = 0; i < obj.length; i++) {
          const char = obj.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
        }
        return hash.toString(16)
      }
      const objectiveHash = hashObjective(objective)

      planStore.createPlan({
        planId: 'plan_hash_002',
        userId: 'user_001',
        objective,
        objectiveHash,
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      planStore.createPlan({
        planId: 'plan_hash_003',
        userId: 'user_002',
        objective,
        objectiveHash,
        status: EXECUTION_PLAN_STATES.APPROVED,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const plans = planStore.findByObjectiveHash(objectiveHash)

      expect(plans).toHaveLength(2)
      expect(plans.map((p) => p.planId)).toContain('plan_hash_002')
      expect(plans.map((p) => p.planId)).toContain('plan_hash_003')
    })
  })

  describe('Integration: Plan + PlannerRun', () => {
    it('should track plannerRunIds on plan', () => {
      // Create a plan
      planStore.createPlan({
        planId: 'plan_int_001',
        userId: 'user_001',
        objective: 'Integrated test',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Create planner runs associated with the plan
      plannerRunStore.create({
        plannerRunId: 'pl_run_int_001',
        planId: 'plan_int_001',
        userId: 'user_001',
        status: PLANNER_STATES.COMPLETED,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      plannerRunStore.create({
        plannerRunId: 'pl_run_int_002',
        planId: 'plan_int_001',
        userId: 'user_001',
        status: PLANNER_STATES.PLANNING,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Get the plan and verify plannerRunIds
      const plan = planStore.getPlan('plan_int_001')
      expect(plan?.plannerRunIds).toContain('pl_run_int_001')
      expect(plan?.plannerRunIds).toContain('pl_run_int_002')
    })

    it('should update plan status when PlannerRun patches', () => {
      // Create a plan
      planStore.createPlan({
        planId: 'plan_int_002',
        userId: 'user_001',
        objective: 'Patch test',
        status: EXECUTION_PLAN_STATES.DRAFT,
        currentVersion: 1,
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Create a planner run
      plannerRunStore.create({
        plannerRunId: 'pl_run_int_003',
        planId: 'plan_int_002',
        userId: 'user_001',
        status: PLANNER_STATES.COMPLETED,
        checkpoint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Apply a patch from the planner run
      planStore.applyPatch({
        planId: 'plan_int_002',
        fromVersion: 1,
        toVersion: 2,
        patch: JSON.stringify({ status: EXECUTION_PLAN_STATES.APPROVED }),
        sourcePlannerRunId: 'pl_run_int_003',
        reason: 'Planner run completed successfully',
        createdAt: new Date().toISOString(),
      })

      const plan = planStore.getPlan('plan_int_002')
      expect(plan?.status).toBe(EXECUTION_PLAN_STATES.APPROVED)
      expect(plan?.currentVersion).toBe(2)
    })
  })
})

// Helper function to get plan migrations
function getPlanMigrations() {
  return [
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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
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
      `,
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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
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
      `,
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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
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
      `,
    },
  ]
}
