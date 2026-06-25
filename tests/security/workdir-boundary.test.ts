/**
 * Workdir Boundary Security Tests
 *
 * Tests that the managed workdir root is properly bounded:
 * - WORKDIR_ROOT env var is respected
 * - Defaults to ./data/workdirs
 * - Path traversal (../) attempts fail with deterministic error codes
 * - Symlinks pointing outside workdir root are rejected
 * - Nested workdir paths cannot escape their parent boundary
 *
 * These tests document the DESIRED behavior for workdir isolation.
 * Tests that require new types/functions are skipped with TODO[T2] comments.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, linkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resolveCanonicalPath,
  isWithinWorkspace,
  validateSymlinkSafety,
} from '../../src/tools/builtins/safe-paths.js'
import {
  getWorkdirRoot,
  resetWorkdirRootCache,
  validateWorkdirPath,
  validateWorkdirWritePath,
} from '../../src/workdirs/workdir-paths.js'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Simulate a workdir-scoped path check using existing safe-paths functions.
 * This validates the PATTERN that workdir boundary enforcement should follow.
 */
function validateWorkdirCandidate(
  path: string,
  workdirRoot: string,
): { safe: boolean; error?: { code: string; message: string } } {
  // Check for .. escape in original path
  if (path.includes('..')) {
    return {
      safe: false,
      error: {
        code: 'WORKDIR_PATH_TRAVERSAL',
        message: 'Path contains ".." which may escape workdir boundary',
      },
    }
  }

  // Resolve canonical path relative to workdir root
  const canonicalPath = resolveCanonicalPath(path, workdirRoot)

  // Check if within workdir root
  if (!isWithinWorkspace(canonicalPath, workdirRoot)) {
    return {
      safe: false,
      error: {
        code: 'WORKDIR_ESCAPE',
        message: 'Path resolves outside workdir root',
      },
    }
  }

  return { safe: true }
}

// =============================================================================
// TESTS
// =============================================================================

