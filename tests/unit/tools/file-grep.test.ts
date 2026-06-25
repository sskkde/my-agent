import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFileGrepTool, type FileGrepParams } from '../../../src/tools/builtins/file-grep.js'
import type { ToolDefinition, ToolExecutionContext } from '../../../src/tools/types.js'

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>()
  return {
    ...actual,
    getWorkspaceRoot: () => {
      return (globalThis as { __testDir?: string }).__testDir || process.cwd()
    },
  }
})

describe('file_grep tool', () => {
  let tool: ToolDefinition
  let testDir: string

  const createToolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
    toolCallId: 'tc-001',
    toolName: 'file_grep',
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
    testDir = join(tmpdir(), `file-grep-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    ;(globalThis as { __testDir?: string }).__testDir = testDir
    tool = createFileGrepTool()
  })

  afterEach(() => {
    delete (globalThis as { __testDir?: string }).__testDir
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('files_with_matches mode', () => {
    it('should find files containing pattern', async () => {
      writeFileSync(join(testDir, 'file1.txt'), 'Hello World\n')
      writeFileSync(join(testDir, 'file2.txt'), 'No match here\n')
      writeFileSync(join(testDir, 'file3.txt'), 'Hello again\n')

      const params: FileGrepParams = { pattern: 'Hello', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }>; outputMode: string }
      expect(data.outputMode).toBe('files_with_matches')
      expect(data.matches.length).toBe(2)
      expect(data.matches.map((m) => m.file)).toContain('file1.txt')
      expect(data.matches.map((m) => m.file)).toContain('file3.txt')
      expect(data.matches.map((m) => m.file)).not.toContain('file2.txt')
    })

    it('should search in subdirectories', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      writeFileSync(join(testDir, 'src', 'index.ts'), 'import React\n')
      writeFileSync(join(testDir, 'src', 'utils.ts'), 'export function\n')

      const params: FileGrepParams = { pattern: 'import', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
      expect(data.matches[0]?.file).toBe(join('src', 'index.ts'))
    })

    it('should support regex patterns', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'function test() {}\nconst test2 = 1;\n')

      const params: FileGrepParams = { pattern: 'function\\s+\\w+', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
    })
  })

  describe('content mode', () => {
    it('should return matching lines with line numbers', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'Line 1\nHello World\nLine 3\nHello again\n')

      const params: FileGrepParams = { pattern: 'Hello', outputMode: 'content' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { files: Array<{ file: string; line: number; content: string }>; outputMode: string }
      expect(data.outputMode).toBe('content')
      expect(data.files.length).toBe(2)
      expect(data.files[0]).toEqual({ file: 'test.txt', line: 2, content: 'Hello World' })
      expect(data.files[1]).toEqual({ file: 'test.txt', line: 4, content: 'Hello again' })
    })

    it('should return matches from multiple files', async () => {
      writeFileSync(join(testDir, 'a.txt'), 'Hello from A\n')
      writeFileSync(join(testDir, 'b.txt'), 'Hello from B\n')

      const params: FileGrepParams = { pattern: 'Hello', outputMode: 'content' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { files: Array<{ file: string; line: number }> }
      expect(data.files.length).toBe(2)
      expect(data.files.map((f) => f.file)).toContain('a.txt')
      expect(data.files.map((f) => f.file)).toContain('b.txt')
    })
  })

  describe('count mode', () => {
    it('should count matches per file', async () => {
      writeFileSync(join(testDir, 'test.txt'), 'test test test\nno match\ntest\n')

      const params: FileGrepParams = { pattern: 'test', outputMode: 'count' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { counts: Array<{ file: string; count: number }>; outputMode: string }
      expect(data.outputMode).toBe('count')
      expect(data.counts.length).toBe(1)
      expect(data.counts[0]).toEqual({ file: 'test.txt', count: 4 })
    })

    it('should count matches across multiple files', async () => {
      writeFileSync(join(testDir, 'a.txt'), 'test test\n')
      writeFileSync(join(testDir, 'b.txt'), 'test\n')

      const params: FileGrepParams = { pattern: 'test', outputMode: 'count' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { counts: Array<{ file: string; count: number }> }
      expect(data.counts.length).toBe(2)
      const aCount = data.counts.find((c) => c.file === 'a.txt')
      const bCount = data.counts.find((c) => c.file === 'b.txt')
      expect(aCount?.count).toBe(2)
      expect(bCount?.count).toBe(1)
    })
  })

  describe('include parameter', () => {
    it('should filter by file extension', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'import React\n')
      writeFileSync(join(testDir, 'test.js'), 'import React\n')
      writeFileSync(join(testDir, 'test.txt'), 'import React\n')

      const params: FileGrepParams = {
        pattern: 'import',
        include: '*.ts',
        outputMode: 'files_with_matches',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
      expect(data.matches[0]?.file).toBe('test.ts')
    })
  })

  describe('path parameter', () => {
    it('should search in specified directory', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      mkdirSync(join(testDir, 'tests'), { recursive: true })
      writeFileSync(join(testDir, 'src', 'index.ts'), 'TODO: implement\n')
      writeFileSync(join(testDir, 'tests', 'test.ts'), 'TODO: test\n')

      const params: FileGrepParams = {
        pattern: 'TODO',
        path: 'src',
        outputMode: 'files_with_matches',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
      expect(data.matches[0]?.file).toBe(join('src', 'index.ts'))
    })
  })

  describe('headLimit parameter', () => {
    it('should respect headLimit', async () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), 'match\n')
      }

      const params: FileGrepParams = {
        pattern: 'match',
        outputMode: 'files_with_matches',
        headLimit: 5,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }>; truncated: boolean }
      expect(data.matches.length).toBe(5)
      expect(data.truncated).toBe(true)
    })

    it('should use default headLimit of 250', async () => {
      for (let i = 0; i < 300; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), 'match\n')
      }

      const params: FileGrepParams = {
        pattern: 'match',
        outputMode: 'files_with_matches',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }>; truncated: boolean }
      expect(data.matches.length).toBe(250)
      expect(data.truncated).toBe(true)
    })
  })

  describe('Path Safety', () => {
    it('should skip sensitive files', async () => {
      writeFileSync(join(testDir, '.env'), 'SECRET=value\n')
      writeFileSync(join(testDir, 'normal.txt'), 'SECRET=public\n')

      const params: FileGrepParams = { pattern: 'SECRET', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.map((m) => m.file)).not.toContain('.env')
      expect(data.matches.map((m) => m.file)).toContain('normal.txt')
    })

    it('should skip binary files', async () => {
      writeFileSync(join(testDir, 'binary.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      writeFileSync(join(testDir, 'text.txt'), 'match\n')

      const params: FileGrepParams = { pattern: 'match', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.map((m) => m.file)).not.toContain('binary.png')
    })

    it('should skip files with null bytes', async () => {
      writeFileSync(join(testDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02]))
      writeFileSync(join(testDir, 'text.txt'), 'match\n')

      const params: FileGrepParams = { pattern: 'match', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.map((m) => m.file)).not.toContain('binary.dat')
    })
  })

  describe('Error Handling', () => {
    it('should return MISSING_PATTERN error when pattern is missing', async () => {
      const params: FileGrepParams = { pattern: '', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MISSING_PATTERN')
    })

    it('should return INVALID_PATTERN error for invalid regex', async () => {
      const params: FileGrepParams = { pattern: '[invalid', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_PATTERN')
    })

    it('should return PATH_NOT_FOUND error for non-existent path', async () => {
      const params: FileGrepParams = { pattern: 'test', path: 'nonexistent' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PATH_NOT_FOUND')
    })

    it('should return NOT_A_DIRECTORY error for file path', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'content')

      const params: FileGrepParams = { pattern: 'test', path: 'file.txt' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_A_DIRECTORY')
    })

    it('should reject path with .. escape', async () => {
      const params: FileGrepParams = { pattern: 'test', path: '../outside' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE')
    })
  })

  describe('workDirRoot support', () => {
    let workDir: string

    beforeEach(() => {
      workDir = join(tmpdir(), `file-grep-workdir-${Date.now()}`)
      mkdirSync(workDir, { recursive: true })
    })

    afterEach(() => {
      if (existsSync(workDir)) {
        rmSync(workDir, { recursive: true, force: true })
      }
    })

    it('should grep files relative to context.workDirRoot when set', async () => {
      writeFileSync(join(workDir, 'match.txt'), 'hello world\n')
      writeFileSync(join(testDir, 'default-match.txt'), 'hello default\n')

      const params: FileGrepParams = { pattern: 'hello', outputMode: 'files_with_matches' }
      const context = createToolContext({ workDirRoot: workDir })

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
      expect(data.matches[0]?.file).toBe('match.txt')
      expect(data.matches[0]?.file).not.toContain(workDir)
    })

    it('should reject grep path that escapes workDirRoot', async () => {
      const params: FileGrepParams = { pattern: 'test', path: '../outside' }
      const context = createToolContext({ workDirRoot: workDir })

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('OUTSIDE_WORKSPACE')
    })

    it('should use getWorkspaceRoot() fallback when workDirRoot is not set', async () => {
      writeFileSync(join(testDir, 'fallback.txt'), 'match content\n')

      const params: FileGrepParams = { pattern: 'match', outputMode: 'files_with_matches' }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as { matches: Array<{ file: string }> }
      expect(data.matches.length).toBe(1)
      expect(data.matches[0]?.file).toBe('fallback.txt')
      expect(data.matches[0]?.file).not.toContain(testDir)
    })
  })

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('file_grep')
    })

    it('should have search category', () => {
      expect(tool.category).toBe('search')
    })

    it('should have medium sensitivity', () => {
      expect(tool.sensitivity).toBe('medium')
    })

    it('should have required pattern in schema', () => {
      expect(tool.schema.required).toContain('pattern')
    })

    it('should have outputMode in schema with enum values', () => {
      const outputModeProp = tool.schema.properties.outputMode as { enum: string[] }
      expect(outputModeProp.enum).toContain('files_with_matches')
      expect(outputModeProp.enum).toContain('content')
      expect(outputModeProp.enum).toContain('count')
    })
  })
})
