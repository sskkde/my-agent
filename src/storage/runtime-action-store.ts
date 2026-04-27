import type { ConnectionManager } from './connection.js';

export type RuntimeActionState =
  | 'created'
  | 'validated'
  | 'duplicate'
  | 'denied'
  | 'accepted'
  | 'queued'
  | 'dispatching'
  | 'waiting_for_approval'
  | 'waiting_for_target'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export interface Source {
  sourceModule: string;
  sourceAction?: string;
}

export interface TargetRef {
  plannerRunId?: string;
  planId?: string;
  runId?: string;
  workflowRunId?: string;
  workflowStepRunId?: string;
  backgroundRunId?: string;
  subagentRunId?: string;
  toolCallId?: string;
}

export interface RuntimeAction {
  actionId: string;
  idempotencyKey?: string;
  source: Source;
  targetRuntime: string;
  targetAction: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  sessionId?: string;
  userId?: string;
  targetRef?: TargetRef;
  status: RuntimeActionState;
  statusMessage?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeActionQuery {
  plannerRunId?: string;
  planId?: string;
  userId?: string;
  status?: RuntimeActionState;
}

export interface RuntimeActionStore {
  save(action: RuntimeAction): void;
  findById(actionId: string): RuntimeAction | null;
  findByIdempotencyKey(idempotencyKey: string): RuntimeAction | null;
  query(filters: RuntimeActionQuery): RuntimeAction[];
  updateStatus(
    actionId: string,
    status: RuntimeActionState,
    statusMessage?: string,
    result?: Record<string, unknown>
  ): void;
}

interface RuntimeActionRow {
  action_id: string;
  idempotency_key: string | null;
  source_module: string;
  source_action: string | null;
  target_runtime: string;
  target_action: string;
  payload: string;
  correlation_id: string | null;
  causation_id: string | null;
  session_id: string | null;
  user_id: string | null;
  planner_run_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  workflow_run_id: string | null;
  workflow_step_run_id: string | null;
  background_run_id: string | null;
  subagent_run_id: string | null;
  tool_call_id: string | null;
  status: RuntimeActionState;
  status_message: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRuntimeAction(row: RuntimeActionRow): RuntimeAction {
  const targetRef: TargetRef = {};
  if (row.planner_run_id) targetRef.plannerRunId = row.planner_run_id;
  if (row.plan_id) targetRef.planId = row.plan_id;
  if (row.run_id) targetRef.runId = row.run_id;
  if (row.workflow_run_id) targetRef.workflowRunId = row.workflow_run_id;
  if (row.workflow_step_run_id) targetRef.workflowStepRunId = row.workflow_step_run_id;
  if (row.background_run_id) targetRef.backgroundRunId = row.background_run_id;
  if (row.subagent_run_id) targetRef.subagentRunId = row.subagent_run_id;
  if (row.tool_call_id) targetRef.toolCallId = row.tool_call_id;

  return {
    actionId: row.action_id,
    idempotencyKey: row.idempotency_key ?? undefined,
    source: {
      sourceModule: row.source_module,
      sourceAction: row.source_action ?? undefined
    },
    targetRuntime: row.target_runtime,
    targetAction: row.target_action,
    payload: JSON.parse(row.payload),
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    userId: row.user_id ?? undefined,
    targetRef: Object.keys(targetRef).length > 0 ? targetRef : undefined,
    status: row.status,
    statusMessage: row.status_message ?? undefined,
    result: row.result ? JSON.parse(row.result) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class RuntimeActionStoreImpl implements RuntimeActionStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  save(action: RuntimeAction): void {
    const sql = `
      INSERT INTO runtime_actions (
        action_id, idempotency_key, source_module, source_action,
        target_runtime, target_action, payload,
        correlation_id, causation_id, session_id, user_id,
        planner_run_id, plan_id, run_id, workflow_run_id, workflow_step_run_id,
        background_run_id, subagent_run_id, tool_call_id,
        status, status_message, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      action.actionId,
      action.idempotencyKey ?? null,
      action.source.sourceModule,
      action.source.sourceAction ?? null,
      action.targetRuntime,
      action.targetAction,
      JSON.stringify(action.payload),
      action.correlationId ?? null,
      action.causationId ?? null,
      action.sessionId ?? null,
      action.userId ?? null,
      action.targetRef?.plannerRunId ?? null,
      action.targetRef?.planId ?? null,
      action.targetRef?.runId ?? null,
      action.targetRef?.workflowRunId ?? null,
      action.targetRef?.workflowStepRunId ?? null,
      action.targetRef?.backgroundRunId ?? null,
      action.targetRef?.subagentRunId ?? null,
      action.targetRef?.toolCallId ?? null,
      action.status,
      action.statusMessage ?? null,
      action.result ? JSON.stringify(action.result) : null,
      action.createdAt,
      action.updatedAt
    ];

    this.connection.exec(sql, params);
  }

  findById(actionId: string): RuntimeAction | null {
    const sql = 'SELECT * FROM runtime_actions WHERE action_id = ?';
    const rows = this.connection.query<RuntimeActionRow>(sql, [actionId]);

    if (rows.length === 0) {
      return null;
    }

    return rowToRuntimeAction(rows[0] as RuntimeActionRow);
  }

  findByIdempotencyKey(idempotencyKey: string): RuntimeAction | null {
    const sql = 'SELECT * FROM runtime_actions WHERE idempotency_key = ?';
    const rows = this.connection.query<RuntimeActionRow>(sql, [idempotencyKey]);

    if (rows.length === 0) {
      return null;
    }

    return rowToRuntimeAction(rows[0] as RuntimeActionRow);
  }

  query(filters: { plannerRunId?: string; planId?: string; userId?: string; status?: RuntimeActionState }): RuntimeAction[] {
    const conditions: string[] = [];
    const params: (string | null)[] = [];

    if (filters.plannerRunId !== undefined) {
      conditions.push('planner_run_id = ?');
      params.push(filters.plannerRunId);
    }

    if (filters.planId !== undefined) {
      conditions.push('plan_id = ?');
      params.push(filters.planId);
    }

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }

    if (filters.status !== undefined) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    let sql = 'SELECT * FROM runtime_actions';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const rows = this.connection.query<RuntimeActionRow>(sql, params);
    return rows.map(row => rowToRuntimeAction(row));
  }

  updateStatus(
    actionId: string,
    status: RuntimeActionState,
    statusMessage?: string,
    result?: Record<string, unknown>
  ): void {
    const fields: string[] = ['status = ?'];
    const params: (string | null)[] = [status];

    if (statusMessage !== undefined) {
      fields.push('status_message = ?');
      params.push(statusMessage);
    }

    if (result !== undefined) {
      fields.push('result = ?');
      params.push(JSON.stringify(result));
    }

    fields.push('updated_at = ?');
    params.push(new Date().toISOString());

    params.push(actionId);

    const sql = `UPDATE runtime_actions SET ${fields.join(', ')} WHERE action_id = ?`;
    this.connection.exec(sql, params);

    const checkSql = 'SELECT COUNT(*) as count FROM runtime_actions WHERE action_id = ?';
    const checkResult = this.connection.query<{ count: number }>(checkSql, [actionId]);
    if (checkResult[0]?.count === 0) {
      throw new Error('Action not found');
    }
  }
}

export function createRuntimeActionStore(connection: ConnectionManager): RuntimeActionStore {
  return new RuntimeActionStoreImpl(connection);
}
