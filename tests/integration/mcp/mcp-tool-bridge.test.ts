import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../../src/tools/types.js'
import { MockMcpTransport, createMockMcpToolDescriptor } from '../../fixtures/phase3-mock-mcp.js'

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

describe('McpToolBridge', () => {
  let connection: ConnectionManager
  let manager: McpSessionManager
  let transport: MockMcpTransport
  let registry: ToolRegistry

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpSessionTable(connection)
    transport = new MockMcpTransport({
      serverId: 'mock',
      tools: [
        createMockMcpToolDescriptor({
          toolId: 'mcp_echo',
          name: 'echo',
          description: 'Echo phase 3 message',
        }),
      ],
    })
    manager = createMcpSessionManager(connection, new Map([['mock', transport]]))
    registry = createToolRegistry()
  })

  afterEach(() => {
    connection.close()
  })

  it('executes discovered tool', async () => {
    const session = manager.openSession('mock')
    await transport.connect()
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: (_sessionId, serverId) => (serverId === 'mock' ? transport : undefined),
    })

    await bridge.registerTools(registry, session.sessionId)

    const tool = registry.getTool('mcp_mock_echo')
    expect(tool).not.toBeNull()
    expect(tool?.metadata?.exposureMode).toBeDefined()

    const result = await bridge.callTool(session.sessionId, 'mcp_mock_echo', { message: 'hello phase3' })

    expect(result.status).toBe('completed')
    expect(result.data).toEqual({ result: 'Mock result for echo' })
    expect(transport.getCallHistory()).toEqual([
      { toolName: 'echo', args: { message: 'hello phase3' }, result: { result: 'Mock result for echo' } },
    ])
  })

  it('normalizes timeout, cancellation, and disconnect failures', async () => {
    const slowTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [createMockMcpToolDescriptor({ name: 'echo' })],
    })
    await slowTransport.connect()
    const session = manager.openSession('mock')
    const bridge = new McpToolBridge({
      sessionManager: manager,
      timeoutMs: 1,
      getTransport: () => ({
        listTools: () => slowTransport.listTools(),
        callTool: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50)),
      }),
    })

    await expect(bridge.callTool(session.sessionId, 'mcp_mock_echo', {})).resolves.toMatchObject({
      status: 'timeout',
      error: { code: 'connector_timeout' },
    })

    const controller = new AbortController()
    controller.abort()
    await expect(
      bridge.callTool(session.sessionId, 'mcp_mock_echo', {}, { signal: controller.signal }),
    ).resolves.toMatchObject({
      status: 'cancelled',
      synthetic: true,
    })

    manager.closeSession(session.sessionId)
    await expect(bridge.callTool(session.sessionId, 'mcp_mock_echo', {})).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'mcp_session_disconnected', recoverable: true },
    })
  })

  it('rejects params missing required fields before forwarding to transport', async () => {
    const session = manager.openSession('mock')
    await transport.connect()

    const descriptorWithRequired = createMockMcpToolDescriptor({
      toolId: 'mcp_geo',
      name: 'geo',
      description: 'Geocode an address',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          city: { type: 'string' },
        },
        required: ['address'],
      },
    })

    const toolsTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [descriptorWithRequired],
    })
    await toolsTransport.connect()

    const bridgeWithSchema = new McpToolBridge({
      sessionManager: manager,
      getTransport: (_sessionId, serverId) => (serverId === 'mock' ? toolsTransport : undefined),
    })

    await bridgeWithSchema.registerTools(registry, session.sessionId)

    const result = await bridgeWithSchema.callTool(session.sessionId, 'mcp_mock_geo', { city: 'Shanghai' })

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('mcp_invalid_params')
    expect(result.error?.message).toContain('address')
    expect(toolsTransport.getCallHistory()).toEqual([])
  })

  it('categorizes read-only tools with low sensitivity and no permission required', async () => {
    const readOnlyDescriptor = createMockMcpToolDescriptor({
      toolId: 'mcp_search',
      name: 'search',
      description: 'Search POIs',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    })
    const readOnlyTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [readOnlyDescriptor],
    })
    await readOnlyTransport.connect()

    const session = manager.openSession('mock')
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: (_sessionId, serverId) => (serverId === 'mock' ? readOnlyTransport : undefined),
    })

    await bridge.registerTools(registry, session.sessionId)

    const tool = registry.getTool('mcp_mock_search')
    expect(tool).not.toBeNull()
    expect(tool?.category).toBe('read')
    expect(tool?.sensitivity).toBe('medium')
    expect(tool?.requiresPermission).toBe(false)
  })

  it('requires permission for destructive tools regardless of readOnlyHint', async () => {
    const destructiveDescriptor = createMockMcpToolDescriptor({
      toolId: 'mcp_delete',
      name: 'delete_poi',
      description: 'Delete a POI',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    })
    const destructiveTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [destructiveDescriptor],
    })
    await destructiveTransport.connect()

    const session = manager.openSession('mock')
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: (_sessionId, serverId) => (serverId === 'mock' ? destructiveTransport : undefined),
    })

    await bridge.registerTools(registry, session.sessionId)

    const tool = registry.getTool('mcp_mock_delete_poi')
    expect(tool).not.toBeNull()
    expect(tool?.category).toBe('write')
    expect(tool?.sensitivity).toBe('high')
    expect(tool?.requiresPermission).toBe(true)
  })

  it('emits stable error codes for transport unavailability', async () => {
    const session = manager.openSession('mock')
    await transport.connect()
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: () => undefined,
    })

    const result = await bridge.callTool(session.sessionId, 'mcp_mock_echo', {})
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('mcp_transport_unavailable')
    expect(result.error?.recoverable).toBe(true)
  })

  it('redacts raw API keys from error messages', async () => {
    const secretKey = 'sk-TEST_SECRET_KEY_12345'
    const errorTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [createMockMcpToolDescriptor({ name: 'echo' })],
    })
    await errorTransport.connect()

    const session = manager.openSession('mock')
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: () => ({
        listTools: () => errorTransport.listTools(),
        callTool: () => {
          throw new Error(`Unauthorized: key=${secretKey} in request`)
        },
      }),
    })

    const result = await bridge.callTool(session.sessionId, 'mcp_mock_echo', {})
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('mcp_tool_call_failed')
    expect(result.error?.message).not.toContain(secretKey)
    expect(result.error?.message).toContain('[REDACTED]')
  })
})
