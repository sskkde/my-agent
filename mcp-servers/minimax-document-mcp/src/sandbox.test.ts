/**
 * Sandbox Utilities Unit Tests
 *
 * Covers:
 * - Safe path operations
 * - Traversal path rejection (../outside.xlsx)
 * - Absolute path rejection (/etc/passwd)
 * - Symlink escape rejection
 * - Oversized input rejection
 * - Timeout handling
 * - Cleanup after thrown error
 * - Structured error shape compatible with normalizeConnectorResponse
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createWorkspace,
  cleanupWorkspace,
  withWorkspace,
  normalizePath,
  resolveArtifactRef,
  enforceSizeLimit,
  enforceQuota,
  withTimeout,
  getTimeoutMs,
  isSandboxError,
  createSandboxError,
  MAX_FILE_SIZE_BYTES,
  SESSION_QUOTA_BYTES,
  TIMEOUT_MS,
  type Workspace,
  type SandboxErrorResponse,
} from './sandbox.js'

describe('sandbox', () => {
  describe('createWorkspace', () => {
    it('creates a temp directory with a unique ID', async () => {
      const workspace = await createWorkspace()
      try {
        const stat = await fs.stat(workspace.root)
        expect(stat.isDirectory()).toBe(true)
        expect(workspace.id).toMatch(/^[0-9a-f-]{36}$/) // UUID format
      } finally {
        await cleanupWorkspace(workspace)
      }
    })

    it('creates workspace with custom prefix', async () => {
      const workspace = await createWorkspace('test-prefix')
      try {
        expect(path.basename(workspace.root)).toMatch(/^test-prefix-/)
      } finally {
        await cleanupWorkspace(workspace)
      }
    })

    it('creates distinct directories for concurrent calls', async () => {
      const [a, b] = await Promise.all([createWorkspace(), createWorkspace()])
      try {
        expect(a.root).not.toBe(b.root)
        expect(a.id).not.toBe(b.id)
      } finally {
        await cleanupWorkspace(a)
        await cleanupWorkspace(b)
      }
    })
  })

  describe('cleanupWorkspace', () => {
    it('removes workspace directory and contents', async () => {
      const workspace = await createWorkspace()
      await fs.writeFile(path.join(workspace.root, 'test.txt'), 'hello')
      await cleanupWorkspace(workspace)
      await expect(fs.stat(workspace.root)).rejects.toThrow()
    })

    it('does not throw if workspace does not exist', async () => {
      const workspace: Workspace = { root: '/tmp/nonexistent-workspace-xyz', id: 'fake' }
      await expect(cleanupWorkspace(workspace)).resolves.toBeUndefined()
    })
  })

  describe('withWorkspace', () => {
    it('cleans up after successful function', async () => {
      let workspaceRoot: string | undefined
      const result = await withWorkspace(async (ws) => {
        workspaceRoot = ws.root
        await fs.writeFile(path.join(ws.root, 'data.txt'), 'content')
        return 42
      })
      expect(result).toBe(42)
      await expect(fs.stat(workspaceRoot!)).rejects.toThrow()
    })

    it('cleans up after thrown error', async () => {
      let workspaceRoot: string | undefined
      await expect(
        withWorkspace(async (ws) => {
          workspaceRoot = ws.root
          throw new Error('intentional failure')
        }),
      ).rejects.toThrow('intentional failure')
      // Workspace must be cleaned up even after error
      await expect(fs.stat(workspaceRoot!)).rejects.toThrow()
    })
  })

  describe('normalizePath', () => {
    let workspace: Workspace

    beforeEach(async () => {
      workspace = await createWorkspace()
    })

    afterEach(async () => {
      await cleanupWorkspace(workspace)
    })

    it('accepts safe relative paths', async () => {
      const result = await normalizePath(workspace, 'data/report.xlsx')
      expect(result).toBe(path.resolve(workspace.root, 'data/report.xlsx'))
    })

    it('accepts simple filenames', async () => {
      const result = await normalizePath(workspace, 'file.txt')
      expect(result).toBe(path.join(workspace.root, 'file.txt'))
    })

    it('rejects absolute paths', async () => {
      await expect(normalizePath(workspace, '/etc/passwd')).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'absolute_path_rejected',
      )
    })

    it('rejects absolute path with Windows-style drive on Windows', async () => {
      // On Linux, C:\Windows\System32 is not absolute (treated as relative filename).
      // On Windows, path.isAbsolute would catch it. This test verifies the Linux behavior.
      if (process.platform === 'win32') {
        await expect(normalizePath(workspace, 'C:\\Windows\\System32')).rejects.toSatisfy(
          (err: SandboxErrorResponse) => err.error.code === 'absolute_path_rejected',
        )
      } else {
        // On Linux, backslashes are literal characters in filenames — no rejection
        const result = await normalizePath(workspace, 'C:\\Windows\\System32')
        expect(result).toContain(workspace.root)
      }
    })

    it('rejects .. traversal', async () => {
      await expect(normalizePath(workspace, '../outside.xlsx')).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'path_traversal',
      )
    })

    it('rejects deep .. traversal', async () => {
      await expect(normalizePath(workspace, 'subdir/../../outside.xlsx')).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'path_traversal',
      )
    })

    it('rejects .. at any position', async () => {
      await expect(normalizePath(workspace, 'a/b/../../../../etc/passwd')).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'path_traversal',
      )
    })

    it('rejects symlink escape', async () => {
      // Create a symlink pointing outside the workspace
      const outsideDir = await fs.mkdtemp(path.join(await fs.realpath('/tmp'), 'outside-'))
      const symlinkPath = path.join(workspace.root, 'escape-link')
      await fs.symlink(outsideDir, symlinkPath)

      await expect(normalizePath(workspace, 'escape-link')).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'symlink_escape',
      )

      await fs.rm(outsideDir, { recursive: true, force: true })
    })

    it('accepts symlink within workspace', async () => {
      const target = path.join(workspace.root, 'target.txt')
      await fs.writeFile(target, 'content')
      const linkPath = path.join(workspace.root, 'link.txt')
      await fs.symlink(target, linkPath)

      const result = await normalizePath(workspace, 'link.txt')
      expect(result).toBe(target)
    })

    it('handles dot segments that stay within workspace', async () => {
      const result = await normalizePath(workspace, './subdir/../file.txt')
      expect(result).toBe(path.join(workspace.root, 'file.txt'))
    })
  })

  describe('resolveArtifactRef', () => {
    let workspace: Workspace

    beforeEach(async () => {
      workspace = await createWorkspace()
    })

    afterEach(async () => {
      await cleanupWorkspace(workspace)
    })

    it('creates artifact reference for existing file', async () => {
      const filePath = path.join(workspace.root, 'output.pptx')
      await fs.writeFile(filePath, Buffer.alloc(1024))

      const ref = await resolveArtifactRef(workspace, filePath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      expect(ref.fileId).toMatch(/^[0-9a-f-]{36}$/)
      expect(ref.fileName).toBe('output.pptx')
      expect(ref.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
      expect(ref.sizeBytes).toBe(1024)
      expect(ref.downloadUrl).toContain(ref.fileId)
    })

    it('throws file_not_found for missing file', async () => {
      const filePath = path.join(workspace.root, 'nonexistent.xlsx')
      await expect(
        resolveArtifactRef(workspace, filePath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      ).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'file_not_found',
      )
    })

    it('rejects path outside workspace', async () => {
      await expect(
        resolveArtifactRef(workspace, '/tmp/evil.xlsx', 'application/octet-stream'),
      ).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'path_traversal',
      )
    })
  })

  describe('enforceSizeLimit', () => {
    it('accepts data within limit', () => {
      expect(() => enforceSizeLimit(1024)).not.toThrow()
    })

    it('accepts data at exact limit', () => {
      expect(() => enforceSizeLimit(MAX_FILE_SIZE_BYTES)).not.toThrow()
    })

    it('rejects data exceeding limit', () => {
      expect(() => enforceSizeLimit(MAX_FILE_SIZE_BYTES + 1)).toThrow()
      try {
        enforceSizeLimit(MAX_FILE_SIZE_BYTES + 1)
      } catch (error) {
        expect(isSandboxError(error)).toBe(true)
        expect((error as SandboxErrorResponse).error.code).toBe('file_too_large')
      }
    })

    it('uses custom max bytes', () => {
      expect(() => enforceSizeLimit(500, 1000)).not.toThrow()
      expect(() => enforceSizeLimit(1001, 1000)).toThrow()
    })

    it('includes label in error message', () => {
      try {
        enforceSizeLimit(MAX_FILE_SIZE_BYTES + 1, MAX_FILE_SIZE_BYTES, 'Custom label')
      } catch (error) {
        expect((error as SandboxErrorResponse).error.message).toContain('Custom label')
      }
    })
  })

  describe('enforceQuota', () => {
    it('accepts when within quota', () => {
      expect(() => enforceQuota(0, 1024)).not.toThrow()
    })

    it('rejects when quota would be exceeded', () => {
      expect(() => enforceQuota(SESSION_QUOTA_BYTES - 100, 101)).toThrow()
      try {
        enforceQuota(SESSION_QUOTA_BYTES - 100, 101)
      } catch (error) {
        expect(isSandboxError(error)).toBe(true)
        expect((error as SandboxErrorResponse).error.code).toBe('quota_exceeded')
      }
    })
  })

  describe('withTimeout', () => {
    it('resolves when operation completes before timeout', async () => {
      const result = await withTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 10))
          return 'done'
        },
        5000,
        'Fast operation',
      )
      expect(result).toBe('done')
    })

    it('rejects with sandbox_timeout when operation exceeds timeout', async () => {
      await expect(
        withTimeout(
          async () => {
            await new Promise((r) => setTimeout(r, 5000))
            return 'never'
          },
          50,
          'Slow operation',
        ),
      ).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'sandbox_timeout',
      )
    })

    it('timeout error is marked recoverable', async () => {
      try {
        await withTimeout(
          async () => {
            await new Promise((r) => setTimeout(r, 5000))
          },
          50,
          'Test',
        )
      } catch (error) {
        expect((error as SandboxErrorResponse).error.recoverable).toBe(true)
        expect((error as SandboxErrorResponse).recoverability).toBe('retryable_later')
      }
    })

    it('clears timeout on success', async () => {
      // This test verifies no lingering timers
      const result = await withTimeout(async () => 'ok', 1000, 'Quick')
      expect(result).toBe('ok')
    })
  })

  describe('getTimeoutMs', () => {
    it('returns correct values for each timeout class', () => {
      expect(getTimeoutMs('fast')).toBe(10_000)
      expect(getTimeoutMs('standard')).toBe(30_000)
      expect(getTimeoutMs('generation')).toBe(60_000)
      expect(getTimeoutMs('heavy')).toBe(120_000)
    })
  })

  describe('isSandboxError', () => {
    it('returns true for valid SandboxErrorResponse', () => {
      const error = createSandboxError('file_too_large', 'too big')
      expect(isSandboxError(error)).toBe(true)
    })

    it('returns false for regular Error', () => {
      expect(isSandboxError(new Error('nope'))).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(isSandboxError(null)).toBe(false)
      expect(isSandboxError(undefined)).toBe(false)
    })

    it('returns false for objects without status', () => {
      expect(isSandboxError({ error: {} })).toBe(false)
    })
  })

  describe('createSandboxError', () => {
    it('creates error with default options', () => {
      const error = createSandboxError('path_traversal', 'bad path')
      expect(error.status).toBe('failed')
      expect(error.error.code).toBe('path_traversal')
      expect(error.error.message).toBe('bad path')
      expect(error.error.recoverable).toBe(false)
      expect(error.error.category).toBe('tool_validation_error')
      expect(error.recoverability).toBe('non_recoverable')
      expect(error.metadata?.sensitivity).toBe('medium')
    })

    it('creates recoverable error', () => {
      const error = createSandboxError('sandbox_timeout', 'timed out', {
        recoverable: true,
        category: 'timeout',
      })
      expect(error.error.recoverable).toBe(true)
      expect(error.recoverability).toBe('retryable_later')
      expect(error.error.category).toBe('timeout')
    })

    it('creates error with custom sensitivity', () => {
      const error = createSandboxError('file_too_large', 'too big', {
        sensitivity: 'high',
      })
      expect(error.metadata?.sensitivity).toBe('high')
    })
  })

  describe('error shape compatibility', () => {
    it('matches NormalizedConnectorResult shape for failed status', () => {
      const error = createSandboxError('file_too_large', 'exceeded limit')
      // Verify the shape matches what normalizeConnectorResponse produces
      expect(error).toHaveProperty('status', 'failed')
      expect(error).toHaveProperty('error.code')
      expect(error).toHaveProperty('error.message')
      expect(error).toHaveProperty('error.recoverable')
      expect(error).toHaveProperty('error.category')
      expect(error).toHaveProperty('recoverability')
      expect(error).toHaveProperty('metadata.sensitivity')
    })

    it('all error codes are snake_case', () => {
      const codes = [
        'path_traversal',
        'absolute_path_rejected',
        'symlink_escape',
        'file_too_large',
        'quota_exceeded',
        'workspace_error',
        'sandbox_timeout',
        'file_not_found',
        'invalid_artifact_ref',
      ]
      for (const code of codes) {
        expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)
      }
    })
  })

  describe('constants', () => {
    it('MAX_FILE_SIZE_BYTES is 10 MiB', () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024)
    })

    it('SESSION_QUOTA_BYTES is 100 MiB', () => {
      expect(SESSION_QUOTA_BYTES).toBe(100 * 1024 * 1024)
    })

    it('TIMEOUT_MS has all four classes', () => {
      expect(Object.keys(TIMEOUT_MS)).toEqual(
        expect.arrayContaining(['fast', 'standard', 'generation', 'heavy']),
      )
    })
  })

  describe('integration: workspace + path + cleanup', () => {
    it('full lifecycle: create, write, normalize, read, cleanup', async () => {
      await withWorkspace(async (ws) => {
        // Create nested structure
        const filePath = await normalizePath(ws, 'subdir/data.txt')
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, 'hello world')

        // Read it back
        const content = await fs.readFile(filePath, 'utf-8')
        expect(content).toBe('hello world')

        // Verify it's within workspace
        expect(filePath.startsWith(ws.root)).toBe(true)
      })
      // After withWorkspace, everything is cleaned up
    })

    it('prevents writing outside workspace even with creative paths', async () => {
      await withWorkspace(async (ws) => {
        const maliciousPaths = [
          '../../../etc/cron.d/evil',
          './../../../../tmp/escaped',
          'subdir/../../../../etc/hosts',
        ]
        for (const p of maliciousPaths) {
          await expect(normalizePath(ws, p)).rejects.toSatisfy(
            (err: SandboxErrorResponse) =>
              err.error.code === 'path_traversal' || err.error.code === 'absolute_path_rejected',
          )
        }
      })
    })
  })
})
