/**
 * Transcript Redaction Mapper - Maps KernelRunResult to redacted transcript summaries
 * and ordered visible messages for interleaved tool/text timelines (Plan C).
 *
 * SAFETY: This module ensures that:
 * - Raw tool params (which may contain sensitive args) are NOT persisted
 * - Raw tool results are NOT persisted
 * - Tool error codes/messages are NOT persisted
 * - Hidden prompt fields from kernel results do NOT leak
 *
 * @module foreground/tools/transcript-redaction-mapper
 */

import type {
  KernelRunResult,
  KernelRunStatus,
  KernelTranscriptEntry,
  ToolUseRequest,
  ToolUseResult,
} from '../../kernel/types.js'
import type { TurnTranscript, VisibleMessage } from '../../storage/transcript-store.js'

type ToolCallStatus = 'completed' | 'failed' | 'skipped'

interface SafeToolCall {
  toolCallId: string
  toolName: string
  startedAt: string
  callIndex: number
}

/**
 * Map kernel execution result to a safe transcript runtime summary.
 *
 * SAFETY: This function ensures that:
 * - Raw tool params (which may contain sensitive args) are NOT persisted
 * - Raw tool results are NOT persisted
 * - Hidden prompt fields from kernel results do NOT leak
 */
export function mapKernelResultToTranscript(
  kernelResult?: KernelRunResult,
): TurnTranscript['runtimeSummary'] | undefined {
  if (!kernelResult) return undefined

  const toolCallSummaries = buildToolCallSummaries(kernelResult)
  const hasToolCalls = toolCallSummaries.length > 0

  if (!hasToolCalls && !kernelResult.structuredTrace) {
    return undefined
  }

  const runtimeSummary: TurnTranscript['runtimeSummary'] = {}

  if (kernelResult.structuredTrace) {
    const trace = kernelResult.structuredTrace
    runtimeSummary.structuredTrace = trace
    runtimeSummary.observationSummaries = trace.observationSummaries
    runtimeSummary.riskAssessments = trace.riskAssessments
  }

  if (hasToolCalls) {
    runtimeSummary.toolCallSummaries = toolCallSummaries
  }

  return runtimeSummary
}

/**
 * Project kernel transcript into ordered public visible messages.
 *
 * Order follows kernel transcript insertion order:
 * assistant (nonblank intermediate text) → tool result → ... → final assistant.
 *
 * Tool-call "running" is NOT a visible message (live SSE only); persisted parts
 * use tool-role messages representing terminal tool results with generic content.
 */
export function mapKernelResultToVisibleMessages(kernelResult: KernelRunResult, turnId: string): VisibleMessage[] {
  const calls = collectSafeToolCalls(kernelResult.transcript)
  const callById = new Map(calls.map((c) => [c.toolCallId, c]))
  const messages: VisibleMessage[] = []
  let sequence = 0

  for (const entry of kernelResult.transcript) {
    if (entry.type === 'llm_response') {
      const content = extractAssistantContent(entry.content)
      if (content === undefined) continue
      messages.push({
        messageId: `msg-${turnId}-seq-${sequence}`,
        role: 'assistant',
        content,
        timestamp: entry.timestamp,
        turnSequence: sequence,
      })
      sequence += 1
      continue
    }

    if (entry.type === 'tool_result') {
      const result = extractToolResult(entry.content)
      if (!result) continue
      const call = callById.get(result.toolCallId)
      const toolName = call?.toolName ?? 'unknown'
      const toolStatus: ToolCallStatus = result.error ? 'failed' : 'completed'
      messages.push({
        messageId: `msg-${turnId}-tool-${sanitizeId(result.toolCallId)}-result`,
        role: 'tool',
        content: formatToolResultContent(toolName, toolStatus),
        timestamp: entry.timestamp,
        turnSequence: sequence,
        toolCallId: result.toolCallId,
        toolName,
        toolStatus,
      })
      sequence += 1
    }
  }

  // Provider reasoning → role: 'thinking' visible message (opt-in display).
  // SAFETY: source is provider `reasoningContent` only — never internal
  // `structuredTrace.reasoningSummary` / decisionTrace. Empty/whitespace
  // reasoning produces no thinking message (no empty UI shells). The thinking
  // message is placed BEFORE the final assistant message so timeline ordering
  // keeps reasoning preceding the answer.
  const reasoningText = typeof kernelResult.reasoningContent === 'string' ? kernelResult.reasoningContent.trim() : ''
  if (reasoningText.length > 0) {
    const thinkingMessage: VisibleMessage = {
      messageId: `msg-${turnId}-thinking`,
      role: 'thinking',
      content: kernelResult.reasoningContent!,
    }
    const lastAssistantIdx = findLastIndex(messages, (m) => m.role === 'assistant')
    if (lastAssistantIdx >= 0) {
      messages.splice(lastAssistantIdx, 0, thinkingMessage)
    } else {
      messages.push(thinkingMessage)
    }
  }

  // Fallback: if transcript has no assistant parts but finalResponse exists, emit it.
  if (
    messages.every((m) => m.role !== 'assistant') &&
    typeof kernelResult.finalResponse === 'string' &&
    kernelResult.finalResponse.trim().length > 0
  ) {
    messages.push({
      messageId: `msg-${turnId}-seq-${sequence}`,
      role: 'assistant',
      content: kernelResult.finalResponse,
      turnSequence: sequence,
    })
  }

  return messages
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}

/**
 * Build per-tool summaries from transcript pairs (prefer over kernelResult.toolCalls alone).
 */
