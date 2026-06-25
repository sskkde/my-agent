import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { ToolExecutionContext } from '../types.js'
import { existsSync, unlinkSync } from 'fs'
import {
  validateWritePathSafety,
  writeTextFileAtomic,
  readTextFileForEdit,
  getWorkspaceRoot,
} from './safe-file-write.js'
import { parsePatchText, validateOperations, type FilePatchOperation } from './patch-parser.js'

export interface FileApplyPatchParams {
  operations?: FilePatchOperation[]
  patch?: string
  dryRun?: boolean
}

export interface OperationResult {
  filePath: string
  type: string
  status: 'applied' | 'failed' | 'skipped'
  error?: string
}

export interface FileApplyPatchResult {
  applied: number
  failed: number
  operations: OperationResult[]
  dryRun: boolean
}

export function createFileApplyPatchTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileApplyPatchParams

    // Check for conflicting input
    if (typedParams.operations && typedParams.patch) {
      return {
        success: false,
        error: {
          code: 'CONFLICTING_INPUT',
          message: 'Cannot specify both operations and patch parameters',
          recoverable: false,
        },
      }
    }

    // Check for missing input
    if (!typedParams.operations && !typedParams.patch) {
      return {
        success: false,
        error: {
          code: 'MISSING_INPUT',
          message: 'Either operations or patch parameter is required',
          recoverable: true,
        },
      }
    }

    // Parse patch text if provided
    let operations: FilePatchOperation[]
    try {
      if (typedParams.patch) {
        const parsed = parsePatchText(typedParams.patch)
        operations = parsed.operations
      } else {
        operations = typedParams.operations!
      }
    } catch (err) {
      const error = err as Error & { code?: string }
      return {
        success: false,
        error: {
          code: error.code ?? 'INVALID_PATCH_FORMAT',
          message: error.message,
          recoverable: false,
        },
      }
    }

    // Validate all operations
    const validation = validateOperations(operations)
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: `Validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
          recoverable: false,
        },
      }
    }

    const workspaceRoot = context.workDirRoot ?? getWorkspaceRoot()
    const dryRun = typedParams.dryRun === true
    const results: OperationResult[] = []
    let applied = 0
    let failed = 0

    // Execute operations
    for (const op of operations) {
      // Validate path safety
	      const safetyResult = validateWritePathSafety(op.filePath, workspaceRoot, {
	        allowNew: true,
	        enforceWorkdirBoundary: Boolean(context.workDirRoot),
	      })
      if (!safetyResult.safe) {
        results.push({
          filePath: op.filePath,
          type: op.type,
          status: 'failed',
          error: safetyResult.error?.message ?? 'Path validation failed',
        })
        failed++
        // Stop on first failure in MVP
        break
      }

      if (dryRun) {
        // Dry run - just report what would happen
        results.push({
          filePath: op.filePath,
          type: op.type,
          status: 'skipped',
          error: 'Dry run - no changes made',
        })
        continue
      }

      // Execute operation
      try {
        switch (op.type) {
          case 'add': {
            const canonicalPath = safetyResult.canonicalPath!
            if (existsSync(canonicalPath) && !op.expectedHash) {
              // File exists - reject unless expectedHash is provided
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'failed',
                error: 'File already exists',
              })
              failed++
            } else {
              writeTextFileAtomic({
                filePath: op.filePath,
                content: op.content!,
                workspaceRoot,
                expectedHash: op.expectedHash,
                createDirs: true,
                enforceWorkdirBoundary: Boolean(context.workDirRoot),
              })
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'applied',
              })
              applied++
            }
            break
          }

          case 'update': {
            // Read file first
            const readResult = readTextFileForEdit({
              filePath: op.filePath,
              workspaceRoot,
              enforceWorkdirBoundary: Boolean(context.workDirRoot),
            })

            if (!readResult.exists) {
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'failed',
                error: 'File not found',
              })
              failed++
              break
            }

            // Check hash if provided
            if (op.expectedHash && readResult.hash !== op.expectedHash) {
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'failed',
                error: 'Hash mismatch',
              })
              failed++
              break
            }

            // Replace oldString with newString (no replaceAll for MVP)
            if (!readResult.content.includes(op.oldString!)) {
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'failed',
                error: 'oldString not found in file',
              })
              failed++
              break
            }

            const newContent = readResult.content.replace(op.oldString!, op.newString!)
            writeTextFileAtomic({
              filePath: op.filePath,
              content: newContent,
              workspaceRoot,
              expectedHash: readResult.hash,
              createDirs: false,
              enforceWorkdirBoundary: Boolean(context.workDirRoot),
            })

            results.push({
              filePath: op.filePath,
              type: op.type,
              status: 'applied',
            })
            applied++
            break
          }

          case 'delete': {
            const canonicalPath = safetyResult.canonicalPath!
            if (!existsSync(canonicalPath)) {
              results.push({
                filePath: op.filePath,
                type: op.type,
                status: 'failed',
                error: 'File not found',
              })
              failed++
            } else {
              try {
                unlinkSync(canonicalPath)
                results.push({
                  filePath: op.filePath,
                  type: op.type,
                  status: 'applied',
                })
                applied++
              } catch (err) {
                const error = err as Error
                results.push({
                  filePath: op.filePath,
                  type: op.type,
                  status: 'failed',
                  error: error.message,
                })
                failed++
              }
            }
            break
          }
        }
      } catch (err) {
        const error = err as Error & { code?: string }
        results.push({
          filePath: op.filePath,
          type: op.type,
          status: 'failed',
          error: error.message,
        })
        failed++
        // Stop on first failure in MVP
        break
      }
    }

    const result: FileApplyPatchResult = {
      applied,
      failed,
      operations: results,
      dryRun,
    }

    return {
      success: failed === 0,
      data: result,
      resultPreview: `Applied ${applied} operation(s), failed ${failed}`,
      structuredContent: result as unknown as Record<string, unknown>,
      error:
        failed > 0
          ? {
              code: 'OPERATIONS_FAILED',
              message: `${failed} operation(s) failed`,
              recoverable: true,
            }
          : undefined,
    }
  }

  return {
    name: 'file_apply_patch',
    description: 'Apply a multi-file patch with add/update/delete operations',
    category: 'write',
    sensitivity: 'high',
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'List of file patch operations',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['add', 'update', 'delete'],
                description: 'Operation type',
              },
              filePath: {
                type: 'string',
                description: 'File path (relative to workspace)',
              },
              content: {
                type: 'string',
                description: 'Content for add operation',
              },
              oldString: {
                type: 'string',
                description: 'Old string for update operation',
              },
              newString: {
                type: 'string',
                description: 'New string for update operation',
              },
              expectedHash: {
                type: 'string',
                description: 'Expected file hash (optional)',
              },
            },
            required: ['type', 'filePath'],
          },
        },
        patch: {
          type: 'string',
          description: 'Patch text in MVP format (alternative to operations)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, validate and report but do not write (default: false)',
        },
      },
    },
    handler,
  }
}
