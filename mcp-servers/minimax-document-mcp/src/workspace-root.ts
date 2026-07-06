import * as fs from 'node:fs/promises'
import { createSandboxError } from './sandbox.js'

export async function resolveDocumentWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configuredRoot = env.MINIMAX_DOCUMENT_WORKSPACE_ROOT?.trim()
  const root = configuredRoot && configuredRoot.length > 0 ? configuredRoot : process.cwd()
  try {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) {
      throw createSandboxError('file_not_found', `Document workspace root is not a directory: ${root}`)
    }
    return await fs.realpath(root)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      throw error
    }
    throw createSandboxError('file_not_found', `Document workspace root not found: ${root}`)
  }
}