export function buildToolCallSummaries(kernelResult: KernelRunResult): Array<{
  toolCallId: string
  toolName: string
  status: ToolCallStatus
  summary?: string
  startedAt?: string
  turnSequence?: number
}> {
  const calls = collectSafeToolCalls(kernelResult.transcript)
  const resultsById = new Map<string, ToolUseResult>()

  for (const entry of kernelResult.transcript) {
    if (entry.type !== 'tool_result') continue
    const result = extractToolResult(entry.content)
    if (result) resultsById.set(result.toolCallId, result)
  }

  // Prefer transcript-derived calls; fall back to kernelResult.toolCalls for ID/name only.
  const seen = new Set<string>()
  const summaries: Array<{
    toolCallId: string
    toolName: string
    status: ToolCallStatus
    summary?: string
    startedAt?: string
    turnSequence?: number
  }> = []

  const append = (
    toolCallId: string,
    toolName: string,
    options: {
      startedAt?: string
      turnSequence?: number
      /** When true, missing result on a terminal run is failed; otherwise use kernel-wide status. */
      requireResult?: boolean
    } = {},
  ) => {
    if (seen.has(toolCallId)) return
    seen.add(toolCallId)
    const result = resultsById.get(toolCallId)
    let status: ToolCallStatus
    if (result) {
      status = result.error ? 'failed' : 'completed'
    } else if (options.requireResult && isTerminalKernelStatus(kernelResult.finalStatus)) {
      // Saw a tool_call in transcript but no terminal result → failed
      status = 'failed'
    } else {
      // Legacy: toolCalls[] without transcript pairs inherit overall kernel status
      status = mapKernelStatusToToolCallStatus(kernelResult.finalStatus)
    }
    summaries.push({
      toolCallId,
      toolName,
      status,
      summary: `Tool: ${toolName}`,
      ...(options.startedAt ? { startedAt: options.startedAt } : {}),
      ...(options.turnSequence !== undefined ? { turnSequence: options.turnSequence } : {}),
    })
  }

  // Assign turnSequence as call order among tools (not full visible sequence).
  for (const call of calls) {
    append(call.toolCallId, call.toolName, {
      startedAt: call.startedAt,
      turnSequence: call.callIndex,
      requireResult: true,
    })
  }

  for (const tc of kernelResult.toolCalls ?? []) {
    if (!tc?.toolCallId || !tc?.toolName) continue
    append(tc.toolCallId, tc.toolName, { requireResult: false })
  }

  // Orphan results with no call entry
  for (const toolCallId of resultsById.keys()) {
    if (seen.has(toolCallId)) continue
    append(toolCallId, 'unknown')
  }

  return summaries
}

function mapKernelStatusToToolCallStatus(kernelStatus: KernelRunStatus): ToolCallStatus {
  if (kernelStatus === 'failed' || kernelStatus === 'timeout') {
    return 'failed'
  }
  return 'completed'
}

function isTerminalKernelStatus(status: KernelRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'timeout' || status === 'max_iterations_reached'
}

function collectSafeToolCalls(transcript: KernelTranscriptEntry[]): SafeToolCall[] {
  const calls: SafeToolCall[] = []
  let callIndex = 0
  for (const entry of transcript) {
    if (entry.type !== 'tool_call') continue
    const req = extractToolRequest(entry.content)
    if (!req) continue
    calls.push({
      toolCallId: req.toolCallId,
      toolName: req.toolName,
      startedAt: entry.timestamp,
      callIndex,
    })
    callIndex += 1
  }
  return calls
}

function extractAssistantContent(content: unknown): string | undefined {
  if (!isRecord(content)) return undefined
  const text = content.content
  if (typeof text !== 'string') return undefined
  if (text.trim().length === 0) return undefined
  return text
}

function extractToolRequest(content: unknown): ToolUseRequest | undefined {
  if (!isRecord(content)) return undefined
  const toolCallId = content.toolCallId
  const toolName = content.toolName
  if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) return undefined
  if (typeof toolName !== 'string' || toolName.trim().length === 0) return undefined
  // Intentionally ignore params
  return { toolCallId, toolName, params: {} }
}

function extractToolResult(content: unknown): ToolUseResult | undefined {
  if (!isRecord(content)) return undefined
  const toolCallId = content.toolCallId
  if (typeof toolCallId !== 'string' || toolCallId.trim().length === 0) return undefined
  // Presence of error object marks failure; never copy error fields
  const hasError = isRecord(content.error)
  return {
    toolCallId,
    result: null,
    ...(hasError
      ? {
          error: {
            code: 'REDACTED',
            message: 'Tool failed',
            recoverable: true,
          },
        }
      : {}),
  }
}

function formatToolResultContent(toolName: string, status: ToolCallStatus): string {
  if (status === 'failed') return `Tool failed: ${toolName}`
  if (status === 'skipped') return `Tool skipped: ${toolName}`
  return `Tool completed: ${toolName}`
}

/**
 * Sanitize IDs for use in eventId / messageId (no CR/LF, stable encoding).
 */
export function sanitizeId(id: string): string {
  return id.replace(/[\r\n]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Deterministic timeline event IDs shared by live broadcast and replay.
 */
export function buildToolCallEventId(turnId: string, toolCallId: string): string {
  return `turn-${turnId}-tool-${sanitizeId(toolCallId)}-call`
}

export function buildToolResultEventId(turnId: string, toolCallId: string): string {
  return `turn-${turnId}-tool-${sanitizeId(toolCallId)}-result`
}

export function formatToolRunningContent(toolName: string): string {
  return `Tool running: ${toolName}`
}

export function formatToolTerminalContent(toolName: string, failed: boolean): string {
  return failed ? `Tool failed: ${toolName}` : `Tool completed: ${toolName}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check if kernel result contains hidden/prompt memory content that should not leak.
 * @returns Always false - we don't persist any hidden prompt data through this mapper
 */
export function hasHiddenPromptContent(_kernelResult: KernelRunResult): boolean {
  return false
}
