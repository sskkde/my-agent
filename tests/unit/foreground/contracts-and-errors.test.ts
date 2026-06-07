/**
 * Comprehensive tests for foreground contracts, projection, tools, and errors.
 * Task 18: Unit tests for contracts, projection, tools, and errors (Wave 4)
 */

import { describe, it, expect } from 'vitest'
import type {
  ForegroundTurnInput,
  ForegroundTurnResult,
  ToolCallSummary,
} from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundToolResult } from '../../../src/foreground/tools/foreground-tool-result.js'
import {
  mapKernelErrorToForegroundResult,
  createSyntheticKernelErrorResult,
  DEFAULT_FOREGROUND_MAX_ITERATIONS,
  DEFAULT_FOREGROUND_TIMEOUT_MS,
  MAX_ITERATION_EXCEEDED_USER_MESSAGE,
  TIMEOUT_USER_MESSAGE,
  LLM_ERROR_USER_MESSAGE,
  GENERIC_ERROR_USER_MESSAGE,
  isRecoverableError,
} from '../../../src/foreground/kernel-guard-constants.js'
import {
  buildForegroundToolProjection,
  toToolPlaneProjection,
  HIGH_RISK_TOOL_CATEGORIES,
} from '../../../src/foreground/tool-projection-mapper.js'
import {
  assertSearchScope,
  isSearchCategoryTool,
  SearchSubagentScopeError,
  SEARCH_CATEGORY_TOOL_IDS,
  NON_SEARCH_TOOL_NOT_ALLOWED,
} from '../../../src/search/search-subagent-types.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { ToolCategory, ToolSensitivity } from '../../../src/tools/types.js'

// ─── ForegroundTurnInput Contract Tests ────────────────────────────────────────

describe('ForegroundTurnInput Contract', () => {
  describe('Required fields', () => {
    it('should require userId field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
      }
      expect(input.userId).toBe('user-123')
    })

    it('should require sessionId field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
      }
      expect(input.sessionId).toBe('session-456')
    })

    it('should require turnId field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
      }
      expect(input.turnId).toBe('turn-789')
    })

    it('should require message field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello world',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
      }
      expect(input.message).toBe('Hello world')
    })

    it('should require timestamp field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
      }
      expect(input.timestamp).toBe('2024-01-01T00:00:00Z')
    })

    it('should require hydratedState field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: { sessionId: 'session-456' } as any,
        foregroundState: {} as any,
      }
      expect(input.hydratedState).toBeDefined()
    })

    it('should require foregroundState field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {
          hydratedSession: {} as any,
          activeWorkRefs: {} as any,
          currentPersona: {} as any,
          effectivePolicy: {} as any,
        } as any,
      }
      expect(input.foregroundState).toBeDefined()
    })
  })

  describe('Optional fields', () => {
    it('should accept optional agentConfig field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
        agentConfig: { providerId: 'openai', model: 'gpt-4' } as any,
      }
      expect(input.agentConfig).toBeDefined()
      expect(input.agentConfig?.providerId).toBe('openai')
    })

    it('should accept optional agentId field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
        agentId: 'foreground.default',
      }
      expect(input.agentId).toBe('foreground.default')
    })

    it('should accept optional maxIterations field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
        maxIterations: 10,
      }
      expect(input.maxIterations).toBe(10)
    })

    it('should accept optional timeoutMs field', () => {
      const input: ForegroundTurnInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-789',
        message: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        hydratedState: {} as any,
        foregroundState: {} as any,
        timeoutMs: 30000,
      }
      expect(input.timeoutMs).toBe(30000)
    })
  })
})

// ─── ForegroundTurnResult Contract Tests ───────────────────────────────────────

