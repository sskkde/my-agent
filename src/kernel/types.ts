import type { AgentType, ContextBundle, ContextItem, RuntimeContextDelta } from '../context/types.js'
import type { LLMAdapter } from '../llm/adapter.js'
import type { LLMRequest } from '../llm/types.js'
import type { ModelInputBuilder } from './model-input/model-input-builder.js'
import type {
  ModelInputBuildInput,
  ToolPlaneProjection,
  ToolSelectionPolicyProjection,
} from './model-input/model-input-types.js'
import type { PromptProjectionResolver } from '../prompt/prompt-projection-types.js'
import type { TokenStreamPayload } from '../api/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'

export interface ToolUseRequest {
  toolCallId: string
  toolName: string
  params: Record<string, unknown>
}

export interface ToolUseResult {
  toolCallId: string
  result: unknown
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
}

/**
 * Result from an internal tool handler.
 *
 * When `stop` is true the kernel short-circuits: it commits the tool_call/tool_result
 * to the transcript and returns a KernelRunResult with finalStatus 'completed' and
 * `structuredResult` populated, without calling the dispatcher or continuing the loop.
 */
export interface InternalToolHandlerResult {
  /** Standard tool result — always required, even when stopping. */
  toolResult: ToolUseResult
  /** When true, kernel stops the loop immediately after this tool result. */
  stop?: boolean
  /** Optional structured payload returned on the KernelRunResult when stop is true. */
  structuredResult?: unknown
}

/**
 * Generic internal tool handler.
 *
 * Receives a ToolUseRequest and returns an InternalToolHandlerResult.
 * Used by callers (e.g. ForegroundAgent) to intercept specific tool names
 * and handle them internally, bypassing the dispatcher.
 */
export type InternalToolHandler = (request: ToolUseRequest) => Promise<InternalToolHandlerResult>

export interface KernelRunInput {
  contextBundle: ContextBundle
  /** Run ID for this run - used for tool dispatch kernelRunId and transcript tracking.
   *  Falls back to contextBundle.runId if not provided at runtime. */
  runId: string
  /** Agent ID for this run - identifies the agent instance executing this run. */
  agentId: string
  /** Agent type for this run - categorizes the agent (main, subagent, background, workflow_step, remote). */
  agentType: AgentType
  /** User ID for this run - used for tool dispatch and permission context. */
  userId: string
  /** Session ID for this run - optional, used for LLM request context. */
  sessionId?: string
  /** Per-run tool projection — takes priority over KernelConfig.toolProjection.
   *  Allows different tool visibility per tenant, workflow step, approval state, or connector scope. */
  toolProjection?: ToolPlaneProjection
  /** Per-run tool selection policy — injected when PROMPT_MEMORY_P0_ENABLED is true. */
  toolSelectionPolicy?: ToolSelectionPolicyProjection
  maxIterations?: number
  timeoutMs?: number
  config?: Record<string, unknown>
  /** Internal tool handlers keyed by tool name — bypasses dispatcher when matched. */
  internalToolHandlers?: Record<string, InternalToolHandler>
  /** Complete per-run ModelInputBuilder input. When supplied, kernel uses it instead of its default function_calling input. */
  modelInputOverride?: ModelInputBuildInput
  /** Per-run temperature override for the LLM request. */
  temperature?: number
  /** Per-run maxTokens override for the LLM request. */
  maxTokens?: number
  /** Per-run toolChoice override for the LLM request. */
  toolChoice?: LLMRequest['toolChoice']
  /** Per-run model override for the LLM request. */
  model?: string
}

export type KernelRunStatus = 'completed' | 'max_iterations_reached' | 'timeout' | 'failed'

export interface KernelRunResult {
  finalStatus: KernelRunStatus
  finalResponse?: string
  iterationsUsed: number
  toolCalls: ToolUseRequest[]
  transcript: KernelTranscriptEntry[]
  error?: {
    code: string
    message: string
  }
  /** Structured payload from an internal tool handler that signaled stop. */
  structuredResult?: unknown
}

