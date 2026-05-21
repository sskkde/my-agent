import type { ConnectionManager } from './connection.js';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js';

export type SourceModule =
  | 'gateway'
  | 'foreground_agent'
  | 'planner'
  | 'dispatcher'
  | 'kernel'
  | 'tool'
  | 'workflow'
  | 'subagent'
  | 'trigger'
  | 'permission'
  | 'memory'
  | 'connector'
  | 'system';

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'restricted';
export type RetentionClass = 'short' | 'standard' | 'long' | 'legal_hold';

export interface RelatedRefs {
  plannerRunId?: string;
  planId?: string;
  runId?: string;
  workflowRunId?: string;
  workflowStepRunId?: string;
  backgroundRunId?: string;
  subagentRunId?: string;
  toolCallId?: string;
  approvalId?: string;
  waitConditionId?: string;
  artifactId?: string;
  memoryId?: string;
}

export interface EventRecord {
  eventId: string;
  eventType: string;
  sourceModule: SourceModule;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  relatedRefs?: RelatedRefs;
  payload: Record<string, unknown>;
  sensitivity: SensitivityLevel;
  retentionClass: RetentionClass;
  createdAt: string;
}

export interface EventQuery {
  sessionId?: string;
  userId?: string;
  eventType?: string;
  sourceModule?: string;
  correlationId?: string;
  causationId?: string;
  plannerRunId?: string;
  runId?: string;
  limit?: number;
  offset?: number;
}

export interface EventStore {
  append(event: EventRecord | EventRecord[], tenantId?: string): void;
  query(filters: EventQuery, tenantId?: string): EventRecord[];
  findByCorrelationId(correlationId: string, tenantId?: string): EventRecord[];
  findByCausationId(causationId: string, tenantId?: string): EventRecord[];
  updateUserIdForSession(sessionId: string, newUserId: string, tenantId?: string): number;
}

interface EventRow {
  event_id: string;
  event_type: string;
  source_module: string;
  user_id: string | null;
  session_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  idempotency_key: string | null;
  planner_run_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  workflow_run_id: string | null;
  workflow_step_run_id: string | null;
  background_run_id: string | null;
  subagent_run_id: string | null;
  tool_call_id: string | null;
  approval_id: string | null;
  wait_condition_id: string | null;
  artifact_id: string | null;
  memory_id: string | null;
  payload: string;
  sensitivity: SensitivityLevel;
  retention_class: RetentionClass;
  created_at: string;
}

function rowToEventRecord(row: EventRow): EventRecord {
  const relatedRefs: RelatedRefs = {};
  if (row.planner_run_id) relatedRefs.plannerRunId = row.planner_run_id;
  if (row.plan_id) relatedRefs.planId = row.plan_id;
  if (row.run_id) relatedRefs.runId = row.run_id;
  if (row.workflow_run_id) relatedRefs.workflowRunId = row.workflow_run_id;
  if (row.workflow_step_run_id) relatedRefs.workflowStepRunId = row.workflow_step_run_id;
  if (row.background_run_id) relatedRefs.backgroundRunId = row.background_run_id;
  if (row.subagent_run_id) relatedRefs.subagentRunId = row.subagent_run_id;
  if (row.tool_call_id) relatedRefs.toolCallId = row.tool_call_id;
  if (row.approval_id) relatedRefs.approvalId = row.approval_id;
  if (row.wait_condition_id) relatedRefs.waitConditionId = row.wait_condition_id;
  if (row.artifact_id) relatedRefs.artifactId = row.artifact_id;
  if (row.memory_id) relatedRefs.memoryId = row.memory_id;

  return {
    eventId: row.event_id,
    eventType: row.event_type,
    sourceModule: row.source_module as SourceModule,
    userId: row.user_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    relatedRefs: Object.keys(relatedRefs).length > 0 ? relatedRefs : undefined,
    payload: JSON.parse(row.payload),
    sensitivity: row.sensitivity,
    retentionClass: row.retention_class,
    createdAt: row.created_at
  };
}

class EventStoreImpl implements EventStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  append(event: EventRecord | EventRecord[], tenantId: string = DEFAULT_TENANT_ID): void {
    const events = Array.isArray(event) ? event : [event];