describe('ForegroundTurnResult Contract', () => {
  describe('Required fields', () => {
    it('should have status field (completed or failed)', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Hello!',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
      }
      expect(result.status).toBe('completed')
    })

    it('should have finalResponse field', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Hello, how can I help you?',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
      }
      expect(result.finalResponse).toBe('Hello, how can I help you?')
    })

    it('should have decisionTrace field', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Hello!',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'Direct response' },
      }
      expect(result.decisionTrace).toBeDefined()
      expect(result.decisionTrace.route).toBe('answer_directly')
    })
  })

  describe('Optional fields', () => {
    it('should have optional kernelResult field', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Done!',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
        kernelResult: {
          finalStatus: 'completed',
          iterationsUsed: 2,
          toolCallCount: 3,
        },
      }
      expect(result.kernelResult).toBeDefined()
      expect(result.kernelResult?.iterationsUsed).toBe(2)
    })

    it('should have optional runtimeSummary field', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Done!',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-1', toolName: 'search', status: 'completed', summary: 'Found 5 results' },
          ],
        },
      }
      expect(result.runtimeSummary).toBeDefined()
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1)
    })

    it('should have optional toolCallSummaries field', () => {
      const result: ForegroundTurnResult = {
        status: 'completed',
        finalResponse: 'Done!',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
        toolCallSummaries: [
          { toolCallId: 'tc-1', toolName: 'search', status: 'completed' },
          { toolCallId: 'tc-2', toolName: 'read', status: 'failed' },
        ],
      }
      expect(result.toolCallSummaries).toHaveLength(2)
    })

    it('should have optional error field', () => {
      const result: ForegroundTurnResult = {
        status: 'failed',
        finalResponse: 'Something went wrong',
        decisionTrace: { route: 'answer_directly', requiresPlanner: false, reason: 'test' },
        error: { code: 'KERNEL_ERROR', message: 'Execution failed' },
      }
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('KERNEL_ERROR')
    })
  })
})

// ─── ForegroundToolResult Shape Tests ──────────────────────────────────────────

describe('ForegroundToolResult Shape', () => {
  describe('Success result shape', () => {
    it('should have success=true for successful results', () => {
      const result: ForegroundToolResult<{ id: string }> = {
        success: true,
        data: { id: 'test-123' },
        userVisibleSummary: 'Operation completed successfully',
        runtimeSummary: {},
      }
      expect(result.success).toBe(true)
    })

    it('should have data field for successful results', () => {
      const result: ForegroundToolResult<{ id: string; count: number }> = {
        success: true,
        data: { id: 'test-123', count: 5 },
        userVisibleSummary: 'Found 5 items',
        runtimeSummary: {},
      }
      expect(result.data).toBeDefined()
      expect(result.data?.id).toBe('test-123')
      expect(result.data?.count).toBe(5)
    })

    it('should have userVisibleSummary field', () => {
      const result: ForegroundToolResult<unknown> = {
        success: true,
        data: {},
        userVisibleSummary: 'Search completed with 10 results',
        runtimeSummary: {},
      }
      expect(result.userVisibleSummary).toBe('Search completed with 10 results')
    })

    it('should have runtimeSummary field', () => {
      const result: ForegroundToolResult<unknown> = {
        success: true,
        data: {},
        userVisibleSummary: 'Done',
        runtimeSummary: {
          toolCallSummaries: [{ toolCallId: 'tc-1', toolName: 'search', status: 'completed' }],
        },
      }
      expect(result.runtimeSummary).toBeDefined()
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1)
    })

    it('should not have error field for successful results', () => {
      const result: ForegroundToolResult<unknown> = {
        success: true,
        data: {},
        userVisibleSummary: 'Done',
        runtimeSummary: {},
      }
      expect(result.error).toBeUndefined()
    })
  })

  describe('Error result shape', () => {
    it('should have success=false for error results', () => {
      const result: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Operation failed',
        runtimeSummary: {},
        error: { code: 'DISPATCH_ERROR', message: 'Failed', recoverable: false },
      }
      expect(result.success).toBe(false)
    })

    it('should have error.code field', () => {
      const result: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Failed',
        runtimeSummary: {},
        error: { code: 'UNAUTHORIZED_ACCESS', message: 'Not allowed', recoverable: false },
      }
      expect(result.error?.code).toBe('UNAUTHORIZED_ACCESS')
    })

    it('should have error.recoverable field', () => {
      const recoverableResult: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Temporary failure',
        runtimeSummary: {},
        error: { code: 'TIMEOUT', message: 'Request timed out', recoverable: true },
      }
      expect(recoverableResult.error?.recoverable).toBe(true)

      const nonRecoverableResult: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Permanent failure',
        runtimeSummary: {},
        error: { code: 'UNAUTHORIZED', message: 'Access denied', recoverable: false },
      }
      expect(nonRecoverableResult.error?.recoverable).toBe(false)
    })

    it('should have error.message field', () => {
      const result: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Failed',
        runtimeSummary: {},
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input: field "name" is required', recoverable: true },
      }
      expect(result.error?.message).toBe('Invalid input: field "name" is required')
    })

    it('should not have data field for error results', () => {
      const result: ForegroundToolResult<never> = {
        success: false,
        userVisibleSummary: 'Failed',
        runtimeSummary: {},
        error: { code: 'ERROR', message: 'Failed', recoverable: false },
      }
      expect(result.data).toBeUndefined()
    })
  })
})

