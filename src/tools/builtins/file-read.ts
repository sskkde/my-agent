import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import { readFileSync, statSync, existsSync } from 'fs';
import {
  validatePathSafety,
  getWorkspaceRoot,
  MAX_FILE_READ_BYTES,
  MAX_FILE_READ_LINES,
  LARGE_RESULT_THRESHOLD,
  isBinaryByContent,
} from './safe-paths.js';

export interface FileReadParams {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface FileReadResult {
  filePath: string;
  content: string;
  startLine: number;
  returnedLines: number;
  totalLines: number;
  truncated: boolean;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

function extractLines(text: string, offset: number, limit: number): { content: string; returnedLines: number } {
  const lines = text.split('\n');
  const startIdx = Math.max(0, offset - 1);
  const endIdx = Math.min(lines.length, startIdx + limit);
  const selectedLines = lines.slice(startIdx, endIdx);
  return {
    content: selectedLines.join('\n'),
    returnedLines: selectedLines.length,
  };
}

export function createFileReadTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileReadParams;

    if (!typedParams.filePath) {
      return {
        success: false,
        error: {
          code: 'MISSING_FILE_PATH',
          message: 'filePath parameter is required',
          recoverable: true,
        },
      };
    }

    const workspaceRoot = getWorkspaceRoot();
    const safetyResult = validatePathSafety(typedParams.filePath, workspaceRoot);

    if (!safetyResult.safe) {
      return {
        success: false,
        error: {
          code: safetyResult.error?.code ?? 'PATH_UNSAFE',
          message: safetyResult.error?.message ?? 'Path validation failed',
          recoverable: false,
        },
      };
    }

    const canonicalPath = safetyResult.canonicalPath!;

    if (!existsSync(canonicalPath)) {
      return {
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: `File not found: ${safetyResult.relativePath}`,
          recoverable: true,
        },
      };
    }

    const stats = statSync(canonicalPath);
    if (!stats.isFile()) {
      return {
        success: false,
        error: {
          code: 'NOT_A_FILE',
          message: `Path is not a file: ${safetyResult.relativePath}`,
          recoverable: false,
        },
      };
    }

    if (stats.size > MAX_FILE_READ_BYTES) {
      return {
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${MAX_FILE_READ_BYTES} bytes (${stats.size} bytes)`,
          recoverable: false,
        },
      };
    }

    let buffer: Buffer;
    try {
      buffer = readFileSync(canonicalPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error reading file';
      return {
        success: false,
        error: {
          code: 'READ_ERROR',
          message: `Failed to read file: ${message}`,
          recoverable: false,
        },
      };
    }

    if (isBinaryByContent(buffer)) {
      return {
        success: false,
        error: {
          code: 'BINARY_FILE',
          message: 'File appears to be binary (contains null bytes)',
          recoverable: false,
        },
      };
    }

    const text = buffer.toString('utf-8');
    const totalLines = countLines(text);
    const offset = typedParams.offset ?? 1;
    const limit = Math.min(typedParams.limit ?? MAX_FILE_READ_LINES, MAX_FILE_READ_LINES);
    const { content, returnedLines } = extractLines(text, offset, limit);
    const truncated = returnedLines < totalLines - (offset - 1);

    const result: FileReadResult = {
      filePath: safetyResult.relativePath!,
      content,
      startLine: offset,
      returnedLines,
      totalLines,
      truncated,
    };

    const resultJson = JSON.stringify(result);

    if (resultJson.length > LARGE_RESULT_THRESHOLD && context.stores?.toolExecutionStore) {
      context.stores.toolExecutionStore.saveResult(context.toolCallId, {
        preview: content.slice(0, 500),
        structuredContent: result as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      data: result,
      resultPreview: `Read ${returnedLines} line(s) from ${safetyResult.relativePath}${truncated ? ' (truncated)' : ''}`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'file_read',
    description: 'Read file content with workspace boundary enforcement and safety checks',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to read (relative to workspace root or absolute)',
        },
        offset: {
          type: 'number',
          description: 'Starting line number (1-indexed, default: 1)',
        },
        limit: {
          type: 'number',
          description: `Maximum number of lines to return (default: ${MAX_FILE_READ_LINES}, max: ${MAX_FILE_READ_LINES})`,
        },
      },
      required: ['filePath'],
    },
    handler,
  };
}
