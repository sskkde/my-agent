import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import {
  createCodeExecutionTool,
  type CodeExecutionParams,
  type CodeExecutionResult,
} from '../../../src/tools/builtins/code-execution.js'
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js'
import type { ToolExecutionContext } from '../../../src/tools/types.js'

vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/builtins/safe-paths.js')>()
  return {
    ...actual,
    getWorkspaceRoot: () => (globalThis as { __testDir?: string }).__testDir || process.cwd(),
  }
})

function createToolContext(userId: string = 'user-123'): ToolExecutionContext {
  return {
    toolCallId: 'test-call-id',
    toolName: 'code_execution',
    userId,
    permissionContext: {
      userId,
      sessionId: 'test-session',
    } as any,
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      },
    },
  }
}

describe('code-execution', () => {
  let testDir: string
  let store: ProcessSessionStore

  beforeEach(() => {
    testDir = join(tmpdir(), `code-execution-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    ;(globalThis as { __testDir?: string }).__testDir = testDir

    store = new ProcessSessionStore()
  })

  afterEach(() => {
    store.clearAllNonRunning()

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('javascript', () => {
    it('executes console.log(1+1) and returns 2', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'javascript',
        code: 'console.log(1 + 1);',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as CodeExecutionResult
      expect(data.status).toBe('completed')
      expect(data.stdout.trim()).toBe('2')
    })

    it('timeout works for infinite loop', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'javascript',
        code: 'while(true) {}',
        timeoutMs: 100,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      const data = result.data as CodeExecutionResult
      expect(data.status).toBe('timeout')
    })

    it('temp file cleaned up after execution', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'javascript',
        code: 'console.log("test");',
      }
      const context = createToolContext()

      await tool.handler(params, context)

      const tmpDir = join(testDir, '.my-agent', 'tmp', 'code-execution')
      if (existsSync(tmpDir)) {
        const files = require('fs').readdirSync(tmpDir)
        expect(files.length).toBe(0)
      }
    })

    it('output > maxOutputChars is truncated', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'javascript',
        code: 'for(let i=0; i<1000; i++) console.log("line " + i);',
        maxOutputChars: 500,
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as CodeExecutionResult
      expect(data.stdoutTruncated).toBe(true)
      expect(data.stdout.length).toBeLessThanOrEqual(500)
    })
  })

  describe('typescript', () => {
    it('returns unavailable when tsx not installed', async () => {
      let tsxAvailable = true

      try {
        require.resolve('tsx')
      } catch {
        tsxAvailable = false
      }

      if (!tsxAvailable) {
        const tool = createCodeExecutionTool(store)
        const params: CodeExecutionParams = {
          language: 'typescript',
          code: 'const x: number = 1; console.log(x);',
        }
        const context = createToolContext()

        const result = await tool.handler(params, context)

        expect(result.success).toBe(true)
        const data = result.data as CodeExecutionResult
        expect(data.status).toBe('unavailable')
        expect(data.unavailableReason).toBe('TYPESCRIPT_UNAVAILABLE')
      } else {
        const tool = createCodeExecutionTool(store)
        const params: CodeExecutionParams = {
          language: 'typescript',
          code: 'const x: number = 1; console.log(x);',
        }
        const context = createToolContext()

        const result = await tool.handler(params, context)

        expect(result.success).toBe(true)
        const data = result.data as CodeExecutionResult
        expect(data.status).toBe('completed')
      }
    })
  })

  describe('bash', () => {
    it('returns unavailable when bash not in PATH', async () => {
      const originalPath = process.env.PATH
      process.env.PATH = ''

      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'bash',
        code: 'echo "test"',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(true)
      const data = result.data as CodeExecutionResult
      expect(data.status).toBe('unavailable')
      expect(data.unavailableReason).toBe('BASH_UNAVAILABLE')

      process.env.PATH = originalPath
    })
  })

  describe('validation', () => {
    it('rejects invalid language', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'python' as any,
        code: 'print("test")',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error!.code).toBe('INVALID_LANGUAGE')
    })

    it('rejects empty code', async () => {
      const tool = createCodeExecutionTool(store)
      const params: CodeExecutionParams = {
        language: 'javascript',
        code: '',
      }
      const context = createToolContext()

      const result = await tool.handler(params, context)

      expect(result.success).toBe(false)
      expect(result.error!.code).toBe('EMPTY_CODE')
    })
  })
})
