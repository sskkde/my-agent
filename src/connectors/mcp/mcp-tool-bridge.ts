import type { MCPToolDescriptor, ConnectorResponse } from '../types.js'
import type { McpSessionManager } from './mcp-session-manager.js'
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult, ToolRegistry } from '../../tools/types.js'
import type { ToolSchemaProvider } from '../../tools/schema/tool-schema-provider.js'
import { createToolSchemaProvider } from '../../tools/schema/tool-schema-provider.js'
import { sanitizeToolName } from '../../tools/tool-name.js'
import {
  createCancelledResponse,
  createTimeoutResponse,
  normalizeConnectorResponse,
  type NormalizedConnectorResult,
} from '../runtime/connector-response-normalizer.js'
import type { AuditRecorder } from '../../observability/audit-types.js'
import { redactMcpConfig, redactMcpErrorMessage } from './mcp-secret-redaction.js'

export interface McpToolTransport {
  listTools(): Promise<MCPToolDescriptor[]> | MCPToolDescriptor[]
  callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> | unknown
}

export interface McpToolBridgeOptions {
  sessionManager: McpSessionManager
  getTransport(sessionId: string, serverId: string): McpToolTransport | undefined
  schemaProvider?: ToolSchemaProvider
  timeoutMs?: number
  auditRecorder?: AuditRecorder
  defaultUserId?: string
}

interface CallOptions {
  signal?: AbortSignal
  userId?: string
  executionSessionId?: string
  toolCallId?: string
}

const DEFAULT_TIMEOUT_MS = 30_000

export class McpToolBridge {
  private readonly sessionManager: McpSessionManager
  private readonly getTransport: (sessionId: string, serverId: string) => McpToolTransport | undefined
  private readonly schemaProvider: ToolSchemaProvider
  private readonly timeoutMs: number
  private readonly auditRecorder?: AuditRecorder
  private readonly defaultUserId: string
  private readonly registeredBySession = new Map<string, string[]>()
  private readonly bridgedToRaw = new Map<string, string>()

  constructor(options: McpToolBridgeOptions) {
    this.sessionManager = options.sessionManager
    this.getTransport = options.getTransport
    this.schemaProvider = options.schemaProvider ?? createToolSchemaProvider()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.auditRecorder = options.auditRecorder
    this.defaultUserId = options.defaultUserId ?? 'system'
  }

  async discoverTools(sessionId: string): Promise<ToolDefinition[]> {
    const session = this.requireHealthySession(sessionId)
    const transport = this.requireTransport(session.sessionId, session.serverId)
    const descriptors = await transport.listTools()
    return descriptors.map((descriptor) =>
      this.descriptorToToolDefinition(session.sessionId, session.serverId, descriptor),
    )
  }

  async registerTools(registry: ToolRegistry, sessionId: string): Promise<void> {
    const tools = await this.discoverTools(sessionId)
    for (const tool of tools) {
      registry.register(tool, { overwriteExisting: true })
    }
    this.registeredBySession.set(
      sessionId,
      tools.map((tool) => tool.name),
    )
  }

  unregisterTools(registry: ToolRegistry, sessionId: string): void {
    const names = this.registeredBySession.get(sessionId) ?? []
    for (const name of names) {
      registry.unregister(name)
    }
    this.registeredBySession.delete(sessionId)
  }

  async callTool(
    sessionId: string,
    toolName: string,
    params: Record<string, unknown>,
    options: CallOptions = {},
  ): Promise<NormalizedConnectorResult> {
    const session = this.sessionManager.getSession(sessionId)
    const requestId = options.toolCallId ?? crypto.randomUUID()
    const connectorInstanceId = session?.connectorInstanceId ?? `mcp.${session?.serverId ?? 'unknown'}`

    if (!session || !this.isHealthyStatus(session.status)) {
      const normalized = normalizeConnectorResponse({
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'mcp_session_disconnected',
          message: 'MCP session is disconnected or unhealthy. Reconnect the MCP server and retry.',
          recoverable: true,
        },
      })
      this.auditToolCall(toolName, params, normalized, options, requestId)
      return normalized
    }

