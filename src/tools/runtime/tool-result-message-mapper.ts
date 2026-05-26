/**
 * Tool Result Message Mapper
 * Maps ToolUseResult (Kernel internal format) to LLM-consumable messages
 */

import type { ToolUseResult } from '../../kernel/types.js';

/**
 * LLM-consumable tool result message
 */
export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
}

/**
 * Options for mapping tool results
 */
export interface MapToolResultOptions {
  /** Size threshold in bytes for truncation (default: 8KB) */
  thresholdBytes?: number;
  /** Maximum preview length in characters for large results (default: 1024) */
  maxPreviewLength?: number;
}

const DEFAULT_THRESHOLD_BYTES = 8 * 1024;
const DEFAULT_MAX_PREVIEW_LENGTH = 1024;

/**
 * Calculate byte size of a value when serialized to JSON
 */
function getResultSize(result: unknown): number {
  try {
    const serialized = JSON.stringify(result);
    return Buffer.byteLength(serialized, 'utf-8');
  } catch {
    return 0;
  }
}

/**
 * Generate a preview of a large result
 */
function generatePreview(result: unknown, maxLength: number): string {
  try {
    const serialized = JSON.stringify(result);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return serialized.substring(0, maxLength) + '...';
  } catch {
    return '[Unable to serialize result]';
  }
}

/**
 * Generate a summary for a large result
 */
function generateSummary(result: unknown): string {
  if (result === null || result === undefined) {
    return 'empty result';
  }

  if (typeof result === 'string') {
    return `string (${result.length} chars)`;
  }

  if (Array.isArray(result)) {
    return `array (${result.length} items)`;
  }

  if (typeof result === 'object') {
    const keys = Object.keys(result as Record<string, unknown>);
    return `object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
  }

  return typeof result;
}

/**
 * Map ToolUseResult to LLM-consumable message format
 *
 * Handles three cases:
 * 1. Error result: content is "Error: {error.message}"
 * 2. Large result (>8KB): content is summary + preview + blob reference
 * 3. Normal result: content is JSON.stringify(result)
 *
 * @param result - The tool use result from kernel
 * @param options - Optional configuration for threshold and preview length
 * @returns LLM-consumable tool result message
 */
export function mapToolResultToMessage(
  result: ToolUseResult,
  options?: MapToolResultOptions
): ToolResultMessage {
  const threshold = options?.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const maxPreviewLength = options?.maxPreviewLength ?? DEFAULT_MAX_PREVIEW_LENGTH;

  if (result.error) {
    return {
      role: 'tool',
      toolCallId: result.toolCallId,
      content: `Error: ${result.error.message}`,
    };
  }

  const sizeBytes = getResultSize(result.result);

  if (sizeBytes > threshold) {
    const preview = generatePreview(result.result, maxPreviewLength);
    const summary = generateSummary(result.result);
    const sizeKB = Math.round(sizeBytes / 1024);

    return {
      role: 'tool',
      toolCallId: result.toolCallId,
      content: `[Large result: ${summary}, ${sizeKB}KB]\nPreview: ${preview}\n[Full result stored in blob storage, ref: blob:${result.toolCallId}]`,
    };
  }

  const stringified = JSON.stringify(result.result);
  return {
    role: 'tool',
    toolCallId: result.toolCallId,
    content: stringified ?? 'undefined',
  };
}
