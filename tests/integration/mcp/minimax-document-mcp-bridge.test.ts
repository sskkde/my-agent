import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMcpServerRegistry, type McpServerRegistry } from '../../../src/connectors/mcp/mcp-server-registry.js'
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../../src/tools/types.js'
import {
  MockMcpTransport,
  createMiniMaxDocumentMcpSetup,
  createMockMcpServer,
} from '../../fixtures/phase3-mock-mcp.js'

const BUILTIN_DOCUMENT_TOOL_NAMES = [
  'xlsx_read',
  'xlsx_validate',
  'pptx_generate',
  'pptx_read',
  'pdf_generate',
  'docx_generate',
]

const createMcpTables = (connection: ConnectionManager): void => {
  connection.exec(`CREATE TABLE mcp_servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    base_url TEXT NOT NULL,
    config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http', 'streamable_http')),
    command TEXT,
    args TEXT,
    authentication_json TEXT,
    trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
    sandbox_policy TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
    tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

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

describe('MiniMax Document MCP - Server Registry + Tool Bridge', () => {
  let connection: ConnectionManager
  let serverRegistry: McpServerRegistry
  let sessionManager: McpSessionManager
  let transport: MockMcpTransport
  let toolRegistry: ToolRegistry

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)

    const setup = createMiniMaxDocumentMcpSetup()
    transport = setup.transport

    serverRegistry = createMcpServerRegistry(connection)
    sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', transport]]))
    toolRegistry = createToolRegistry()
  })

  afterEach(() => {
    connection.close()
  })

  it('registers minimax-document-mcp server definition in registry', () => {
    const serverDef = createMockMcpServer({
      serverId: 'minimax-document-mcp',
      name: 'MiniMax Document MCP Server',
      version: '0.1.0',
      baseUrl: 'stdio://minimax-document-mcp',
      configType: 'stdio',
      command: 'node',
      args: ['mcp-servers/minimax-document-mcp/dist/index.js'],
      trustLevel: 'verified',
      sandboxPolicy: { network: false, filesystem: 'read-only' },
      status: 'active',
    })

    serverRegistry.registerServer(serverDef)

    const stored = serverRegistry.getServer('minimax-document-mcp')
    expect(stored).not.toBeNull()
    expect(stored).toMatchObject({
      serverId: 'minimax-document-mcp',
      name: 'MiniMax Document MCP Server',
      version: '0.1.0',
      configType: 'stdio',
      command: 'node',
      trustLevel: 'verified',
      status: 'active',
    })
    expect(serverRegistry.listServers()).toHaveLength(1)
  })

  it('discovers xlsx.read and pptx.generate via McpToolBridge', async () => {
    const session = sessionManager.openSession('minimax-document-mcp')
    await transport.connect()

    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })

    const tools = await bridge.discoverTools(session.sessionId)

    const xlsxRead = tools.find((t) => t.name === 'mcp_minimax-document-mcp_xlsx_read')
    const pptxGenerate = tools.find((t) => t.name === 'mcp_minimax-document-mcp_pptx_generate')

    expect(xlsxRead).toBeDefined()
    expect(pptxGenerate).toBeDefined()
    expect(tools).toHaveLength(4)
  })

  it('registers bridged tool names in ToolRegistry with correct metadata', async () => {
    const session = sessionManager.openSession('minimax-document-mcp')
    await transport.connect()

    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })

    await bridge.registerTools(toolRegistry, session.sessionId)

    const xlsxRead = toolRegistry.getTool('mcp_minimax-document-mcp_xlsx_read')
    expect(xlsxRead).not.toBeNull()
    expect(xlsxRead?.metadata?.bridge).toBe('mcp')
    expect(xlsxRead?.metadata?.serverId).toBe('minimax-document-mcp')
    expect(xlsxRead?.metadata?.rawToolName).toBe('xlsx.read')
    expect(xlsxRead?.metadata?.mcpToolId).toBe('minimax_xlsx_read')
    expect(xlsxRead?.category).toBe('read')
    expect(xlsxRead?.sensitivity).toBe('medium')
    expect(xlsxRead?.requiresPermission).toBe(false)
    expect(xlsxRead?.idempotent).toBe(true)

    const pptxGenerate = toolRegistry.getTool('mcp_minimax-document-mcp_pptx_generate')
    expect(pptxGenerate).not.toBeNull()
    expect(pptxGenerate?.metadata?.bridge).toBe('mcp')
    expect(pptxGenerate?.metadata?.serverId).toBe('minimax-document-mcp')
    expect(pptxGenerate?.metadata?.rawToolName).toBe('pptx.generate')
    expect(pptxGenerate?.category).toBe('write')
    expect(pptxGenerate?.sensitivity).toBe('high')
    expect(pptxGenerate?.idempotent).toBe(false)
  })

  it('verifies no direct built-in document tool names in ToolRegistry', async () => {
    const session = sessionManager.openSession('minimax-document-mcp')
    await transport.connect()

    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })

    await bridge.registerTools(toolRegistry, session.sessionId)

    for (const builtinName of BUILTIN_DOCUMENT_TOOL_NAMES) {
      expect(toolRegistry.hasTool(builtinName)).toBe(false)
    }

    const allNames = toolRegistry.listTools().map((t) => t.name)
    expect(allNames.every((name) => name.startsWith('mcp_minimax-document-mcp_'))).toBe(true)
  })

  it('returns mcp_session_disconnected error when session is closed', async () => {
    const session = sessionManager.openSession('minimax-document-mcp')
    await transport.connect()

    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })

    await bridge.registerTools(toolRegistry, session.sessionId)

    sessionManager.closeSession(session.sessionId)

    const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
      inputPath: '/test.xlsx',
    })

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('mcp_session_disconnected')
    expect(result.error?.recoverable).toBe(true)
  })

  it('unregisters all bridged tools on session close', async () => {
    const session = sessionManager.openSession('minimax-document-mcp')
    await transport.connect()

    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })

    await bridge.registerTools(toolRegistry, session.sessionId)
    expect(toolRegistry.listTools()).toHaveLength(4)

    bridge.unregisterTools(toolRegistry, session.sessionId)
    expect(toolRegistry.listTools()).toHaveLength(0)
  })
})
