/**
 * Safe File Write Helpers
 *
 * Provides atomic write operations with safety checks for the file-write tool family.
 * All writes are workspace-bound, reject binary content, and use temp+rename for atomicity.
 */

import { createHash, randomBytes } from 'crypto'
import { writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync, readFileSync, statSync, realpathSync } from 'fs'
import { dirname, basename, resolve, relative, isAbsolute, join } from 'path'
import { getWorkspaceRoot } from './safe-paths.js'
import { SENSITIVE_FILE_PATTERNS, BINARY_EXTENSIONS } from './safe-paths.js'
import { validateWorkdirWritePath } from '../../workdirs/workdir-paths.js'

export { getWorkspaceRoot }

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum bytes to write to a file (512 KiB)
 */
export const MAX_FILE_WRITE_BYTES = 512 * 1024

/**
 * Maximum bytes to read for editing a file (512 KiB)
 */
export const MAX_FILE_EDIT_BYTES = 512 * 1024

/**
 * Maximum bytes for patch content (1 MiB)
 */
export const MAX_PATCH_BYTES = 1024 * 1024

// ============================================================================
// Hash Functions
// ============================================================================

/**
 * Compute SHA-256 hash of text content (UTF-8)
 */
export function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Compute SHA-256 hash of a buffer
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// ============================================================================
// Path Safety for Writes
// ============================================================================

export interface WritePathSafetyResult {
  safe: boolean
  canonicalPath?: string
  relativePath?: string
  error?: {
    code: string
    message: string
  }
}

/**
 * Validate a path for safe writing
 *
 * Wraps validatePathSafety with support for new file creation.
 *
 * @param filePath - Path to validate
 * @param workspaceRoot - Workspace root (optional, uses getWorkspaceRoot() by default)
 * @param options - Validation options
 * @returns Safety result with canonical path on success
 */
export function validateWritePathSafety(
  filePath: string,
  workspaceRoot?: string,
  options?: {
    allowNew?: boolean
    enforceWorkdirBoundary?: boolean
  },
): WritePathSafetyResult {
  const root = workspaceRoot ?? getWorkspaceRoot()

  // Check for .. escape in the original path
  if (filePath.includes('..')) {
    return {
      safe: false,
      error: {
        code: 'PATH_ESCAPE',
        message: 'Path contains ".." which may escape workspace',
      },
    }
  }

  // Resolve to canonical or absolute path
  let canonicalPath: string
  if (isAbsolute(filePath)) {
    // For absolute paths, resolve canonical if exists, otherwise use as-is
    if (existsSync(filePath)) {
      canonicalPath = realpathSync(filePath)
    } else {
      canonicalPath = filePath
    }
  } else {
    canonicalPath = resolve(root, filePath)
  }

  // Check workspace boundary
  const relativePath = relative(root, canonicalPath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return {
      safe: false,
      error: {
        code: 'OUTSIDE_WORKSPACE',
        message: 'Path resolves outside workspace root',
      },
    }
  }

  if (options?.enforceWorkdirBoundary) {
    const workdirValidation = validateWorkdirWritePath(canonicalPath, root)
    if (!workdirValidation.ok) {
      return {
        safe: false,
        error: workdirValidation.error,
      }
    }
  }

  // Check sensitive file denylist
  const fileName = basename(relativePath)
  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(relativePath) || pattern.test(fileName)) {
      return {
        safe: false,
        error: {
          code: 'SENSITIVE_FILE',
          message: `File matches sensitive pattern: ${pattern.source}`,
        },
      }
    }
  }

  // Check binary file extension
  const ext = (basename(relativePath).split('.').pop() || '').toLowerCase()
  if (ext && BINARY_EXTENSIONS.includes(`.${ext}`)) {
    return {
      safe: false,
      error: {
        code: 'BINARY_FILE',
        message: `File has binary extension: .${ext}`,
      },
    }
  }

  // For new files, check parent directory safety
  if (!existsSync(canonicalPath)) {
    if (options?.allowNew) {
      const parentDir = dirname(canonicalPath)
      if (!existsSync(parentDir)) {
        // Parent doesn't exist - this is okay, will be created by createDirs option
        return {
          safe: true,
          canonicalPath,
          relativePath,
        }
      }

      // Parent exists - check it's within workspace
      try {
        const parentCanonical = realpathSync(parentDir)
        const parentRelative = relative(root, parentCanonical)
        if (parentRelative.startsWith('..') || isAbsolute(parentRelative)) {
          return {
            safe: false,
            error: {
              code: 'OUTSIDE_WORKSPACE',
              message: 'Parent directory resolves outside workspace root',
            },
          }
        }
      } catch {
        return {
          safe: false,
          error: {
            code: 'PATH_UNSAFE',
            message: 'Failed to resolve parent directory',
          },
        }
      }
    }
  }

  return {
    safe: true,
    canonicalPath,
    relativePath,
  }
}

// ============================================================================
// Atomic Write Operations
// ============================================================================

export interface WriteTextFileAtomicParams {
  filePath: string
  content: string
  workspaceRoot?: string
  expectedHash?: string
  createDirs?: boolean
  enforceWorkdirBoundary?: boolean
}

export interface WriteTextFileAtomicResult {
  filePath: string
  bytesWritten: number
  newHash: string
  previousHash?: string
  created: boolean
}

