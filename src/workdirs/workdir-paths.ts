/**
 * Workdir Path Resolver
 *
 * Manages the canonical workdir root, safe ID/path segment validation,
 * tenant/user/workdir managed path construction, directory creation,
 * path-inside-workdir checks, and quota constants.
 *
 * This module does NOT touch tool execution. It provides pure path
 * primitives consumed by the workdir service, storage, and API layers.
 */

import { realpathSync, mkdirSync, existsSync, statSync } from 'fs'
import { resolve, relative, isAbsolute, join, dirname } from 'path'

// ============================================================================
// Constants
// ============================================================================

/** Default workdir root relative to cwd. */
const DEFAULT_WORKDIR_ROOT = './data/workdirs'

/** Maximum length for a workdir ID or user ID segment. */
export const WORKDIR_MAX_NAME_LENGTH = 128

/** Maximum directory depth from workdir root (e.g., /root/user/workdir = 2). */
export const WORKDIR_MAX_DEPTH = 3

/** Per-workdir storage quota in bytes (1 GiB). Enforced elsewhere. */
export const WORKDIR_QUOTA_BYTES = 1024 * 1024 * 1024

/** Maximum single file size in bytes (100 MiB). */
export const WORKDIR_MAX_FILE_BYTES = 100 * 1024 * 1024

export const WORKDIR_MAX_FILES = 100_000

/**
 * Regex that matches a valid workdir/user ID segment.
 * Allowed: alphanumeric, hyphens, underscores. No leading/trailing hyphens.
 * Min 1 character, max WORKDIR_MAX_NAME_LENGTH.
 */
const VALID_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,126}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/

// ============================================================================
// Error codes
// ============================================================================

export type WorkdirPathErrorCode =
  | 'WORKDIR_PATH_TRAVERSAL'
  | 'WORKDIR_ESCAPE'
  | 'WORKDIR_INVALID_ID'
  | 'WORKDIR_ID_TOO_LONG'
  | 'WORKDIR_DEPTH_EXCEEDED'
  | 'WORKDIR_SYMLINK_ESCAPE'
  | 'WORKDIR_ROOT_UNRESOLVABLE'
  | 'WORKDIR_HARDLINK_BOUNDARY'

export interface WorkdirPathError {
  code: WorkdirPathErrorCode
  message: string
}

export interface WorkdirPathResult {
  ok: true
  canonicalPath: string
  relativePath: string
}

export interface WorkdirPathFailure {
  ok: false
  error: WorkdirPathError
}

export type WorkdirPathValidation = WorkdirPathResult | WorkdirPathFailure

// ============================================================================
// Root resolution
// ============================================================================

let cachedRoot: string | undefined

/**
 * Return the canonical workdir root directory.
 *
 * Resolution order:
 * 1. `WORKDIR_ROOT` env var (if set and non-empty)
 * 2. Default `./data/workdirs` relative to cwd
 *
 * The directory is created (with parents) on first call if it does not exist,
 * then canonicalized via `realpathSync`. The result is cached; call
 * `resetWorkdirRootCache()` in tests to clear.
 */
export function getWorkdirRoot(): string {
  if (cachedRoot) {
    return cachedRoot
  }

  const rawRoot = process.env.WORKDIR_ROOT?.trim() || DEFAULT_WORKDIR_ROOT
  const absoluteRoot = isAbsolute(rawRoot) ? rawRoot : resolve(process.cwd(), rawRoot)

  // Ensure the directory exists (idempotent)
  if (!existsSync(absoluteRoot)) {
    mkdirSync(absoluteRoot, { recursive: true })
  }

  cachedRoot = realpathSync(absoluteRoot)
  return cachedRoot
}

/**
 * Reset the cached workdir root. Useful for testing env overrides.
 */
export function resetWorkdirRootCache(): void {
  cachedRoot = undefined
}

// ============================================================================
// ID sanitization
// ============================================================================