    const transport = this.getTransport(session.sessionId, session.serverId)
    if (!transport) {
      const normalized = normalizeConnectorResponse({
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'mcp_transport_unavailable',
          message: 'MCP transport is unavailable. Reconnect the MCP server and retry.',
          recoverable: true,
        },
      })
      this.auditToolCall(toolName, params, normalized, options, requestId)
      return normalized
    }

    if (options.signal?.aborted) {
      const normalized = normalizeConnectorResponse(createCancelledResponse(requestId, connectorInstanceId))
      this.auditToolCall(toolName, params, normalized, options, requestId)
      return normalized
    }

    const rawName = this.rawToolName(session.serverId, toolName)
    const response = await this.executeWithGuards(
      transport,
      rawName,
      params,
      requestId,
      connectorInstanceId,
      options.signal,
    )
    const normalized = normalizeConnectorResponse(response)
    this.auditToolCall(toolName, params, normalized, options, requestId)
    return normalized
  }

  private descriptorToToolDefinition(
    sessionId: string,
    serverId: string,
    descriptor: MCPToolDescriptor,
  ): ToolDefinition {
    const name = this.bridgedToolName(serverId, descriptor.name)
    const isDestructive = descriptor.annotations?.destructiveHint === true
    const category = isDestructive ? 'write' : 'read'
    const sensitivity = isDestructive ? 'high' : 'medium'
    const definition: ToolDefinition = {
      name,
      description: descriptor.description,
      category,
      sensitivity,
      schema: descriptor.inputSchema,
      idempotent: descriptor.annotations?.idempotentHint ?? false,
      // destructiveHint=true must always require permission, regardless of readOnlyHint
      requiresPermission: isDestructive ? true : !descriptor.annotations?.readOnlyHint,
      metadata: {
        bridge: 'mcp',
        sessionId,
        serverId,
        rawToolName: descriptor.name,
        mcpToolId: descriptor.toolId,
        outputSchema: descriptor.outputSchema,
      },
      handler: async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
        const result = await this.callTool(sessionId, name, this.toRecord(params), {
          userId: context.userId,
          executionSessionId: context.sessionId,
          toolCallId: context.toolCallId,
        })
        return this.toToolExecutionResult(result)
      },
    }
    return {
      ...definition,
      metadata: {
        ...definition.metadata,
        exposureMode: this.schemaProvider.getExposureMode(definition),
      },
    }
  }

  private async executeWithGuards(
    transport: McpToolTransport,
    toolName: string,
    params: Record<string, unknown>,
    requestId: string,
    connectorInstanceId: string,
    signal?: AbortSignal,
  ): Promise<ConnectorResponse> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let abortHandler: (() => void) | undefined

    try {
      const call = Promise.resolve(transport.callTool(toolName, params))
      const timeout = new Promise<ConnectorResponse>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve(createTimeoutResponse(requestId, connectorInstanceId, this.timeoutMs))
        }, this.timeoutMs)
      })
      const cancellation = new Promise<ConnectorResponse>((resolve) => {
        abortHandler = () => resolve(createCancelledResponse(requestId, connectorInstanceId))
        signal?.addEventListener('abort', abortHandler, { once: true })
      })
      const raw = await Promise.race([
        call.then((value) => this.rawResultToResponse(value, requestId, connectorInstanceId)),
        timeout,
        cancellation,
      ])
      return raw
    } catch (error) {
      return {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: 'mcp_tool_call_failed',
          message: `${redactMcpErrorMessage(this.errorMessage(error))}. Reconnect the MCP server and retry if the session was interrupted.`,
          recoverable: true,
        },
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler)
      }
    }
  }

  private rawResultToResponse(raw: unknown, requestId: string, connectorInstanceId: string): ConnectorResponse {
    if (this.isMcpErrorResult(raw)) {
      return {
        status: 'failed',
        requestId,
        connectorInstanceId,
        error: {
          code: String(raw.error?.code ?? 'mcp_tool_error'),
          message: redactMcpErrorMessage(String(raw.error?.message ?? 'MCP tool returned an error')),
          recoverable: false,
        },
      }
    }
    return { status: 'success', requestId, connectorInstanceId, data: raw }
  }

  private toToolExecutionResult(result: NormalizedConnectorResult): ToolExecutionResult {
    if (result.status === 'completed') {
      return { success: true, data: result.data }
    }
    return {
      success: false,
      status: result.status === 'timeout' || result.status === 'cancelled' ? result.status : undefined,
      synthetic: result.synthetic,
      error: result.error ?? {
        code: result.status,
        message: `MCP tool execution ${result.status}`,
        recoverable: result.recoverability !== 'non_recoverable',
      },
    }
  }

  private auditToolCall(
    toolName: string,
    params: Record<string, unknown>,
    result: NormalizedConnectorResult,
    options: CallOptions,
    requestId: string,
  ): void {
    this.auditRecorder?.recordToolCall({
      toolCallId: requestId,
      toolName,
      userId: options.userId ?? this.defaultUserId,
      sessionId: options.executionSessionId,
      params: redactMcpConfig(params),
      result,
      status: result.status === 'completed' ? 'success' : 'failure',
    })
  }

  private requireHealthySession(sessionId: string) {
    const session = this.sessionManager.getSession(sessionId)
    if (!session || !this.isHealthyStatus(session.status)) {
      throw new Error(`MCP session is not healthy: ${sessionId}`)
    }
    return session
  }

  private requireTransport(sessionId: string, serverId: string): McpToolTransport {
    const transport = this.getTransport(sessionId, serverId)
    if (!transport) {
      throw new Error(`MCP transport not found for session: ${sessionId}`)
    }
    return transport
  }

  private isHealthyStatus(status: string): boolean {
    return status === 'active' || status === 'connected'
  }

  private bridgedToolName(serverId: string, toolName: string): string {
    const sanitized = sanitizeToolName(`mcp.${serverId}.${toolName}`)
    this.bridgedToRaw.set(sanitized, toolName)
    return sanitized
  }

  private rawToolName(_serverId: string, toolName: string): string {
    return this.bridgedToRaw.get(toolName) ?? toolName
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private isMcpErrorResult(value: unknown): value is { isError: true; error?: { code?: unknown; message?: unknown } } {
    return typeof value === 'object' && value !== null && (value as { isError?: unknown }).isError === true
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
