/**
 * Extraction and interception layer for `foreground_decide` tool calls.
 *
 * Security model: this module intercepts and validates LLM-produced tool calls
 * but never dispatches them, never adds them to user-visible responses, and
 * never passes unfiltered LLM data through. Structural failures (wrong name,
 * multiple calls) are non-retryable; parse/validation failures are retryable.
 *
 * SECURITY: `runtimeAction` is never extracted from LLM output. The validator
 * (`validateForegroundDecideParams` → `normalizeToForegroundDecision`) strips it.
 * The extracted `ForegroundDecision` only contains: route, reason,
 * userVisibleResponse, estimatedSteps, complexity, suggestedTools.
 */

import type { ToolCall } from '../llm/types.js';
import type { ForegroundDecision } from './types.js';
import {
  validateForegroundDecideParams,
  type ValidateForegroundDecideOptions,
  type ForegroundDecideErrorCode,
} from './foreground-decision-validator.js';

export type ForegroundDecideFallbackReason =
  | 'missing_tool_call'
  | 'unexpected_tool_call'
  | 'multiple_tool_calls'
  | 'malformed_args'
  | 'invalid_params';

export type ForegroundDecideExtractionResult =
  | { success: true; decision: ForegroundDecision }
  | { success: false; fallbackReason: ForegroundDecideFallbackReason; detail: string; canRetry: boolean };

/**
 * Extract and validate a `foreground_decide` tool call from an LLM response.
 *
 * This is an **interception** layer — it never dispatches, never adds tool
 * calls to user-visible responses, and never passes LLM data unfiltered.
 * Structural mismatches (wrong name, multiple calls) are non-retryable.
 * Parse/validation failures are retryable so the caller can re-ask the LLM.
 */
export function extractForegroundDecideToolCall(
  toolCalls: ToolCall[] | undefined,
  options: ValidateForegroundDecideOptions,
): ForegroundDecideExtractionResult {
  if (!toolCalls || toolCalls.length === 0) {
    return { success: false, fallbackReason: 'missing_tool_call', detail: 'LLM response contained no tool calls', canRetry: false };
  }

  if (toolCalls.length > 1) {
    return { success: false, fallbackReason: 'multiple_tool_calls', detail: `Expected exactly 1 tool call, got ${toolCalls.length}`, canRetry: false };
  }

  const toolCall = toolCalls[0]!;
  if (toolCall.function.name !== 'foreground_decide') {
    return { success: false, fallbackReason: 'unexpected_tool_call', detail: `Expected "foreground_decide", got "${toolCall.function.name}"`, canRetry: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return { success: false, fallbackReason: 'malformed_args', detail: 'Tool call arguments are not valid JSON', canRetry: true };
  }

  const result = validateForegroundDecideParams(parsed, options);

  if (result.valid && result.decision) {
    // SECURITY: result.decision comes from normalizeToForegroundDecision which
    // never includes runtimeAction. Only safe fields are passed through.
    return { success: true, decision: result.decision };
  }

  const errorCode: ForegroundDecideErrorCode = result.error?.code ?? 'INVALID_PARAMS';
  const errorMessage: string = result.error?.message ?? 'Unknown validation error';

  return {
    success: false,
    fallbackReason: 'invalid_params',
    detail: `[${errorCode}] ${errorMessage}`,
    canRetry: isRetryableValidationErrorCode(errorCode),
  };
}

function isRetryableValidationErrorCode(code: ForegroundDecideErrorCode): boolean {
  switch (code) {
    case 'INVALID_ROUTE':
    case 'EMPTY_REASON':
    case 'INVALID_COMPLEXITY':
    case 'INVALID_ESTIMATED_STEPS':
    case 'INVALID_TOOLS':
      return true;
    case 'INVALID_PARAMS':
    case 'INVALID_SCHEMA_VERSION':
      return false;
    default:
      return false;
  }
}