export interface KernelTranscriptEntry {
  iteration: number
  timestamp: string
  type: 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'compact' | 'error'
  content: unknown
}

export interface KernelRunState {
  currentIteration: number
  status: 'running' | 'waiting' | 'completed' | 'failed'
  contextItems: ContextItem[]
  startTime: number
  toolCalls: ToolUseRequest[]
  transcript: KernelTranscriptEntry[]
  compactedItemIds: Set<string>
  compactedToolCallIds: Set<string>
  lastCompactSummaryItem: ContextItem | undefined
}

export interface ToolExecutor {
  execute(request: {
    toolCallId: string
    toolName: string
    params: unknown
    userId: string
    sessionId?: string
    kernelRunId?: string
    permissionContext: {
      userId: string
      permissions: string[]
    }
  }): Promise<{
    success: boolean
    data?: unknown
    error?: {
      code: string
      message: string
      recoverable: boolean
    }
    resultPreview?: string
  }>
}

export interface ContextManager {
  assembleBundle(): ContextBundle
  getItems(): ContextItem[]
  addItem(item: ContextItem): void
  applyDelta(delta: RuntimeContextDelta): void
}

export interface RuntimeDispatcher {
  dispatch(request: {
    requestId: string
    action: {
      actionId: string
      actionType: string
      targetRuntime: string
      targetAction?: {
        toolName?: string
        params?: unknown
        toolCallId?: string
        toolDispatchRequest?: import('../tools/runtime/tool-dispatch-contract.js').ToolDispatchRequest
      }
      source: {
        sourceModule: string
        sourceAction: string
      }
      userId: string
      createdAt: string
      status: string
    }
    context: {
      callerModule: string
      userId?: string
      sessionId?: string
      kernelRunId?: string
      agentId?: string
      agentType?: AgentType
    }
  }): Promise<{
    requestId: string
    actionId: string
    status: string
    targetRuntime: string
    result?: unknown
    error?: {
      code: string
      message: string
      recoverable: boolean
    }
    createdAt: string
    completedAt?: string
  }>
}

/**
 * Minimal interface for broadcasting token stream events.
 * Decouples the kernel from the full TimelineBroadcaster API surface.
 */
export interface TokenStreamBroadcaster {
  broadcastTokenStream(sessionId: string, token: TokenStreamPayload): void
}

export interface KernelConfig {
  llmAdapter: LLMAdapter
  toolExecutor: ToolExecutor
  contextManager: ContextManager
  dispatcher: RuntimeDispatcher
  modelInputBuilder: ModelInputBuilder
  maxIterations: number
  timeoutMs: number
  compactThreshold?: number
  /** Optional executor invoked when the compact trigger fires. */
  compactExecutor?: CompactExecutor
  defaultModel?: string
  providerFamily?: string
  toolProjection?: ToolPlaneProjection
  modelInputSnapshotStore?: import('./model-input/model-input-snapshot-store.js').ModelInputSnapshotStore
  promptProjectionResolver?: PromptProjectionResolver
  /** Optional broadcaster for real-time token streaming to connected clients. */
  timelineBroadcaster?: TokenStreamBroadcaster
  /** Optional envelope registry for AgentType-level tool security boundary enforcement. */
  envelopeRegistry?: AgentTypeToolEnvelopeRegistry
}

export interface CompactTriggerResult {
  shouldCompact: boolean
  candidateItemIds?: string[]
  mustKeepItemIds?: string[]
}

export interface CompactExecutorInput {
  readonly candidateItemIds: readonly string[]
  readonly mustKeepItemIds: readonly string[]
  readonly contextItems: readonly ContextItem[]
}

export type CompactExecutorResult =
  | {
      readonly status: 'applied'
      readonly compactedItemIds: readonly string[]
      readonly summaryItem: ContextItem
      readonly compressionRatio: number
    }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }

export type CompactExecutor = (input: CompactExecutorInput) => Promise<CompactExecutorResult>