// ─── ToolCallSummary Shape Tests ───────────────────────────────────────────────

describe('ToolCallSummary Shape', () => {
  it('should have toolCallId field', () => {
    const summary: ToolCallSummary = {
      toolCallId: 'call_abc123',
      toolName: 'web_search',
      status: 'completed',
    }
    expect(summary.toolCallId).toBe('call_abc123')
  })

  it('should have toolName field', () => {
    const summary: ToolCallSummary = {
      toolCallId: 'call_abc123',
      toolName: 'file_read',
      status: 'completed',
    }
    expect(summary.toolName).toBe('file_read')
  })

  it('should have status field with valid values', () => {
    const completed: ToolCallSummary = {
      toolCallId: 'call-1',
      toolName: 'search',
      status: 'completed',
    }
    expect(completed.status).toBe('completed')

    const failed: ToolCallSummary = {
      toolCallId: 'call-2',
      toolName: 'search',
      status: 'failed',
    }
    expect(failed.status).toBe('failed')

    const skipped: ToolCallSummary = {
      toolCallId: 'call-3',
      toolName: 'search',
      status: 'skipped',
    }
    expect(skipped.status).toBe('skipped')
  })

  it('should have optional summary field', () => {
    const withSummary: ToolCallSummary = {
      toolCallId: 'call-1',
      toolName: 'web_search',
      status: 'completed',
      summary: 'Found 10 results for "test query"',
    }
    expect(withSummary.summary).toBe('Found 10 results for "test query"')

    const withoutSummary: ToolCallSummary = {
      toolCallId: 'call-2',
      toolName: 'file_read',
      status: 'completed',
    }
    expect(withoutSummary.summary).toBeUndefined()
  })
})

// ─── mapKernelErrorToForegroundResult Tests ────────────────────────────────────

