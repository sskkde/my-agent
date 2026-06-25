/**
 * MCP Mock Factories
 *
 * Factory functions for creating mock MCP server definitions, sessions,
 * and tool descriptors.
 */

import type { MCPServerDefinition, MCPSession, MCPToolDescriptor } from '../../src/connectors/types.js'

export function createMockMcpServer(overrides?: Partial<MCPServerDefinition>): MCPServerDefinition {
  const now = new Date().toISOString()
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
  }
}

export function createMockMcpSession(overrides?: Partial<MCPSession>): MCPSession {
  const now = new Date().toISOString()
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
  }
}

export function createMockMcpToolDescriptor(overrides?: Partial<MCPToolDescriptor>): MCPToolDescriptor {
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
  }
}
