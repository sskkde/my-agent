import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { KernelRunInput, KernelRunResult } from '../../../src/kernel/types.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundSessionState } from '../../../src/foreground/types.js'
import type { HydratedSessionState } from '../../../src/gateway/types.js'
import type { ToolRegistry, ToolDefinition } from '../../../src/tools/types.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import {
  DEFAULT_FOREGROUND_MAX_ITERATIONS,
  DEFAULT_FOREGROUND_TIMEOUT_MS,
  MAX_ITERATION_EXCEEDED_USER_MESSAGE,
  TIMEOUT_USER_MESSAGE,
  LLM_ERROR_USER_MESSAGE,
} from '../../../src/foreground/kernel-guard-constants.js'

function createMockForegroundState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user-123',
        sessionId: 'session-456',
        preferences: {},
      },
      sessionContext: {
        messageCount: 1,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
    } as HydratedSessionState,
    activeWorkRefs: {
      pendingApprovals: [],
      activeRuns: [],
    },
    currentPersona: {
      personaId: 'default',
      name: 'Assistant',
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium',
        allowedToolCategories: ['read', 'search', 'internal'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search', 'internal'],
    },
    conversationHistory: [],
  }
}

function createMockInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  const state = createMockForegroundState()
  return {
    userId: 'user-123',
    sessionId: 'session-456',
    turnId: 'turn-001',
    message: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    hydratedState: state.hydratedSession,
    foregroundState: state,
    ...overrides,
  }
}

function createMockKernelResult(overrides?: Partial<KernelRunResult>): KernelRunResult {
  return {
    finalStatus: 'completed',
    finalResponse: 'Kernel processed response',
    iterationsUsed: 1,
    toolCalls: [{ toolCallId: 'tc-001', toolName: 'ask_user', params: {} }],
    transcript: [],
    ...overrides,
  }
}

