/**
 * AMap Streamable HTTP MCP Transport
 *
 * Implements both {@link McpTransport} (connect/disconnect) and
 * {@link McpToolTransport} (listTools/callTool) by wrapping the MCP SDK
 * `Client` + `StreamableHTTPClientTransport`.
 *
 * The API key is injected at runtime via the URL query parameter and never
 * persisted. All error paths redact secrets before propagation.
 *
 * @module connectors/mcp/amap-streamable-http-transport
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpTransport } from './mcp-session-manager.js'
import type { McpToolTransport } from './mcp-tool-bridge.js'
import type { MCPToolDescriptor } from '../types.js'
import { redactMcpErrorMessage, redactMcpUrl } from './mcp-secret-redaction.js'

/**
 * Configuration for the AMap streamable HTTP transport.
 */
export interface AMapStreamableHttpTransportConfig {
  /** Base endpoint URL (without API key). E.g. `https://mcp.amap.com/mcp`. */
  endpoint: string
  /** AMap API key injected at runtime, never persisted. */
  apiKey: string
  /** Client identification sent during MCP handshake. */
  clientInfo?: { name: string; version: string }
  /** Timeout in ms for individual tool calls. */
  requestTimeoutMs?: number
}

const DEFAULT_CLIENT_INFO = { name: 'amap-connector', version: '1.0.0' }

/**
 * Wraps MCP SDK `Client` + `StreamableHTTPClientTransport` to provide
 * the repo-internal `McpTransport` and `McpToolTransport` interfaces.
 */
export class AMapStreamableHttpTransport implements McpTransport, McpToolTransport {
  private readonly endpoint: string
  private readonly apiKey: string
  private readonly clientInfo: { name: string; version: string }

  private client: Client | null = null
  private transport: StreamableHTTPClientTransport | null = null
  private connected = false

  constructor(config: AMapStreamableHttpTransportConfig) {
    this.endpoint = config.endpoint
    this.apiKey = config.apiKey
    this.clientInfo = config.clientInfo ?? DEFAULT_CLIENT_INFO
  }

  // ─── McpTransport ───────────────────────────────────────────────

  /**
   * Establishes connection to the AMap MCP server.
   * Idempotent: no-op if already connected.
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return
    }

    const url = this.buildUrl()

    try {
      this.transport = new StreamableHTTPClientTransport(new URL(url))
      this.client = new Client(this.clientInfo)
      await this.client.connect(this.transport)
      this.connected = true
    } catch (error) {
      this.connected = false
      this.client = null
      this.transport = null
      throw new Error(
        `AMap MCP connection failed: ${this.redactError(this.extractMessage(error))} (endpoint: ${redactMcpUrl(url)})`,
      )
    }
  }

  /**
   * Closes the MCP session and client.
   * Safe to call when not connected.
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      this.connected = false
      return
    }

    try {
      // Terminate the server-side session first (sends HTTP DELETE).
      await this.transport?.terminateSession().catch(() => {
        // Server may return 405; swallow.
      })
      await this.client.close()
    } catch (error) {
      // Disconnect must never throw — log-worthy but caller-safe.
      void error
    } finally {
      this.client = null
      this.transport = null
      this.connected = false
    }
  }

  // ─── McpToolTransport ───────────────────────────────────────────

  /**
   * Lists all tools advertised by the AMap MCP server.
   * Returns descriptors normalized to {@link MCPToolDescriptor}.
   */
  async listTools(): Promise<MCPToolDescriptor[]> {
    this.ensureConnected()

    try {
      const result = await this.client!.listTools()
      return result.tools.map((tool) => this.normalizeTool(tool))
    } catch (error) {
      throw new Error(
        `AMap MCP listTools failed: ${this.redactError(this.extractMessage(error))}`,
      )
    }
  }

  /**
   * Invokes a tool on the AMap MCP server.
   * Returns the raw SDK call result.
   */
  async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected()

    try {
      return await this.client!.callTool({ name: toolName, arguments: params })
    } catch (error) {
      throw new Error(
        `AMap MCP callTool(${toolName}) failed: ${this.redactError(this.extractMessage(error))}`,
      )
    }
  }

  // ─── Private helpers ────────────────────────────────────────────

  /**
   * Builds the full URL with API key injected as a query parameter.
   * The key never appears in persisted config or error messages.
   */
  private buildUrl(): string {
    const separator = this.endpoint.includes('?') ? '&' : '?'
    return `${this.endpoint}${separator}key=${this.apiKey}`
  }

  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('AMap MCP transport is not connected. Call connect() first.')
    }
  }

  /**
   * Normalizes an MCP SDK tool descriptor to the repo's `MCPToolDescriptor`.
   * Generates a stable `toolId` from a hash of the endpoint + tool name.
   */
  private normalizeTool(tool: {
    name: string
    description?: string
    inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] }
    outputSchema?: { type: 'object'; properties?: Record<string, object>; required?: string[] }
    annotations?: {
      readOnlyHint?: boolean
      destructiveHint?: boolean
      idempotentHint?: boolean
    }
  }): MCPToolDescriptor {
    return {
      toolId: this.generateToolId(tool.name),
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: {
        type: 'object',
        properties: (tool.inputSchema.properties ?? {}) as Record<string, unknown>,
        required: tool.inputSchema.required,
      },
      outputSchema: tool.outputSchema
        ? {
            type: 'object',
            properties: (tool.outputSchema.properties ?? {}) as Record<string, unknown>,
          }
        : undefined,
      annotations: tool.annotations
        ? {
            readOnlyHint: tool.annotations.readOnlyHint,
            destructiveHint: tool.annotations.destructiveHint,
            idempotentHint: tool.annotations.idempotentHint,
          }
        : undefined,
    }
  }

  /**
   * Generates a deterministic tool ID from a short hash of the endpoint
   * plus the tool name. Keeps IDs stable across reconnections.
   */
  private generateToolId(toolName: string): string {
    const hash = this.simpleHash(this.endpoint)
    return `${hash}.${toolName}`
  }

  /**
   * Deterministic 8-hex-char hash of a string (FNV-1a variant).
   * Not cryptographic — only needs collision avoidance for tool IDs.
   */
  private simpleHash(input: string): string {
    let hash = 0x811c_9dc5
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 0x0100_0193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  private extractMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /**
   * Defense-in-depth: strips the raw API key value from a string even if
   * the upstream redaction helpers missed it (e.g. bare `key=VALUE` without
   * URL context). Also applies the standard redaction helpers.
   */
  private redactError(message: string): string {
    let safe = message
    if (this.apiKey.length > 0 && safe.includes(this.apiKey)) {
      safe = safe.replaceAll(this.apiKey, '[REDACTED]')
    }
    return redactMcpErrorMessage(safe)
  }
}

/**
 * Factory function for creating an AMap streamable HTTP transport.
 */
export function createAMapStreamableHttpTransport(
  config: AMapStreamableHttpTransportConfig,
): AMapStreamableHttpTransport {
  return new AMapStreamableHttpTransport(config)
}
