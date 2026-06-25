/**
 * Sandbox Workspace Management
 *
 * Per-call temporary directory creation, cleanup, and lifecycle helpers.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface Workspace {
  /** Absolute path to the per-call temp directory */
  root: string
  /** Unique workspace ID for this call */
  id: string
}

/**
 * Creates a per-call temporary workspace directory.
 */
export async function createWorkspace(prefix = 'mcp-sandbox'): Promise<Workspace> {
  const id = randomUUID()
  const root = path.join(os.tmpdir(), `${prefix}-${id}`)
  await fs.mkdir(root, { recursive: true })
  return { root, id }
}

/**
 * Recursively removes a workspace directory and all its contents.
 * Never throws — logs errors to stderr instead.
 */
export async function cleanupWorkspace(workspace: Workspace): Promise<void> {
  try {
    await fs.rm(workspace.root, { recursive: true, force: true })
  } catch (error: unknown) {
    console.error(`[sandbox] Failed to cleanup workspace ${workspace.root}:`, error)
  }
}

/**
 * Executes a function within a workspace, guaranteeing cleanup
 * even if the function throws.
 */
export async function withWorkspace<T>(
  fn: (workspace: Workspace) => Promise<T>,
  prefix?: string,
): Promise<T> {
  const workspace = await createWorkspace(prefix)
  try {
    return await fn(workspace)
  } finally {
    await cleanupWorkspace(workspace)
  }
}
