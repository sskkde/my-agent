// Connector Runtime Types
// Based on connector runtime responsibilities for managing external integrations

import type { ToolDefinition, ToolCategory, ToolSensitivity } from '../tools/types.js'
import type {
  ConnectorDefinition as StoreConnectorDefinition,
  ConnectorInstance as StoreConnectorInstance,
  ConnectorType,
  ConnectorStatus,
} from '../storage/connector-store.js'
import type { TraceStore } from '../observability/types.js'
import type { AuditRecorder } from '../observability/audit-types.js'

// Re-export from storage for convenience
export type { ConnectorType, ConnectorStatus }
export type { StoreConnectorDefinition as ConnectorDefinition, StoreConnectorInstance as ConnectorInstance }

// Connector Capability - describes what a connector can do
export interface ConnectorCapability {
  capabilityId: string
  name: string
  description: string
  category: ToolCategory
  riskLevel: ToolSensitivity
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  rateLimitInfo?: {
    requestsPerSecond?: number
    requestsPerMinute?: number
    requestsPerHour?: number
  }
  requiresAuth: boolean
  supportedOperations: string[]
}

// Connector Call Request - request to execute a connector operation
export interface ConnectorCallRequest {
  requestId: string
  connectorInstanceId: string
  capabilityId: string
  operation: string
  params: Record<string, unknown>
  userId: string
  sessionId?: string
  correlationId?: string
  timeoutMs?: number
}

// Connector Response Status
export type ConnectorResponseStatus =
  | 'success'
  | 'started_async'
  | 'partial_success'
  | 'auth_required'
  | 'permission_denied'
  | 'rate_limited'
  | 'failed'
  | 'timeout'
  | 'cancelled'

// Connector Response - result of a connector call
export interface ConnectorResponse {
  status: ConnectorResponseStatus
  requestId: string
  connectorInstanceId: string
  data?: unknown
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
  metadata?: {
    rateLimitRemaining?: number
    rateLimitResetAt?: string
    retryAfterMs?: number
    operationId?: string
  }
}

// Async Operation Reference - returned when operation is async
export interface AsyncOperationRef {
  operationId: string
  connectorInstanceId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  result?: ConnectorResponse
}

// Connector Tool Bridge - bridges connector capabilities to tools
export interface ConnectorToolBridge {
  bridgeCapabilityToToolDefinition(capability: ConnectorCapability): ToolDefinition
  determineToolCategory(capability: ConnectorCapability): ToolCategory
  determineRiskLevel(capability: ConnectorCapability): ToolSensitivity
}

// MCP Server Definition - Model Context Protocol server metadata
export interface MCPServerDefinition {
  serverId: string
  name: string
  version: string
  description?: string
  baseUrl: string
  configType?: 'stdio' | 'http'
  command?: string
  args?: string[]
  authentication?: {
    type: 'bearer' | 'api_key' | 'oauth2'
    required: boolean
  }
  capabilities: string[]
  supportedFormats: string[]
  trustLevel?: 'trusted' | 'verified' | 'untrusted'
  sandboxPolicy?: Record<string, unknown>
  status?: 'active' | 'inactive' | 'error'
  createdAt: string
  updatedAt: string
}

// MCP Session - active session with an MCP server
export interface MCPSession {
  sessionId: string
  serverId: string
  connectorInstanceId?: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'active' | 'unhealthy' | 'closed'
  authTokenRef?: string
  metadata?: Record<string, unknown>
  lastError?: string
  lastHealthCheck?: string
  connectedAt?: string
  lastActivityAt?: string
  disconnectedAt?: string
  createdAt?: string
  updatedAt?: string
}

export type McpSession = MCPSession

// MCP Tool Descriptor - tool schema from MCP server
export interface MCPToolDescriptor {
  toolId: string
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  outputSchema?: {
    type: 'object'
    properties: Record<string, unknown>
  }
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
  }
}

// Connector Runtime Configuration
export interface ConnectorRuntimeConfig {
  connectorStore: {
    createDefinition(data: Omit<StoreConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>): StoreConnectorDefinition
    findDefinitionById(id: string): StoreConnectorDefinition | undefined
    findDefinitionByConnectorId(connectorId: string): StoreConnectorDefinition | undefined
    createInstance(data: Omit<StoreConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>): StoreConnectorInstance
    findInstanceById(id: string): StoreConnectorInstance | undefined
    updateInstance(
      id: string,
      data: Partial<Omit<StoreConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>>,
    ): StoreConnectorInstance | undefined
  }
  toolBridge: ConnectorToolBridge
  eventStore?: {
    append(event: unknown | unknown[]): void
  }
  traceStore?: TraceStore
  auditRecorder?: AuditRecorder
}

// Connector Runtime Interface
export interface ConnectorRuntime {
  // Definition management
  registerDefinition(def: Omit<StoreConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'>): StoreConnectorDefinition

  // Instance management
  createInstance(instance: Omit<StoreConnectorInstance, 'id' | 'createdAt' | 'updatedAt'>): StoreConnectorInstance

  // Capability discovery
  discoverCapabilities(connectorInstanceId: string): ConnectorCapability[]

  // Execution
  executeCall(request: ConnectorCallRequest): Promise<ConnectorResponse | AsyncOperationRef>

  // Response normalization
  normalizeResponse(raw: unknown, requestId?: string, connectorInstanceId?: string): ConnectorResponse
}

// Connector Adapter - interface for actual connector implementations
export interface ConnectorAdapter {
  execute(instance: StoreConnectorInstance, request: ConnectorCallRequest): Promise<unknown>
  discoverCapabilities(instance: StoreConnectorInstance): ConnectorCapability[]
  checkHealth(instance: StoreConnectorInstance): { healthy: boolean; message?: string }
}

// Connector Registry - manages connector adapters
export interface ConnectorAdapterRegistry {
  register(connectorType: string, adapter: ConnectorAdapter): void
  getAdapter(connectorType: string): ConnectorAdapter | undefined
  unregister(connectorType: string): void
  listAdapters(): string[]
}

// Event types for connector events
export type ConnectorEventType =
  | 'connector_definition_registered'
  | 'connector_instance_created'
  | 'connector_call_executed'
  | 'connector_call_failed'
  | 'connector_auth_required'
  | 'connector_rate_limited'
  | 'connector_async_started'
  | 'connector_async_completed'
  | 'connector_capability_discovered'
  | 'mcp_session_connected'
  | 'mcp_session_disconnected'
  | 'mcp_tool_invoked'

// Connector Event Payload
export interface ConnectorEventPayload {
  connectorInstanceId: string
  userId?: string
  sessionId?: string
  capabilityId?: string
  operation?: string
  status?: ConnectorResponseStatus
  errorCode?: string
  metadata?: Record<string, unknown>
}

// Health check result
export interface ConnectorHealthResult {
  healthy: boolean
  status: ConnectorStatus
  lastCheckedAt: string
  message?: string
  latencyMs?: number
}