describe('ForegroundAgent.runTurn via AgentKernel', () => {
  let mockAgentKernel: AgentKernel
  let agent: ForegroundAgent

  beforeEach(() => {
    mockAgentKernel = {
      run: vi.fn().mockResolvedValue(createMockKernelResult()),
    } as unknown as AgentKernel

    agent = createForegroundAgent({ agentKernel: mockAgentKernel })
  })

  it('runTurn calls AgentKernel.run with function-calling projection — agent kind foreground, toolProjection present, maxIterations set, timeoutMs set', async () => {
    const input = createMockInput()
    await agent.runTurn!(input)

    expect(mockAgentKernel.run).toHaveBeenCalledTimes(1)
    const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0][0] as KernelRunInput

    expect(kernelInput.agentId).toBe('foreground.default')
    expect(kernelInput.agentType).toBe('main')
    expect(kernelInput.userId).toBe('user-123')
    expect(kernelInput.sessionId).toBe('session-456')
    expect(kernelInput.maxIterations).toBe(DEFAULT_FOREGROUND_MAX_ITERATIONS)
    expect(kernelInput.timeoutMs).toBe(DEFAULT_FOREGROUND_TIMEOUT_MS)

    expect(kernelInput.toolProjection).toBeDefined()
    expect(kernelInput.toolProjection!.toolIds).toBeDefined()
    expect(kernelInput.toolProjection!.toolIds.length).toBeGreaterThan(0)
    expect(kernelInput.toolProjection!.tools).toBeDefined()
    expect(kernelInput.toolProjection!.tools!.length).toBeGreaterThan(0)

    expect(kernelInput.toolProjection!.toolIds).toContain('ask_user')
    expect(kernelInput.toolProjection!.toolIds).toContain('status_query')
    expect(kernelInput.toolProjection!.toolIds).toContain('memory_retrieve')
  })

  it('Kernel failure does not route fallback — safe failed ForegroundTurnResult returned', async () => {
    vi.mocked(mockAgentKernel.run).mockResolvedValue(
      createMockKernelResult({
        finalStatus: 'failed',
        finalResponse: undefined,
        error: { code: 'UNKNOWN', message: 'Something broke' },
      }),
    )

    const input = createMockInput()
    const result = await agent.runTurn!(input)

    expect(result.status).toBe('failed')
    expect(result.finalResponse).not.toBe('')
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('GENERIC_ERROR')
  })

  it('Max iterations safe failure — returns safe finalResponse', async () => {
    vi.mocked(mockAgentKernel.run).mockResolvedValue(
      createMockKernelResult({
        finalStatus: 'max_iterations_reached',
        finalResponse: undefined,
        iterationsUsed: DEFAULT_FOREGROUND_MAX_ITERATIONS,
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      }),
    )

    const input = createMockInput()
    const result = await agent.runTurn!(input)

    expect(result.status).toBe('failed')
    expect(result.finalResponse).toBe(MAX_ITERATION_EXCEEDED_USER_MESSAGE)
    expect(result.error!.code).toBe('MAX_ITERATIONS_EXCEEDED')
  })

  it('Timeout safe failure — returns safe finalResponse', async () => {
    vi.mocked(mockAgentKernel.run).mockResolvedValue(
      createMockKernelResult({
        finalStatus: 'timeout',
        finalResponse: undefined,
        iterationsUsed: 3,
        error: { code: 'TIMEOUT', message: 'Execution timed out' },
      }),
    )

    const input = createMockInput()
    const result = await agent.runTurn!(input)

    expect(result.status).toBe('failed')
    expect(result.finalResponse).toBe(TIMEOUT_USER_MESSAGE)
    expect(result.error!.code).toBe('TIMEOUT')
  })

  it('LLM error returns safe failure with LLM_ERROR code', async () => {
    vi.mocked(mockAgentKernel.run).mockResolvedValue(
      createMockKernelResult({
        finalStatus: 'failed',
        finalResponse: undefined,
        error: { code: 'LLM_RATE_LIMIT', message: 'Rate limit exceeded' },
      }),
    )

    const input = createMockInput()
    const result = await agent.runTurn!(input)

    expect(result.status).toBe('failed')
    expect(result.finalResponse).toBe(LLM_ERROR_USER_MESSAGE)
    expect(result.error!.code).toBe('LLM_ERROR')
  })

  it('Completed result includes kernelResult with iteration and tool call counts', async () => {
    vi.mocked(mockAgentKernel.run).mockResolvedValue(
      createMockKernelResult({
        finalStatus: 'completed',
        finalResponse: 'Done!',
        iterationsUsed: 2,
        toolCalls: [
          { toolCallId: 'tc-001', toolName: 'web_search', params: {} },
          { toolCallId: 'tc-002', toolName: 'memory_retrieve', params: {} },
        ],
      }),
    )

    const input = createMockInput()
    const result = await agent.runTurn!(input)

    expect(result.status).toBe('completed')
    expect(result.finalResponse).toBe('Done!')
    expect(result.kernelResult).toBeDefined()
    expect(result.kernelResult!.finalStatus).toBe('completed')
    expect(result.kernelResult!.iterationsUsed).toBe(2)
    expect(result.kernelResult!.toolCallCount).toBe(2)
    expect(result.toolCallSummaries).toHaveLength(2)
    expect(result.runtimeSummary).toBeDefined()
  })

  // ─── Tool Schema Exposure Tests ─────────────────────────────────────────────

  describe('Tool schema projection', () => {
    it('projected tools include real JSON schema parameters — session_history has sessionId, transcript_search has query', async () => {
      // Create a real ToolRegistry with parameterized tools
      const toolRegistry: ToolRegistry = createToolRegistry()

      // Register session_history tool with real schema
      const sessionHistoryTool: ToolDefinition = {
        name: 'session_history',
        description: 'Retrieve message history for a session with pagination and truncation',
        category: 'read',
        sensitivity: 'medium',
        schema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID to retrieve history for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return (default: 50, max: 200)',
            },
            offset: {
              type: 'number',
              description: 'Number of messages to skip for pagination',
            },
          },
          required: ['sessionId'],
        },
        handler: async () => ({ success: true, data: {} }),
      }

      // Register transcript_search tool with real schema
      const transcriptSearchTool: ToolDefinition = {
        name: 'transcript_search',
        description: 'Search transcript records for matching content',
        category: 'search',
        sensitivity: 'medium',
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string' },
            sessionId: { type: 'string', description: 'Optional session ID to limit search scope' },
            limit: { type: 'number', description: 'Maximum number of results to return' },
          },
          required: ['query'],
        },
        handler: async () => ({ success: true, data: {} }),
      }

      // Register a high-risk exec tool (should NOT be projected)
      const execTool: ToolDefinition = {
        name: 'exec',
        description: 'Execute a shell command with security validation',
        category: 'execute',
        sensitivity: 'high',
        schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The command to execute' },
          },
          required: ['command'],
        },
        handler: async () => ({ success: true, data: {} }),
      }

      toolRegistry.register(sessionHistoryTool)
      toolRegistry.register(transcriptSearchTool)
      toolRegistry.register(execTool)

      // Create ForegroundAgent with ToolRegistry
      const agentWithRegistry = createForegroundAgent({ agentKernel: mockAgentKernel })
      agentWithRegistry.setToolRegistry!(toolRegistry)

      const input = createMockInput()
      await agentWithRegistry.runTurn!(input)

      // Capture the KernelRunInput passed to AgentKernel.run
      expect(mockAgentKernel.run).toHaveBeenCalledTimes(1)
      const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0][0] as KernelRunInput

      // Verify toolProjection is present
      expect(kernelInput.toolProjection).toBeDefined()
      expect(kernelInput.toolProjection!.tools).toBeDefined()
      expect(kernelInput.toolProjection!.tools!.length).toBeGreaterThan(0)

      // Find session_history tool in projection
      const sessionHistoryProj = kernelInput.toolProjection!.tools!.find(
        (t) => t.function.name === 'session_history',
      )
      expect(sessionHistoryProj).toBeDefined()
      expect(sessionHistoryProj!.function.parameters).toBeDefined()
      expect(sessionHistoryProj!.function.parameters!.type).toBe('object')
      expect(sessionHistoryProj!.function.parameters!.properties).toBeDefined()

      // CRITICAL: Verify sessionId parameter exists (not empty schema)
      const sessionHistoryProps = sessionHistoryProj!.function.parameters!.properties as Record<string, unknown>
      expect(sessionHistoryProps.sessionId).toBeDefined()
      expect((sessionHistoryProps.sessionId as { type: string }).type).toBe('string')

      // Find transcript_search tool in projection
      const transcriptSearchProj = kernelInput.toolProjection!.tools!.find(
        (t) => t.function.name === 'transcript_search',
      )
      expect(transcriptSearchProj).toBeDefined()
      expect(transcriptSearchProj!.function.parameters).toBeDefined()
      expect(transcriptSearchProj!.function.parameters!.type).toBe('object')
      expect(transcriptSearchProj!.function.parameters!.properties).toBeDefined()

      // CRITICAL: Verify query parameter exists (not empty schema)
      const transcriptSearchProps = transcriptSearchProj!.function.parameters!.properties as Record<string, unknown>
      expect(transcriptSearchProps.query).toBeDefined()
      expect((transcriptSearchProps.query as { type: string }).type).toBe('string')

      // HIGH-RISK TOOL EXCLUSION: Verify exec tool is NOT projected
      const execProj = kernelInput.toolProjection!.tools!.find(
        (t) => t.function.name === 'exec',
      )
      expect(execProj).toBeUndefined()

      // Verify exec is also not in toolIds
      expect(kernelInput.toolProjection!.toolIds).not.toContain('exec')
    })

    it('tool parameters.properties is never empty for parameterized tools — proves schema exposure bug is fixed', async () => {
      const toolRegistry: ToolRegistry = createToolRegistry()

      const parameterizedTools: ToolDefinition[] = [
        {
          name: 'session_history',
          description: 'Retrieve session history',
          category: 'read',
          sensitivity: 'medium',
          schema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Session ID' },
            },
            required: ['sessionId'],
          },
          handler: async () => ({ success: true, data: {} }),
        },
        {
          name: 'transcript_search',
          description: 'Search transcripts',
          category: 'search',
          sensitivity: 'medium',
          schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
          handler: async () => ({ success: true, data: {} }),
        },
      ]

      parameterizedTools.forEach((tool) => toolRegistry.register(tool))

      const agentWithRegistry = createForegroundAgent({ agentKernel: mockAgentKernel })
      agentWithRegistry.setToolRegistry!(toolRegistry)

      const input = createMockInput()
      await agentWithRegistry.runTurn!(input)

      const kernelInput = vi.mocked(mockAgentKernel.run).mock.calls[0][0] as KernelRunInput
      const projectedTools = kernelInput.toolProjection!.tools!

      const registeredToolNames = parameterizedTools.map((t) => t.name)
      const projectedRegisteredTools = projectedTools.filter((t) =>
        registeredToolNames.includes(t.function.name),
      )

      expect(projectedRegisteredTools.length).toBeGreaterThan(0)

      for (const tool of projectedRegisteredTools) {
        const params = tool.function.parameters
        expect(params).toBeDefined()
        expect(params!.type).toBe('object')
        const props = params!.properties as Record<string, unknown>
        expect(Object.keys(props).length).toBeGreaterThan(0)
      }
    })
  })
})
