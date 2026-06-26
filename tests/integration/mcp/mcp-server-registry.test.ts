import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import {
  createMcpServerRegistry,
  type McpServerRegistry,
  redactSecretParams,
} from '../../../src/connectors/mcp/mcp-server-registry.js'
import { createMockMcpServer } from '../../fixtures/phase3-mock-mcp.js'

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
}

describe('McpServerRegistry', () => {
  let connection: ConnectionManager
  let registry: McpServerRegistry

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)
    registry = createMcpServerRegistry(connection)
  })

  afterEach(() => {
    connection.close()
  })

  it('MCP registry stores stdio and http server definitions', () => {
    const stdioServer = createMockMcpServer({
      serverId: 'stdio-server',
      baseUrl: 'stdio://local/filesystem',
      configType: 'stdio',
      command: 'node',
      args: ['server.js', '--stdio'],
      trustLevel: 'verified',
      sandboxPolicy: { network: false, filesystem: 'read-only' },
      status: 'active',
    })
    const httpServer = createMockMcpServer({
      serverId: 'http-server',
      baseUrl: 'https://mcp.example.test/rpc',
      configType: 'http',
      trustLevel: 'trusted',
      sandboxPolicy: { network: true },
      status: 'active',
    })

    registry.registerServer(stdioServer)
    registry.registerServer(httpServer)

    expect(registry.getServer('stdio-server')).toMatchObject({
      serverId: 'stdio-server',
      configType: 'stdio',
      command: 'node',
      args: ['server.js', '--stdio'],
      trustLevel: 'verified',
      sandboxPolicy: { network: false, filesystem: 'read-only' },
      status: 'active',
    })
    expect(registry.getServer('http-server')).toMatchObject({
      serverId: 'http-server',
      baseUrl: 'https://mcp.example.test/rpc',
      configType: 'http',
      trustLevel: 'trusted',
      sandboxPolicy: { network: true },
      status: 'active',
    })
    expect(registry.listServers()).toHaveLength(2)

    registry.disableServer('stdio-server')
    expect(registry.getServer('stdio-server')?.status).toBe('inactive')
  })

  it('streamable_http config validates and stores correctly', () => {
    const server = createMockMcpServer({
      serverId: 'amap-server',
      baseUrl: 'https://mcp.amap.com/sse',
      configType: 'streamable_http',
      trustLevel: 'verified',
      status: 'active',
    })

    registry.registerServer(server)

    const stored = registry.getServer('amap-server')
    expect(stored).toMatchObject({
      serverId: 'amap-server',
      configType: 'streamable_http',
      baseUrl: 'https://mcp.amap.com/sse',
      trustLevel: 'verified',
      status: 'active',
    })
  })

  it('streamable_http rejects invalid baseUrl', () => {
    const server = createMockMcpServer({
      serverId: 'bad-url',
      baseUrl: 'not-a-url',
      configType: 'streamable_http',
    })

    expect(() => registry.registerServer(server)).toThrow('MCP streamable_http server requires a valid http(s) baseUrl')
  })

  it('streamable_http rejects non-http protocol', () => {
    const server = createMockMcpServer({
      serverId: 'ftp-server',
      baseUrl: 'ftp://files.example.com/mcp',
      configType: 'streamable_http',
    })

    expect(() => registry.registerServer(server)).toThrow('MCP streamable_http server requires a valid http(s) baseUrl')
  })

  it('baseUrl with key= query param is redacted before storage', () => {
    const server = createMockMcpServer({
      serverId: 'amap-with-key',
      baseUrl: 'https://mcp.amap.com/sse?key=SECRET_API_KEY_123',
      configType: 'streamable_http',
    })

    registry.registerServer(server)

    const stored = registry.getServer('amap-with-key')
    expect(stored?.baseUrl).toBe('https://mcp.amap.com/sse')
    expect(stored?.baseUrl).not.toContain('SECRET_API_KEY')
    expect(stored?.baseUrl).not.toContain('key=')
  })

  it('baseUrl with api_key= query param is redacted before storage', () => {
    const server = createMockMcpServer({
      serverId: 'api-key-test',
      baseUrl: 'https://mcp.example.com/rpc?api_key=MY_SECRET&foo=bar',
      configType: 'http',
    })

    registry.registerServer(server)

    const stored = registry.getServer('api-key-test')
    expect(stored?.baseUrl).toBe('https://mcp.example.com/rpc?foo=bar')
    expect(stored?.baseUrl).not.toContain('MY_SECRET')
  })

  it('baseUrl without secret params is stored unchanged', () => {
    const server = createMockMcpServer({
      serverId: 'clean-url',
      baseUrl: 'https://mcp.example.com/rpc?region=cn&lang=zh',
      configType: 'http',
    })

    registry.registerServer(server)

    const stored = registry.getServer('clean-url')
    expect(stored?.baseUrl).toBe('https://mcp.example.com/rpc?region=cn&lang=zh')
  })

  it('auth config round-trips without secret values', () => {
    const server = createMockMcpServer({
      serverId: 'auth-server',
      baseUrl: 'https://mcp.amap.com/sse',
      configType: 'streamable_http',
      authentication: {
        type: 'api_key',
        required: true,
        placement: 'query',
        name: 'key',
        envVar: 'AMAP_API_KEY',
        tokenRef: 'vault://secret/amap-key',
      },
    })

    registry.registerServer(server)

    const stored = registry.getServer('auth-server')
    expect(stored?.authentication).toEqual({
      type: 'api_key',
      required: true,
      placement: 'query',
      name: 'key',
      envVar: 'AMAP_API_KEY',
      tokenRef: 'vault://secret/amap-key',
    })
    // Auth config should never contain the actual secret value
    expect(JSON.stringify(stored?.authentication)).not.toContain('SECRET')
  })

  it('auth config with bearer type round-trips correctly', () => {
    const server = createMockMcpServer({
      serverId: 'bearer-server',
      baseUrl: 'https://mcp.example.com/rpc',
      configType: 'http',
      authentication: {
        type: 'bearer',
        required: true,
        placement: 'header',
        envVar: 'MCP_BEARER_TOKEN',
      },
    })

    registry.registerServer(server)

    const stored = registry.getServer('bearer-server')
    expect(stored?.authentication).toEqual({
      type: 'bearer',
      required: true,
      placement: 'header',
      envVar: 'MCP_BEARER_TOKEN',
    })
  })

  it('server without auth config stores authentication as undefined', () => {
    const server = createMockMcpServer({
      serverId: 'no-auth',
      baseUrl: 'https://mcp.example.com/rpc',
      configType: 'http',
      authentication: undefined,
    })

    registry.registerServer(server)

    const stored = registry.getServer('no-auth')
    expect(stored?.authentication).toBeUndefined()
  })

  it('update preserves auth config on conflict', () => {
    const server = createMockMcpServer({
      serverId: 'update-auth',
      baseUrl: 'https://mcp.amap.com/sse',
      configType: 'streamable_http',
      authentication: {
        type: 'api_key',
        required: true,
        placement: 'query',
        name: 'key',
        envVar: 'AMAP_API_KEY',
      },
    })

    registry.registerServer(server)

    const updated = createMockMcpServer({
      serverId: 'update-auth',
      baseUrl: 'https://mcp.amap.com/v2/sse',
      configType: 'streamable_http',
      authentication: {
        type: 'api_key',
        required: true,
        placement: 'query',
        name: 'key',
        envVar: 'AMAP_API_KEY_V2',
      },
    })

    registry.registerServer(updated)

    const stored = registry.getServer('update-auth')
    expect(stored?.baseUrl).toBe('https://mcp.amap.com/v2/sse')
    expect(stored?.authentication?.envVar).toBe('AMAP_API_KEY_V2')
  })

  it('listServers returns all config types', () => {
    registry.registerServer(
      createMockMcpServer({ serverId: 's1', baseUrl: 'stdio://local', configType: 'stdio', command: 'node' }),
    )
    registry.registerServer(
      createMockMcpServer({ serverId: 's2', baseUrl: 'https://a.com', configType: 'http' }),
    )
    registry.registerServer(
      createMockMcpServer({ serverId: 's3', baseUrl: 'https://b.com', configType: 'streamable_http' }),
    )

    const all = registry.listServers()
    expect(all).toHaveLength(3)
    expect(all.map((s) => s.configType).sort()).toEqual(['http', 'stdio', 'streamable_http'])
  })
})

describe('redactSecretParams', () => {
  it('strips key param from URL', () => {
    expect(redactSecretParams('https://mcp.amap.com/sse?key=SECRET')).toBe('https://mcp.amap.com/sse')
  })

  it('strips api_key param from URL', () => {
    expect(redactSecretParams('https://example.com/rpc?api_key=SECRET&foo=bar')).toBe(
      'https://example.com/rpc?foo=bar',
    )
  })

  it('strips multiple secret params', () => {
    expect(redactSecretParams('https://example.com/rpc?key=A&token=B&safe=c')).toBe(
      'https://example.com/rpc?safe=c',
    )
  })

  it('preserves URL without secret params', () => {
    expect(redactSecretParams('https://example.com/rpc?region=cn')).toBe('https://example.com/rpc?region=cn')
  })

  it('returns invalid URL unchanged', () => {
    expect(redactSecretParams('not-a-url')).toBe('not-a-url')
  })

  it('strips access_token param', () => {
    expect(redactSecretParams('https://example.com/rpc?access_token=TOKEN&v=2')).toBe(
      'https://example.com/rpc?v=2',
    )
  })
})
