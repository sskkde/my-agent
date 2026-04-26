import type { ConnectionManager } from './connection.js';
import type { ExecutionPlanState } from '../shared/states.js';

export interface PlanStep {
  stepId: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies?: string[];
}

export interface ExecutionPlanRecord {
  planId: string;
  userId: string;
  sessionId?: string;
  objective: string;
  objectiveHash?: string;
  status: ExecutionPlanState;
  currentVersion: number;
  plannerRunIds?: string[];
  steps: PlanStep[];
  constraints?: string[];
  assumptions?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanPatch {
  planId: string;
  fromVersion: number;
  toVersion: number;
  patch: string;
  sourcePlannerRunId?: string;
  reason?: string;
  createdAt: string;
}

export interface PlanStore {
  createPlan(plan: ExecutionPlanRecord): ExecutionPlanRecord;
  getPlan(planId: string): ExecutionPlanRecord | null;
  applyPatch(patch: PlanPatch): ExecutionPlanRecord;
  getPatches(planId: string): PlanPatch[];
  findByObjectiveHash(objectiveHash: string): ExecutionPlanRecord[];
  updateStepStatus(planId: string, stepId: string, status: PlanStep['status']): void;
}

class PlanStoreImpl implements PlanStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createPlan(plan: ExecutionPlanRecord): ExecutionPlanRecord {
    const sql = `
      INSERT INTO plans (
        plan_id, user_id, session_id, objective, objective_hash,
        status, current_version, planner_run_ids, steps,
        constraints, assumptions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.connection.exec(sql, [
      plan.planId,
      plan.userId,
      plan.sessionId ?? null,
      plan.objective,
      plan.objectiveHash ?? null,
      plan.status,
      plan.currentVersion,
      plan.plannerRunIds ? JSON.stringify(plan.plannerRunIds) : null,
      JSON.stringify(plan.steps),
      plan.constraints ? JSON.stringify(plan.constraints) : null,
      plan.assumptions ? JSON.stringify(plan.assumptions) : null,
      plan.createdAt,
      plan.updatedAt
    ]);

    return plan;
  }

  getPlan(planId: string): ExecutionPlanRecord | null {
    const sql = `SELECT * FROM plans WHERE plan_id = ?`;
    const rows = this.connection.query<{
      plan_id: string;
      user_id: string;
      session_id: string | null;
      objective: string;
      objective_hash: string | null;
      status: string;
      current_version: number;
      planner_run_ids: string | null;
      steps: string;
      constraints: string | null;
      assumptions: string | null;
      created_at: string;
      updated_at: string;
    }>(sql, [planId]);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return this.rowToPlan(row);
  }

  applyPatch(patch: PlanPatch): ExecutionPlanRecord {
    const tx = this.connection.transaction(() => {
      const currentPlan = this.getPlan(patch.planId);
      if (!currentPlan) {
        throw new Error(`Plan not found: ${patch.planId}`);
      }

      if (currentPlan.currentVersion !== patch.fromVersion) {
        throw new Error(
          `Version mismatch: expected ${patch.fromVersion}, got ${currentPlan.currentVersion}`
        );
      }

      const patchData = JSON.parse(patch.patch) as Partial<ExecutionPlanRecord>;

      const newVersion = patch.toVersion;
      const newStatus = patchData.status ?? currentPlan.status;
      const newObjective = patchData.objective ?? currentPlan.objective;
      const newSteps = patchData.steps ?? currentPlan.steps;
      const newConstraints = patchData.constraints ?? currentPlan.constraints;
      const newAssumptions = patchData.assumptions ?? currentPlan.assumptions;
      const updatedAt = new Date().toISOString();

      const updateSql = `
        UPDATE plans SET
          current_version = ?,
          status = ?,
          objective = ?,
          steps = ?,
          constraints = ?,
          assumptions = ?,
          updated_at = ?
        WHERE plan_id = ?
      `;

      this.connection.exec(updateSql, [
        newVersion,
        newStatus,
        newObjective,
        JSON.stringify(newSteps),
        newConstraints ? JSON.stringify(newConstraints) : null,
        newAssumptions ? JSON.stringify(newAssumptions) : null,
        updatedAt,
        patch.planId
      ]);

      const patchSql = `
        INSERT INTO plan_patches (
          plan_id, from_version, to_version, patch,
          source_planner_run_id, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.connection.exec(patchSql, [
        patch.planId,
        patch.fromVersion,
        patch.toVersion,
        patch.patch,
        patch.sourcePlannerRunId ?? null,
        patch.reason ?? null,
        patch.createdAt
      ]);

      return this.getPlan(patch.planId)!;
    });

    return tx();
  }

  getPatches(planId: string): PlanPatch[] {
    const sql = `
      SELECT * FROM plan_patches
      WHERE plan_id = ?
      ORDER BY from_version ASC
    `;

    const rows = this.connection.query<{
      patch_id: number;
      plan_id: string;
      from_version: number;
      to_version: number;
      patch: string;
      source_planner_run_id: string | null;
      reason: string | null;
      created_at: string;
    }>(sql, [planId]);

    return rows.map(row => ({
      planId: row.plan_id,
      fromVersion: row.from_version,
      toVersion: row.to_version,
      patch: row.patch,
      sourcePlannerRunId: row.source_planner_run_id ?? undefined,
      reason: row.reason ?? undefined,
      createdAt: row.created_at
    }));
  }

  findByObjectiveHash(objectiveHash: string): ExecutionPlanRecord[] {
    const sql = `SELECT * FROM plans WHERE objective_hash = ? ORDER BY updated_at DESC`;

    const rows = this.connection.query<{
      plan_id: string;
      user_id: string;
      session_id: string | null;
      objective: string;
      objective_hash: string | null;
      status: string;
      current_version: number;
      planner_run_ids: string | null;
      steps: string;
      constraints: string | null;
      assumptions: string | null;
      created_at: string;
      updated_at: string;
    }>(sql, [objectiveHash]);

    return rows.map(row => this.rowToPlan(row));
  }

  updateStepStatus(planId: string, stepId: string, status: PlanStep['status']): void {
    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const stepIndex = plan.steps.findIndex(s => s.stepId === stepId);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepId}`);
    }

    plan.steps[stepIndex]!.status = status;

    const sql = `
      UPDATE plans SET steps = ?, updated_at = ? WHERE plan_id = ?
    `;

    this.connection.exec(sql, [
      JSON.stringify(plan.steps),
      new Date().toISOString(),
      planId
    ]);
  }

  private rowToPlan(row: {
    plan_id: string;
    user_id: string;
    session_id: string | null;
    objective: string;
    objective_hash: string | null;
    status: string;
    current_version: number;
    planner_run_ids: string | null;
    steps: string;
    constraints: string | null;
    assumptions: string | null;
    created_at: string;
    updated_at: string;
  }): ExecutionPlanRecord {
    return {
      planId: row.plan_id,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      objective: row.objective,
      objectiveHash: row.objective_hash ?? undefined,
      status: row.status as ExecutionPlanState,
      currentVersion: row.current_version,
      plannerRunIds: row.planner_run_ids ? JSON.parse(row.planner_run_ids) : undefined,
      steps: JSON.parse(row.steps) as PlanStep[],
      constraints: row.constraints ? JSON.parse(row.constraints) : undefined,
      assumptions: row.assumptions ? JSON.parse(row.assumptions) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function createPlanStore(connection: ConnectionManager): PlanStore {
  return new PlanStoreImpl(connection);
}
