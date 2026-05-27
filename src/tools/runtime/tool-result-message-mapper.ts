import type { ToolUseResult } from '../../kernel/types.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';

export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
  resultRef?: string;
  toolName?: string;
  isError: boolean;
  modelFacingContent: string;
  transcriptSummary?: string;
  userVisibleSummary?: string;
  persistedResultRef?: string;
  structuredContent?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface MapToolResultOptions {
  thresholdBytes?: number;
  maxPreviewLength?: number;
  toolResultStore?: ToolResultStore;
  userId?: string;
  sessionId?: string;
}

const DEFAULT_THRESHOLD_BYTES = 8 * 1024;
const DEFAULT_MAX_PREVIEW_LENGTH = 1024;

function getResultSize(result: unknown): number {
  try {
    const serialized = JSON.stringify(result);
    return Buffer.byteLength(serialized, 'utf-8');
  } catch {
    return 0;
  }
}

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

function generateUserVisibleSummary(result: unknown, isError: boolean): string {
  if (isError) {
    return 'Tool execution failed';
  }

  if (result === null || result === undefined) {
    return 'Tool returned empty result';
  }

  if (typeof result === 'string') {
    return result.length > 200
      ? `string result (${result.length} chars)`
      : result;
  }

  if (Array.isArray(result)) {
    return `array with ${result.length} items`;
  }

  if (typeof result === 'object') {
    const keys = Object.keys(result as Record<string, unknown>);
    return `object with ${keys.length} keys`;
  }

  return `${typeof result} result`;
}

export function mapToolResultToMessage(
  result: ToolUseResult,
  options?: MapToolResultOptions
): ToolResultMessage {
  const threshold = options?.thresholdBytes ?? DEFAULT_THRESHOLD_BYTES;
  const maxPreviewLength = options?.maxPreviewLength ?? DEFAULT_MAX_PREVIEW_LENGTH;

  if (result.error) {
    const errorContent = `Error: ${result.error.message}`;
    return {
      role: 'tool',
      toolCallId: result.toolCallId,
      content: errorContent,
      isError: true,
      modelFacingContent: errorContent,
      transcriptSummary: `Error: ${result.error.code}`,
      userVisibleSummary: generateUserVisibleSummary(null, true),
      structuredContent: {
        error: true,
        code: result.error.code,
        recoverable: result.error.recoverable,
      },
      meta: { errorCode: result.error.code, recoverable: result.error.recoverable },
    };
  }

  const sizeBytes = getResultSize(result.result);

  if (sizeBytes > threshold) {
    const preview = generatePreview(result.result, maxPreviewLength);
    const summary = generateSummary(result.result);
    const sizeKB = Math.round(sizeBytes / 1024);

    let resultRef = `blob:${result.toolCallId}`;
    let persistedResultRef: string | undefined;

    if (options?.toolResultStore && options.userId) {
      const stored = options.toolResultStore.create({
        resultRef: `tr:${Date.now().toString(36)}-${result.toolCallId}`,
        toolCallId: result.toolCallId,
        toolName: '',
        userId: options.userId,
        sessionId: options.sessionId,
        preview: preview.substring(0, 512),
        sensitivity: 'low',
      });
      resultRef = stored.resultRef;
      persistedResultRef = stored.resultRef;
    }

    const largeContent = `[Large result: ${summary}, ${sizeKB}KB]\nPreview: ${preview}\n[Full result stored, ref: ${resultRef}]`;

    return {
      role: 'tool',
      toolCallId: result.toolCallId,
      content: largeContent,
      resultRef,
      isError: false,
      modelFacingContent: preview,
      transcriptSummary: `Large result: ${summary}, ${sizeKB}KB`,
      userVisibleSummary: generateUserVisibleSummary(result.result, false),
      persistedResultRef,
      structuredContent: {
        _type: 'blob_ref',
        sizeBytes,
        sizeKB,
        summary,
        resultRef,
      },
      meta: { sizeBytes, sizeKB, isLargeResult: true },
    };
  }

  const stringified = JSON.stringify(result.result);
  const content = stringified ?? 'undefined';

  return {
    role: 'tool',
    toolCallId: result.toolCallId,
    content,
    isError: false,
    modelFacingContent: content,
    userVisibleSummary: generateUserVisibleSummary(result.result, false),
  };
}
