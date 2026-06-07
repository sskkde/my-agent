/**
 * @deprecated / @historical — these tests exercise the legacy ForegroundKernelRunner
 * route-dispatch path which has been removed (T17). All scenarios are skipped.
 *
 * @see src/foreground/tools/ for the replacement tool implementations
 * @see src/processing/processor-orchestration.ts for the replacement pipeline
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createForegroundKernelRunner } from '../../../src/foreground/foreground-kernel-runner.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import type { ForegroundDecision, ForegroundSessionState } from '../../../src/foreground/types.js'
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { RuntimeDispatcher, DispatchResult } from '../../../src/dispatcher/types.js'
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMResult, LLMResponse } from '../../../src/llm/types.js'
import type { HydratedSessionState } from '../../../src/gateway/types.js'

function createMockForegroundState(): ForegroundSessionState {
  return {
    hydratedSession: {
      userContext: {
        userId: 'user-001',
        sessionId: 'session-001',
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
    userId: 'user-001',
    sessionId: 'session-001',
    turnId: 'turn-001',
    message: 'Hello!',
    timestamp: '2024-01-15T10:00:00.000Z',
    hydratedState: state.hydratedSession,
    foregroundState: state,
    ...overrides,
  }
}

function createMockLLMResponse(content: string): LLMResult {
  const response: LLMResponse = {
    id: 'resp-001',
    content,
    model: 'gpt-4o-mini',
    role: 'assistant',
    finishReason: 'stop',
    createdAt: '2024-01-15T10:00:00.000Z',
  }
  return {
    success: true,
    response,
    providerId: 'mock-provider',
  }
}

describe.skip('ForegroundKernelRunner Integration Tests [deprecated/historical]', () => {
  let mockForegroundAgent: ForegroundAgent
  let mockAgentKernel: AgentKernel
  let mockRuntimeDispatcher: RuntimeDispatcher
  let mockPlannerRuntime: PlannerRuntime
  let mockLlmAdapter: LLMAdapter

  beforeEach(() => {
    mockForegroundAgent = {
      processMessage: vi.fn().mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Default mock response',
      } as ForegroundDecision),
    }

    mockAgentKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'Kernel processed response',
        iterationsUsed: 1,
        toolCalls: [{ toolCallId: 'tc-001', toolName: 'memory_retrieve', params: { query: 'test' } }],
        transcript: [],
      } as KernelRunResult),
    } as unknown as AgentKernel

    mockRuntimeDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        requestId: 'req-001',
        actionId: 'action-001',
        status: 'completed',
        targetRuntime: 'gateway',
        result: { activeWork: [] },
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult),
    }

    mockPlannerRuntime = {
      createPlannerRun: vi.fn().mockReturnValue({
        plannerRunId: 'planner-run-001',
        planId: 'plan-001',
        status: 'initializing',
        actions: [],
      }),
      resumePlannerRun: vi.fn(),
      cancelPlannerRun: vi.fn(),
      replan: vi.fn(),
      archivePlannerRun: vi.fn(),
      transitionState: vi.fn(),
      handleApprovalRejection: vi.fn(),
      applyPlanPatch: vi.fn(),
      addActiveExecutionRef: vi.fn(),
      emitRuntimeAction: vi.fn(),
      saveCheckpoint: vi.fn(),
    }

    mockLlmAdapter = {
      config: {
        providers: [],
        defaultTimeoutMs: 10000,
        enableCircuitBreaker: false,
      },
      providers: [],
      complete: vi.fn().mockResolvedValue(createMockLLMResponse('LLM response content')),
      stream: async function* () {},
      addProvider: vi.fn(),
      removeProvider: vi.fn(),
      getProvider: vi.fn(),
      getHealthyProviders: vi.fn().mockReturnValue([]),
      updateProviderPriority: vi.fn(),
    } as unknown as LLMAdapter
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Scenario 1: Full dispatch_tool flow', () => {
    it('completes full user message -> processor -> ForegroundKernelRunner -> dispatch_tool -> AgentKernel tool loop -> tool_result -> finalResponse', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['memory_retrieve'],
      } as ForegroundDecision)

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'Based on the retrieved memory, here is the information you requested.',
        iterationsUsed: 2,
        toolCalls: [
          { toolCallId: 'tc-memory-retrieve-001', toolName: 'memory_retrieve', params: { query: 'project details' } },
        ],
        transcript: [
          {
            iteration: 1,
            timestamp: '2024-01-15T10:00:01.000Z',
            type: 'tool_call',
            content: { toolCallId: 'tc-memory-retrieve-001' },
          },
          {
            iteration: 1,
            timestamp: '2024-01-15T10:00:02.000Z',
            type: 'tool_result',
            content: { result: 'Project Mercury details...' },
          },
          {
            iteration: 2,
            timestamp: '2024-01-15T10:00:03.000Z',
            type: 'llm_response',
            content: 'Based on the retrieved memory...',
          },
        ],
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'What do you know about my project?' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('completed')
      expect(result.finalResponse).toBe('Based on the retrieved memory, here is the information you requested.')
      expect(result.decisionTrace.route).toBe('dispatch_tool')
      expect(result.kernelResult).toBeDefined()
      expect(result.kernelResult?.iterationsUsed).toBe(2)
      expect(result.runtimeSummary).toBeDefined()
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1)
    })
  })

  describe('Scenario 2: finalResponse does NOT contain "Processing tool request..."', () => {
    it('finalResponse is natural language, not the old placeholder string', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['docs_search'],
        userVisibleResponse: 'Searching documentation...',
      } as ForegroundDecision)

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'The documentation shows that TypeScript interfaces can be extended using the extends keyword.',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-docs-search-001', toolName: 'docs_search', params: { query: 'interface extends' } },
        ],
        transcript: [],
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'How do I extend an interface?' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('completed')
      expect(result.finalResponse).not.toContain('Processing tool request...')
      expect(result.finalResponse).not.toContain('Processing...')
      expect(result.finalResponse).toContain('TypeScript')
    })
  })

  describe('Scenario 3: finalResponse does NOT expose raw JSON tool results', () => {
    it('finalResponse is LLM-processed, not raw JSON tool result', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['web_search'],
      } as ForegroundDecision)

      const rawToolResult = {
        query: 'TypeScript tutorial',
        results: [
          {
            title: 'TypeScript Handbook',
            url: 'https://typescriptlang.org',
            snippet: 'The TypeScript Handbook is the official guide...',
          },
          { title: 'TypeScript Deep Dive', url: 'https://basarat.gitbook.io', snippet: 'A comprehensive deep dive...' },
        ],
        total: 2,
        provider: 'searxng',
      }

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse:
          'I found two excellent TypeScript resources: the official TypeScript Handbook and TypeScript Deep Dive by Basarat.',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: 'tc-web-search-001', toolName: 'web_search', params: { query: 'TypeScript tutorial' } },
        ],
        transcript: [
          { iteration: 1, timestamp: '2024-01-15T10:00:01.000Z', type: 'tool_result', content: rawToolResult },
        ],
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Find TypeScript tutorials' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('completed')
      expect(result.finalResponse).not.toContain('{"toolResult"')
      expect(result.finalResponse).not.toContain('{"query"')
      expect(result.finalResponse).not.toContain('"results":')
      expect(result.finalResponse).not.toContain('tc-web-search-001')
      expect(result.finalResponse).toContain('TypeScript')
      expect(result.finalResponse).toContain('Handbook')
    })
  })

  describe('Scenario 4: toolCallSummaries contain real toolCallIds', () => {
    it('runtimeSummary.toolCallSummaries contains actual toolCallIds from KernelRunResult', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['memory_retrieve', 'transcript_search'],
      } as ForegroundDecision)

      const realToolCallIds = ['tc-memory-retrieve-002', 'tc-transcript-search-003']

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'completed',
        finalResponse: 'I found relevant information in both memory and transcript.',
        iterationsUsed: 1,
        toolCalls: [
          { toolCallId: realToolCallIds[0], toolName: 'memory_retrieve', params: { query: 'project' } },
          { toolCallId: realToolCallIds[1], toolName: 'transcript_search', params: { query: 'discussion' } },
        ],
        transcript: [],
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Search memory and transcript' })
      const result = await runner.runTurn(input)

      expect(result.runtimeSummary).toBeDefined()
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(2)
      expect(result.runtimeSummary?.toolCallSummaries?.[0].toolCallId).toBe(realToolCallIds[0])
      expect(result.runtimeSummary?.toolCallSummaries?.[0].toolName).toBe('memory_retrieve')
      expect(result.runtimeSummary?.toolCallSummaries?.[0].status).toBe('completed')
      expect(result.runtimeSummary?.toolCallSummaries?.[1].toolCallId).toBe(realToolCallIds[1])
      expect(result.runtimeSummary?.toolCallSummaries?.[1].toolName).toBe('transcript_search')
      expect(result.runtimeSummary?.toolCallSummaries?.[1].status).toBe('completed')
    })
  })

  describe('Scenario 5: Tool failure produces LLM-summarized failure explanation', () => {
    it('returns meaningful error message, not raw error dump', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['web_search'],
        userVisibleResponse: 'Searching the web...',
      } as ForegroundDecision)

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [{ toolCallId: 'tc-web-search-failed', toolName: 'web_search', params: { query: 'test' } }],
        transcript: [],
        error: {
          code: 'WEB_SEARCH_UNAVAILABLE',
          message: 'The web search service is temporarily unavailable. Please try again later.',
        },
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Search the web' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('WEB_SEARCH_UNAVAILABLE')
      expect(result.error?.message).not.toContain('{"error"')
      expect(result.error?.message).not.toContain('stack')
      expect(result.error?.message).toContain('unavailable')
    })

    it('returns userVisibleResponse as fallback when kernel fails without error', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'dispatch_tool',
        requiresPlanner: false,
        reason: 'Tool dispatch required',
        suggestedTools: ['docs_search'],
        userVisibleResponse: 'The document search encountered an issue.',
      } as ForegroundDecision)

      vi.mocked(mockAgentKernel.run).mockResolvedValue({
        finalStatus: 'failed',
        finalResponse: undefined,
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'KERNEL_ERROR', message: 'Kernel execution failed' },
      } as KernelRunResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Search docs' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('KERNEL_ERROR')
    })
  })

  describe('Scenario 6: answer_directly path works end-to-end', () => {
    it('answer_directly returns LLM response without calling AgentKernel', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple greeting',
        userVisibleResponse: 'Hello! How can I help you today?',
      } as ForegroundDecision)

      vi.mocked(mockLlmAdapter.complete).mockResolvedValue(
        createMockLLMResponse('Hello! I am your AI assistant. How can I assist you?'),
      )

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Hello!' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('completed')
      expect(result.finalResponse).toBe('Hello! I am your AI assistant. How can I assist you?')
      expect(result.decisionTrace.route).toBe('answer_directly')
      expect(result.kernelResult).toBeUndefined()
      expect(mockAgentKernel.run).not.toHaveBeenCalled()
      expect(mockLlmAdapter.complete).toHaveBeenCalled()
    })

    it('answer_directly falls back to userVisibleResponse when LLM fails', async () => {
      vi.mocked(mockForegroundAgent.processMessage).mockResolvedValue({
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Simple question',
        userVisibleResponse: 'This is a fallback response.',
      } as ForegroundDecision)

      vi.mocked(mockLlmAdapter.complete).mockResolvedValue({
        success: false,
        error: {
          errorId: 'err-001',
          category: 'model_error',
          code: 'PROVIDER_ERROR',
          message: 'Provider unavailable',
          recoverability: 'retryable_later',
          source: { module: 'llm' },
          createdAt: '2024-01-15T10:00:00.000Z',
        },
        providerId: 'mock-provider',
      } as LLMResult)

      const runner = createForegroundKernelRunner({
        foregroundAgent: mockForegroundAgent,
        agentKernel: mockAgentKernel,
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRuntime: mockPlannerRuntime,
        llmAdapter: mockLlmAdapter,
      })

      const input = createMockInput({ message: 'Hello' })
      const result = await runner.runTurn(input)

      expect(result.status).toBe('completed')
      expect(result.finalResponse).toBe('This is a fallback response.')
      expect(mockAgentKernel.run).not.toHaveBeenCalled()
    })
  })
})
