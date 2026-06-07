import type { PermissionContext } from '../../permissions/types.js'
import type { AgentType, RuntimeContextDelta } from '../../context/types.js'

export type ToolDispatchStatus = 'completed' | 'partial' | 'failed' | 'cancelled'

export type ToolExecutionTerminalStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'aborted'
  | 'cancelled'
  | 'discarded'
  | 'timeout'

export interface ToolUseDispatchInput {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ToolDispatchRequest {
  runId: string
  userId: string
  sessionId?: string
  agentId: string
  agentType: AgentType
  assistantMessageId: string
  toolUses: ToolUseDispatchInput[]
  permissionContext: PermissionContext
  executionPolicy: ToolExecutionPolicy
  workingContextRef?: string
}

export interface ToolExecutionPolicy {
  maxConcurrency: number
  allowParallelReadOnly: boolean
  allowWriteConcurrency: boolean
  timeoutMs?: number
  abortOnSiblingFailure?: boolean
}

export interface ToolExecutionMappedResult {
  toolCallId: string
  toolName: string
  status: ToolExecutionTerminalStatus
  output?: unknown
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
  resultMessage: {
    toolCallId: string
    toolName: string
    isError: boolean
    modelFacingContent: string | Record<string, unknown>
    transcriptSummary?: string
    userVisibleSummary?: string
    persistedResultRef?: string
    structuredContent?: Record<string, unknown>
    meta?: Record<string, unknown>
  }
  contextDelta?: RuntimeContextDelta
  metrics?: {
    startedAt: string
    completedAt: string
    durationMs: number
    outputSizeBytes?: number
  }
}

export interface ToolDispatchResult {
  runId: string
  userId: string
  sessionId?: string
  agentId: string
  status: ToolDispatchStatus
  results: ToolExecutionMappedResult[]
  contextDeltas?: RuntimeContextDelta[]
  events?: ToolDispatchEvent[]
  updatedWorkingContextRef?: string
}

export interface ToolDispatchEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
}

export function createToolDispatchRequest(
  fields: Omit<ToolDispatchRequest, 'executionPolicy'> & { executionPolicy?: Partial<ToolExecutionPolicy> },
): ToolDispatchRequest {
  if (fields.toolUses.length === 0) {
    throw new Error('ToolDispatchRequest requires at least one tool use')
  }

  return {
    ...fields,
    executionPolicy: {
      maxConcurrency: fields.executionPolicy?.maxConcurrency ?? 1,
      allowParallelReadOnly: fields.executionPolicy?.allowParallelReadOnly ?? true,
      allowWriteConcurrency: fields.executionPolicy?.allowWriteConcurrency ?? false,
      ...(fields.executionPolicy?.timeoutMs !== undefined ? { timeoutMs: fields.executionPolicy.timeoutMs } : {}),
      ...(fields.executionPolicy?.abortOnSiblingFailure !== undefined
        ? { abortOnSiblingFailure: fields.executionPolicy.abortOnSiblingFailure }
        : {}),
    },
  }
}

export function createToolDispatchResult(
  fields: Omit<ToolDispatchResult, 'status'> & { status?: ToolDispatchStatus },
): ToolDispatchResult {
  const completed = fields.results.filter((result) => result.status === 'completed').length
  const failed = fields.results.length - completed
  const status = fields.status ?? (failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed')

  return {
    status,
    ...fields,
  }
}

export function isTerminalStatus(
  status: ToolDispatchStatus,
): status is Extract<ToolExecutionTerminalStatus, ToolDispatchStatus> {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function mapToTerminalStatus(status: ToolDispatchStatus): ToolExecutionTerminalStatus {
  if (isTerminalStatus(status)) return status
  if (status === 'partial') return 'failed'
  return 'failed'
}
