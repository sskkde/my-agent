import type { ConnectionManager } from './connection.js';

export const APPROVAL_STATES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type ApprovalState = typeof APPROVAL_STATES[keyof typeof APPROVAL_STATES];

export interface ApprovalRequest {
  id: string;
  userId: string;
  sessionId: string;
  status: ApprovalState;
  riskLevel?: string | null;
  scope?: string | null;
  actionType: string;
  resource?: string | null;
  justification?: string | null;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string | null;
  respondedAt?: string | null;
  responseBy?: string | null;
  responseReason?: string | null;
  idempotencyKey?: string | null;
  metadata?: string | null;
  sourceContext?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApprovalRequest {
  id: string;
  userId: string;
  sessionId: string;
  status: ApprovalState;
  riskLevel?: string;
  scope?: string;
  actionType: string;
  resource?: string;
  justification?: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt?: string;
  respondedAt?: string;
  responseBy?: string;
  responseReason?: string;
  idempotencyKey?: string;
  metadata?: string;
  sourceContext?: string;
}

export interface UpdateApprovalRequest {
  status?: ApprovalState;
  respondedAt?: string;
  responseBy?: string;
  responseReason?: string;
  expiresAt?: string;
}

export interface ApprovalStore {
  create(request: CreateApprovalRequest): ApprovalRequest;
  getById(id: string): ApprovalRequest | null;
  update(id: string, updates: UpdateApprovalRequest): ApprovalRequest;
  findPendingByUser(userId: string): ApprovalRequest[];
  findPendingBySession(sessionId: string): ApprovalRequest[];
  findExpired(before: string): ApprovalRequest[];
  delete(id: string): void;
}

class ApprovalStoreImpl implements ApprovalStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(request: CreateApprovalRequest): ApprovalRequest {
    const now = new Date().toISOString();
    const approval: ApprovalRequest = {
      id: request.id,
      userId: request.userId,
      sessionId: request.sessionId,
      status: request.status,
      riskLevel: request.riskLevel ?? null,
      scope: request.scope ?? null,
      actionType: request.actionType,
      resource: request.resource ?? null,
      justification: request.justification ?? null,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt ?? null,
      respondedAt: request.respondedAt ?? null,
      responseBy: request.responseBy ?? null,
      responseReason: request.responseReason ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      metadata: request.metadata ?? null,
      sourceContext: request.sourceContext ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.connection.exec(
      `INSERT INTO approval_requests (
        id, user_id, session_id, status, risk_level, scope, action_type, resource,
        justification, requested_by, requested_at, expires_at, responded_at,
        response_by, response_reason, idempotency_key, metadata, source_context,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        approval.id,
        approval.userId,
        approval.sessionId,
        approval.status,
        approval.riskLevel,
        approval.scope,
        approval.actionType,
        approval.resource,
        approval.justification,
        approval.requestedBy,
        approval.requestedAt,
        approval.expiresAt,
        approval.respondedAt,
        approval.responseBy,
        approval.responseReason,
        approval.idempotencyKey,
        approval.metadata,
        approval.sourceContext,
        approval.createdAt,
        approval.updatedAt,
      ]
    );

    return approval;
  }

  getById(id: string): ApprovalRequest | null {
    const results = this.connection.query<ApprovalRequestRow>(
      'SELECT * FROM approval_requests WHERE id = ?',
      [id]
    );

    if (results.length === 0) {
      return null;
    }

    return this.rowToRequest(results[0]);
  }

  update(id: string, updates: UpdateApprovalRequest): ApprovalRequest {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`Approval request not found: ${id}`);
    }

    const now = new Date().toISOString();
    const updated: ApprovalRequest = {
      ...existing,
      status: updates.status ?? existing.status,
      respondedAt: updates.respondedAt ?? existing.respondedAt,
      responseBy: updates.responseBy ?? existing.responseBy,
      responseReason: updates.responseReason ?? existing.responseReason,
      expiresAt: updates.expiresAt ?? existing.expiresAt,
      updatedAt: now,
    };

    this.connection.exec(
      `UPDATE approval_requests SET
        status = ?,
        responded_at = ?,
        response_by = ?,
        response_reason = ?,
        expires_at = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        updated.status,
        updated.respondedAt,
        updated.responseBy,
        updated.responseReason,
        updated.expiresAt,
        updated.updatedAt,
        id,
      ]
    );

    return updated;
  }

  findPendingByUser(userId: string): ApprovalRequest[] {
    const results = this.connection.query<ApprovalRequestRow>(
      'SELECT * FROM approval_requests WHERE user_id = ? AND status = ?',
      [userId, APPROVAL_STATES.PENDING]
    );
    return results.map(row => this.rowToRequest(row));
  }

  findPendingBySession(sessionId: string): ApprovalRequest[] {
    const results = this.connection.query<ApprovalRequestRow>(
      'SELECT * FROM approval_requests WHERE session_id = ? AND status = ?',
      [sessionId, APPROVAL_STATES.PENDING]
    );
    return results.map(row => this.rowToRequest(row));
  }

  findExpired(before: string): ApprovalRequest[] {
    const results = this.connection.query<ApprovalRequestRow>(
      'SELECT * FROM approval_requests WHERE expires_at IS NOT NULL AND expires_at < ?',
      [before]
    );
    return results.map(row => this.rowToRequest(row));
  }

  delete(id: string): void {
    this.connection.exec('DELETE FROM approval_requests WHERE id = ?', [id]);
  }

  private rowToRequest(row: ApprovalRequestRow): ApprovalRequest {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      status: row.status as ApprovalState,
      riskLevel: row.risk_level,
      scope: row.scope,
      actionType: row.action_type,
      resource: row.resource,
      justification: row.justification,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
      responseBy: row.response_by,
      responseReason: row.response_reason,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata,
      sourceContext: row.source_context,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

interface ApprovalRequestRow {
  id: string;
  user_id: string;
  session_id: string;
  status: string;
  risk_level: string | null;
  scope: string | null;
  action_type: string;
  resource: string | null;
  justification: string | null;
  requested_by: string;
  requested_at: string;
  expires_at: string | null;
  responded_at: string | null;
  response_by: string | null;
  response_reason: string | null;
  idempotency_key: string | null;
  metadata: string | null;
  source_context: string | null;
  created_at: string;
  updated_at: string;
}

export function createApprovalStore(connection: ConnectionManager): ApprovalStore {
  return new ApprovalStoreImpl(connection);
}
