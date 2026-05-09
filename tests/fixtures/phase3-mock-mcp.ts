/**
 * Phase 3 Mock MCP
 *
 * Mock MCP (Model Context Protocol) server and session descriptors for testing.
 * Provides deterministic tool descriptors and responses without real MCP servers.
 *
 * Usage:
 * ```typescript
 * import { MockMcpTransport, createMockMcpServer } from '../fixtures/phase3-mock-mcp.js';
 *
 * const transport = new MockMcpTransport();
 * const tools = await transport.listTools();
 * const result = await transport.callTool('read_file', { path: '/test.txt' });
 * ```
 */

import type {
  MCPServerDefinition,
  MCPSession,
  MCPToolDescriptor,
} from '../../src/connectors/types.js';

// ============================================================================
// Mock MCP Tool Definitions
// ============================================================================

export const MOCK_MCP_TOOLS: MCPToolDescriptor[] = [
  {
    toolId: 'mcp_read_file',
    name: 'read_file',
    description: 'Read contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        encoding: { type: 'string' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    toolId: 'mcp_write_file',
    name: 'write_file',
    description: 'Write contents to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        bytesWritten: { type: 'number' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    toolId: 'mcp_list_directory',
    name: 'list_directory',
    description: 'List contents of a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              size: { type: 'number' },
            },
          },
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    toolId: 'mcp_execute_command',
    name: 'execute_command',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        stdout: { type: 'string' },
        stderr: { type: 'string' },
        exitCode: { type: 'number' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
];

// ============================================================================
// Mock MCP Transport
// ============================================================================

export interface MockMcpTransportConfig {
  serverId?: string;
  name?: string;
  version?: string;
  tools?: MCPToolDescriptor[];
  connectionDelay?: number;
  failOnConnect?: boolean;
}

export class MockMcpTransport {
  private config: Required<MockMcpTransportConfig>;
  private connected: boolean = false;
  private callHistory: Array<{ toolName: string; args: unknown; result: unknown }> = [];

  constructor(config: MockMcpTransportConfig = {}) {
    this.config = {
      serverId: config.serverId ?? 'mock_mcp_server',
      name: config.name ?? 'Mock MCP Server',
      version: config.version ?? '1.0.0',
      tools: config.tools ?? MOCK_MCP_TOOLS,
      connectionDelay: config.connectionDelay ?? 0,
      failOnConnect: config.failOnConnect ?? false,
    };
  }

  async connect(): Promise<void> {
    if (this.config.connectionDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.connectionDelay));
    }
    if (this.config.failOnConnect) {
      throw new Error('Mock connection failure');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    this.ensureConnected();
    return [...this.config.tools];
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected();

    const tool = this.config.tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        isError: true,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${toolName}`,
        },
      };
    }

    const result = this.executeMockTool(toolName, args);
    this.callHistory.push({ toolName, args, result });
    return result;
  }

  getCallHistory(): Array<{ toolName: string; args: unknown; result: unknown }> {
    return [...this.callHistory];
  }

  clearCallHistory(): void {
    this.callHistory = [];
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
  }

  private executeMockTool(toolName: string, args: Record<string, unknown>): unknown {
    switch (toolName) {
      case 'read_file':
        return {
          content: `Mock content of ${(args.path as string) ?? 'unknown'}`,
          encoding: 'utf-8',
        };
      case 'write_file':
        return {
          bytesWritten: typeof args.content === 'string' ? args.content.length : 0,
        };
      case 'list_directory':
        return {
          entries: [
            { name: 'file1.txt', type: 'file', size: 100 },
            { name: 'file2.txt', type: 'file', size: 200 },
            { name: 'subdir', type: 'directory', size: 0 },
          ],
        };
      case 'execute_command':
        return {
          stdout: `Mock output for: ${(args.command as string) ?? 'unknown'}`,
          stderr: '',
          exitCode: 0,
        };
      default:
        return {
          result: `Mock result for ${toolName}`,
        };
    }
  }
}

// ============================================================================
// Mock MCP Server Definition Factory
// ============================================================================

export function createMockMcpServer(overrides?: Partial<MCPServerDefinition>): MCPServerDefinition {
  const now = new Date().toISOString();
  return {
    serverId: 'mock_mcp_server',
    name: 'Mock MCP Server',
    version: '1.0.0',
    description: 'A mock MCP server for testing',
    baseUrl: 'mock://localhost/mcp',
    authentication: {
      type: 'bearer',
      required: false,
    },
    capabilities: ['tools', 'resources'],
    supportedFormats: ['json'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Mock MCP Session Factory
// ============================================================================

export function createMockMcpSession(overrides?: Partial<MCPSession>): MCPSession {
  const now = new Date().toISOString();
  return {
    sessionId: 'mock_mcp_session',
    serverId: 'mock_mcp_server',
    connectorInstanceId: 'mock_connector_instance',
    status: 'connected',
    authTokenRef: 'mock_auth_token_ref',
    metadata: {},
    connectedAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

// ============================================================================
// Mock MCP Tool Descriptor Factory
// ============================================================================

export function createMockMcpToolDescriptor(
  overrides?: Partial<MCPToolDescriptor>
): MCPToolDescriptor {
  return {
    toolId: 'mock_tool',
    name: 'mock_tool',
    description: 'A mock tool for testing',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        output: { type: 'string' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    ...overrides,
  };
}

// ============================================================================
// Complete Mock MCP Setup
// ============================================================================

export interface MockMcpSetup {
  server: MCPServerDefinition;
  session: MCPSession;
  transport: MockMcpTransport;
  tools: MCPToolDescriptor[];
}

export function createMockMcpSetup(config?: MockMcpTransportConfig): MockMcpSetup {
  const transport = new MockMcpTransport(config);
  const server = createMockMcpServer({
    serverId: config?.serverId,
    name: config?.name,
    version: config?.version,
  });
  const session = createMockMcpSession({
    serverId: server.serverId,
  });

  return {
    server,
    session,
    transport,
    tools: config?.tools ?? MOCK_MCP_TOOLS,
  };
}

// ============================================================================
// Pre-configured Mock MCP Setups
// ============================================================================

export function createFileSystemMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'filesystem_mcp',
    name: 'Filesystem MCP Server',
    tools: MOCK_MCP_TOOLS.filter(t =>
      ['read_file', 'write_file', 'list_directory'].includes(t.name)
    ),
  });
}

export function createCommandMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'command_mcp',
    name: 'Command Execution MCP Server',
    tools: MOCK_MCP_TOOLS.filter(t => t.name === 'execute_command'),
  });
}

export function createFullMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'full_mcp',
    name: 'Full MCP Server',
    tools: MOCK_MCP_TOOLS,
  });
}
