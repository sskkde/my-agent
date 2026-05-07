/**
 * Tool Result Reference Module
 * 
 * Implements inline vs ref policy for tool execution outputs.
 * Outputs < 32 KiB remain inline; outputs >= 32 KiB are persisted
 * using tool-result-store and returned as resultRef.
 */

import type { ToolResultStore, ToolResultBlob, SensitivityLevel } from '../storage/tool-result-store.js';

/** Threshold for storing results as references (32 KiB) */
export const INLINE_THRESHOLD = 32 * 1024;

/** Metadata returned when a result is stored as a reference */
export interface ResultRefMetadata {
  resultId: string;
  toolExecutionId: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
}

/** Result of processing tool output - either inline or as reference */
export interface ProcessedToolOutput {
  /** True if output is stored as reference, false if inline */
  isRef: boolean;
  /** The inline output (when isRef is false) */
  inlineOutput?: unknown;
  /** Reference metadata (when isRef is true) */
  resultRef?: ResultRefMetadata;
}

/**
 * Determines whether a tool output should be stored as a reference
 * based on its serialized JSON size.
 * 
 * @param output - The tool execution output to check
 * @returns true if output should be stored as reference, false if inline
 */
export function shouldStoreAsRef(output: unknown): boolean {
  try {
    const serialized = JSON.stringify(output);
    const sizeBytes = Buffer.byteLength(serialized, 'utf-8');
    return sizeBytes >= INLINE_THRESHOLD;
  } catch {
    // If serialization fails, keep inline to avoid data loss
    return false;
  }
}

/**
 * Calculates the size of a serialized output in bytes.
 * 
 * @param output - The output to measure
 * @returns Size in bytes of the serialized JSON
 */
export function getOutputSize(output: unknown): number {
  try {
    const serialized = JSON.stringify(output);
    return Buffer.byteLength(serialized, 'utf-8');
  } catch {
    return 0;
  }
}

/**
 * Creates a result reference by persisting a large tool output.
 * 
 * @param store - The tool result store to use for persistence
 * @param toolExecutionId - The tool call/execution ID
 * @param output - The tool output to persist
 * @param options - Additional metadata for the result
 * @returns Metadata about the stored result reference
 */
export function createResultRef(
  store: ToolResultStore,
  toolExecutionId: string,
  output: unknown,
  options: {
    toolName: string;
    userId: string;
    sessionId?: string;
    sensitivity?: SensitivityLevel;
  }
): ResultRefMetadata {
  const serialized = JSON.stringify(output);
  const sizeBytes = Buffer.byteLength(serialized, 'utf-8');
  const resultId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Generate a preview (first 1000 chars of stringified output)
  const preview = serialized.length > 1000 
    ? serialized.substring(0, 1000) + '...' 
    : serialized;

  // Determine content type based on output structure
  const contentType = determineContentType(output);

  // Create the blob record
  const blob: Omit<ToolResultBlob, 'id' | 'createdAt'> = {
    resultRef: resultId,
    toolCallId: toolExecutionId,
    toolName: options.toolName,
    userId: options.userId,
    sessionId: options.sessionId,
    preview,
    rawBlobRef: undefined,
    structuredContent: typeof output === 'object' && output !== null 
      ? output as Record<string, unknown> 
      : { value: output },
    sensitivity: options.sensitivity ?? 'low',
  };

  store.create(blob);

  return {
    resultId,
    toolExecutionId,
    sizeBytes,
    contentType,
    createdAt,
  };
}

/**
 * Processes a tool output and returns either inline output or a reference.
 * 
 * @param store - The tool result store for persistence
 * @param toolExecutionId - The tool execution ID
 * @param output - The tool output to process
 * @param options - Additional metadata
 * @returns Processed output with either inline data or reference
 */
export function processToolOutput(
  store: ToolResultStore,
  toolExecutionId: string,
  output: unknown,
  options: {
    toolName: string;
    userId: string;
    sessionId?: string;
    sensitivity?: SensitivityLevel;
  }
): ProcessedToolOutput {
  if (shouldStoreAsRef(output)) {
    const resultRef = createResultRef(store, toolExecutionId, output, options);
    return {
      isRef: true,
      resultRef,
    };
  }

  return {
    isRef: false,
    inlineOutput: output,
  };
}

/**
 * Determines the content type of an output.
 */
function determineContentType(output: unknown): string {
  if (output === null) {
    return 'application/json; type=null';
  }
  
  if (Array.isArray(output)) {
    return 'application/json; type=array';
  }
  
  if (typeof output === 'object') {
    return 'application/json; type=object';
  }
  
  if (typeof output === 'string') {
    // Check if it looks like JSON
    try {
      JSON.parse(output);
      return 'application/json; type=string';
    } catch {
      return 'text/plain';
    }
  }
  
  if (typeof output === 'number') {
    return 'application/json; type=number';
  }
  
  if (typeof output === 'boolean') {
    return 'application/json; type=boolean';
  }
  
  return 'application/octet-stream';
}
