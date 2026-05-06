import type { ConnectionManager } from './connection.js';

export type ExtractionRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type ResultCounts = {
  memoriesCreated: number;
  memoriesSuperseded: number;
};

export type MemoryExtractionRun = {
  runId: string;
  userId: string;
  windowHash: string;
  windowStart: string;
  windowEnd: string;
  status: ExtractionRunStatus;
  startedAt?: string;
  completedAt?: string;
  resultCounts?: ResultCounts;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePendingInput = {
  userId: string;
  windowHash: string;
  windowStart: string;
  windowEnd: string;
};

export interface MemoryExtractionRunStore {
  createPending(input: CreatePendingInput): MemoryExtractionRun;
  markRunning(runId: string): void;
  markSucceeded(runId: string, resultCounts: ResultCounts): void;
  markFailed(runId: string, errorMessage: string): void;
  getByWindowHash(userId: string, windowHash: string): MemoryExtractionRun | null;
  listByUser(userId: string): MemoryExtractionRun[];
}

class MemoryExtractionRunStoreImpl implements MemoryExtractionRunStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  createPending(input: CreatePendingInput): MemoryExtractionRun {
    const runId = `run-${input.userId}-${input.windowHash}`;
    const now = new Date().toISOString();
    
    const sql = `
      INSERT INTO memory_extraction_runs (
        run_id, user_id, window_hash, window_start, window_end, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `;
    
    this.connection.exec(sql, [
      runId,
      input.userId,
      input.windowHash,
      input.windowStart,
      input.windowEnd,
      now,
      now,
    ]);
    
    return {
      runId,
      userId: input.userId,
      windowHash: input.windowHash,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      status: 'pending',
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
      SET status = 'running', started_at = ?, updated_at = ?
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

  markFailed(runId: string, errorMessage: string): void {
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
      SET status = 'failed', completed_at = ?, error_message = ?, updated_at = ?
      WHERE run_id = ?
    `;
    
    this.connection.exec(sql, [now, errorMessage, now, runId]);
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
      windowHash: row.window_hash,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      status: row.status as ExtractionRunStatus,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      resultCounts: row.result_counts ? JSON.parse(row.result_counts) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

type ExtractionRunRow = {
  run_id: string;
  user_id: string;
  window_hash: string;
  window_start: string;
  window_end: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  result_counts: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export function createMemoryExtractionRunStore(connection: ConnectionManager): MemoryExtractionRunStore {
  return new MemoryExtractionRunStoreImpl(connection);
}