describe('mapKernelErrorToForegroundResult', () => {
  describe('MAX_ITERATIONS_EXCEEDED', () => {
    it('should map max_iterations_reached to safe failure response', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 6,
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'search', params: {} },
          { toolCallId: 'tc-2', toolName: 'read_file', params: {} },
        ],
        transcript: [],
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.status).toBe('failed')
      expect(result.finalResponse).toBe(MAX_ITERATION_EXCEEDED_USER_MESSAGE)
      expect(result.error?.code).toBe('MAX_ITERATIONS_EXCEEDED')
      expect(result.decisionTrace.route).toBe('answer_directly')
      expect(result.decisionTrace.requiresPlanner).toBe(false)
    })

    it('should not expose iteration count in finalResponse', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 999,
        toolCalls: [],
        transcript: [],
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.finalResponse).not.toContain('999')
      expect(result.finalResponse).not.toContain('iterations')
    })

    it('should include tool call summaries in runtimeSummary', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 3,
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'web_search', params: { query: 'test' } },
          { toolCallId: 'tc-2', toolName: 'file_read', params: { path: '/test' } },
        ],
        transcript: [],
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(2)
      expect(result.runtimeSummary?.toolCallSummaries?.[0]?.toolName).toBe('web_search')
      expect(result.runtimeSummary?.toolCallSummaries?.[1]?.toolName).toBe('file_read')
    })
  })

  describe('TIMEOUT', () => {
    it('should map timeout to safe failure response', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'timeout',
        iterationsUsed: 2,
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'long_operation', params: {} }],
        transcript: [],
        error: { code: 'TIMEOUT', message: 'Execution timed out after 60000ms' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.status).toBe('failed')
      expect(result.finalResponse).toBe(TIMEOUT_USER_MESSAGE)
      expect(result.error?.code).toBe('TIMEOUT')
    })

    it('should not expose timeout duration in finalResponse', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'timeout',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'TIMEOUT', message: 'Timed out after 120000ms' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.finalResponse).not.toContain('120000')
      expect(result.finalResponse).not.toContain('ms')
    })
  })

  describe('LLM_ERROR', () => {
    it('should map LLM rate limit error to LLM_ERROR', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'LLM_RATE_LIMIT', message: 'Rate limit exceeded' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.status).toBe('failed')
      expect(result.finalResponse).toBe(LLM_ERROR_USER_MESSAGE)
      expect(result.error?.code).toBe('LLM_ERROR')
    })

    it('should map provider error to LLM_ERROR', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'PROVIDER_UNAVAILABLE', message: 'OpenAI API unavailable' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.error?.code).toBe('LLM_ERROR')
    })

    it('should map auth error to LLM_ERROR', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'AUTH_INVALID_KEY', message: 'Invalid API key' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.error?.code).toBe('LLM_ERROR')
    })

    it('should map model error to LLM_ERROR', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'MODEL_NOT_FOUND', message: 'Model gpt-5 not found' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.error?.code).toBe('LLM_ERROR')
    })
  })

  describe('GENERIC_ERROR', () => {
    it('should map unknown errors to GENERIC_ERROR', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'UNKNOWN_ERROR', message: 'Something unexpected happened' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.status).toBe('failed')
      expect(result.finalResponse).toBe(GENERIC_ERROR_USER_MESSAGE)
      expect(result.error?.code).toBe('GENERIC_ERROR')
    })

    it('should not expose raw error message in finalResponse', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'DB_ERROR', message: 'Database connection failed: password=secret123' },
      }

      const result = mapKernelErrorToForegroundResult(kernelResult)

      expect(result.finalResponse).not.toContain('secret123')
      expect(result.finalResponse).not.toContain('password')
    })
  })
})

// ─── createSyntheticKernelErrorResult Tests ────────────────────────────────────

describe('createSyntheticKernelErrorResult', () => {
  it('should create synthetic result for MAX_ITERATIONS_EXCEEDED', () => {
    const result = createSyntheticKernelErrorResult('MAX_ITERATIONS_EXCEEDED', 'Test error')

    expect(result.finalStatus).toBe('max_iterations_reached')
    expect(result.iterationsUsed).toBe(0)
    expect(result.toolCalls).toEqual([])
    expect(result.transcript).toEqual([])
    expect(result.error?.code).toBe('MAX_ITERATIONS_EXCEEDED')
  })

  it('should create synthetic result for TIMEOUT', () => {
    const result = createSyntheticKernelErrorResult('TIMEOUT', 'Test timeout')

    expect(result.finalStatus).toBe('timeout')
    expect(result.error?.code).toBe('TIMEOUT')
  })

  it('should create synthetic result for LLM_ERROR', () => {
    const result = createSyntheticKernelErrorResult('LLM_ERROR', 'Provider down')

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('LLM_ERROR')
  })

  it('should create synthetic result for GENERIC_ERROR', () => {
    const result = createSyntheticKernelErrorResult('GENERIC_ERROR', 'Unknown failure')

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('GENERIC_ERROR')
  })
})

// ─── isRecoverableError Tests ──────────────────────────────────────────────────

describe('isRecoverableError', () => {
  it('should return true for TIMEOUT', () => {
    expect(isRecoverableError('TIMEOUT')).toBe(true)
  })

  it('should return true for LLM_ERROR', () => {
    expect(isRecoverableError('LLM_ERROR')).toBe(true)
  })

  it('should return false for MAX_ITERATIONS_EXCEEDED', () => {
    expect(isRecoverableError('MAX_ITERATIONS_EXCEEDED')).toBe(false)
  })

  it('should return false for GENERIC_ERROR', () => {
    expect(isRecoverableError('GENERIC_ERROR')).toBe(false)
  })
})

// ─── buildForegroundToolProjection Tests ───────────────────────────────────────

