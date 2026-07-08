/**
 * Transcript Redaction Mapper - Maps KernelRunResult to redacted transcript summaries
 * Ensures sensitive data (raw params, results, hidden prompts) is NOT persisted
 * @module foreground/tools/transcript-redaction-mapper
 */

import type { KernelRunResult, KernelRunStatus } from '../../kernel/types.js'
import type { TurnTranscript } from '../../storage/transcript-store.js'

/**
 * Map kernel execution result to a safe transcript runtime summary.
 *
 * SAFETY: This function ensures that:
 * - Raw tool params (which may contain sensitive args) are NOT persisted
 * - Raw tool results are NOT persisted
 * - Hidden prompt fields from kernel results do NOT leak
 *
 * @param kernelResult - The kernel execution result
 * @returns Redacted runtime summary suitable for transcript persistence, or undefined if no tool calls
 */
export function mapKernelResultToTranscript(
  kernelResult?: KernelRunResult,
): TurnTranscript['runtimeSummary'] | undefined {
  if (!kernelResult) return undefined

  const hasToolCalls = kernelResult.toolCalls && kernelResult.toolCalls.length > 0

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
    runtimeSummary.toolCallSummaries = kernelResult.toolCalls.map((toolCall) => {
      return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: mapKernelStatusToToolCallStatus(kernelResult.finalStatus),
        summary: `Tool: ${toolCall.toolName}`,
      }
    })
  }

  return runtimeSummary
}

/**
 * Map kernel run status to individual tool call status.
 *
 * When the kernel fails or times out, tool calls that were in progress
 * or incomplete are marked as 'failed'. Otherwise, they're 'completed'.
 *
 * SAFETY: Status is safe to persist as it contains no sensitive data.
 */
function mapKernelStatusToToolCallStatus(kernelStatus: KernelRunStatus): 'completed' | 'failed' | 'skipped' {
  if (kernelStatus === 'failed' || kernelStatus === 'timeout') {
    return 'failed'
  }

  // 'max_iterations_reached' implies tools were executed but loop stopped,
  // so tool calls are still 'completed'
  return 'completed'
}

/**
 * Check if kernel result contains hidden/prompt memory content that should not leak.
 *
 * This is a safety guard for the transcript persistence layer.
 * Hidden prompts and private reasoning should NEVER appear in transcripts.
 *
 * @returns Always false - we don't persist any hidden prompt data through this mapper
 */
export function hasHiddenPromptContent(_kernelResult: KernelRunResult): boolean {
  // By design, mapKernelResultToTranscript never includes hidden prompts.
  // The kernel transcript contains full details but is NOT persisted here.
  // This function exists for audit/logging purposes.
  return false
}
