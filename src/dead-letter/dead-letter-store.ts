import type { ConnectionManager } from '../storage/connection.js';
import type { DeadLetterRecord, DeadLetterStatus, DeadLetterListFilters } from './types.js';

export interface DeadLetterStore {
  enqueue(record: DeadLetterRecord): void;
  findByEventId(eventId: string): DeadLetterRecord | null;
  list(filters?: DeadLetterListFilters): DeadLetterRecord[];
  updateStatus(eventId: string, status: DeadLetterStatus, error?: string): void;
  count(filters?: DeadLetterListFilters): number;
}

interface DeadLetterRow {
  event_id: string;
  source_module: string;
  source_id: string;
  reason: string;
  payload: string | null;
  status: DeadLetterStatus;
  failure_count: number;
  last_error: string | null;
  enqueued_at: string;
  updated_at: string;
  discarded_at: string | null;
  resolved_at: string | null;
}

function rowToRecord(row: DeadLetterRow): DeadLetterRecord {
  return {
    eventId: row.event_id,
    sourceModule: row.source_module,
    sourceId: row.source_id,
    reason: row.reason,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : undefined,
    status: row.status,
    failureCount: row.failure_count,
    lastError: row.last_error ?? undefined,
    enqueuedAt: row.enqueued_at,
    updatedAt: row.updated_at,
    discardedAt: row.discarded_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

class DeadLetterStoreImpl implements DeadLetterStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  enqueue(record: DeadLetterRecord): void {
    const existing = this.connection.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM dead_letter WHERE event_id = ?',
      [record.eventId]
    );
    if ((existing[0]?.count ?? 0) > 0) {
      return;
    }

    const sql = `
      INSERT INTO dead_letter (
        event_id, source_module, source_id, reason, payload,
        status, failure_count, last_error, enqueued_at, updated_at,
        discarded_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      record.eventId,
      record.sourceModule,
      record.sourceId,
      record.reason,
      record.payload ? JSON.stringify(record.payload) : null,
      record.status,
      record.failureCount,
      record.lastError ?? null,
      record.enqueuedAt,
      record.updatedAt,
      record.discardedAt ?? null,
      record.resolvedAt ?? null,
    ];

    this.connection.exec(sql, params);
  }

  findByEventId(eventId: string): DeadLetterRecord | null {
    const sql = 'SELECT * FROM dead_letter WHERE event_id = ?';
    const rows = this.connection.query<DeadLetterRow>(sql, [eventId]);

    if (rows.length === 0) {
      return null;
    }

    return rowToRecord(rows[0] as DeadLetterRow);
  }

  list(filters?: DeadLetterListFilters): DeadLetterRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters?.module !== undefined) {
      conditions.push('source_module = ?');
      params.push(filters.module);
    }

    if (filters?.status !== undefined) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    let sql = 'SELECT * FROM dead_letter';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY enqueued_at DESC';

    const rows = this.connection.query<DeadLetterRow>(sql, params);
    return rows.map(row => rowToRecord(row));
  }

  updateStatus(eventId: string, status: DeadLetterStatus, error?: string): void {
    const fields: string[] = ['status = ?'];
    const params: (string | null)[] = [status];

    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    params.push(now);

    if (status === 'retrying') {
      fields.push('failure_count = failure_count + 1');
    }

    if (error !== undefined) {
      fields.push('last_error = ?');
      params.push(error);
    }

    if (status === 'discarded') {
      fields.push('discarded_at = ?');
      params.push(now);
    }

    if (status === 'resolved') {
      fields.push('resolved_at = ?');
      params.push(now);
    }

    params.push(eventId);

    const sql = `UPDATE dead_letter SET ${fields.join(', ')} WHERE event_id = ?`;
    this.connection.exec(sql, params);
  }

  count(filters?: DeadLetterListFilters): number {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters?.module !== undefined) {
      conditions.push('source_module = ?');
      params.push(filters.module);
    }

    if (filters?.status !== undefined) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    let sql = 'SELECT COUNT(*) as count FROM dead_letter';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const result = this.connection.query<{ count: number }>(sql, params);
    return result[0]?.count ?? 0;
  }
}

export function createDeadLetterStore(connection: ConnectionManager): DeadLetterStore {
  return new DeadLetterStoreImpl(connection);
}
