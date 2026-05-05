import type { ConnectionManager } from './connection.js';

export interface Session {
  sessionId: string;
  userId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  messageCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  selectedModel?: string;
  selectedProviderId?: string;
}

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  title: string;
  status?: 'active' | 'archived' | 'closed';
  messageCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ListSessionsOptions {
  userId?: string;
  status?: 'active' | 'archived' | 'closed';
  limit?: number;
  offset?: number;
}

export interface UpdateMetadataInput {
  messageCount?: number;
  lastActivityAt?: string;
}

export interface SessionStore {
  create(input: CreateSessionInput): Session;
  getById(sessionId: string): Session | null;
  list(options?: ListSessionsOptions): Session[];
  updateActivity(sessionId: string, lastActivityAt: string): boolean;
  updateMetadata(sessionId: string, input: UpdateMetadataInput): boolean;
  updateStatus(sessionId: string, status: 'active' | 'archived' | 'closed'): boolean;
  updateTitle(sessionId: string, title: string): boolean;
  updateUserId(sessionId: string, newUserId: string): boolean;
  setModel(sessionId: string, selectedModel: string, selectedProviderId: string): boolean;
  getCount(options?: { userId?: string; status?: 'active' | 'archived' | 'closed' }): number;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  message_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  selected_model: string | null;
  selected_provider_id: string | null;
}

class SessionStoreImpl implements SessionStore {
  private connection: ConnectionManager;

  constructor(connection: ConnectionManager) {
    this.connection = connection;
  }

  create(input: CreateSessionInput): Session {
    const now = new Date().toISOString();
    const session: Session = {
      sessionId: input.sessionId,
      userId: input.userId,
      title: input.title,
      status: input.status ?? 'active',
      messageCount: input.messageCount ?? 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };

    const sql = `
      INSERT INTO sessions (
        session_id, user_id, title, status, message_count,
        last_activity_at, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      session.sessionId,
      session.userId,
      session.title,
      session.status,
      session.messageCount,
      session.lastActivityAt,
      session.createdAt,
      session.updatedAt,
      session.metadata ? JSON.stringify(session.metadata) : null
    ];

    this.connection.exec(sql, params);
    return session;
  }

  getById(sessionId: string): Session | null {
    const sql = 'SELECT * FROM sessions WHERE session_id = ?';
    const rows = this.connection.query<SessionRow>(sql, [sessionId]);

    if (rows.length === 0) {
      return null;
    }

    return this.rowToSession(rows[0]);
  }

  list(options: ListSessionsOptions = {}): Session[] {
    const { userId, status, limit = 100, offset = 0 } = options;

    let sql: string;
    let params: unknown[];

    if (userId && status) {
      sql = `
        SELECT * FROM sessions
        WHERE user_id = ? AND status = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, status, limit, offset];
    } else if (userId) {
      sql = `
        SELECT * FROM sessions
        WHERE user_id = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, limit, offset];
    } else if (status) {
      sql = `
        SELECT * FROM sessions
        WHERE status = ?
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [status, limit, offset];
    } else {
      sql = `
        SELECT * FROM sessions
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    const rows = this.connection.query<SessionRow>(sql, params);
    return rows.map(row => this.rowToSession(row));
  }

  updateActivity(sessionId: string, lastActivityAt: string): boolean {
    const sql = `
      UPDATE sessions
      SET last_activity_at = ?, updated_at = ?
      WHERE session_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [lastActivityAt, now, sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  updateMetadata(sessionId: string, input: UpdateMetadataInput): boolean {
    const updates: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    if (input.messageCount !== undefined) {
      updates.push('message_count = ?');
      params.push(input.messageCount);
    }

    if (input.lastActivityAt !== undefined) {
      updates.push('last_activity_at = ?');
      params.push(input.lastActivityAt);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(sessionId);

    const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE session_id = ?`;

    try {
      this.connection.exec(sql, params);
      return true;
    } catch {
      return false;
    }
  }

  updateStatus(sessionId: string, status: 'active' | 'archived' | 'closed'): boolean {
    const sql = `
      UPDATE sessions
      SET status = ?, updated_at = ?
      WHERE session_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [status, now, sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  updateTitle(sessionId: string, title: string): boolean {
    const sql = `
      UPDATE sessions
      SET title = ?, updated_at = ?
      WHERE session_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [title, now, sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  updateUserId(sessionId: string, newUserId: string): boolean {
    const sql = `
      UPDATE sessions
      SET user_id = ?, updated_at = ?
      WHERE session_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [newUserId, now, sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  setModel(sessionId: string, selectedModel: string, selectedProviderId: string): boolean {
    const sql = `
      UPDATE sessions
      SET selected_model = ?, selected_provider_id = ?, updated_at = ?
      WHERE session_id = ?
    `;

    const now = new Date().toISOString();

    try {
      this.connection.exec(sql, [selectedModel, selectedProviderId, now, sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  getCount(options: { userId?: string; status?: 'active' | 'archived' | 'closed' } = {}): number {
    const { userId, status } = options;

    let sql: string;
    let params: unknown[];

    if (userId && status) {
      sql = 'SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND status = ?';
      params = [userId, status];
    } else if (userId) {
      sql = 'SELECT COUNT(*) as count FROM sessions WHERE user_id = ?';
      params = [userId];
    } else if (status) {
      sql = 'SELECT COUNT(*) as count FROM sessions WHERE status = ?';
      params = [status];
    } else {
      sql = 'SELECT COUNT(*) as count FROM sessions';
      params = [];
    }

    const rows = this.connection.query<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }

  private rowToSession(row: SessionRow): Session {
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      title: row.title,
      status: row.status,
      messageCount: row.message_count,
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      selectedModel: row.selected_model ?? undefined,
      selectedProviderId: row.selected_provider_id ?? undefined
    };
  }
}

export function createSessionStore(connection: ConnectionManager): SessionStore {
  return new SessionStoreImpl(connection);
}
