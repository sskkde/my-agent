import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFileEditTool, type FileEditParams, type FileEditResult } from '../../../src/tools/builtins/file-edit.js'
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js'
import { sha256Text } from '../../../src/tools/builtins/safe-file-write.js'

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>()
  return {
    ...actual,
    getWorkspaceRoot: () => {
      return (globalThis as { __testDir?: string }).__testDir || process.cwd()
    },
  }
})

describe('file_edit tool', () => {
  let tool: ToolDefinition
  let testDir: string

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file_edit',
    userId: 'user-123',
    sessionId: 'session-001',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-001',
      mode: 'ask_on_write',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
    ...overrides,
  })

  beforeEach(() => {
    testDir = join(tmpdir(), `file-edit-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    ;(globalThis as { __testDir?: string }).__testDir = testDir
    tool = createFileEditTool()
  })

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('Single Match Replacement', () => {
    it('should replace single match successfully', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Hello, World!')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'World',
        newString: 'Universe',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as FileEditResult
      expect(data.replaced).toBe(1)
      expect(data.filePath).toBe('file.txt')
      expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('Hello, Universe!')
    })

    it('should replace text with multiple lines', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Line 1\nLine 2\nLine 3')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'Line 2',
        newString: 'Modified Line 2',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('Line 1\nModified Line 2\nLine 3')
    })
  })

  describe('No Match', () => {
    it('should return NO_MATCH when oldString not found', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Hello, World!')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'NotFound',
        newString: 'Replacement',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NO_MATCH')
    })
  })

  describe('Multiple Matches', () => {
    it('should return AMBIGUOUS_MATCH without replaceAll', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'foo bar foo baz foo')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'foo',
        newString: 'qux',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('AMBIGUOUS_MATCH')
      expect(result.error?.message).toContain('3 matches')
    })

    it('should replace all matches with replaceAll=true', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'foo bar foo baz foo')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'foo',
        newString: 'qux',
        replaceAll: true,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as FileEditResult
      expect(data.replaced).toBe(3)
      expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('qux bar qux baz qux')
    })
  })

  describe('Empty oldString', () => {
    it('should reject empty oldString', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Content')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: '',
        newString: 'Replacement',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EMPTY_OLD_STRING')
    })
  })

  describe('Hash Verification', () => {
    it('should reject hash mismatch', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'Original',
        newString: 'Modified',
        expectedHash: 'wrong-hash',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('HASH_MISMATCH')
    })

    it('should allow edit when hash matches', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Original content')
      const originalHash = sha256Text('Original content')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'Original',
        newString: 'Modified',
        expectedHash: originalHash,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      expect(readFileSync(join(testDir, 'file.txt'), 'utf8')).toBe('Modified content')
    })
  })

  describe('File Not Found', () => {
    it('should return FILE_NOT_FOUND for non-existent file', async () => {
      const params: FileEditParams = {
        filePath: 'nonexistent.txt',
        oldString: 'old',
        newString: 'new',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('FILE_NOT_FOUND')
    })
  })

  describe('Path Safety', () => {
    it('should reject path with .. escape', async () => {
      const params: FileEditParams = {
        filePath: '../outside.txt',
        oldString: 'old',
        newString: 'new',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PATH_ESCAPE')
    })

    it('should reject sensitive files', async () => {
      const params: FileEditParams = {
        filePath: '.env',
        oldString: 'old',
        newString: 'new',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SENSITIVE_FILE')
    })
  })

  describe('Result Preview', () => {
    it('should not include newString in resultPreview', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'Hello, World!')

      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'World',
        newString: 'SecretReplacement',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      expect(result.resultPreview).toBeDefined()
      expect(result.resultPreview).not.toContain('SecretReplacement')
      expect(result.resultPreview).toContain('file.txt')
      expect(result.resultPreview).toContain('replaced')
    })
  })

  describe('Error Handling', () => {
    it('should return MISSING_FILE_PATH error when filePath is missing', async () => {
      const params: FileEditParams = {
        filePath: '',
        oldString: 'old',
        newString: 'new',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_FILE_PATH')
    })

    it('should return MISSING_OLD_STRING error when oldString is missing', async () => {
      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: undefined as unknown as string,
        newString: 'new',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_OLD_STRING')
    })

    it('should return MISSING_NEW_STRING error when newString is missing', async () => {
      const params: FileEditParams = {
        filePath: 'file.txt',
        oldString: 'old',
        newString: undefined as unknown as string,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_NEW_STRING')
    })
  })

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_edit')
    })

    it('should have write category', () => {
      expect(tool.category).toBe('write')
    })

    it('should have high sensitivity', () => {
      expect(tool.sensitivity).toBe('high')
    })

    it('should have required parameters in schema', () => {
      expect(tool.schema.required).toContain('filePath')
      expect(tool.schema.required).toContain('oldString')
      expect(tool.schema.required).toContain('newString')
    })
  })
})
