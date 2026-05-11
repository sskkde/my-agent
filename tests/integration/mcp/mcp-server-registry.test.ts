import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMcpServerRegistry, type McpServerRegistry } from '../../../src/connectors/mcp/mcp-server-registry.js';
import { createMockMcpServer } from '../../fixtures/phase3-mock-mcp.js';

const createMcpTables = (connection: ConnectionManager): void => {
  connection.exec(`CREATE TABLE mcp_servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    base_url TEXT NOT NULL,
    config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http')),
    command TEXT,
    args TEXT,
    trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
    sandbox_policy TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
};

describe('McpServerRegistry', () => {
  let connection: ConnectionManager;
  let registry: McpServerRegistry;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    createMcpTables(connection);
    registry = createMcpServerRegistry(connection);
  });

  afterEach(() => {
    connection.close();
  });

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
    });
    const httpServer = createMockMcpServer({
      serverId: 'http-server',
      baseUrl: 'https://mcp.example.test/rpc',
      configType: 'http',
      trustLevel: 'trusted',
      sandboxPolicy: { network: true },
      status: 'active',
    });

    registry.registerServer(stdioServer);
    registry.registerServer(httpServer);

    expect(registry.getServer('stdio-server')).toMatchObject({
      serverId: 'stdio-server',
      configType: 'stdio',
      command: 'node',
      args: ['server.js', '--stdio'],
      trustLevel: 'verified',
      sandboxPolicy: { network: false, filesystem: 'read-only' },
      status: 'active',
    });
    expect(registry.getServer('http-server')).toMatchObject({
      serverId: 'http-server',
      baseUrl: 'https://mcp.example.test/rpc',
      configType: 'http',
      trustLevel: 'trusted',
      sandboxPolicy: { network: true },
      status: 'active',
    });
    expect(registry.listServers()).toHaveLength(2);

    registry.disableServer('stdio-server');
    expect(registry.getServer('stdio-server')?.status).toBe('inactive');
  });
});
