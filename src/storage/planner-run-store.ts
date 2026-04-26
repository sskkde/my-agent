import type { ConnectionManager } from './connection.js';
import type { PlannerState } from '../shared/states.js';

export interface PlannerRunRecord {
  plannerRunId: string;
  planId: string;
  userId: string;
  sessionId?: string;
  status: PlannerState;
  checkpoint: unknown | null;
  backgroundRunId?: string;
  workflowRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerRunStore {
  create(run: PlannerRunRecord): PlannerRunRecord;
  findActive(userId: string, statusFilter?: PlannerState): PlannerRunRecord[];
  findActiveBySession(sessionId: string, statusFilter?: PlannerState): PlannerRunRecord[];
  updateStatus(plannerRunId: string, status: PlannerState, checkpoint?: unknown): void;
}

const TERMINAL_STATES: PlannerState[] = [
  'completed',
  'failed',
  'cancelled',
  'archived'
];

class PlannerRunStoreImpl implements PlannerRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(run: PlannerRunRecord): PlannerRunRecord {
    const sql = `
      INSERT INTO planner_runs (
        planner_run_id, plan_id, user_id, session_id,
        status, checkpoint, background_run_id, workflow_run_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.connection.exec(sql, [
      run.plannerRunId,
      run.planId,
      run.userId,
      run.sessionId ?? null,
      run.status,
      run.checkpoint ? JSON.stringify(run.checkpoint) : null,
      run.backgroundRunId ?? null,
      run.workflowRunId ?? null,
      run.createdAt,
      run.updatedAt
    ]);

    this.addPlannerRunToPlan(run.planId, run.plannerRunId);

    return run;
  }

  findActive(userId: string, statusFilter?: PlannerState): PlannerRunRecord[] {
    let sql: string;
    let params: unknown[];

    if (statusFilter) {
      sql = `
        SELECT * FROM planner_runs
        WHERE user_id = ? AND status = ?
        ORDER BY updated_at DESC
      `;
      params = [userId, statusFilter];
    } else {
      sql = `
        SELECT * FROM planner_runs
        WHERE user_id = ? AND status NOT IN (${TERMINAL_STATES.map(() => '?').join(', ')})
        ORDER BY updated_at DESC
      `;
      params = [userId, ...TERMINAL_STATES];
    }

    const rows = this.connection.query<{
      planner_run_id: string;
      plan_id: string;
      user_id: string;
      session_id: string | null;
      status: string;
      checkpoint: string | null;
      background_run_id: string | null;
      workflow_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(sql, params);

    return rows.map(row => this.rowToRun(row));
  }

  findActiveBySession(sessionId: string, statusFilter?: PlannerState): PlannerRunRecord[] {
    let sql: string;
    let params: unknown[];

    if (statusFilter) {
      sql = `
        SELECT * FROM planner_runs
        WHERE session_id = ? AND status = ?
        ORDER BY updated_at DESC
      `;
      params = [sessionId, statusFilter];
    } else {
      sql = `
        SELECT * FROM planner_runs
        WHERE session_id = ? AND status NOT IN (${TERMINAL_STATES.map(() => '?').join(', ')})
        ORDER BY updated_at DESC
      `;
      params = [sessionId, ...TERMINAL_STATES];
    }

    const rows = this.connection.query<{
      planner_run_id: string;
      plan_id: string;
      user_id: string;
      session_id: string | null;
      status: string;
      checkpoint: string | null;
      background_run_id: string | null;
      workflow_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(sql, params);

    return rows.map(row => this.rowToRun(row));
  }

  updateStatus(plannerRunId: string, status: PlannerState, checkpoint?: unknown): void {
    const sql = `
      UPDATE planner_runs SET
        status = ?,
        checkpoint = ?,
        updated_at = ?
      WHERE planner_run_id = ?
    `;

    this.connection.exec(sql, [
      status,
      checkpoint ? JSON.stringify(checkpoint) : null,
      new Date().toISOString(),
      plannerRunId
    ]);
  }

  private addPlannerRunToPlan(planId: string, plannerRunId: string): void {
    const selectSql = `SELECT planner_run_ids FROM plans WHERE plan_id = ?`;
    const rows = this.connection.query<{ planner_run_ids: string | null }>(selectSql, [planId]);

    if (rows.length === 0) {
      return;
    }

    const currentIds = rows[0]?.planner_run_ids
      ? JSON.parse(rows[0].planner_run_ids) as string[]
      : [];

    if (!currentIds.includes(plannerRunId)) {
      currentIds.push(plannerRunId);

      const updateSql = `
        UPDATE plans SET planner_run_ids = ?, updated_at = ? WHERE plan_id = ?
      `;
      this.connection.exec(updateSql, [
        JSON.stringify(currentIds),
        new Date().toISOString(),
        planId
      ]);
    }
  }

  private rowToRun(row: {
    planner_run_id: string;
    plan_id: string;
    user_id: string;
    session_id: string | null;
    status: string;
    checkpoint: string | null;
    background_run_id: string | null;
    workflow_run_id: string | null;
    created_at: string;
    updated_at: string;
  }): PlannerRunRecord {
    return {
      plannerRunId: row.planner_run_id,
      planId: row.plan_id,
      userId: row.user_id,
      sessionId: row.session_id ?? undefined,
      status: row.status as PlannerState,
      checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : null,
      backgroundRunId: row.background_run_id ?? undefined,
      workflowRunId: row.workflow_run_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export function createPlannerRunStore(connection: ConnectionManager): PlannerRunStore {
  return new PlannerRunStoreImpl(connection);
}