    const sql = `
      INSERT INTO events (
        event_id, event_type, source_module, user_id, session_id,
        correlation_id, causation_id, idempotency_key,
        planner_run_id, plan_id, run_id, workflow_run_id, workflow_step_run_id,
        background_run_id, subagent_run_id, tool_call_id, approval_id,
        wait_condition_id, artifact_id, memory_id,
        payload, sensitivity, retention_class, created_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const evt of events) {
      const params = [
        evt.eventId,
        evt.eventType,
        evt.sourceModule,
        evt.userId ?? null,
        evt.sessionId ?? null,
        evt.correlationId ?? null,
        evt.causationId ?? null,
        evt.idempotencyKey ?? null,
        evt.relatedRefs?.plannerRunId ?? null,
        evt.relatedRefs?.planId ?? null,
        evt.relatedRefs?.runId ?? null,
        evt.relatedRefs?.workflowRunId ?? null,
        evt.relatedRefs?.workflowStepRunId ?? null,
        evt.relatedRefs?.backgroundRunId ?? null,
        evt.relatedRefs?.subagentRunId ?? null,
        evt.relatedRefs?.toolCallId ?? null,
        evt.relatedRefs?.approvalId ?? null,
        evt.relatedRefs?.waitConditionId ?? null,
        evt.relatedRefs?.artifactId ?? null,
        evt.relatedRefs?.memoryId ?? null,
        JSON.stringify(evt.payload),
        evt.sensitivity,
        evt.retentionClass,
        evt.createdAt,
        tenantId
      ];

      this.connection.exec(sql, params);
    }
  }

  query(filters: EventQuery, tenantId: string = DEFAULT_TENANT_ID): EventRecord[] {
    const conditions: string[] = ['tenant_id = ?'];
    const params: (string | number)[] = [tenantId];

    if (filters.sessionId !== undefined) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }

    if (filters.userId !== undefined) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }

    if (filters.eventType !== undefined) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }

    if (filters.sourceModule !== undefined) {
      conditions.push('source_module = ?');
      params.push(filters.sourceModule);
    }

    if (filters.correlationId !== undefined) {
      conditions.push('correlation_id = ?');
      params.push(filters.correlationId);
    }

    if (filters.causationId !== undefined) {
      conditions.push('causation_id = ?');
      params.push(filters.causationId);
    }

    if (filters.plannerRunId !== undefined) {
      conditions.push('planner_run_id = ?');
      params.push(filters.plannerRunId);
    }

    if (filters.runId !== undefined) {
      conditions.push('run_id = ?');
      params.push(filters.runId);
    }

    let sql = 'SELECT * FROM events';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at ASC';

    if (filters.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = this.connection.query<EventRow>(sql, params);
    return rows.map(rowToEventRecord);
  }

  findByCorrelationId(correlationId: string, tenantId: string = DEFAULT_TENANT_ID): EventRecord[] {
    const sql = 'SELECT * FROM events WHERE correlation_id = ? AND tenant_id = ? ORDER BY created_at ASC';
    const rows = this.connection.query<EventRow>(sql, [correlationId, tenantId]);
    return rows.map(rowToEventRecord);
  }

  findByCausationId(causationId: string, tenantId: string = DEFAULT_TENANT_ID): EventRecord[] {
    const sql = 'SELECT * FROM events WHERE causation_id = ? AND tenant_id = ? ORDER BY created_at ASC';
    const rows = this.connection.query<EventRow>(sql, [causationId, tenantId]);
    return rows.map(rowToEventRecord);
  }

  updateUserIdForSession(sessionId: string, newUserId: string, tenantId: string = DEFAULT_TENANT_ID): number {
    const sql = `
      UPDATE events
      SET user_id = ?
      WHERE session_id = ? AND tenant_id = ?
    `;

    try {
      this.connection.exec(sql, [newUserId, sessionId, tenantId]);
      const countSql = 'SELECT COUNT(*) as count FROM events WHERE session_id = ? AND user_id = ? AND tenant_id = ?';
      const rows = this.connection.query<{ count: number }>(countSql, [sessionId, newUserId, tenantId]);
      return rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }
}

export function createEventStore(connection: ConnectionManager): EventStore {
  return new EventStoreImpl(connection);
}