describe('Workdir Boundary Security', () => {
  let testDir: string
  let workdirRoot: string
  let savedWorkdirRoot: string | undefined

  beforeEach(() => {
    savedWorkdirRoot = process.env.WORKDIR_ROOT
    delete process.env.WORKDIR_ROOT
    resetWorkdirRootCache()
    testDir = join(tmpdir(), `workdir-boundary-test-${Date.now()}`)
    workdirRoot = join(testDir, 'data', 'workdirs')
    mkdirSync(workdirRoot, { recursive: true })
  })

  afterEach(() => {
    if (savedWorkdirRoot === undefined) {
      delete process.env.WORKDIR_ROOT
    } else {
      process.env.WORKDIR_ROOT = savedWorkdirRoot
    }
    resetWorkdirRootCache()
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  // =========================================================================
  // Managed root config
  // =========================================================================
  describe('Managed root config', () => {
    it('should respect WORKDIR_ROOT env var', () => {
      const customRoot = join(testDir, 'custom-workdir-root')
      process.env.WORKDIR_ROOT = customRoot
      resetWorkdirRootCache()

      const result = getWorkdirRoot()

      expect(result).toBe(resolveCanonicalPath(customRoot))
    })

    it('should default to ./data/workdirs when WORKDIR_ROOT not set', () => {
      delete process.env.WORKDIR_ROOT
      resetWorkdirRootCache()

      const result = getWorkdirRoot()

      expect(result.endsWith('/data/workdirs')).toBe(true)
      expect(result.startsWith('/')).toBe(true)
    })

    it('should resolve WORKDIR_ROOT to absolute path', () => {
      process.env.WORKDIR_ROOT = join(testDir, 'relative-workdir-root')
      resetWorkdirRootCache()

      const result = getWorkdirRoot()

      expect(result.startsWith('/')).toBe(true)
    })
  })

  // =========================================================================
  // Path traversal rejection
  // =========================================================================
  describe('Path traversal rejection', () => {
    it('should reject paths with ../ traversal', () => {
      const result = validateWorkdirCandidate('../escape.txt', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_PATH_TRAVERSAL')
    })

    it('should reject paths with nested ../ traversal', () => {
      const result = validateWorkdirCandidate('subdir/../../escape.txt', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_PATH_TRAVERSAL')
    })

    it('should reject paths with leading ../ traversal', () => {
      const result = validateWorkdirCandidate('../../../etc/passwd', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_PATH_TRAVERSAL')
    })

    it('should reject paths with encoded traversal patterns', () => {
      // Even if someone tries to encode .. differently, the raw string check catches it
      const result = validateWorkdirCandidate('foo/..%00/bar', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_PATH_TRAVERSAL')
    })

    it('should reject absolute paths outside workdir root', () => {
      const result = validateWorkdirCandidate('/etc/passwd', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_ESCAPE')
    })

    it('should accept paths within workdir root', () => {
      // Create a subdir to make the path resolve properly
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = validateWorkdirCandidate(join(userDir, 'file.txt'), workdirRoot)
      expect(result.safe).toBe(true)
    })

    it('should accept relative paths that stay within workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const result = validateWorkdirCandidate('user-123/test.txt', workdirRoot)
      expect(result.safe).toBe(true)
    })
  })

  // =========================================================================
  // Symlink escape rejection
  // =========================================================================
  describe('Symlink escape rejection', () => {
    it('should reject symlinks pointing outside workdir root', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const outsideFile = join(testDir, 'outside-secret.txt')
      writeFileSync(outsideFile, 'secret data')

      const symlinkPath = join(userDir, 'escape-link.txt')
      symlinkSync(outsideFile, symlinkPath)

      // The symlink itself is within workdir, but its target is outside
      const result = validateSymlinkSafety(symlinkPath, workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SYMLINK_ESCAPE')
    })

    it('should reject directory symlinks pointing outside workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const outsideDir = join(testDir, 'outside-dir')
      mkdirSync(outsideDir, { recursive: true })
      writeFileSync(join(outsideDir, 'secret.txt'), 'secret')

      const symlinkPath = join(userDir, 'escape-dir-link')
      symlinkSync(outsideDir, symlinkPath)

      const result = validateSymlinkSafety(symlinkPath, workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SYMLINK_ESCAPE')
    })

    it('should accept symlinks pointing within workdir root', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const targetFile = join(userDir, 'target.txt')
      writeFileSync(targetFile, 'content')

      const symlinkPath = join(userDir, 'safe-link.txt')
      symlinkSync(targetFile, symlinkPath)

      const result = validateSymlinkSafety(symlinkPath, workdirRoot)
      expect(result.safe).toBe(true)
    })

    it('should accept cross-user symlinks within workdir root', () => {
      const userA = join(workdirRoot, 'user-a')
      const userB = join(workdirRoot, 'user-b')
      mkdirSync(userA, { recursive: true })
      mkdirSync(userB, { recursive: true })

      const targetFile = join(userB, 'shared.txt')
      writeFileSync(targetFile, 'shared content')

      // User A links to User B's file - still within workdir root
      const symlinkPath = join(userA, 'link-to-b.txt')
      symlinkSync(targetFile, symlinkPath)

      const result = validateSymlinkSafety(symlinkPath, workdirRoot)
      expect(result.safe).toBe(true)
    })

    it('should reject symlink chains that escape workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const outsideFile = join(testDir, 'outside.txt')
      writeFileSync(outsideFile, 'outside content')

      // Create a chain: link1 -> link2 -> outside
      const link2 = join(testDir, 'intermediate-link')
      symlinkSync(outsideFile, link2)

      const link1 = join(userDir, 'chain-link.txt')
      symlinkSync(link2, link1)

      const result = validateSymlinkSafety(link1, workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SYMLINK_ESCAPE')
    })

    it('should reject writes through symlinked parent directories', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })
      const outsideDir = join(testDir, 'outside-write-dir')
      mkdirSync(outsideDir, { recursive: true })
      const symlinkPath = join(userDir, 'escape-dir-link')
      symlinkSync(outsideDir, symlinkPath)

      const result = validateWorkdirWritePath(join(symlinkPath, 'created.txt'), workdirRoot)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('WORKDIR_SYMLINK_ESCAPE')
      }
    })
  })

  describe('Hardlink boundary rejection', () => {
    it('should reject hardlinked files inside the workdir boundary', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })
      const outsideFile = join(testDir, 'outside-hardlink-source.txt')
      writeFileSync(outsideFile, 'outside hardlink content')
      const hardlinkPath = join(userDir, 'hardlinked-secret.txt')
      linkSync(outsideFile, hardlinkPath)

      const result = validateWorkdirPath(hardlinkPath, workdirRoot)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('WORKDIR_HARDLINK_BOUNDARY')
      }
    })
  })

  // =========================================================================
  // Nested workdir boundary
  // =========================================================================
  describe('Nested workdir boundary', () => {
    it('should reject user workdir paths that escape to parent', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      // Try to access parent of user workdir (the workdir root itself)
      const result = validateWorkdirCandidate('../../other-user/file.txt', workdirRoot)
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_PATH_TRAVERSAL')
    })

    it('should contain each user within their own workdir subdirectory', () => {
      const userA = join(workdirRoot, 'user-a')
      const userB = join(workdirRoot, 'user-b')
      mkdirSync(userA, { recursive: true })
      mkdirSync(userB, { recursive: true })

      // User A's path stays within user-a
      const resultA = validateWorkdirCandidate('user-a/file.txt', workdirRoot)
      expect(resultA.safe).toBe(true)

      // User A cannot reach user-b via relative path from their subdir
      // (This is a store-level concern, but the path boundary should still hold)
      const resultB = validateWorkdirCandidate('user-b/file.txt', workdirRoot)
      // This is technically within workdirRoot, so path validation passes
      // User-level isolation is tested in workdir-isolation.test.ts
      expect(resultB.safe).toBe(true)
    })
  })
})
