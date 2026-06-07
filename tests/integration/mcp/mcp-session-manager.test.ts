import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js'

const createMcpSessionTable = (connection: ConnectionManager): void => {
  connection.exec(`CREATE TABLE mcp_sessions (
    session_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    connector_instance_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('connecting', 'connected', 'disconnected', 'error')),
    auth_token_ref TEXT,
    metadata TEXT,
    last_error TEXT,
    last_health_check TEXT,
    connected_at TEXT,
    last_activity_at TEXT,
    disconnected_at TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

describe('McpSessionManager', () => {
  let connection: ConnectionManager
  let manager: McpSessionManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpSessionTable(connection)
    manager = createMcpSessionManager(connection)
  })

  afterEach(() => {
    connection.close()
  })

  it('MCP session manager marks failed session unhealthy', () => {
    const session = manager.openSession('mock_mcp_server')

    manager.markUnhealthy(session.sessionId, 'Mock transport error')

    const unhealthy = manager.getSession(session.sessionId)
    expect(unhealthy).toMatchObject({
      sessionId: session.sessionId,
      serverId: 'mock_mcp_server',
      status: 'unhealthy',
      lastError: 'Mock transport error',
    })
    expect(unhealthy?.lastHealthCheck).toBeDefined()
    expect(manager.listSessionsByServer('mock_mcp_server')).toHaveLength(1)

    manager.closeSession(session.sessionId)
    expect(manager.getSession(session.sessionId)?.status).toBe('closed')
  })
})
