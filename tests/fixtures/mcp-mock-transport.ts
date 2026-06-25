/**
 * MCP Mock Transport
 *
 * Mock MCP transport implementation for testing. Provides deterministic
 * tool execution without real MCP servers.
 */

import type { MCPToolDescriptor } from '../../src/connectors/types.js'
import { MOCK_MCP_TOOLS } from './mcp-mock-tools.js'

export interface MockMcpTransportConfig {
  serverId?: string
  name?: string
  version?: string
  tools?: MCPToolDescriptor[]
  connectionDelay?: number
  failOnConnect?: boolean
}

export class MockMcpTransport {
  private config: Required<MockMcpTransportConfig>
  private connected: boolean = false
  private callHistory: Array<{ toolName: string; args: unknown; result: unknown }> = []

  constructor(config: MockMcpTransportConfig = {}) {
    this.config = {
      serverId: config.serverId ?? 'mock_mcp_server',
      name: config.name ?? 'Mock MCP Server',
      version: config.version ?? '1.0.0',
      tools: config.tools ?? MOCK_MCP_TOOLS,
      connectionDelay: config.connectionDelay ?? 0,
      failOnConnect: config.failOnConnect ?? false,
    }
  }

  async connect(): Promise<void> {
    if (this.config.connectionDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.connectionDelay))
    }
    if (this.config.failOnConnect) {
      throw new Error('Mock connection failure')
    }
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    this.ensureConnected()
    return [...this.config.tools]
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected()

    const tool = this.config.tools.find((t) => t.name === toolName)
    if (!tool) {
      return {
        isError: true,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${toolName}`,
        },
      }
    }

    const result = this.executeMockTool(toolName, args)
    this.callHistory.push({ toolName, args, result })
    return result
  }

  getCallHistory(): Array<{ toolName: string; args: unknown; result: unknown }> {
    return [...this.callHistory]
  }

  clearCallHistory(): void {
    this.callHistory = []
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }
  }

  private executeMockTool(toolName: string, args: Record<string, unknown>): unknown {
    switch (toolName) {
      case 'read_file':
        return {
          content: `Mock content of ${(args.path as string) ?? 'unknown'}`,
          encoding: 'utf-8',
        }
      case 'write_file':
        return {
          bytesWritten: typeof args.content === 'string' ? args.content.length : 0,
        }
      case 'list_directory':
        return {
          entries: [
            { name: 'file1.txt', type: 'file', size: 100 },
            { name: 'file2.txt', type: 'file', size: 200 },
            { name: 'subdir', type: 'directory', size: 0 },
          ],
        }
      case 'execute_command':
        return {
          stdout: `Mock output for: ${(args.command as string) ?? 'unknown'}`,
          stderr: '',
          exitCode: 0,
        }
      default:
        return {
          result: `Mock result for ${toolName}`,
        }
    }
  }
}