/**
 * Validate and sanitize a workdir or user ID segment.
 *
 * Rules:
 * - Must be non-empty
 * - Max WORKDIR_MAX_NAME_LENGTH characters
 * - Only alphanumeric, hyphens, underscores
 * - Must start and end with alphanumeric (single-char alphanumeric OK)
 * - Rejects path traversal (`..`, `/`, `\`)
 * - Rejects absolute paths
 *
 * Returns the sanitized (trimmed) ID on success, or throws on failure.
 */
export function sanitizeWorkdirId(id: string): string {
  const trimmed = id.trim()

  if (trimmed.length === 0) {
    throw new WorkdirPathValidationError('WORKDIR_INVALID_ID', 'ID must not be empty')
  }

  if (trimmed.length > WORKDIR_MAX_NAME_LENGTH) {
    throw new WorkdirPathValidationError(
      'WORKDIR_ID_TOO_LONG',
      `ID exceeds maximum length of ${WORKDIR_MAX_NAME_LENGTH}`,
    )
  }

  // Reject path traversal characters
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new WorkdirPathValidationError('WORKDIR_PATH_TRAVERSAL', 'ID must not contain path separators or ".."')
  }

  // Reject absolute paths
  if (isAbsolute(trimmed)) {
    throw new WorkdirPathValidationError('WORKDIR_PATH_TRAVERSAL', 'ID must not be an absolute path')
  }

  // Reject null bytes
  if (trimmed.includes('\0')) {
    throw new WorkdirPathValidationError('WORKDIR_INVALID_ID', 'ID must not contain null bytes')
  }

  if (!VALID_ID_PATTERN.test(trimmed)) {
    throw new WorkdirPathValidationError(
      'WORKDIR_INVALID_ID',
      'ID must contain only alphanumeric characters, hyphens, and underscores; must start and end with alphanumeric',
    )
  }

  return trimmed
}

// ============================================================================
// Path construction
// ============================================================================

/**
 * Build a managed workdir path: `<workdirRoot>/<userId>/<workdirId>`.
 *
 * Both `userId` and `workdirId` are sanitized before construction.
 * The resulting path is NOT canonicalized (it may not exist yet).
 *
 * @throws WorkdirPathValidationError if either ID is invalid.
 */
export function buildWorkdirPath(workdirRoot: string, userId: string, workdirId: string): string {
  const safeUserId = sanitizeWorkdirId(userId)
  const safeWorkdirId = sanitizeWorkdirId(workdirId)
  return join(workdirRoot, safeUserId, safeWorkdirId)
}

/**
 * Create a directory (and parents) if it does not already exist.
 * Idempotent: no error if the directory already exists.
 *
 * @throws if mkdir fails for a reason other than EEXIST.
 */
export function ensureWorkdirDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

// ============================================================================
// Path safety checks
// ============================================================================

/**
 * Check whether `candidatePath` is inside `workdirRoot` after canonicalization.
 *
 * For non-existent paths, falls back to `resolve()` without `realpathSync`
 * (since the path may not exist yet). Symlinks that exist are fully resolved.
 */
