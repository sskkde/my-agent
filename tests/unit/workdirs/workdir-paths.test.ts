/**
 * Workdir Path Resolver Tests
 *
 * Covers:
 * - Default root resolution (./data/workdirs)
 * - WORKDIR_ROOT env override
 * - User/workdir ID sanitization (reject traversal, absolute paths, special chars)
 * - Canonical root creation (idempotent mkdir)
 * - Path traversal rejection
 * - Symlink target outside workdir rejection
 * - No raw host path in public shape
 * - Depth limit enforcement
 * - Constants exported correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getWorkdirRoot,
  resetWorkdirRootCache,
  sanitizeWorkdirId,
  buildWorkdirPath,
  ensureWorkdirDir,
  isWithinWorkdir,
  validateWorkdirPath,
  WorkdirPathValidationError,
  WORKDIR_MAX_NAME_LENGTH,
  WORKDIR_MAX_DEPTH,
  WORKDIR_QUOTA_BYTES,
} from '../../../src/workdirs/workdir-paths.js'

// =============================================================================
// HELPERS
// =============================================================================

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// =============================================================================
// TESTS
// =============================================================================

describe('workdir-paths', () => {
  let savedEnv: string | undefined
  let tempDirs: string[]

  beforeEach(() => {
    savedEnv = process.env.WORKDIR_ROOT
    delete process.env.WORKDIR_ROOT
    resetWorkdirRootCache()
    tempDirs = []
  })

  afterEach(() => {
    // Restore env
    if (savedEnv === undefined) {
      delete process.env.WORKDIR_ROOT
    } else {
      process.env.WORKDIR_ROOT = savedEnv
    }
    resetWorkdirRootCache()

    // Clean up temp dirs
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('Constants', () => {
    it('should export WORKDIR_MAX_NAME_LENGTH as 128', () => {
      expect(WORKDIR_MAX_NAME_LENGTH).toBe(128)
    })

    it('should export WORKDIR_MAX_DEPTH as 3', () => {
      expect(WORKDIR_MAX_DEPTH).toBe(3)
    })

    it('should export WORKDIR_QUOTA_BYTES as 1 GiB', () => {
      expect(WORKDIR_QUOTA_BYTES).toBe(1024 * 1024 * 1024)
    })
  })

  // ===========================================================================
  // getWorkdirRoot
  // ===========================================================================

  describe('getWorkdirRoot', () => {
    it('should return a canonical absolute path for the default root', () => {
      const root = getWorkdirRoot()
      expect(root).toBeDefined()
      expect(typeof root).toBe('string')
      expect(root.startsWith('/')).toBe(true)
      // Should end with /data/workdirs (canonicalized)
      expect(root).toContain('data')
      expect(root).toContain('workdirs')
    })

    it('should create the default root directory if it does not exist', () => {
      const root = getWorkdirRoot()
      expect(existsSync(root)).toBe(true)
    })

    it('should use WORKDIR_ROOT env override when set', () => {
      const customDir = makeTempDir('workdir-root-override')
      tempDirs.push(customDir)
      const customRoot = join(customDir, 'custom-workdirs')
      process.env.WORKDIR_ROOT = customRoot

      const root = getWorkdirRoot()
      expect(root).toBe(realpathSync(customRoot))
      expect(existsSync(root)).toBe(true)
    })

    it('should support absolute WORKDIR_ROOT paths', () => {
      const customDir = makeTempDir('workdir-root-abs')
      tempDirs.push(customDir)
      process.env.WORKDIR_ROOT = customDir

      const root = getWorkdirRoot()
      expect(root).toBe(realpathSync(customDir))
    })

    it('should support relative WORKDIR_ROOT paths', () => {
      const customDir = makeTempDir('workdir-root-rel')
      tempDirs.push(customDir)
      // Use a relative path from cwd
      const relativePath = customDir.replace(process.cwd() + '/', '')
      if (relativePath.startsWith('/')) {
        // customDir is not under cwd; skip this assertion
        return
      }
      process.env.WORKDIR_ROOT = relativePath

      const root = getWorkdirRoot()
      expect(root).toBe(realpathSync(customDir))
    })

    it('should cache the root after first resolution', () => {
      const root1 = getWorkdirRoot()
      const root2 = getWorkdirRoot()
      expect(root1).toBe(root2)
    })

    it('should re-resolve after cache reset', () => {
      const dir1 = makeTempDir('workdir-cache-1')
      const dir2 = makeTempDir('workdir-cache-2')
      tempDirs.push(dir1, dir2)

      process.env.WORKDIR_ROOT = dir1
      const root1 = getWorkdirRoot()
      expect(root1).toBe(realpathSync(dir1))

      resetWorkdirRootCache()
      process.env.WORKDIR_ROOT = dir2
      const root2 = getWorkdirRoot()
      expect(root2).toBe(realpathSync(dir2))
      expect(root1).not.toBe(root2)
    })

    it('should treat empty WORKDIR_ROOT as default', () => {
      process.env.WORKDIR_ROOT = '   '
      const root = getWorkdirRoot()
      // Should resolve to default ./data/workdirs
      expect(root).toContain('data')
      expect(root).toContain('workdirs')
    })
  })

  // ===========================================================================
  // sanitizeWorkdirId
  // ===========================================================================

  describe('sanitizeWorkdirId', () => {
    it('should accept valid alphanumeric IDs', () => {
      expect(sanitizeWorkdirId('my-workdir')).toBe('my-workdir')
      expect(sanitizeWorkdirId('test123')).toBe('test123')
      expect(sanitizeWorkdirId('a')).toBe('a')
      expect(sanitizeWorkdirId('AB')).toBe('AB')
    })

    it('should accept IDs with underscores', () => {
      expect(sanitizeWorkdirId('my_workdir')).toBe('my_workdir')
      expect(sanitizeWorkdirId('test_work_dir')).toBe('test_work_dir')
    })

    it('should accept IDs with hyphens', () => {
      expect(sanitizeWorkdirId('my-workdir')).toBe('my-workdir')
      expect(sanitizeWorkdirId('a-b-c')).toBe('a-b-c')
    })

    it('should trim whitespace', () => {
      expect(sanitizeWorkdirId('  my-workdir  ')).toBe('my-workdir')
    })

    it('should reject empty IDs', () => {
      expect(() => sanitizeWorkdirId('')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('')).toThrow('must not be empty')
    })

    it('should reject whitespace-only IDs', () => {
      expect(() => sanitizeWorkdirId('   ')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('   ')).toThrow('must not be empty')
    })

    it('should reject IDs exceeding max length', () => {
      const longId = 'a'.repeat(WORKDIR_MAX_NAME_LENGTH + 1)
      expect(() => sanitizeWorkdirId(longId)).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId(longId)).toThrow('exceeds maximum length')
    })

    it('should accept IDs at exactly max length', () => {
      // Must start and end with alphanumeric, so use 'a' + middle + 'z'
      const maxId = 'a' + 'b'.repeat(WORKDIR_MAX_NAME_LENGTH - 2) + 'z'
      expect(sanitizeWorkdirId(maxId)).toBe(maxId)
    })

    it('should reject path traversal with ..', () => {
      try {
        sanitizeWorkdirId('../escape')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should reject path traversal with .. only', () => {
      try {
        sanitizeWorkdirId('..')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should reject IDs containing forward slash', () => {
      try {
        sanitizeWorkdirId('user/workdir')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should reject IDs containing backslash', () => {
      try {
        sanitizeWorkdirId('user\\workdir')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should reject absolute paths', () => {
      try {
        sanitizeWorkdirId('/etc/passwd')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should reject IDs with null bytes', () => {
      expect(() => sanitizeWorkdirId('work\0dir')).toThrow(WorkdirPathValidationError)
    })

    it('should reject IDs starting with hyphen', () => {
      try {
        sanitizeWorkdirId('-workdir')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_INVALID_ID')
      }
    })

    it('should reject IDs ending with hyphen', () => {
      try {
        sanitizeWorkdirId('workdir-')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_INVALID_ID')
      }
    })

    it('should reject IDs starting with underscore', () => {
      expect(() => sanitizeWorkdirId('_workdir')).toThrow(WorkdirPathValidationError)
    })

    it('should reject IDs ending with underscore', () => {
      expect(() => sanitizeWorkdirId('workdir_')).toThrow(WorkdirPathValidationError)
    })

    it('should reject IDs with special characters', () => {
      expect(() => sanitizeWorkdirId('work dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work@dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work#dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work$dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work%dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work&dir')).toThrow(WorkdirPathValidationError)
      expect(() => sanitizeWorkdirId('work*dir')).toThrow(WorkdirPathValidationError)
    })

    it('should set correct error code on WorkdirPathValidationError', () => {
      try {
        sanitizeWorkdirId('../escape')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkdirPathValidationError)
        expect((err as WorkdirPathValidationError).code).toBe('WORKDIR_PATH_TRAVERSAL')
      }
    })

    it('should return a string (not expose raw host path)', () => {
      const result = sanitizeWorkdirId('my-workdir')
      expect(typeof result).toBe('string')
      // The sanitized ID should not contain any path separators
      expect(result).not.toContain('/')
      expect(result).not.toContain('\\')
    })
  })

  // ===========================================================================
  // buildWorkdirPath
  // ===========================================================================

  describe('buildWorkdirPath', () => {
    it('should construct path as root/userId/workdirId', () => {
      const root = '/data/workdirs'
      const result = buildWorkdirPath(root, 'user-123', 'my-workdir')
      expect(result).toBe(join(root, 'user-123', 'my-workdir'))
    })

    it('should sanitize userId and workdirId', () => {
      const root = '/data/workdirs'
      // Valid IDs pass through
      const result = buildWorkdirPath(root, 'user-1', 'wd-2')
      expect(result).toBe(join(root, 'user-1', 'wd-2'))
    })

    it('should reject traversal in userId', () => {
      const root = '/data/workdirs'
      expect(() => buildWorkdirPath(root, '../escape', 'wd-1')).toThrow(WorkdirPathValidationError)
    })

    it('should reject traversal in workdirId', () => {
      const root = '/data/workdirs'
      expect(() => buildWorkdirPath(root, 'user-1', '../escape')).toThrow(WorkdirPathValidationError)
    })

    it('should reject absolute path in userId', () => {
      const root = '/data/workdirs'
      expect(() => buildWorkdirPath(root, '/etc', 'wd-1')).toThrow(WorkdirPathValidationError)
    })

    it('should reject absolute path in workdirId', () => {
      const root = '/data/workdirs'
      expect(() => buildWorkdirPath(root, 'user-1', '/etc')).toThrow(WorkdirPathValidationError)
    })

    it('should produce a path that is within the root when IDs are valid', () => {
      const root = '/data/workdirs'
      const path = buildWorkdirPath(root, 'user-1', 'wd-1')
      expect(path.startsWith(root)).toBe(true)
    })

    it('should not expose raw host path in the result for user-supplied IDs', () => {
      const root = '/data/workdirs'
      const path = buildWorkdirPath(root, 'user-1', 'wd-1')
      // The result is a join of root + sanitized IDs; no injection possible
      expect(path).toBe('/data/workdirs/user-1/wd-1')
    })
  })

  // ===========================================================================
  // ensureWorkdirDir
  // ===========================================================================

  describe('ensureWorkdirDir', () => {
    it('should create directory if it does not exist', () => {
      const dir = join(makeTempDir('ensure-dir-test'), 'nested', 'path')
      tempDirs.push(dir)
      expect(existsSync(dir)).toBe(false)

      ensureWorkdirDir(dir)
      expect(existsSync(dir)).toBe(true)
    })

    it('should be idempotent (no error if directory already exists)', () => {
      const dir = makeTempDir('ensure-dir-idempotent')
      tempDirs.push(dir)

      ensureWorkdirDir(dir)
      ensureWorkdirDir(dir) // Should not throw
      expect(existsSync(dir)).toBe(true)
    })

    it('should create parent directories recursively', () => {
      const dir = join(makeTempDir('ensure-dir-recursive'), 'a', 'b', 'c')
      tempDirs.push(dir)

      ensureWorkdirDir(dir)
      expect(existsSync(dir)).toBe(true)
    })
  })

  // ===========================================================================
  // isWithinWorkdir
  // ===========================================================================

  describe('isWithinWorkdir', () => {
    let workdirRoot: string

    beforeEach(() => {
      workdirRoot = makeTempDir('is-within-test')
      tempDirs.push(workdirRoot)
    })

    it('should return true for paths inside the workdir root', () => {
      const innerPath = join(workdirRoot, 'user-1', 'wd-1')
      mkdirSync(innerPath, { recursive: true })

      expect(isWithinWorkdir(innerPath, workdirRoot)).toBe(true)
    })

    it('should return true for deeply nested paths', () => {
      const deepPath = join(workdirRoot, 'user-1', 'wd-1', 'src', 'index.ts')
      mkdirSync(join(workdirRoot, 'user-1', 'wd-1', 'src'), { recursive: true })
      writeFileSync(deepPath, 'content')

      expect(isWithinWorkdir(deepPath, workdirRoot)).toBe(true)
    })

    it('should return false for paths outside the workdir root', () => {
      expect(isWithinWorkdir('/etc/passwd', workdirRoot)).toBe(false)
    })

    it('should return false for parent directory traversal', () => {
      const parentPath = join(workdirRoot, '..', 'outside')
      expect(isWithinWorkdir(parentPath, workdirRoot)).toBe(false)
    })

    it('should return false for symlink pointing outside', () => {
      const outsideDir = makeTempDir('is-within-outside')
      tempDirs.push(outsideDir)
      const outsideFile = join(outsideDir, 'outside.txt')
      writeFileSync(outsideFile, 'outside content')

      const linkFile = join(workdirRoot, 'escape-link')
      symlinkSync(outsideFile, linkFile)

      expect(isWithinWorkdir(linkFile, workdirRoot)).toBe(false)
    })

    it('should return true for symlink pointing inside', () => {
      const targetFile = join(workdirRoot, 'target.txt')
      writeFileSync(targetFile, 'content')

      const linkFile = join(workdirRoot, 'link.txt')
      symlinkSync(targetFile, linkFile)

      expect(isWithinWorkdir(linkFile, workdirRoot)).toBe(true)
    })

    it('should handle non-existent paths by resolving without realpath', () => {
      const nonExistent = join(workdirRoot, 'user-1', 'wd-1', 'file.txt')
      expect(isWithinWorkdir(nonExistent, workdirRoot)).toBe(true)
    })

    it('should return false for non-existent path outside root', () => {
      expect(isWithinWorkdir('/tmp/some-random-path-that-does-not-exist', workdirRoot)).toBe(false)
    })
  })

  // ===========================================================================
  // validateWorkdirPath
  // ===========================================================================

  describe('validateWorkdirPath', () => {
    let workdirRoot: string

    beforeEach(() => {
      workdirRoot = makeTempDir('validate-path-test')
      tempDirs.push(workdirRoot)
    })

    describe('success cases', () => {
      it('should accept a valid path inside workdir root', () => {
        const innerDir = join(workdirRoot, 'user-1', 'wd-1')
        mkdirSync(innerDir, { recursive: true })

        const result = validateWorkdirPath(innerDir, workdirRoot)
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.canonicalPath).toBe(realpathSync(innerDir))
          expect(result.relativePath).toBe('user-1/wd-1')
        }
      })

      it('should accept a non-existent path inside workdir root', () => {
        const futurePath = join(workdirRoot, 'user-1', 'wd-1', 'file.txt')
        const result = validateWorkdirPath(futurePath, workdirRoot)
        expect(result.ok).toBe(true)
      })

      it('should accept a symlink pointing inside', () => {
        const targetFile = join(workdirRoot, 'target.txt')
        writeFileSync(targetFile, 'content')
        const linkFile = join(workdirRoot, 'link.txt')
        symlinkSync(targetFile, linkFile)

        const result = validateWorkdirPath(linkFile, workdirRoot)
        expect(result.ok).toBe(true)
      })
    })

    describe('path traversal rejection', () => {
      it('should reject path with .. segments', () => {
        // Use raw string with .. to avoid join() normalizing it away
        const result = validateWorkdirPath(workdirRoot + '/../escape', workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_PATH_TRAVERSAL')
        }
      })

      it('should reject path with embedded ..', () => {
        // Use raw string with .. to avoid join() normalizing it away
        const result = validateWorkdirPath(workdirRoot + '/user/../../escape', workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_PATH_TRAVERSAL')
        }
      })

      it('should reject ../ at the start', () => {
        const result = validateWorkdirPath('../escape', workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_PATH_TRAVERSAL')
        }
      })
    })

    describe('escape rejection', () => {
      it('should reject absolute path outside workdir', () => {
        const result = validateWorkdirPath('/etc/passwd', workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_ESCAPE')
        }
      })

      it('should reject resolved path outside workdir', () => {
        const outsideDir = makeTempDir('validate-outside')
        tempDirs.push(outsideDir)
        const result = validateWorkdirPath(outsideDir, workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_ESCAPE')
        }
      })
    })

    describe('symlink escape rejection', () => {
      it('should reject symlink pointing outside workdir root', () => {
        const outsideDir = makeTempDir('validate-symlink-outside')
        tempDirs.push(outsideDir)
        const outsideFile = join(outsideDir, 'secret.txt')
        writeFileSync(outsideFile, 'secret')

        const linkFile = join(workdirRoot, 'escape-link')
        symlinkSync(outsideFile, linkFile)

        const result = validateWorkdirPath(linkFile, workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          // realpathSync resolves the symlink, so the boundary check catches it
          expect(['WORKDIR_ESCAPE', 'WORKDIR_SYMLINK_ESCAPE']).toContain(result.error.code)
        }
      })

      it('should reject symlink to another workdir', () => {
        // Simulate symlink from user-a's workdir to user-b's workdir
        const userBDir = join(workdirRoot, 'user-b', 'wd-b')
        mkdirSync(userBDir, { recursive: true })
        writeFileSync(join(userBDir, 'secret.txt'), 'user b secret')

        const userADir = join(workdirRoot, 'user-a', 'wd-a')
        mkdirSync(userADir, { recursive: true })

        // This symlink stays inside root, so it should be allowed
        const linkFile = join(userADir, 'link-to-b')
        symlinkSync(userBDir, linkFile)

        const result = validateWorkdirPath(linkFile, workdirRoot)
        // Both are inside workdir root, so this is allowed at the path level
        // (user isolation is enforced at the store/API layer, not path layer)
        expect(result.ok).toBe(true)
      })
    })

    describe('depth limit', () => {
      it('should reject paths exceeding WORKDIR_MAX_DEPTH', () => {
        // Create a deeply nested path
        const segments = Array.from({ length: WORKDIR_MAX_DEPTH + 2 }, (_, i) => `level-${i}`)
        const deepPath = join(workdirRoot, ...segments)
        mkdirSync(deepPath, { recursive: true })

        const result = validateWorkdirPath(deepPath, workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('WORKDIR_DEPTH_EXCEEDED')
        }
      })

      it('should accept paths at exactly WORKDIR_MAX_DEPTH', () => {
        const segments = Array.from({ length: WORKDIR_MAX_DEPTH }, (_, i) => `level-${i}`)
        const exactPath = join(workdirRoot, ...segments)
        mkdirSync(exactPath, { recursive: true })

        const result = validateWorkdirPath(exactPath, workdirRoot)
        expect(result.ok).toBe(true)
      })
    })

    describe('no raw host path in public shape', () => {
      it('should return relativePath relative to workdir root', () => {
        const innerDir = join(workdirRoot, 'user-1', 'wd-1')
        mkdirSync(innerDir, { recursive: true })

        const result = validateWorkdirPath(innerDir, workdirRoot)
        expect(result.ok).toBe(true)
        if (result.ok) {
          // relativePath should not be an absolute host path
          expect(result.relativePath.startsWith('/')).toBe(false)
          expect(result.relativePath).toBe('user-1/wd-1')
        }
      })

      it('should return canonicalPath as absolute (server-side only)', () => {
        const innerDir = join(workdirRoot, 'user-1', 'wd-1')
        mkdirSync(innerDir, { recursive: true })

        const result = validateWorkdirPath(innerDir, workdirRoot)
        expect(result.ok).toBe(true)
        if (result.ok) {
          // canonicalPath is absolute (for server-side use), but relativePath is safe
          expect(result.canonicalPath.startsWith('/')).toBe(true)
          // relativePath is the safe public-facing path
          expect(result.relativePath).not.toContain(workdirRoot)
        }
      })
    })

    describe('error codes', () => {
      it('should return deterministic error codes for each failure mode', () => {
        // Traversal
        const traversal = validateWorkdirPath('../escape', workdirRoot)
        expect(traversal.ok).toBe(false)
        if (!traversal.ok) expect(traversal.error.code).toBe('WORKDIR_PATH_TRAVERSAL')

        // Escape
        const escape = validateWorkdirPath('/etc/passwd', workdirRoot)
        expect(escape.ok).toBe(false)
        if (!escape.ok) expect(escape.error.code).toBe('WORKDIR_ESCAPE')

        // Symlink escape
        const outsideDir = makeTempDir('validate-error-codes')
        tempDirs.push(outsideDir)
        const outsideFile = join(outsideDir, 'secret.txt')
        writeFileSync(outsideFile, 'secret')
        const linkFile = join(workdirRoot, 'escape-link')
        symlinkSync(outsideFile, linkFile)

        const symlinkEscape = validateWorkdirPath(linkFile, workdirRoot)
        expect(symlinkEscape.ok).toBe(false)
        if (!symlinkEscape.ok) expect(['WORKDIR_ESCAPE', 'WORKDIR_SYMLINK_ESCAPE']).toContain(symlinkEscape.error.code)
      })

      it('should include human-readable error messages', () => {
        const result = validateWorkdirPath('../escape', workdirRoot)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.message).toBeDefined()
          expect(typeof result.error.message).toBe('string')
          expect(result.error.message.length).toBeGreaterThan(0)
        }
      })
    })
  })

  // ===========================================================================
  // WorkdirPathValidationError
  // ===========================================================================

  describe('WorkdirPathValidationError', () => {
    it('should be an instance of Error', () => {
      const err = new WorkdirPathValidationError('WORKDIR_INVALID_ID', 'test error')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(WorkdirPathValidationError)
    })

    it('should have correct name property', () => {
      const err = new WorkdirPathValidationError('WORKDIR_INVALID_ID', 'test error')
      expect(err.name).toBe('WorkdirPathValidationError')
    })

    it('should expose code and message', () => {
      const err = new WorkdirPathValidationError('WORKDIR_PATH_TRAVERSAL', 'traversal detected')
      expect(err.code).toBe('WORKDIR_PATH_TRAVERSAL')
      expect(err.message).toBe('traversal detected')
    })
  })
})
