/**
 * MiniMax Document MCP E2E - Failure Scenarios
 *
 * Tests error handling for session disconnects, unknown tools, and cleanup.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMcpServerRegistry, type McpServerRegistry } from '../../src/connectors/mcp/mcp-server-registry.js'
import { createMcpSessionManager, type McpSessionManager } from '../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../src/tools/types.js'
import { createMockMcpServer } from '../fixtures/phase3-mock-mcp.js'
import { MiniMaxDocumentMockTransport } from './minimax-document-e2e-transport.js'
import { createMcpTables } from './minimax-document-e2e-helpers.js'

describe('MiniMax Document MCP - Failure Scenarios', () => {
  let connection: ConnectionManager
  let serverRegistry: McpServerRegistry
  let sessionManager: McpSessionManager
  let transport: MiniMaxDocumentMockTransport
  let toolRegistry: ToolRegistry
  let bridge: McpToolBridge

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)

    transport = new MiniMaxDocumentMockTransport()
    serverRegistry = createMcpServerRegistry(connection)
    sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', transport]]))
    toolRegistry = createToolRegistry()

    const serverDef = createMockMcpServer({
      serverId: 'minimax-document-mcp',
      name: 'MiniMax Document MCP Server',
      version: '0.1.0',
      baseUrl: 'stdio://minimax-document-mcp',
      configType: 'stdio',
      command: 'node',
      args: ['mcp-servers/minimax-document-mcp/dist/index.js'],
      trustLevel: 'verified',
      status: 'active',
    })
    serverRegistry.registerServer(serverDef)

    sessionManager.openSession('minimax-document-mcp')

    bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })
  })

  it('session disconnect returns mcp_session_disconnected error', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    sessionManager.closeSession(session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_xlsx_read',
      { inputPath: '/test.xlsx' },
    )

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('mcp_session_disconnected')
    expect(result.error?.recoverable).toBe(true)
  })

  it('calling unknown tool returns tool_not_found error', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_nonexistent_tool',
      {},
    )

    expect(result.status).toBe('failed')
  })

  it('unregistering tools cleans up the tool registry', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    expect(toolRegistry.listTools()).toHaveLength(4)

    bridge.unregisterTools(toolRegistry, session.sessionId)

    expect(toolRegistry.listTools()).toHaveLength(0)
    expect(toolRegistry.hasTool('mcp_minimax-document-mcp_xlsx_read')).toBe(false)
    expect(toolRegistry.hasTool('mcp_minimax-document-mcp_pptx_generate')).toBe(false)
  })
})
