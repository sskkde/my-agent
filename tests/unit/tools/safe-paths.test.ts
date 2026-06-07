import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import {
  MAX_FILE_READ_BYTES,
  MAX_FILE_READ_LINES,
  GLOB_RESULT_CAP,
  GREP_HEAD_LIMIT,
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  SESSION_HISTORY_DEFAULT_LIMIT,
  SESSION_HISTORY_MAX_LIMIT,
  LARGE_RESULT_THRESHOLD,
  SENSITIVE_FILE_PATTERNS,
  BINARY_EXTENSIONS,
  getWorkspaceRoot,
  resolveCanonicalPath,
  isWithinWorkspace,
  validatePathSafety,
  isBinaryByContent,
  isBinaryByExtension,
  isBinaryFile,
  isSymlink,
  validateSymlinkSafety,
  normalizePathForDisplay,
  validateMultiplePaths,
} from '../../../src/tools/builtins/safe-paths.js'

describe('safe-paths', () => {
  const testDir = join(process.cwd(), 'test-safe-paths-temp')

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('Constants', () => {
    it('should have correct file read limits', () => {
      expect(MAX_FILE_READ_BYTES).toBe(256 * 1024)
      expect(MAX_FILE_READ_LINES).toBe(2000)
      expect(GLOB_RESULT_CAP).toBe(500)
      expect(GREP_HEAD_LIMIT).toBe(1000)
    })

    it('should have correct session limits', () => {
      expect(SESSION_LIST_DEFAULT_LIMIT).toBe(20)
      expect(SESSION_LIST_MAX_LIMIT).toBe(100)
      expect(SESSION_HISTORY_DEFAULT_LIMIT).toBe(50)
      expect(SESSION_HISTORY_MAX_LIMIT).toBe(200)
    })

    it('should have correct large result threshold', () => {
      expect(LARGE_RESULT_THRESHOLD).toBe(10000)
    })

    it('should have sensitive file patterns', () => {
      expect(SENSITIVE_FILE_PATTERNS.length).toBeGreaterThan(0)

      const envPattern = SENSITIVE_FILE_PATTERNS.find((p) => p.source === '^\\.env$')
      expect(envPattern).toBeDefined()

      const envWildcardPattern = SENSITIVE_FILE_PATTERNS.find((p) => p.source === '^\\.env\\..+$')
      expect(envWildcardPattern).toBeDefined()
    })

    it('should have binary extensions list', () => {
      expect(BINARY_EXTENSIONS.length).toBeGreaterThan(0)
      expect(BINARY_EXTENSIONS).toContain('.exe')
      expect(BINARY_EXTENSIONS).toContain('.png')
      expect(BINARY_EXTENSIONS).toContain('.pdf')
    })
  })

  describe('getWorkspaceRoot', () => {
    it('should return canonical workspace root', () => {
      const root = getWorkspaceRoot()
      expect(root).toBeDefined()
      expect(typeof root).toBe('string')
    })
  })

  describe('resolveCanonicalPath', () => {
    it('should resolve relative paths to absolute', () => {
      const result = resolveCanonicalPath('test.txt')
      expect(result).toBe(resolve(process.cwd(), 'test.txt'))
    })

    it('should handle absolute paths', () => {
      const absPath = resolve(process.cwd(), 'test.txt')
      const result = resolveCanonicalPath(absPath)
      expect(result).toBe(absPath)
    })

    it('should resolve symlinks to their targets', () => {
      const targetFile = join(testDir, 'target.txt')
      const linkFile = join(testDir, 'link.txt')

      writeFileSync(targetFile, 'test content')
      symlinkSync(targetFile, linkFile)

      const result = resolveCanonicalPath(linkFile)
      expect(result).toBe(targetFile)
    })

    it('should handle non-existent paths', () => {
      const result = resolveCanonicalPath('/non/existent/path.txt')
      expect(result).toBe('/non/existent/path.txt')
    })
  })

  describe('isWithinWorkspace', () => {
    it('should return true for paths within workspace', () => {
      expect(isWithinWorkspace('src/index.ts')).toBe(true)
      expect(isWithinWorkspace('./package.json')).toBe(true)
    })

    it('should return false for paths outside workspace', () => {
      expect(isWithinWorkspace('../outside.txt')).toBe(false)
      expect(isWithinWorkspace('/etc/passwd')).toBe(false)
    })

    it('should handle symlink escapes', () => {
      const outsideDir = '/tmp/outside-safe-paths-test'
      mkdirSync(outsideDir, { recursive: true })

      const outsideFile = join(outsideDir, 'outside.txt')
      const linkFile = join(testDir, 'escape-link.txt')

      writeFileSync(outsideFile, 'outside content')

      if (existsSync(linkFile)) {
        rmSync(linkFile)
      }
      symlinkSync(outsideFile, linkFile)

      expect(isWithinWorkspace(linkFile)).toBe(false)

      rmSync(outsideDir, { recursive: true, force: true })
    })
  })

  describe('validatePathSafety', () => {
    it('should accept safe paths', () => {
      const result = validatePathSafety('src/index.ts')
      expect(result.safe).toBe(true)
      expect(result.canonicalPath).toBeDefined()
      expect(result.relativePath).toBeDefined()
    })

    it('should reject paths with .. escape', () => {
      const result = validatePathSafety('../outside.txt')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('PATH_ESCAPE')
    })

    it('should reject paths outside workspace', () => {
      const result = validatePathSafety('/etc/passwd')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE')
    })

    it('should reject sensitive files (.env)', () => {
      const result = validatePathSafety('.env')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })

    it('should reject sensitive files (.env.local)', () => {
      const result = validatePathSafety('.env.local')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })

    it('should reject private key files', () => {
      const result = validatePathSafety('id_rsa')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })

    it('should reject database files', () => {
      const result = validatePathSafety('data/app.db')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })

    it('should reject binary files by extension', () => {
      const result = validatePathSafety('image.png')
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('BINARY_FILE')
    })

    it('should allow binary files when option is set', () => {
      const result = validatePathSafety('image.png', undefined, {
        allowBinary: true,
      })
      expect(result.safe).toBe(true)
    })

    it('should support custom denylist', () => {
      const customDenylist = [/^custom-blocked$/]
      const result = validatePathSafety('custom-blocked', undefined, {
        customDenylist,
      })
      expect(result.safe).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })
  })

  describe('Binary Detection', () => {
    describe('isBinaryByContent', () => {
      it('should detect binary content with null bytes', () => {
        const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03])
        expect(isBinaryByContent(binaryBuffer)).toBe(true)
      })

      it('should return false for text content', () => {
        const textBuffer = Buffer.from('Hello, World!')
        expect(isBinaryByContent(textBuffer)).toBe(false)
      })

      it('should only check first 8192 bytes', () => {
        const largeBuffer = Buffer.alloc(10000, 0x41)
        largeBuffer[9000] = 0x00

        expect(isBinaryByContent(largeBuffer)).toBe(false)
      })

      it('should detect null bytes in first 8192 bytes', () => {
        const buffer = Buffer.alloc(10000, 0x41)
        buffer[100] = 0x00

        expect(isBinaryByContent(buffer)).toBe(true)
      })
    })

    describe('isBinaryByExtension', () => {
      it('should detect binary extensions', () => {
        expect(isBinaryByExtension('file.exe')).toBe(true)
        expect(isBinaryByExtension('file.png')).toBe(true)
        expect(isBinaryByExtension('file.pdf')).toBe(true)
      })

      it('should return false for text extensions', () => {
        expect(isBinaryByExtension('file.txt')).toBe(false)
        expect(isBinaryByExtension('file.ts')).toBe(false)
        expect(isBinaryByExtension('file.json')).toBe(false)
      })

      it('should be case insensitive', () => {
        expect(isBinaryByExtension('file.PNG')).toBe(true)
        expect(isBinaryByExtension('file.Pdf')).toBe(true)
      })
    })

    describe('isBinaryFile', () => {
      it('should check extension first', () => {
        expect(isBinaryFile('image.png')).toBe(true)
      })

      it('should check content when buffer provided', () => {
        const binaryBuffer = Buffer.from([0x00, 0x01, 0x02])
        expect(isBinaryFile('file.txt', binaryBuffer)).toBe(true)
      })

      it('should return false for text files', () => {
        const textBuffer = Buffer.from('Hello, World!')
        expect(isBinaryFile('file.txt', textBuffer)).toBe(false)
      })
    })
  })

  describe('Symlink Safety', () => {
    describe('isSymlink', () => {
      it('should return true for symlinks', () => {
        const targetFile = join(testDir, 'target.txt')
        const linkFile = join(testDir, 'link.txt')

        writeFileSync(targetFile, 'test')
        symlinkSync(targetFile, linkFile)

        expect(isSymlink(linkFile)).toBe(true)
      })

      it('should return false for regular files', () => {
        const regularFile = join(testDir, 'regular.txt')
        writeFileSync(regularFile, 'test')

        expect(isSymlink(regularFile)).toBe(false)
      })

      it('should return false for non-existent paths', () => {
        expect(isSymlink('/non/existent/path')).toBe(false)
      })
    })

    describe('validateSymlinkSafety', () => {
      it('should accept symlinks within workspace', () => {
        const targetFile = join(testDir, 'target.txt')
        const linkFile = join(testDir, 'link.txt')

        writeFileSync(targetFile, 'test')
        symlinkSync(targetFile, linkFile)

        const result = validateSymlinkSafety(linkFile)
        expect(result.safe).toBe(true)
      })

      it('should reject symlinks pointing outside workspace', () => {
        const outsideDir = '/tmp/outside-symlink-test'
        mkdirSync(outsideDir, { recursive: true })

        const outsideFile = join(outsideDir, 'outside.txt')
        const linkFile = join(testDir, 'escape-link.txt')

        writeFileSync(outsideFile, 'outside')

        if (existsSync(linkFile)) {
          rmSync(linkFile)
        }
        symlinkSync(outsideFile, linkFile)

        const result = validateSymlinkSafety(linkFile)
        expect(result.safe).toBe(false)
        expect(result.error?.code).toBe('SYMLINK_ESCAPE')

        rmSync(outsideDir, { recursive: true, force: true })
      })
    })
  })

  describe('Path Normalization', () => {
    describe('normalizePathForDisplay', () => {
      it('should return relative path for workspace files', () => {
        const result = normalizePathForDisplay('src/index.ts')
        expect(result).toBe('src/index.ts')
      })

      it('should return absolute path for outside files', () => {
        const result = normalizePathForDisplay('/etc/passwd')
        expect(result).toBe('/etc/passwd')
      })
    })

    describe('validateMultiplePaths', () => {
      it('should return safe for all valid paths', () => {
        const result = validateMultiplePaths(['src/index.ts', 'package.json'])

        expect(result.safe).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should collect errors for invalid paths', () => {
        const result = validateMultiplePaths(['src/index.ts', '../outside.txt', '.env'])

        expect(result.safe).toBe(false)
        expect(result.errors).toHaveLength(2)
        expect(result.errors[0]?.path).toBe('../outside.txt')
        expect(result.errors[1]?.path).toBe('.env')
      })
    })
  })
})
