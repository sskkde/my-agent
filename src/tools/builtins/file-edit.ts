import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import {
  validateWritePathSafety,
  readTextFileForEdit,
  writeTextFileAtomic,
  getWorkspaceRoot,
} from './safe-file-write.js';

export interface FileEditParams {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  expectedHash?: string;
}

export interface FileEditResult {
  filePath: string;
  replaced: number;
  newHash: string;
}

export function createFileEditTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileEditParams;

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

    if (typedParams.oldString === undefined || typedParams.oldString === null) {
      return {
        success: false,
        error: {
          code: 'MISSING_OLD_STRING',
          message: 'oldString parameter is required',
          recoverable: true,
        },
      };
    }

    if (typedParams.newString === undefined || typedParams.newString === null) {
      return {
        success: false,
        error: {
          code: 'MISSING_NEW_STRING',
          message: 'newString parameter is required',
          recoverable: true,
        },
      };
    }

    // Reject empty oldString
    if (typedParams.oldString === '') {
      return {
        success: false,
        error: {
          code: 'EMPTY_OLD_STRING',
          message: 'oldString cannot be empty',
          recoverable: false,
        },
      };
    }

    const workspaceRoot = getWorkspaceRoot();

    // Validate path safety
    const safetyResult = validateWritePathSafety(typedParams.filePath, workspaceRoot, { allowNew: false });

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

    // Read file for editing
    let readResult;
    try {
      readResult = readTextFileForEdit({
        filePath: typedParams.filePath,
        workspaceRoot,
      });
    } catch (err) {
      const error = err as Error & { code?: string };
      return {
        success: false,
        error: {
          code: error.code ?? 'READ_ERROR',
          message: error.message,
          recoverable: false,
        },
      };
    }

    // Check if file exists
    if (!readResult.exists) {
      return {
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: `File not found: ${safetyResult.relativePath}`,
          recoverable: true,
        },
      };
    }

    // Check expected hash if provided
    if (typedParams.expectedHash !== undefined && readResult.hash !== typedParams.expectedHash) {
      return {
        success: false,
        error: {
          code: 'HASH_MISMATCH',
          message: `Hash mismatch: expected ${typedParams.expectedHash}, got ${readResult.hash}`,
          recoverable: true,
        },
      };
    }

    // Count matches
    const content = readResult.content;
    const oldString = typedParams.oldString;
    let matchCount = 0;
    let searchPos = 0;

    while (true) {
      const idx = content.indexOf(oldString, searchPos);
      if (idx === -1) break;
      matchCount++;
      searchPos = idx + 1;
    }

    // Handle match cases
    if (matchCount === 0) {
      return {
        success: false,
        error: {
          code: 'NO_MATCH',
          message: `oldString not found in file: ${safetyResult.relativePath}`,
          recoverable: true,
        },
      };
    }

    if (matchCount > 1 && typedParams.replaceAll !== true) {
      return {
        success: false,
        error: {
          code: 'AMBIGUOUS_MATCH',
          message: `Found ${matchCount} matches of oldString. Use replaceAll: true to replace all occurrences.`,
          recoverable: true,
        },
      };
    }

    // Perform replacement
    let newContent: string;
    if (typedParams.replaceAll === true) {
      newContent = content.split(oldString).join(typedParams.newString);
    } else {
      const idx = content.indexOf(oldString);
      newContent = content.slice(0, idx) + typedParams.newString + content.slice(idx + oldString.length);
    }

    // Write back atomically
    try {
      const writeResult = writeTextFileAtomic({
        filePath: typedParams.filePath,
        content: newContent,
        workspaceRoot,
        expectedHash: readResult.hash,
        createDirs: false,
      });

      const editResult: FileEditResult = {
        filePath: writeResult.filePath,
        replaced: typedParams.replaceAll === true ? matchCount : 1,
        newHash: writeResult.newHash,
      };

      // Build result preview (MUST NOT include newString)
      const hashPrefix = writeResult.newHash.slice(0, 8);
      const preview = `${editResult.filePath}: replaced ${editResult.replaced} occurrence(s), hash ${hashPrefix}`;

      return {
        success: true,
        data: editResult,
        resultPreview: preview,
        structuredContent: editResult as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      
      return {
        success: false,
        error: {
          code: error.code ?? 'WRITE_ERROR',
          message: error.message,
          recoverable: false,
        },
      };
    }
  };

  return {
    name: 'file_edit',
    description: 'Edit a file by replacing a specific string in the workspace',
    category: 'write',
    sensitivity: 'high',
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to edit (relative to workspace root or absolute)',
        },
        oldString: {
          type: 'string',
          description: 'The exact string to replace (cannot be empty)',
        },
        newString: {
          type: 'string',
          description: 'The string to replace oldString with',
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace all occurrences of oldString (default: false)',
        },
        expectedHash: {
          type: 'string',
          description: 'Expected SHA-256 hash of the file. If provided, the edit will fail if the hash does not match.',
        },
      },
      required: ['filePath', 'oldString', 'newString'],
    },
    handler,
  };
}
