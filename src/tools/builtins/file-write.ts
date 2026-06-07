import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { ToolExecutionContext } from '../types.js'
import { existsSync } from 'fs'
import { validateWritePathSafety, writeTextFileAtomic, getWorkspaceRoot } from './safe-file-write.js'

export interface FileWriteParams {
  filePath: string
  content: string
  overwrite?: boolean
  createDirs?: boolean
  expectedHash?: string
}

export interface FileWriteResult {
  filePath: string
  bytesWritten: number
  created: boolean
  previousHash?: string
  newHash: string
}

export function createFileWriteTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileWriteParams

    if (!typedParams.filePath) {
      return {
        success: false,
        error: {
          code: 'MISSING_FILE_PATH',
          message: 'filePath parameter is required',
          recoverable: true,
        },
      }
    }

    if (typedParams.content === undefined || typedParams.content === null) {
      return {
        success: false,
        error: {
          code: 'MISSING_CONTENT',
          message: 'content parameter is required',
          recoverable: true,
        },
      }
    }

    const workspaceRoot = getWorkspaceRoot()

    // Validate path safety
    const safetyResult = validateWritePathSafety(typedParams.filePath, workspaceRoot, { allowNew: true })

    if (!safetyResult.safe) {
      return {
        success: false,
        error: {
          code: safetyResult.error?.code ?? 'PATH_UNSAFE',
          message: safetyResult.error?.message ?? 'Path validation failed',
          recoverable: false,
        },
      }
    }

    const canonicalPath = safetyResult.canonicalPath!
    const fileExists = existsSync(canonicalPath)

    // Check overwrite policy
    if (fileExists && typedParams.overwrite !== true) {
      return {
        success: false,
        error: {
          code: 'FILE_EXISTS',
          message: `File already exists: ${safetyResult.relativePath}. Use overwrite: true to replace it.`,
          recoverable: true,
        },
      }
    }

    // Attempt atomic write
    try {
      const result = writeTextFileAtomic({
        filePath: typedParams.filePath,
        content: typedParams.content,
        workspaceRoot,
        expectedHash: typedParams.expectedHash,
        createDirs: typedParams.createDirs,
      })

      const writeResult: FileWriteResult = {
        filePath: result.filePath,
        bytesWritten: result.bytesWritten,
        created: result.created,
        previousHash: result.previousHash,
        newHash: result.newHash,
      }

      // Build result preview (MUST NOT include full content)
      const hashPrefix = result.newHash.slice(0, 8)
      const preview = `${result.filePath}: wrote ${result.bytesWritten} bytes, hash ${hashPrefix}`

      return {
        success: true,
        data: writeResult,
        resultPreview: preview,
        structuredContent: writeResult as unknown as Record<string, unknown>,
      }
    } catch (err) {
      const error = err as Error & { code?: string }

      return {
        success: false,
        error: {
          code: error.code ?? 'WRITE_ERROR',
          message: error.message,
          recoverable: error.code === 'HASH_MISMATCH' || error.code === 'PARENT_DIR_NOT_FOUND',
        },
      }
    }
  }

  return {
    name: 'file_write',
    description: 'Write content to a file in the workspace with atomic write, hash verification, and safety checks',
    category: 'write',
    sensitivity: 'high',
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to write (relative to workspace root or absolute)',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite an existing file (default: false)',
        },
        createDirs: {
          type: 'boolean',
          description: 'Whether to create parent directories if they do not exist (default: false)',
        },
        expectedHash: {
          type: 'string',
          description:
            'Expected SHA-256 hash of existing file. If provided, the write will fail if the hash does not match.',
        },
      },
      required: ['filePath', 'content'],
    },
    handler,
  }
}
