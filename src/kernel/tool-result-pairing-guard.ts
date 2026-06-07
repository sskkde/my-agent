import type { KernelTranscriptEntry, ToolUseRequest, ToolUseResult } from './types.js'

export interface PairingGuardWarning {
  type: 'missing_result' | 'orphan_result'
  toolCallId: string
  message: string
}

export interface PairingGuardResult {
  valid: boolean
  warnings: PairingGuardWarning[]
}

export function validateToolResultPairing(transcript: KernelTranscriptEntry[]): PairingGuardResult {
  const toolCalls = transcript.filter((e) => e.type === 'tool_call')
  const toolResults = transcript.filter((e) => e.type === 'tool_result')

  const warnings: PairingGuardWarning[] = []

  const calledIds = new Set<string>()
  for (const entry of toolCalls) {
    const tc = entry.content as ToolUseRequest
    calledIds.add(tc.toolCallId)
  }

  const resultIds = new Set<string>()
  for (const entry of toolResults) {
    const tr = entry.content as ToolUseResult
    resultIds.add(tr.toolCallId)
  }

  for (const id of calledIds) {
    if (!resultIds.has(id)) {
      warnings.push({
        type: 'missing_result',
        toolCallId: id,
        message: `Tool call ${id} has no matching tool result`,
      })
    }
  }

  for (const id of resultIds) {
    if (!calledIds.has(id)) {
      warnings.push({
        type: 'orphan_result',
        toolCallId: id,
        message: `Tool result ${id} has no matching tool call`,
      })
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  }
}

export class ToolResultPairingGuard {
  private pendingCalls: Map<string, ToolUseRequest> = new Map()
  private completedResults: Map<string, ToolUseResult> = new Map()

  trackAssistantToolCalls(requests: ToolUseRequest[]): void {
    for (const req of requests) {
      this.pendingCalls.set(req.toolCallId, req)
    }
  }

  acceptToolResult(result: ToolUseResult): void {
    this.completedResults.set(result.toolCallId, result)
    this.pendingCalls.delete(result.toolCallId)
  }

  flushMissingResults(reason = 'iteration_end'): ToolUseResult[] {
    const missing: ToolUseResult[] = []
    for (const [id, req] of this.pendingCalls) {
      missing.push({
        toolCallId: id,
        result: null,
        error: {
          code: 'MISSING_TOOL_RESULT',
          message: `Tool call ${req.toolName} (${id}) had no matching result (${reason})`,
          recoverable: true,
        },
      })
    }
    this.pendingCalls.clear()
    return missing
  }

  hasPendingCalls(): boolean {
    return this.pendingCalls.size > 0
  }

  getPendingCallIds(): string[] {
    return Array.from(this.pendingCalls.keys())
  }

  validate(): PairingGuardResult {
    const warnings: PairingGuardWarning[] = []
    for (const id of this.pendingCalls.keys()) {
      warnings.push({
        type: 'missing_result',
        toolCallId: id,
        message: `Tool call ${id} has no matching tool result`,
      })
    }
    return {
      valid: warnings.length === 0,
      warnings,
    }
  }
}
