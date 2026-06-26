/**
 * AMap MCP Bootstrap Tests
 *
 * Verifies the `registerAMapMcpTools` helper:
 * - Disabled mode → no AMap tools in registry
 * - Enabled + mock transport → tools registered with `mcp_amap_*` names
 * - Enabled but missing key → no crash, no raw key placeholder
 * - Registration failure → graceful no-op, no process crash
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry, ToolDefinition } from '../../../src/tools/types.js'
import type { MCPToolDescriptor } from '../../../src/connectors/types.js'
import type { McpTransport } from '../../../src/connectors/mcp/mcp-session-manager.js'
import type { McpToolTransport } from '../../../src/connectors/mcp/mcp-tool-bridge.js'
import { registerAMapMcpTools } from '../../../src/connectors/mcp/register-amap-mcp-tools.js'

// ─── Schema DDL ──────────────────────────────────────────────────────

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

// ─── Mock AMap Transport ─────────────────────────────────────────────

const AMAP_MOCK_TOOLS: MCPToolDescriptor[] = [
  {
    toolId: 'amap.geocode',
    name: 'geocode',
    description: 'Convert an address to geographic coordinates',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'The address to geocode' },
        city: { type: 'string', description: 'City name for disambiguation' },
      },
      required: ['address'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    toolId: 'amap.poi_search',
    name: 'poi_search',
    description: 'Search for points of interest by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        keywords: { type: 'string', description: 'Search keywords' },
        location: { type: 'string', description: 'Center point (lng,lat)' },
        radius: { type: 'number', description: 'Search radius in meters' },
      },
      required: ['keywords'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    toolId: 'amap.route_plan',
    name: 'route_plan',
    description: 'Plan a route between two points',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin coordinates (lng,lat)' },
        destination: { type: 'string', description: 'Destination coordinates (lng,lat)' },
        mode: { type: 'string', description: 'Travel mode: driving, walking, transit' },
      },
      required: ['origin', 'destination'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
]

/**
 * Mock transport that satisfies both McpTransport and McpToolTransport.
 * Simulates a connected AMap MCP server with pre-defined tools.
 */
class MockAMapTransport implements McpTransport, McpToolTransport {
  private connected = false
  private readonly tools: MCPToolDescriptor[]
  readonly connectSpy: Mock

  constructor(tools: MCPToolDescriptor[] = AMAP_MOCK_TOOLS) {
    this.tools = tools
    this.connectSpy = vi.fn()
  }

  async connect(): Promise<void> {
    this.connectSpy()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    if (!this.connected) throw new Error('Not connected')
    return [...this.tools]
  }

