/**
 * Runtime Summary Helpers
 * Reusable helpers for building runtime summaries from kernel/tool execution results
 */

import type { KernelRunResult, KernelRunStatus } from '../../kernel/types.js';
import type { ToolCallSummary } from '../../api/types.js';
import type { TurnTranscript } from '../../storage/transcript-store.js';

/**
 * Build runtime summary from kernel execution result
 * Extracted from ForegroundKernelRunner for reuse across foreground tools
 */
export function buildRuntimeSummary(
  kernelResult?: KernelRunResult
): TurnTranscript['runtimeSummary'] | undefined {
  if (kernelResult?.toolCalls && kernelResult.toolCalls.length > 0) {
    const status: 'completed' | 'failed' = 
      kernelResult.finalStatus === 'failed' || kernelResult.finalStatus === 'timeout'
        ? 'failed'
        : 'completed';
    
    return {
      toolCallSummaries: kernelResult.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status,
      })),
    };
  }
  return undefined;
}

/**
 * Summarize a single tool call for transcript
 */
export function summarizeToolCall(
  toolCallId: string,
  toolName: string,
  status: 'completed' | 'failed' | 'pending',
  transcriptSummary?: string,
  resultRef?: string
): ToolCallSummary {
  const summary: ToolCallSummary = {
    toolCallId,
    toolName,
    status,
  };
  
  if (transcriptSummary) {
    summary.transcriptSummary = transcriptSummary;
  }
  
  if (resultRef) {
    summary.resultRef = resultRef;
  }
  
  return summary;
}

/**
 * Build runtime summary from a list of tool call summaries
 */
export function buildRuntimeSummaryFromToolCalls(
  toolCallSummaries: ToolCallSummary[]
): TurnTranscript['runtimeSummary'] | undefined {
  if (toolCallSummaries.length === 0) {
    return undefined;
  }
  
  return {
    toolCallSummaries,
  };
}

/**
 * Determine if a kernel status represents failure
 */
export function isKernelFailure(status: KernelRunStatus): boolean {
  return status === 'failed' || status === 'timeout';
}

/**
 * Map kernel status to tool call status
 */
export function mapKernelStatusToToolStatus(
  kernelStatus: KernelRunStatus
): 'completed' | 'failed' {
  return isKernelFailure(kernelStatus) ? 'failed' : 'completed';
}