/**
 * Write text content to a file atomically
 *
 * Uses temp file + rename pattern for atomicity.
 * Validates content for NUL bytes (binary rejection).
 * Checks expectedHash before writing if provided.
 * Cleans up temp file on failure.
 *
 * @param params - Write parameters
 * @returns Write result with hashes and metadata
 * @throws Error with code field for specific failures
 */
export function writeTextFileAtomic(params: WriteTextFileAtomicParams): WriteTextFileAtomicResult {
  const { filePath, content, workspaceRoot, expectedHash, createDirs, enforceWorkdirBoundary } = params
  const root = workspaceRoot ?? getWorkspaceRoot()

  // Validate content for binary (NUL bytes)
  if (content.includes('\0')) {
    throw Object.assign(new Error('Content contains NUL bytes (binary content rejected)'), {
      code: 'BINARY_CONTENT',
    })
  }

  // Check content size
  const byteSize = Buffer.byteLength(content, 'utf8')
  if (byteSize > MAX_FILE_WRITE_BYTES) {
    throw Object.assign(
      new Error(`Content exceeds maximum size of ${MAX_FILE_WRITE_BYTES} bytes (${byteSize} bytes)`),
      { code: 'CONTENT_TOO_LARGE' },
    )
  }

  // Validate path safety
  const safety = validateWritePathSafety(filePath, root, { allowNew: true, enforceWorkdirBoundary })
  if (!safety.safe) {
    throw Object.assign(new Error(safety.error?.message ?? 'Path validation failed'), {
      code: safety.error?.code ?? 'PATH_UNSAFE',
    })
  }

  const canonicalPath = safety.canonicalPath!
  const fileExists = existsSync(canonicalPath)

  // Check hash if file exists
  let previousHash: string | undefined
  if (fileExists) {
    const existingContent = readFileSync(canonicalPath, 'utf8')
    previousHash = sha256Text(existingContent)

    if (expectedHash !== undefined && previousHash !== expectedHash) {
      throw Object.assign(new Error(`Hash mismatch: expected ${expectedHash}, got ${previousHash}`), {
        code: 'HASH_MISMATCH',
      })
    }
  } else {
    // File doesn't exist - if expectedHash provided, it's a mismatch
    if (expectedHash !== undefined) {
      throw Object.assign(new Error(`Hash mismatch: file does not exist but expectedHash provided`), {
        code: 'HASH_MISMATCH',
      })
    }
  }

  // Create parent directories if needed
  const parentDir = dirname(canonicalPath)
  if (!existsSync(parentDir)) {
    if (createDirs) {
      mkdirSync(parentDir, { recursive: true })
    } else {
      throw Object.assign(new Error(`Parent directory does not exist: ${dirname(safety.relativePath!)}`), {
        code: 'PARENT_DIR_NOT_FOUND',
      })
    }
  }

  // Write to temp file first
  const randomId = randomBytes(8).toString('hex')
  const tempPath = join(parentDir, `.${basename(canonicalPath)}.tmp-${randomId}`)

  try {
    writeFileSync(tempPath, content, 'utf8')

    // Atomic rename
    renameSync(tempPath, canonicalPath)
  } catch (err) {
    // Clean up temp file on failure
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Ignore cleanup errors
    }

    const message = err instanceof Error ? err.message : 'Unknown error writing file'
    throw Object.assign(new Error(`Failed to write file: ${message}`), {
      code: 'WRITE_ERROR',
    })
  }

  const newHash = sha256Text(content)

  return {
    filePath: safety.relativePath!,
    bytesWritten: byteSize,
    newHash,
    previousHash: fileExists ? previousHash : undefined,
    created: !fileExists,
  }
}

// ============================================================================
// Read for Edit Operations
// ============================================================================

export interface ReadTextFileForEditParams {
  filePath: string
  workspaceRoot?: string
  enforceWorkdirBoundary?: boolean
}

export interface ReadTextFileForEditResult {
  content: string
  hash: string
  exists: boolean
}

/**
 * Read a file for editing purposes
 *
 * Returns empty content and special hash for non-existent files.
 * Enforces size limit for editing.
 *
 * @param params - Read parameters
 * @returns File content and hash, or empty if not exists
 */
export function readTextFileForEdit(params: ReadTextFileForEditParams): ReadTextFileForEditResult {
  const { filePath, workspaceRoot, enforceWorkdirBoundary } = params
  const root = workspaceRoot ?? getWorkspaceRoot()

  // Validate path safety
  const safety = validateWritePathSafety(filePath, root, { allowNew: true, enforceWorkdirBoundary })
  if (!safety.safe) {
    throw Object.assign(new Error(safety.error?.message ?? 'Path validation failed'), {
      code: safety.error?.code ?? 'PATH_UNSAFE',
    })
  }

  const canonicalPath = safety.canonicalPath!

  // Check if file exists
  if (!existsSync(canonicalPath)) {
    // Return empty result for non-existent files
    return {
      content: '',
      hash: sha256Text(''),
      exists: false,
    }
  }

  // Check file size
  const stats = statSync(canonicalPath)
  if (stats.size > MAX_FILE_EDIT_BYTES) {
    throw Object.assign(new Error(`File exceeds maximum size for editing (${MAX_FILE_EDIT_BYTES} bytes)`), {
      code: 'CONTENT_TOO_LARGE',
    })
  }

  // Read content
  const content = readFileSync(canonicalPath, 'utf8')
  const hash = sha256Text(content)

  return {
    content,
    hash,
    exists: true,
  }
}