  async callTool(name: string, _params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) throw new Error('Not connected')
    const tool = this.tools.find((t) => t.name === name)
    if (!tool) return { isError: true, error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${name}` } }
    return { result: `Mock AMap result for ${name}` }
  }
}

class DelayedConnectAMapTransport implements McpTransport, McpToolTransport {
  private connected = false
  private readonly tools: MCPToolDescriptor[]
  readonly connectSpy: Mock

  constructor(tools: MCPToolDescriptor[] = AMAP_MOCK_TOOLS) {
    this.tools = tools
    this.connectSpy = vi.fn()
  }

  async connect(): Promise<void> {
    this.connectSpy()
    await Promise.resolve()
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    if (!this.connected) throw new Error('Not connected yet')
    return [...this.tools]
  }

  async callTool(name: string, _params: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) throw new Error('Not connected yet')
    const tool = this.tools.find((t) => t.name === name)
    if (!tool) return { isError: true, error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${name}` } }
    return { result: `Mock AMap result for ${name}` }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('registerAMapMcpTools', () => {
  let connection: ConnectionManager
  let registry: ToolRegistry

  const getAmapTools = (reg: ToolRegistry): ToolDefinition[] =>
    reg.listTools().filter((t) => t.metadata?.bridge === 'mcp' && t.metadata?.serverId === 'amap-maps')

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)
    registry = createToolRegistry()
  })

  afterEach(() => {
    connection.close()
  })

  it('is a no-op when AMAP_MCP_ENABLED is not set', async () => {
    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: {},
    })

    expect(getAmapTools(registry)).toHaveLength(0)
  })

  it('is a no-op when AMAP_MCP_ENABLED=false', async () => {
    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'false' },
    })

    expect(getAmapTools(registry)).toHaveLength(0)
  })

  it('is a no-op when AMAP_MCP_ENABLED=true but AMAP_MAPS_API_KEY is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true' },
    })

    expect(getAmapTools(registry)).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AMAP_MAPS_API_KEY is not set'),
    )

    warnSpy.mockRestore()
  })

  it('is a no-op when AMAP_MCP_ENABLED=true but AMAP_MAPS_API_KEY is empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: '   ' },
    })

    expect(getAmapTools(registry)).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AMAP_MAPS_API_KEY is not set'),
    )

    warnSpy.mockRestore()
  })

  it('registers AMap tools when enabled with mock transport', async () => {
    const mockTransport = new MockAMapTransport()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: 'test-key-123' },
      transportOverride: mockTransport,
    })

    // Transport was connected
    expect(mockTransport.connectSpy).toHaveBeenCalledOnce()

    // Tools registered with sanitized names
    const amapTools = getAmapTools(registry)
    expect(amapTools.length).toBe(3)

    // Tool names follow mcp_amap-maps_<tool> pattern (sanitized)
    const toolNames = amapTools.map((t) => t.name).sort()
    expect(toolNames).toEqual([
      'mcp_amap-maps_geocode',
      'mcp_amap-maps_poi_search',
      'mcp_amap-maps_route_plan',
    ])

    // Each tool has expected metadata
    for (const tool of amapTools) {
      expect(tool.metadata?.bridge).toBe('mcp')
      expect(tool.metadata?.serverId).toBe('amap-maps')
      expect(tool.schema).toBeDefined()
      expect(tool.schema.type).toBe('object')
      expect(tool.description).toBeTruthy()
    }

    // Registration logged
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Registered 3 AMap MCP tool(s)'))

    logSpy.mockRestore()
  })

  it('waits for delayed async transport connect before discovering tools', async () => {
    const mockTransport = new DelayedConnectAMapTransport()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: 'test-key-123' },
      transportOverride: mockTransport,
    })

    expect(mockTransport.connectSpy).toHaveBeenCalledOnce()
    expect(getAmapTools(registry)).toHaveLength(3)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Registered 3 AMap MCP tool(s)'))

    logSpy.mockRestore()
  })

  it('registers server definition with secret-safe baseUrl (no key)', async () => {
    const mockTransport = new MockAMapTransport()

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: 'secret-key-456' },
      transportOverride: mockTransport,
    })

    // Verify the server was registered via the registry's DB table
    const rows = connection.query<{ base_url: string; authentication_json: string }>(
      'SELECT base_url, authentication_json FROM mcp_servers WHERE server_id = ?',
      ['amap-maps'],
    )
    expect(rows).toHaveLength(1)
    // baseUrl must NOT contain the key
    expect(rows[0]!.base_url).not.toContain('secret-key-456')
    expect(rows[0]!.base_url).toBe('https://mcp.amap.com/mcp')

    // Auth config references env var
    const auth = JSON.parse(rows[0]!.authentication_json) as Record<string, unknown>
    expect(auth.envVar).toBe('AMAP_MAPS_API_KEY')
    expect(auth.placement).toBe('query')
  })

  it('gracefully handles transport connect failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failTransport: McpTransport & McpToolTransport = {
      connect: () => {
        throw new Error('Connection refused')
      },
      disconnect: async () => {},
      listTools: async () => [],
      callTool: async () => ({}),
    }

    // Should not throw
    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: 'test-key' },
      transportOverride: failTransport,
    })

    // No tools registered because session errored and bridge couldn't discover
    // (session error status means bridge.registerTools may throw, caught by try/catch)
    expect(getAmapTools(registry)).toHaveLength(0)

    warnSpy.mockRestore()
  })

  it('does not crash on registration failure (catch-all)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Provide a transport that throws on listTools
    const badTransport: McpTransport & McpToolTransport = {
      connect: async () => {},
      disconnect: async () => {},
      listTools: () => {
        throw new Error('MCP protocol error')
      },
      callTool: async () => ({}),
    }

    // Should not throw — errors are caught internally
    await expect(
      registerAMapMcpTools({
        connection,
        toolRegistry: registry,
        env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: 'test-key' },
        transportOverride: badTransport,
      }),
    ).resolves.toBeUndefined()

    expect(getAmapTools(registry)).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to register'))

    warnSpy.mockRestore()
  })

  it('no raw API key placeholder leaks into registry metadata', async () => {
    const sentinel = 'AMAP_SECRET_SHOULD_NOT_APPEAR'
    const mockTransport = new MockAMapTransport()

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: { AMAP_MCP_ENABLED: 'true', AMAP_MAPS_API_KEY: sentinel },
      transportOverride: mockTransport,
    })

    // Check all tool names, descriptions, and metadata
    const allTools = registry.listTools()
    for (const tool of allTools) {
      const serialized = JSON.stringify(tool)
      expect(serialized).not.toContain(sentinel)
    }

    // Also check DB rows
    const serverRows = connection.query<{ base_url: string; authentication_json: string }>(
      'SELECT base_url, authentication_json FROM mcp_servers',
    )
    for (const row of serverRows) {
      expect(row.base_url).not.toContain(sentinel)
      expect(row.authentication_json).not.toContain(sentinel)
    }
  })

  it('uses custom AMAP_MCP_BASE_URL when provided', async () => {
    const mockTransport = new MockAMapTransport()
    const customEndpoint = 'https://custom-amap.example.com/mcp'

    await registerAMapMcpTools({
      connection,
      toolRegistry: registry,
      env: {
        AMAP_MCP_ENABLED: 'true',
        AMAP_MAPS_API_KEY: 'test-key',
        AMAP_MCP_BASE_URL: customEndpoint,
      },
      transportOverride: mockTransport,
    })

    const rows = connection.query<{ base_url: string }>(
      'SELECT base_url FROM mcp_servers WHERE server_id = ?',
      ['amap-maps'],
    )
    expect(rows[0]!.base_url).toBe(customEndpoint)
  })
})
