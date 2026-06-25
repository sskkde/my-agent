/**
 * Sandbox Path Safety
 *
 * Normalizes user-supplied paths and verifies they stay within the workspace.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createSandboxError } from './sandbox-errors.js'
import { isSandboxError, isNodeError } from './sandbox-guards.js'
import type { Workspace } from './sandbox-workspace.js'

/**
 * Normalizes a user-supplied path and verifies it stays within the workspace.
 *
 * Rejects:
 * - Absolute paths (e.g., `/etc/passwd`)
 * - `..` traversal (e.g., `../outside.xlsx`)
 * - Symlink escapes (resolved path outside workspace)
 *
 * @param workspace - The workspace to confine paths within
 * @param userPath - User-supplied relative path
 * @returns Resolved absolute path within the workspace
 * @throws SandboxErrorResponse if path is unsafe
 */
export async function normalizePath(workspace: Workspace, userPath: string): Promise<string> {
  // Reject absolute paths
  if (path.isAbsolute(userPath)) {
    throw createSandboxError(
      'absolute_path_rejected',
      `Absolute paths are not allowed: ${userPath}`,
    )
  }

  // Normalize and resolve against workspace root
  const normalized = path.normalize(userPath)
  const resolved = path.resolve(workspace.root, normalized)

  // Check for traversal after resolution
  if (!resolved.startsWith(workspace.root + path.sep) && resolved !== workspace.root) {
    throw createSandboxError(
      'path_traversal',
      `Path traversal detected: ${userPath} resolves outside workspace`,
    )
  }

  // Check for symlink escape: if the file exists, verify the real path
  try {
    const realPath = await fs.realpath(resolved)
    if (!realPath.startsWith(workspace.root + path.sep) && realPath !== workspace.root) {
      throw createSandboxError(
        'symlink_escape',
        `Symlink escape detected: ${userPath} points outside workspace`,
      )
    }
    return realPath
  } catch (error: unknown) {
    // If file doesn't exist yet, that's fine — the resolved path is within workspace
    if (isSandboxError(error)) throw error
    if (isNodeError(error) && error.code === 'ENOENT') {
      return resolved
    }
    throw error
  }
}
