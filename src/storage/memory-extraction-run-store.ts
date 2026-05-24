import type { ConnectionManager } from './connection.js';

export type ExtractionRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type ResultCounts = {
  accepted: number;
  discarded: number;
  tombstoneSkipped: number;
  superseded: number;
};

export type MemoryExtractionRun = {
  runId: string;
  userId: string;
  sessionId: string;
  triggerTurnId: string;
  windowHash: string;
  includedTurnIds: string[];
  sessionMemorySummaryId?: string;
  status: ExtractionRunStatus;
  attempts: number;
  resultCounts?: ResultCounts;
  failureCode?: string;
  failureMessage?: string;
  sourceRefs: Record<string, unknown>;
  policyVersion?: string;
  variant?: string;
  shadowComparisonPayload?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type CreatePendingInput = {
  userId: string;
  sessionId: string;
  triggerTurnId: string;
  windowHash: string;
  includedTurnIds: string[];
  sessionMemorySummaryId?: string;
  sourceRefs?: Record<string, unknown>;
  policyVersion?: string;
  variant?: string;
  shadowComparisonPayload?: string;
};

export interface MemoryExtractionRunStore {
  createPending(input: CreatePendingInput): MemoryExtractionRun;
  markRunning(runId: string): void;
  markSucceeded(runId: string, resultCounts: ResultCounts): void;
  markFailed(runId: string, failureCode: string, failureMessage?: string): void;
  getByWindowHash(userId: string, windowHash: string): MemoryExtractionRun | null;
  listByUser(userId: string): MemoryExtractionRun[];
  listShadowByWindowHash(userId: string, windowHash: string): MemoryExtractionRun[];
  deleteByWindowHash(userId: string, windowHash: string): void;
}

class MemoryExtractionRunStoreImpl implements MemoryExtractionRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createPending(input: CreatePendingInput): MemoryExtractionRun {
    const suffix = input.variant ? `-${input.variant}` : '';
    const runId = `run-${input.userId}-${input.windowHash}${suffix}`;
    const now = new Date().toISOString();
    
    const sql = `
      INSERT INTO memory_extraction_runs (
        run_id, user_id, session_id, trigger_turn_id, window_hash, included_turn_ids,
        session_memory_summary_id, status, attempts, source_refs,
        policy_version, variant, shadow_comparison_payload,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?)
    `;
    
    this.connection.exec(sql, [
      runId,
      input.userId,
      input.sessionId,
      input.triggerTurnId,
      input.windowHash,
      JSON.stringify(input.includedTurnIds),
      input.sessionMemorySummaryId ?? null,
      JSON.stringify(input.sourceRefs ?? {}),
      input.policyVersion ?? null,
      input.variant ?? null,
      input.shadowComparisonPayload ?? null,
      now,
      now,
    ]);
    
    return {
      runId,
      userId: input.userId,
      sessionId: input.sessionId,
      triggerTurnId: input.triggerTurnId,
      windowHash: input.windowHash,
      includedTurnIds: input.includedTurnIds,
      sessionMemorySummaryId: input.sessionMemorySummaryId,
      status: 'pending',
      attempts: 0,
      sourceRefs: input.sourceRefs ?? {},
      policyVersion: input.policyVersion,
      variant: input.variant,
      shadowComparisonPayload: input.shadowComparisonPayload,
      createdAt: now,
      updatedAt: now,
    };
  }

  markRunning(runId: string): void {
    const current = this.getById(runId);
    if (!current) {
      throw new Error(`Extraction run "${runId}" not found`);
    }
    if (current.status !== 'pending') {
      throw new Error(`Cannot transition from "${current.status}" to "running"`);
    }
    
    const now = new Date().toISOString();
    const sql = `
      UPDATE memory_extraction_runs 
      SET status = 'running', started_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE run_id = ?
    `;
    
    this.connection.exec(sql, [now, now, runId]);
  }

  markSucceeded(runId: string, resultCounts: ResultCounts): void {
    const current = this.getById(runId);
    if (!current) {
      throw new Error(`Extraction run "${runId}" not found`);
    }
    if (current.status !== 'running') {
      throw new Error(`Cannot transition from "${current.status}" to "succeeded"`);
    }
    
    const now = new Date().toISOString();
    const sql = `
      UPDATE memory_extraction_runs 
      SET status = 'succeeded', completed_at = ?, result_counts = ?, updated_at = ?
      WHERE run_id = ?
    `;
    
    this.connection.exec(sql, [now, JSON.stringify(resultCounts), now, runId]);
  }

  markFailed(runId: string, failureCode: string, failureMessage?: string): void {
    const current = this.getById(runId);
    if (!current) {
      throw new Error(`Extraction run "${runId}" not found`);
    }
    if (current.status !== 'running') {
      throw new Error(`Cannot transition from "${current.status}" to "failed"`);
    }
    
    const now = new Date().toISOString();
    const sql = `
      UPDATE memory_extraction_runs 
      SET status = 'failed', completed_at = ?, failure_code = ?, failure_message = ?, updated_at = ?
      WHERE run_id = ?
    `;
    
    this.connection.exec(sql, [now, failureCode, failureMessage ?? null, now, runId]);
  }

  getByWindowHash(userId: string, windowHash: string): MemoryExtractionRun | null {
    const sql = `
      SELECT * FROM memory_extraction_runs 
      WHERE user_id = ? AND window_hash = ?
      LIMIT 1
    `;
    const rows = this.connection.query<ExtractionRunRow>(sql, [userId, windowHash]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.rowToRun(rows[0]);
  }

  listByUser(userId: string): MemoryExtractionRun[] {
    const sql = `
      SELECT * FROM memory_extraction_runs 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    const rows = this.connection.query<ExtractionRunRow>(sql, [userId]);
    return rows.map(r => this.rowToRun(r));
  }

  listShadowByWindowHash(userId: string, windowHash: string): MemoryExtractionRun[] {
    const sql = `
      SELECT * FROM memory_extraction_runs 
      WHERE user_id = ? AND window_hash = ? AND variant = 'shadow'
      ORDER BY created_at DESC
    `;
    const rows = this.connection.query<ExtractionRunRow>(sql, [userId, windowHash]);
    return rows.map(r => this.rowToRun(r));
  }

  deleteByWindowHash(userId: string, windowHash: string): void {
    const sql = `
      DELETE FROM memory_extraction_runs 
      WHERE user_id = ? AND window_hash = ?
    `;
    this.connection.exec(sql, [userId, windowHash]);
  }

  private getById(runId: string): MemoryExtractionRun | null {
    const sql = 'SELECT * FROM memory_extraction_runs WHERE run_id = ?';
    const rows = this.connection.query<ExtractionRunRow>(sql, [runId]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.rowToRun(rows[0]);
  }

  private rowToRun(row: ExtractionRunRow): MemoryExtractionRun {
    return {
      runId: row.run_id,
      userId: row.user_id,
      sessionId: row.session_id,
      triggerTurnId: row.trigger_turn_id,
      windowHash: row.window_hash,
      includedTurnIds: JSON.parse(row.included_turn_ids),
      sessionMemorySummaryId: row.session_memory_summary_id ?? undefined,
      status: row.status as ExtractionRunStatus,
      attempts: row.attempts,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      resultCounts: row.result_counts ? JSON.parse(row.result_counts) : undefined,
      failureCode: row.failure_code ?? undefined,
      failureMessage: row.failure_message ?? undefined,
      sourceRefs: JSON.parse(row.source_refs),
      policyVersion: row.policy_version ?? undefined,
      variant: row.variant ?? undefined,
      shadowComparisonPayload: row.shadow_comparison_payload ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

type ExtractionRunRow = {
  run_id: string;
  user_id: string;
  session_id: string;
  trigger_turn_id: string;
  window_hash: string;
  included_turn_ids: string;
  session_memory_summary_id: string | null;
  status: string;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  result_counts: string | null;
  failure_code: string | null;
  failure_message: string | null;
  source_refs: string;
  policy_version: string | null;
  variant: string | null;
  shadow_comparison_payload: string | null;
  created_at: string;
  updated_at: string;
};

export function createMemoryExtractionRunStore(connection: ConnectionManager): MemoryExtractionRunStore {
  return new MemoryExtractionRunStoreImpl(connection);
}
