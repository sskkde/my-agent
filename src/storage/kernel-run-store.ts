import type { ConnectionManager } from './connection.js';
import type { KernelRunState } from '../shared/states.js';

export interface KernelRun {
  runId: string;
  sessionId?: string;
  agentId: string;
  invocationSource: string;
  status: KernelRunState;
  checkpointData?: unknown;
  finalResult?: unknown;
  metrics?: unknown;
  eventStart?: number;
  eventEnd?: number;
  parentRunId?: string;
  rootRunId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KernelRunStore {
  create(run: Omit<KernelRun, 'createdAt' | 'updatedAt'>): void;
  getById(runId: string): KernelRun | null;
  updateStatus(runId: string, status: KernelRunState): void;
  saveCheckpoint(runId: string, checkpoint: unknown): void;
  saveFinalResult(runId: string, result: unknown): void;
  getBySession(sessionId: string): KernelRun[];
  getByAgentId(agentId: string): KernelRun[];
  getByStatus(status: KernelRunState): KernelRun[];
  getByParentRunId(parentRunId: string): KernelRun[];
  getByRootRunId(rootRunId: string): KernelRun[];
  getByInvocationSource(source: string): KernelRun[];
}

class KernelRunStoreImpl implements KernelRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(run: Omit<KernelRun, 'createdAt' | 'updatedAt'>): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `INSERT INTO kernel_runs (
        run_id, session_id, agent_id, invocation_source, status,
        checkpoint_data, final_result, metrics, event_start, event_end,
        parent_run_id, root_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.runId,
        run.sessionId ?? null,
        run.agentId,
        run.invocationSource,
        run.status,
        run.checkpointData ? JSON.stringify(run.checkpointData) : null,
        run.finalResult ? JSON.stringify(run.finalResult) : null,
        run.metrics ? JSON.stringify(run.metrics) : null,
        run.eventStart ?? null,
        run.eventEnd ?? null,
        run.parentRunId ?? null,
        run.rootRunId ?? null,
        now,
        now,
      ]
    );
  }

  getById(runId: string): KernelRun | null {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE run_id = ?`,
      [runId]
    );

    if (results.length === 0) {
      return null;
    }

    return this.mapRowToKernelRun(results[0]);
  }

  updateStatus(runId: string, status: KernelRunState): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE kernel_runs SET status = ?, updated_at = ? WHERE run_id = ?`,
      [status, now, runId]
    );
  }

  saveCheckpoint(runId: string, checkpoint: unknown): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE kernel_runs SET checkpoint_data = ?, updated_at = ? WHERE run_id = ?`,
      [JSON.stringify(checkpoint), now, runId]
    );
  }

  saveFinalResult(runId: string, result: unknown): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE kernel_runs SET final_result = ?, updated_at = ? WHERE run_id = ?`,
      [JSON.stringify(result), now, runId]
    );
  }

  getBySession(sessionId: string): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE session_id = ? ORDER BY created_at DESC`,
      [sessionId]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  getByAgentId(agentId: string): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE agent_id = ? ORDER BY created_at DESC`,
      [agentId]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  getByStatus(status: KernelRunState): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE status = ? ORDER BY created_at DESC`,
      [status]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  getByParentRunId(parentRunId: string): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE parent_run_id = ? ORDER BY created_at DESC`,
      [parentRunId]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  getByRootRunId(rootRunId: string): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE root_run_id = ? ORDER BY created_at DESC`,
      [rootRunId]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  getByInvocationSource(source: string): KernelRun[] {
    const results = this.connection.query<{
      run_id: string;
      session_id: string | null;
      agent_id: string;
      invocation_source: string;
      status: string;
      checkpoint_data: string | null;
      final_result: string | null;
      metrics: string | null;
      event_start: number | null;
      event_end: number | null;
      parent_run_id: string | null;
      root_run_id: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT * FROM kernel_runs WHERE invocation_source = ? ORDER BY created_at DESC`,
      [source]
    );

    return results.map(r => this.mapRowToKernelRun(r));
  }

  private mapRowToKernelRun(row: {
    run_id: string;
    session_id: string | null;
    agent_id: string;
    invocation_source: string;
    status: string;
    checkpoint_data: string | null;
    final_result: string | null;
    metrics: string | null;
    event_start: number | null;
    event_end: number | null;
    parent_run_id: string | null;
    root_run_id: string | null;
    created_at: string;
    updated_at: string;
  }): KernelRun {
    return {
      runId: row.run_id,
      sessionId: row.session_id ?? undefined,
      agentId: row.agent_id,
      invocationSource: row.invocation_source,
      status: row.status as KernelRunState,
      checkpointData: row.checkpoint_data ? JSON.parse(row.checkpoint_data) : undefined,
      finalResult: row.final_result ? JSON.parse(row.final_result) : undefined,
      metrics: row.metrics ? JSON.parse(row.metrics) : undefined,
      eventStart: row.event_start ?? undefined,
      eventEnd: row.event_end ?? undefined,
      parentRunId: row.parent_run_id ?? undefined,
      rootRunId: row.root_run_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createKernelRunStore(connection: ConnectionManager): KernelRunStore {
  return new KernelRunStoreImpl(connection);
}
