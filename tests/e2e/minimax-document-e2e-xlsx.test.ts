/**
 * MiniMax Document MCP E2E - xlsx.read Tests
 *
 * Tests that xlsx.read returns structured data, not binary content,
 * and is correctly marked as read-only.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMcpServerRegistry, type McpServerRegistry } from '../../src/connectors/mcp/mcp-server-registry.js'
import { createMcpSessionManager, type McpSessionManager } from '../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../src/tools/types.js'
import { createMockMcpServer } from '../fixtures/phase3-mock-mcp.js'
import {
  MiniMaxDocumentMockTransport,
  createMcpTables,
  containsBase64BinaryContent,
  containsBinaryContentMarkers,
  MOCK_XLSX_READ_RESULT,
} from './minimax-document-e2e-setup.js'

describe('MiniMax Document MCP - xlsx.read Verification', () => {
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

  it('calls xlsx.read via bridge and returns structured spreadsheet data', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_xlsx_read',
      { inputPath: '/test-data/employees.xlsx', sheetName: 'Sheet1' },
    )

    expect(result.status).toBe('completed')
    expect(result.data).toBeDefined()

    const data = result.data as typeof MOCK_XLSX_READ_RESULT
    expect(data.structuredContent).toBeDefined()
    expect(data.structuredContent.sheetName).toBe('Sheet1')
    expect(data.structuredContent.headers).toEqual(['Name', 'Department', 'Salary'])
    expect(data.structuredContent.rows).toHaveLength(3)
    expect(data.structuredContent.totalRows).toBe(3)
    expect(data.structuredContent.sheetNames).toContain('Sheet1')
    expect(data.structuredContent.sheetNames).toContain('Summary')
  })

  it('xlsx.read response contains no base64 or binary content', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_xlsx_read',
      { inputPath: '/test-data/employees.xlsx' },
    )

    expect(result.status).toBe('completed')

    const serialized = JSON.stringify(result.data)
    expect(containsBase64BinaryContent(serialized)).toBe(false)
    expect(containsBinaryContentMarkers(serialized)).toBe(false)

    const data = result.data as typeof MOCK_XLSX_READ_RESULT
    for (const item of data.content) {
      expect(item.type).toBe('text')
      expect(containsBase64BinaryContent(item.text)).toBe(false)
      const parsed = JSON.parse(item.text)
      expect(parsed).toHaveProperty('sheetName')
      expect(parsed).toHaveProperty('headers')
    }
  })

  it('xlsx.read tool is marked read-only (no destructive permission required)', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const tool = toolRegistry.getTool('mcp_minimax-document-mcp_xlsx_read')
    expect(tool).not.toBeNull()
    expect(tool!.category).toBe('read')
    expect(tool!.requiresPermission).toBe(false)
    expect(tool!.idempotent).toBe(true)
    expect(tool!.sensitivity).toBe('medium')
  })
})
