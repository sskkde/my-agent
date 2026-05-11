import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js';
import { McpToolBridge } from '../../../src/connectors/mcp/mcp-tool-bridge.js';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import type { ToolRegistry } from '../../../src/tools/types.js';
import { MockMcpTransport, createMockMcpToolDescriptor } from '../../fixtures/phase3-mock-mcp.js';

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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
};

describe('McpToolBridge', () => {
  let connection: ConnectionManager;
  let manager: McpSessionManager;
  let transport: MockMcpTransport;
  let registry: ToolRegistry;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    createMcpSessionTable(connection);
    transport = new MockMcpTransport({
      serverId: 'mock',
      tools: [createMockMcpToolDescriptor({
        toolId: 'mcp_echo',
        name: 'echo',
        description: 'Echo phase 3 message',
      })],
    });
    manager = createMcpSessionManager(connection, new Map([['mock', transport]]));
    registry = createToolRegistry();
  });

  afterEach(() => {
    connection.close();
  });

  it('executes discovered tool', async () => {
    const session = manager.openSession('mock');
    await transport.connect();
    const bridge = new McpToolBridge({
      sessionManager: manager,
      getTransport: (_sessionId, serverId) => serverId === 'mock' ? transport : undefined,
    });

    await bridge.registerTools(registry, session.sessionId);

    const tool = registry.getTool('mcp.mock.echo');
    expect(tool).not.toBeNull();
    expect(tool?.metadata?.exposureMode).toBeDefined();

    const result = await bridge.callTool(session.sessionId, 'mcp.mock.echo', { message: 'hello phase3' });

    expect(result.status).toBe('completed');
    expect(result.data).toEqual({ result: 'Mock result for echo' });
    expect(transport.getCallHistory()).toEqual([
      { toolName: 'echo', args: { message: 'hello phase3' }, result: { result: 'Mock result for echo' } },
    ]);
  });

  it('normalizes timeout, cancellation, and disconnect failures', async () => {
    const slowTransport = new MockMcpTransport({
      serverId: 'mock',
      tools: [createMockMcpToolDescriptor({ name: 'echo' })],
    });
    await slowTransport.connect();
    const session = manager.openSession('mock');
    const bridge = new McpToolBridge({
      sessionManager: manager,
      timeoutMs: 1,
      getTransport: () => ({
        listTools: () => slowTransport.listTools(),
        callTool: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 50)),
      }),
    });

    await expect(bridge.callTool(session.sessionId, 'mcp.mock.echo', {})).resolves.toMatchObject({
      status: 'timeout',
      error: { code: 'connector_timeout' },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(bridge.callTool(session.sessionId, 'mcp.mock.echo', {}, { signal: controller.signal })).resolves.toMatchObject({
      status: 'cancelled',
      synthetic: true,
    });

    manager.closeSession(session.sessionId);
    await expect(bridge.callTool(session.sessionId, 'mcp.mock.echo', {})).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'mcp_session_disconnected', recoverable: true },
    });
  });
});