export function isWithinWorkdir(candidatePath: string, workdirRoot: string): boolean {
  const root = workdirRoot
  let canonical: string

  if (existsSync(candidatePath)) {
    try {
      canonical = realpathSync(candidatePath)
    } catch {
      // Path exists but can't be resolved (broken symlink, permission, etc.)
      return false
    }
  } else {
    canonical = resolve(candidatePath)
  }

  const rel = relative(root, canonical)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Validate that a path is safely inside the workdir root.
 *
 * Checks (in order):
 * 1. No `..` segments in the raw path
 * 2. Resolved canonical path is inside workdir root
 * 3. Depth from root does not exceed WORKDIR_MAX_DEPTH
 *
 * @returns A discriminated union: `{ ok: true, canonicalPath, relativePath }` or
 *          `{ ok: false, error: { code, message } }`.
 */
export function validateWorkdirPath(candidatePath: string, workdirRoot: string): WorkdirPathValidation {
  return _validateWorkdirPath(candidatePath, workdirRoot, false)
}

/**
 * Validate a path for write/create operations.
 *
 * In addition to `validateWorkdirPath` checks, this resolves the nearest
 * existing ancestor with `realpathSync` to detect symlinked parent directories
 * that would cause the new file/directory to be created outside the workdir
 * even though the non-existent leaf path appears inside.
 */
export function validateWorkdirWritePath(candidatePath: string, workdirRoot: string): WorkdirPathValidation {
  return _validateWorkdirPath(candidatePath, workdirRoot, true)
}

function _validateWorkdirPath(
  candidatePath: string,
  workdirRoot: string,
  checkWriteParent: boolean,
): WorkdirPathValidation {
  if (candidatePath.includes('..')) {
    return {
      ok: false,
      error: {
        code: 'WORKDIR_PATH_TRAVERSAL',
        message: 'Path contains ".." which may escape the workdir boundary',
      },
    }
  }

  if (checkWriteParent) {
    const nearest = resolveNearestExistingAncestor(candidatePath)
    if (nearest.exists) {
      let canonicalAncestor: string
      try {
        canonicalAncestor = realpathSync(nearest.path)
      } catch {
        return {
          ok: false,
          error: {
            code: 'WORKDIR_ROOT_UNRESOLVABLE',
            message: 'Nearest existing path ancestor could not be canonicalized',
          },
        }
      }
      const ancestorRel = relative(workdirRoot, canonicalAncestor)
      if (ancestorRel.startsWith('..') || isAbsolute(ancestorRel)) {
        return {
          ok: false,
          error: {
            code: 'WORKDIR_SYMLINK_ESCAPE',
            message: 'Path resolves through a symlinked directory outside the workdir root boundary',
          },
        }
      }
    }
  }

  let canonical: string
  if (existsSync(candidatePath)) {
    try {
      canonical = realpathSync(candidatePath)
    } catch {
      return {
        ok: false,
        error: {
          code: 'WORKDIR_ROOT_UNRESOLVABLE',
          message: 'Path exists but could not be canonicalized',
        },
      }
    }
  } else {
    canonical = resolve(candidatePath)
  }

  const rel = relative(workdirRoot, canonical)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      ok: false,
      error: {
        code: 'WORKDIR_ESCAPE',
        message: 'Path resolves outside the workdir root boundary',
      },
    }
  }

  const segments = rel.split('/').filter((s) => s.length > 0)
  if (segments.length > WORKDIR_MAX_DEPTH) {
    return {
      ok: false,
      error: {
        code: 'WORKDIR_DEPTH_EXCEEDED',
        message: `Path depth ${segments.length} exceeds maximum allowed depth of ${WORKDIR_MAX_DEPTH}`,
      },
    }
  }

  if (existsSync(canonical) && hasMultipleLinks(canonical)) {
    return {
      ok: false,
      error: {
        code: 'WORKDIR_HARDLINK_BOUNDARY',
        message: 'Hardlinked files cannot be accessed through the managed workdir boundary',
      },
    }
  }

  return { ok: true, canonicalPath: canonical, relativePath: rel }
}

function hasMultipleLinks(filePath: string): boolean {
  try {
    const stats = statSync(filePath)
    return stats.isFile() && stats.nlink > 1
  } catch {
    return false
  }
}

function resolveNearestExistingAncestor(candidatePath: string): { path: string; exists: boolean } {
  let current = candidatePath
  while (current !== dirname(current)) {
    if (existsSync(current)) {
      return { path: current, exists: true }
    }
    current = dirname(current)
  }
  if (existsSync(current)) {
    return { path: current, exists: true }
  }
  return { path: candidatePath, exists: false }
}

export class WorkdirPathValidationError extends Error {
  public readonly code: WorkdirPathErrorCode

  constructor(code: WorkdirPathErrorCode, message: string) {
    super(message)
    this.name = 'WorkdirPathValidationError'
    this.code = code
  }
}