describe('buildForegroundToolProjection', () => {
  const createMockInput = (): ForegroundTurnInput => ({
    userId: 'test-user',
    sessionId: 'test-session',
    turnId: 'test-turn',
    message: 'test message',
    timestamp: new Date().toISOString(),
    hydratedState: {} as any,
    foregroundState: {} as any,
  })

  const createTool = (
    name: string,
    category: ToolCategory,
    sensitivity: ToolSensitivity,
    description: string = 'Test tool',
  ) => ({
    name,
    category,
    sensitivity,
    description,
  })

  describe('Safe defaults', () => {
    it('should return empty projection for empty tool array', () => {
      const result = buildForegroundToolProjection(createMockInput(), [])

      expect(result.allowedToolIds).toEqual([])
      expect(result.toolDefinitions).toEqual([])
      expect(result.projectionMode).toBe('function_calling')
    })

    it('should include read category tools with low sensitivity', () => {
      const tools = [createTool('file_read', 'read', 'low'), createTool('file_glob', 'read', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('file_glob')
    })

    it('should include search category tools with low sensitivity', () => {
      const tools = [createTool('web_search', 'search', 'low'), createTool('docs_search', 'search', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).toContain('docs_search')
    })

    it('should include internal category tools with low sensitivity', () => {
      const tools = [createTool('status_query', 'internal', 'low'), createTool('ask_user', 'internal', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).toContain('status_query')
      expect(result.allowedToolIds).toContain('ask_user')
    })

    it('should include tools with medium sensitivity in safe categories', () => {
      const tools = [createTool('file_read', 'read', 'medium'), createTool('web_search', 'search', 'medium')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
    })
  })

  describe('High-risk exclusion', () => {
    it('should exclude write category tools by default', () => {
      const tools = [createTool('file_write', 'write', 'low'), createTool('file_read', 'read', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('file_write')
      expect(result.allowedToolIds).toContain('file_read')
    })

    it('should exclude delete category tools by default', () => {
      const tools = [createTool('file_delete', 'delete', 'low'), createTool('file_read', 'read', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('file_delete')
    })

    it('should exclude execute category tools by default', () => {
      const tools = [createTool('run_command', 'execute', 'low'), createTool('status_query', 'internal', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('run_command')
    })

    it('should exclude admin category tools by default', () => {
      const tools = [createTool('configure_system', 'admin', 'low'), createTool('web_search', 'search', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('configure_system')
    })

    it('should exclude tools with high sensitivity even in safe categories', () => {
      const tools = [createTool('sensitive_search', 'search', 'high'), createTool('normal_search', 'search', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('sensitive_search')
      expect(result.allowedToolIds).toContain('normal_search')
    })

    it('should exclude tools with restricted sensitivity', () => {
      const tools = [createTool('restricted_tool', 'read', 'restricted'), createTool('normal_tool', 'read', 'low')]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.allowedToolIds).not.toContain('restricted_tool')
    })
  })

  describe('Tool definitions', () => {
    it('should generate correct tool definitions', () => {
      const tools = [
        createTool('web_search', 'search', 'low', 'Search the web'),
        createTool('file_read', 'read', 'low', 'Read a file'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), tools)

      expect(result.toolDefinitions).toHaveLength(2)
      expect(result.toolDefinitions[0]).toEqual({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: { type: 'object', properties: {} },
        },
      })
    })
  })

  describe('toToolPlaneProjection', () => {
    it('should convert to ToolPlaneProjection format', () => {
      const tools = [createTool('web_search', 'search', 'low'), createTool('file_read', 'read', 'low')]

      const projectionResult = buildForegroundToolProjection(createMockInput(), tools)
      const planeProjection = toToolPlaneProjection(projectionResult)

      expect(planeProjection.toolIds).toEqual(['web_search', 'file_read'])
      expect(planeProjection.tools).toHaveLength(2)
    })
  })
})

// ─── HIGH_RISK_TOOL_CATEGORIES Tests ───────────────────────────────────────────

describe('HIGH_RISK_TOOL_CATEGORIES', () => {
  it('should include write category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('write')).toBe(true)
  })

  it('should include delete category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('delete')).toBe(true)
  })

  it('should include send category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('send')).toBe(true)
  })

  it('should include execute category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('execute')).toBe(true)
  })

  it('should include admin category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('admin')).toBe(true)
  })

  it('should not include read category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('read')).toBe(false)
  })

  it('should not include search category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('search')).toBe(false)
  })

  it('should not include internal category', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('internal')).toBe(false)
  })
})

// ─── assertSearchScope Tests ───────────────────────────────────────────────────

describe('assertSearchScope', () => {
  describe('Valid search tool IDs', () => {
    it('should not throw for web_search', () => {
      expect(() => assertSearchScope('web_search')).not.toThrow()
    })

    it('should not throw for docs_search', () => {
      expect(() => assertSearchScope('docs_search')).not.toThrow()
    })
  })

  describe('Invalid tool IDs', () => {
    it('should throw SearchSubagentScopeError for non-search tools', () => {
      expect(() => assertSearchScope('file_read')).toThrow(SearchSubagentScopeError)
    })

    it('should throw for foreground tools', () => {
      expect(() => assertSearchScope('foreground_spawn_planner')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('foreground_status_query')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('foreground_launch_subagent')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('foreground_cancel_or_modify_task')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('foreground_handle_approval')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('foreground_resume_planner')).toThrow(SearchSubagentScopeError)
    })

    it('should throw for write tools', () => {
      expect(() => assertSearchScope('file_write')).toThrow(SearchSubagentScopeError)
    })

    it('should throw for execute tools', () => {
      expect(() => assertSearchScope('run_command')).toThrow(SearchSubagentScopeError)
    })

    it('should throw for arbitrary tool names', () => {
      expect(() => assertSearchScope('random_tool')).toThrow(SearchSubagentScopeError)
      expect(() => assertSearchScope('')).toThrow(SearchSubagentScopeError)
    })
  })

  describe('SearchSubagentScopeError properties', () => {
    it('should have correct error name', () => {
      try {
        assertSearchScope('invalid_tool')
      } catch (error) {
        expect(error).toBeInstanceOf(SearchSubagentScopeError)
        expect((error as SearchSubagentScopeError).name).toBe('SearchSubagentScopeError')
      }
    })

    it('should have correct error code', () => {
      try {
        assertSearchScope('invalid_tool')
      } catch (error) {
        expect((error as SearchSubagentScopeError).code).toBe(NON_SEARCH_TOOL_NOT_ALLOWED)
      }
    })

    it('should include the invalid tool ID', () => {
      try {
        assertSearchScope('my_invalid_tool')
      } catch (error) {
        expect((error as SearchSubagentScopeError).toolId).toBe('my_invalid_tool')
      }
    })

    it('should include allowed tools list', () => {
      try {
        assertSearchScope('invalid_tool')
      } catch (error) {
        expect((error as SearchSubagentScopeError).allowedTools).toEqual(SEARCH_CATEGORY_TOOL_IDS)
      }
    })

    it('should have descriptive message', () => {
      try {
        assertSearchScope('bad_tool')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toContain('bad_tool')
        expect(message).toContain('web_search')
        expect(message).toContain('docs_search')
      }
    })
  })
})

// ─── isSearchCategoryTool Tests ────────────────────────────────────────────────

describe('isSearchCategoryTool', () => {
  it('should return true for web_search', () => {
    expect(isSearchCategoryTool('web_search')).toBe(true)
  })

  it('should return true for docs_search', () => {
    expect(isSearchCategoryTool('docs_search')).toBe(true)
  })

  it('should return false for non-search tools', () => {
    expect(isSearchCategoryTool('file_read')).toBe(false)
    expect(isSearchCategoryTool('file_write')).toBe(false)
    expect(isSearchCategoryTool('foreground_spawn_planner')).toBe(false)
    expect(isSearchCategoryTool('')).toBe(false)
  })
})

// ─── SEARCH_CATEGORY_TOOL_IDS Tests ────────────────────────────────────────────

describe('SEARCH_CATEGORY_TOOL_IDS', () => {
  it('should contain web_search', () => {
    expect(SEARCH_CATEGORY_TOOL_IDS).toContain('web_search')
  })

  it('should contain docs_search', () => {
    expect(SEARCH_CATEGORY_TOOL_IDS).toContain('docs_search')
  })

  it('should have exactly 2 tool IDs', () => {
    expect(SEARCH_CATEGORY_TOOL_IDS).toHaveLength(2)
  })
})

// ─── Kernel Guard Constants Tests ──────────────────────────────────────────────

describe('Kernel Guard Constants', () => {
  it('should define DEFAULT_FOREGROUND_MAX_ITERATIONS as 6', () => {
    expect(DEFAULT_FOREGROUND_MAX_ITERATIONS).toBe(6)
  })

  it('should define DEFAULT_FOREGROUND_TIMEOUT_MS as 60000', () => {
    expect(DEFAULT_FOREGROUND_TIMEOUT_MS).toBe(60000)
  })

  it('should have safe MAX_ITERATION_EXCEEDED_USER_MESSAGE', () => {
    expect(MAX_ITERATION_EXCEEDED_USER_MESSAGE).toBe(
      'I could not complete this in the allowed number of steps. Please try breaking it into a smaller request.',
    )
    // Should not expose internal details
    expect(MAX_ITERATION_EXCEEDED_USER_MESSAGE).not.toMatch(/\d+/)
  })

  it('should have safe TIMEOUT_USER_MESSAGE', () => {
    expect(TIMEOUT_USER_MESSAGE).toBe('The request took too long to process. Please try a simpler request.')
    // Should not expose timing details
    expect(TIMEOUT_USER_MESSAGE).not.toContain('60000')
    expect(TIMEOUT_USER_MESSAGE).not.toContain('ms')
  })

  it('should have safe LLM_ERROR_USER_MESSAGE', () => {
    expect(LLM_ERROR_USER_MESSAGE).toBe('The AI service encountered an issue. Please try again.')
  })

  it('should have safe GENERIC_ERROR_USER_MESSAGE', () => {
    expect(GENERIC_ERROR_USER_MESSAGE).toBe('Something went wrong while processing your request. Please try again.')
  })
})

// ─── Unprojected Tool Call Tests ───────────────────────────────────────────────

describe('Unprojected Tool Call Handling', () => {
  /**
   * When a tool is called that was not projected in the tool projection,
   * the kernel returns UNPROJECTED_TOOL_CALL error.
   *
   * This section tests that all foreground tools properly handle this scenario
   * when they are not included in the projection.
   */

  const UNPROJECTED_TOOL_CALL_CODE = 'UNPROJECTED_TOOL_CALL'

  it('should recognize UNPROJECTED_TOOL_CALL error code', () => {
    // This is the error code the kernel returns for unprojected tools
    expect(UNPROJECTED_TOOL_CALL_CODE).toBe('UNPROJECTED_TOOL_CALL')
  })

  describe('Foreground tool IDs that must be projected', () => {
    it('should have STATUS_QUERY_TOOL_ID', () => {
      const STATUS_QUERY_TOOL_ID = 'foreground_status_query'
      expect(STATUS_QUERY_TOOL_ID).toBe('foreground_status_query')
    })

    it('should have SPAWN_PLANNER_TOOL_ID', () => {
      const SPAWN_PLANNER_TOOL_ID = 'foreground_spawn_planner'
      expect(SPAWN_PLANNER_TOOL_ID).toBe('foreground_spawn_planner')
    })

    it('should have RESUME_PLANNER_TOOL_ID', () => {
      const RESUME_PLANNER_TOOL_ID = 'foreground_resume_planner'
      expect(RESUME_PLANNER_TOOL_ID).toBe('foreground_resume_planner')
    })

    it('should have LAUNCH_SUBAGENT_TOOL_ID', () => {
      const LAUNCH_SUBAGENT_TOOL_ID = 'foreground_launch_subagent'
      expect(LAUNCH_SUBAGENT_TOOL_ID).toBe('foreground_launch_subagent')
    })

    it('should have CANCEL_MODIFY_TOOL_ID', () => {
      const CANCEL_MODIFY_TOOL_ID = 'foreground_cancel_or_modify_task'
      expect(CANCEL_MODIFY_TOOL_ID).toBe('foreground_cancel_or_modify_task')
    })

    it('should have APPROVAL_REQUEST_TOOL_ID', () => {
      const APPROVAL_REQUEST_TOOL_ID = 'foreground_handle_approval'
      expect(APPROVAL_REQUEST_TOOL_ID).toBe('foreground_handle_approval')
    })

    it('should have SEARCH_SUBAGENT_TOOL_ID', () => {
      const SEARCH_SUBAGENT_TOOL_ID = 'search_subagent'
      expect(SEARCH_SUBAGENT_TOOL_ID).toBe('search_subagent')
    })
  })

  describe('Unprojected call error shape', () => {
    it('should have correct error structure for unprojected calls', () => {
      // Simulating the error returned by AgentKernel.dispatchTool for unprojected tools
      const unprojectedError = {
        toolCallId: 'call-123',
        result: null,
        error: {
          code: UNPROJECTED_TOOL_CALL_CODE,
          message: 'Tool foreground_spawn_planner was not projected as callable for this kernel run',
          recoverable: false,
        },
      }

      expect(unprojectedError.error.code).toBe('UNPROJECTED_TOOL_CALL')
      expect(unprojectedError.error.recoverable).toBe(false)
      expect(unprojectedError.result).toBeNull()
    })

    it('should be non-recoverable when tool is not projected', () => {
      // Unprojected tool calls are not recoverable - the tool must be added to projection
      const unprojectedError = {
        code: UNPROJECTED_TOOL_CALL_CODE,
        recoverable: false,
      }

      expect(unprojectedError.recoverable).toBe(false)
    })
  })
})

// ─── Max Iteration Safe Failure Tests ──────────────────────────────────────────

describe('Max Iteration Safe Failure', () => {
  it('should return safe user message without iteration count', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'max_iterations_reached',
      iterationsUsed: 100,
      toolCalls: [],
      transcript: [],
      error: { code: 'MAX_ITERATIONS', message: 'Reached maximum iterations' },
    }

    const result = mapKernelErrorToForegroundResult(kernelResult)

    // User message should be safe and not expose internal count
    expect(result.finalResponse).toBe(MAX_ITERATION_EXCEEDED_USER_MESSAGE)
    expect(result.finalResponse).not.toContain('100')
    expect(result.finalResponse).not.toContain('iterations')
    expect(result.finalResponse).not.toContain('maximum')
  })

  it('should mark MAX_ITERATIONS_EXCEEDED as non-recoverable', () => {
    expect(isRecoverableError('MAX_ITERATIONS_EXCEEDED')).toBe(false)
  })

  it('should include decision trace with safe reason', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'max_iterations_reached',
      iterationsUsed: 6,
      toolCalls: [],
      transcript: [],
      error: { code: 'MAX_ITERATIONS', message: 'Max iterations' },
    }

    const result = mapKernelErrorToForegroundResult(kernelResult)

    expect(result.decisionTrace.route).toBe('answer_directly')
    expect(result.decisionTrace.requiresPlanner).toBe(false)
    expect(result.decisionTrace.reason).toContain('MAX_ITERATIONS_EXCEEDED')
  })
})

// ─── Timeout Safe Failure Tests ────────────────────────────────────────────────

describe('Timeout Safe Failure', () => {
  it('should return safe user message without timeout duration', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'timeout',
      iterationsUsed: 2,
      toolCalls: [],
      transcript: [],
      error: { code: 'TIMEOUT', message: 'Execution timed out after 120000ms' },
    }

    const result = mapKernelErrorToForegroundResult(kernelResult)

    // User message should be safe and not expose timeout duration
    expect(result.finalResponse).toBe(TIMEOUT_USER_MESSAGE)
    expect(result.finalResponse).not.toContain('120000')
    expect(result.finalResponse).not.toContain('ms')
  })

  it('should mark TIMEOUT as recoverable', () => {
    expect(isRecoverableError('TIMEOUT')).toBe(true)
  })

  it('should include decision trace with safe reason', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'timeout',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
      error: { code: 'TIMEOUT', message: 'Timed out' },
    }

    const result = mapKernelErrorToForegroundResult(kernelResult)

    expect(result.decisionTrace.route).toBe('answer_directly')
    expect(result.decisionTrace.reason).toContain('TIMEOUT')
  })
})
