/**
 * Sandbox Artifact Reference Resolution
 *
 * Resolves artifact metadata from file paths within the workspace,
 * with symlink escape protection.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSandboxError, type ArtifactReference } from './sandbox-errors.js'
import { isSandboxError, isNodeError } from './sandbox-guards.js'
import type { Workspace } from './sandbox-workspace.js'

/**
 * Resolves an artifact reference from a file path within the workspace.
 * Creates the artifact metadata without reading the file into memory.
 *
 * Defends against symlink escape by verifying the real path of the file
 * is within the workspace boundary.
 */
export async function resolveArtifactRef(
  workspace: Workspace,
  filePath: string,
  mimeType: string,
  downloadUrlBase = 'mcp-artifact://',
): Promise<ArtifactReference> {
  // Verify file is within workspace (string check)
  if (!filePath.startsWith(workspace.root + path.sep) && filePath !== workspace.root) {
    throw createSandboxError(
      'path_traversal',
      `Artifact path ${filePath} is outside workspace`,
    )
  }

  // Verify real path (symlink escape protection)
  try {
    const realPath = await fs.realpath(filePath)
    if (!realPath.startsWith(workspace.root + path.sep) && realPath !== workspace.root) {
      throw createSandboxError(
        'symlink_escape',
        `Artifact path symlinks outside workspace: ${filePath}`,
      )
    }
  } catch (error: unknown) {
    if (isSandboxError(error)) throw error
    if (isNodeError(error) && error.code !== 'ENOENT') {
      throw error
    }
    // ENOENT is fine — will be caught by the stat check below
  }

  // Get file stats without reading content
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw createSandboxError(
      'file_not_found',
      `Artifact file not found: ${path.basename(filePath)}`,
    )
  }

  if (!stat.isFile()) {
    throw createSandboxError(
      'file_not_found',
      `Artifact path is not a file: ${path.basename(filePath)}`,
    )
  }

  const fileId = randomUUID()
  const fileName = path.basename(filePath)

  return {
    fileId,
    fileName,
    mimeType,
    sizeBytes: stat.size,
    downloadUrl: `${downloadUrlBase}${fileId}`,
  }
}
