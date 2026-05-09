import type { ConnectionManager } from '../../storage/connection.js';
import type { McpSession } from '../types.js';

export interface McpTransport {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
}

export interface McpSessionManager {
  openSession(serverId: string): McpSession;
  closeSession(sessionId: string): void;
  markUnhealthy(sessionId: string, error: string): void;
  getSession(sessionId: string): McpSession | null;
  listSessionsByServer(serverId: string): McpSession[];
}

interface McpSessionRow {
  session_id: string;
  server_id: string;
  connector_instance_id: string | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  auth_token_ref: string | null;
  metadata: string | null;
  last_error: string | null;
  last_health_check: string | null;
  connected_at: string | null;
  last_activity_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

class SqliteMcpSessionManager implements McpSessionManager {
  constructor(
    private readonly connection: ConnectionManager,
    private readonly transports: Map<string, McpTransport> = new Map()
  ) {}

  openSession(serverId: string): McpSession {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const transport = this.transports.get(serverId);
    let status: 'connected' | 'error' = 'connected';
    let lastError: string | null = null;

    try {
      const result = transport?.connect();
      if (this.isPromiseLike(result)) {
        void result.catch(error => {
          this.markUnhealthy(sessionId, error instanceof Error ? error.message : String(error));
        });
      }
    } catch (error) {
      status = 'error';
      lastError = error instanceof Error ? error.message : String(error);
    }

    this.connection.exec(
      `INSERT INTO mcp_sessions (
        session_id, server_id, connector_instance_id, status, auth_token_ref, metadata,
        last_error, last_health_check, connected_at, last_activity_at, disconnected_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, serverId, null, status, null, null, lastError, now, now, now, null, now, now]
    );

    return this.getSession(sessionId) as McpSession;
  }

  closeSession(sessionId: string): void {
    const existing = this.getSession(sessionId);
    if (!existing) {
      return;
    }
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE mcp_sessions
       SET status = ?, disconnected_at = ?, updated_at = ?, last_activity_at = ?
       WHERE session_id = ?`,
      ['disconnected', now, now, now, sessionId]
    );
  }

  markUnhealthy(sessionId: string, error: string): void {
    const now = new Date().toISOString();
    this.connection.exec(
      `UPDATE mcp_sessions
       SET status = ?, last_error = ?, last_health_check = ?, updated_at = ?
       WHERE session_id = ?`,
      ['error', error, now, now, sessionId]
    );
  }

  getSession(sessionId: string): McpSession | null {
    const rows = this.connection.query<McpSessionRow>('SELECT * FROM mcp_sessions WHERE session_id = ?', [sessionId]);
    return rows[0] ? this.rowToSession(rows[0]) : null;
  }

  listSessionsByServer(serverId: string): McpSession[] {
    const rows = this.connection.query<McpSessionRow>(
      'SELECT * FROM mcp_sessions WHERE server_id = ? ORDER BY created_at ASC',
      [serverId]
    );
    return rows.map(row => this.rowToSession(row));
  }

  private rowToSession(row: McpSessionRow): McpSession {
    return {
      sessionId: row.session_id,
      serverId: row.server_id,
      connectorInstanceId: row.connector_instance_id ?? undefined,
      status: this.toPublicStatus(row.status),
      authTokenRef: row.auth_token_ref ?? undefined,
      metadata: this.parseJson<Record<string, unknown> | undefined>(row.metadata, undefined),
      lastError: row.last_error ?? undefined,
      lastHealthCheck: row.last_health_check ?? undefined,
      connectedAt: row.connected_at ?? undefined,
      lastActivityAt: row.last_activity_at ?? undefined,
      disconnectedAt: row.disconnected_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toPublicStatus(status: McpSessionRow['status']): McpSession['status'] {
    if (status === 'connected') {
      return 'active';
    }
    if (status === 'error') {
      return 'unhealthy';
    }
    if (status === 'disconnected') {
      return 'closed';
    }
    return status;
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) {
      return fallback;
    }
    return JSON.parse(value) as T;
  }

  private isPromiseLike(value: unknown): value is Promise<void> {
    return typeof value === 'object' && value !== null && 'then' in value;
  }
}

export function createMcpSessionManager(
  connection: ConnectionManager,
  transports?: Map<string, McpTransport>
): McpSessionManager {
  return new SqliteMcpSessionManager(connection, transports);
}

export { SqliteMcpSessionManager };
