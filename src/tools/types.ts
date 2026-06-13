// Tool Plane Types
// Based on tool plane responsibilities for registry, schema validation, and execution

import type { RuntimeContextDelta } from '../context/types.js'
import type { PermissionDecision, PermissionContext as PermContext } from '../permissions/types.js'
import type { TraceStore } from '../observability/types.js'
import type { AuditRecorder } from '../observability/audit-types.js'

export type PermissionContext = PermContext

// Tool Categories for classification and permission handling
export type ToolCategory =
  | 'read' // Read-only operations (files, data, status)
  | 'write' // Write operations (create, update)
  | 'delete' // Delete operations
  | 'send' // Send outbound messages/notifications
  | 'automation' // Browser/UI/system automation
  | 'execute' // Execute commands, scripts
  | 'search' // Search operations
  | 'admin' // Administrative operations
  | 'connector' // Connector-specific operations
  | 'internal' // Internal system tools;

// Tool Sensitivity Levels
export type ToolSensitivity = 'low' | 'medium' | 'high' | 'restricted'

// JSON Schema type for tool input validation
export interface ToolSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  description?: string
}

// Tool Definition for registration
export interface ToolDefinition {
  name: string
  description: string
  category: ToolCategory
  sensitivity: ToolSensitivity
  schema: ToolSchema
  handler: ToolHandler
  requiresPermission?: boolean // Explicit permission requirement override
  idempotent?: boolean
  metadata?: Record<string, unknown>
}

// Tool handler function type
export type ToolHandler = (
  params: unknown,
  context: ToolExecutionContext,
) => Promise<ToolExecutionResult> | ToolExecutionResult

// Context provided to tool execution
export interface ToolExecutionContext {
  toolCallId: string
  toolName: string
  userId: string
  sessionId?: string
  kernelRunId?: string
  permissionContext: PermissionContext
  executionStartTime: string
  signal?: AbortSignal
  // Access to stores (injected by executor)
  stores: {
    toolExecutionStore: {
      updateStatus: (toolCallId: string, status: string, errorMessage?: string) => void
      saveResult: (
        toolCallId: string,
        result: {
          preview?: string
          resultRef?: string
          structuredContent?: Record<string, unknown>
        },
      ) => void
    }
  }
}

// Tool execution result
export interface ToolExecutionResult {
  success: boolean
  status?: 'cancelled' | 'timeout' | 'skipped'
  synthetic?: boolean
  data?: unknown
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
  // Context updates to emit
  contextDelta?: RuntimeContextDelta
  // Result reference for storage
  resultRef?: string
  // Human-readable preview
  resultPreview?: string
  // Structured content for LLM consumption
  structuredContent?: Record<string, unknown>
  // Event to emit for observability
  events?: ToolExecutionEvent[]
}

// Tool execution event for observability
export interface ToolExecutionEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
}

// Tool registration options
export interface ToolRegistrationOptions {
  overwriteExisting?: boolean
}

// Tool registry interface
export interface ToolRegistry {
  register(definition: ToolDefinition, options?: ToolRegistrationOptions): void
  getTool(name: string): ToolDefinition | null
  listTools(): ToolDefinition[]
  listToolsByCategory(category: ToolCategory): ToolDefinition[]
  unregister(name: string): boolean
  hasTool(name: string): boolean
}

// Tool execution request
export interface ToolExecutionRequest {
  toolCallId: string
  toolName: string
  params: unknown
  userId: string
  sessionId?: string
  kernelRunId?: string
  permissionContext: PermissionContext
  signal?: AbortSignal
}

// Tool execution status
export type ToolExecutionStatus =
  | 'pending'
  | 'validating'
  | 'checking_permission'
  | 'waiting_for_approval'
  | 'denied'
  | 'executing'
  | 'completed'
  | 'failed'

// Tool executor interface
export interface ToolExecutor {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResult>
}

// Tool executor configuration
export interface ToolExecutorConfig {
  registry: ToolRegistry
  permissionEngine: {
    checkPermission: (request: {
      context: PermissionContext
      actionType: string
      resource?: string
      operationType: 'read' | 'write' | 'execute' | 'delete' | 'admin'
      justification?: string
    }) => PermissionDecision
  }
  toolExecutionStore: {
    create: (exec: {
      toolCallId: string
      toolName: string
      userId: string
      sessionId?: string
      kernelRunId?: string
      status: string
      params?: unknown
      sensitivity: string
      errorMessage?: string
    }) => void
    updateStatus: (toolCallId: string, status: string, tenantId?: string, errorMessage?: string) => void
    saveResult: (
      toolCallId: string,
      result: {
        preview?: string
        resultRef?: string
        structuredContent?: Record<string, unknown>
      },
    ) => void
  }
  eventStore?: {
    append: (event: unknown | unknown[]) => void
  }
  contextManager?: {
    applyDelta: (delta: RuntimeContextDelta) => void
  }
  traceStore?: TraceStore
  auditRecorder?: AuditRecorder
}

// Tool pool for kernel context
export interface ToolPool {
  tools: ToolDefinition[]
  metadata: {
    assembledAt: string
    runId: string
    categoryCounts: Record<ToolCategory, number>
  }
}

// Tool assembly options
export interface ToolPoolAssemblyOptions {
  includeCategories?: ToolCategory[]
  excludeTools?: string[]
  maxTools?: number
  permissionMode?: string
}

// Schema validation result
export interface SchemaValidationResult {
  valid: boolean
  errors?: string[]
}

// Tool context delta for context manager integration
export type ToolContextDelta = RuntimeContextDelta

// Error codes for tool execution
export const TOOL_ERROR_CODES = {
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

// Tool execution error
export class ToolExecutionError extends Error {
  constructor(
    public code: string,
    message: string,
    public recoverable: boolean = false,
  ) {
    super(message)
    this.name = 'ToolExecutionError'
  }
}
