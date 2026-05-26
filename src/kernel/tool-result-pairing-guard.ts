import type { KernelTranscriptEntry, ToolUseRequest, ToolUseResult } from './types.js';

export interface PairingGuardWarning {
  type: 'missing_result' | 'orphan_result';
  toolCallId: string;
  message: string;
}

export interface PairingGuardResult {
  valid: boolean;
  warnings: PairingGuardWarning[];
}

/**
 * Validates that every tool_call has a matching tool_result and vice versa.
 * Multi-tool parallel calls (EC-5) are handled by pairing each tool_call
 * with its corresponding tool_result via toolCallId.
 *
 * @param transcript - Array of KernelTranscriptEntry to validate
 * @returns PairingGuardResult with validity status and any warnings
 */
export function validateToolResultPairing(
  transcript: KernelTranscriptEntry[]
): PairingGuardResult {
  const toolCalls = transcript.filter(e => e.type === 'tool_call');
  const toolResults = transcript.filter(e => e.type === 'tool_result');

  const warnings: PairingGuardWarning[] = [];

  const calledIds = new Set<string>();
  for (const entry of toolCalls) {
    const tc = entry.content as ToolUseRequest;
    calledIds.add(tc.toolCallId);
  }

  const resultIds = new Set<string>();
  for (const entry of toolResults) {
    const tr = entry.content as ToolUseResult;
    resultIds.add(tr.toolCallId);
  }

  for (const id of calledIds) {
    if (!resultIds.has(id)) {
      warnings.push({
        type: 'missing_result',
        toolCallId: id,
        message: `Tool call ${id} has no matching tool result`,
      });
    }
  }

  for (const id of resultIds) {
    if (!calledIds.has(id)) {
      warnings.push({
        type: 'orphan_result',
        toolCallId: id,
        message: `Tool result ${id} has no matching tool call`,
      });
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
