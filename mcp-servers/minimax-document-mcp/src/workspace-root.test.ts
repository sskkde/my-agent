import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveDocumentWorkspaceRoot } from './workspace-root.js'

describe('resolveDocumentWorkspaceRoot', () => {
  it('uses MINIMAX_DOCUMENT_WORKSPACE_ROOT when configured', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-doc-root-'))
    await expect(resolveDocumentWorkspaceRoot({ MINIMAX_DOCUMENT_WORKSPACE_ROOT: root })).resolves.toBe(
      await fs.realpath(root),
    )
    await fs.rm(root, { recursive: true, force: true })
  })

  it('uses process.cwd when no env root is configured', async () => {
    await expect(resolveDocumentWorkspaceRoot({})).resolves.toBe(await fs.realpath(process.cwd()))
  })

  it('rejects missing configured roots', async () => {
    await expect(
      resolveDocumentWorkspaceRoot({ MINIMAX_DOCUMENT_WORKSPACE_ROOT: '/definitely/not/present/minimax' }),
    ).rejects.toSatisfy((error: { error?: { code?: string } }) => error.error?.code === 'file_not_found')
  })
})
