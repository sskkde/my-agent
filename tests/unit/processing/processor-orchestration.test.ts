import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MessageProcessorInput } from '../../../src/processing/types.js'
import {
  createOrchestrationProcessor,
  type ProcessorOrchestrationDeps,
} from '../../../src/processing/processor-orchestration.js'
import type { ForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import type { HydratedSessionState, Stores } from '../../../src/gateway/types.js'
import type { Gateway } from '../../../src/gateway/gateway.js'
import type { RuntimeDispatcher } from '../../../src/dispatcher/types.js'
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js'
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { AgentConfig, AgentConfigStore } from '../../../src/storage/agent-config-store.js'
import type { ProviderConfigStore } from '../../../src/storage/provider-config-store.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'

describe('ProcessorOrchestration', () => {
  // Mock dependencies
  let mockGateway: Gateway
  let mockStores: Stores
  let mockForegroundAgent: ForegroundAgent
  let mockRuntimeDispatcher: RuntimeDispatcher
  let mockPlannerRuntime: PlannerRuntime
  let mockAgentKernel: AgentKernel
  let mockLlmAdapter: LLMAdapter
  let mockTranscriptStore: TranscriptStore
  let savedTranscripts: TurnTranscript[]

  let deps: ProcessorOrchestrationDeps

  beforeEach(() => {
    // Create mock hydrated session state
    const mockHydratedSession: HydratedSessionState = {
      userContext: {
        userId: 'user-123',
        sessionId: 'session-456',
        preferences: {},
      },
      sessionContext: {
        messageCount: 5,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
    }

    // Setup mock gateway
    mockGateway = {
      receiveUserMessage: vi.fn(),
      normalizeInbound: vi.fn(),
      assembleHydratedState: vi.fn().mockReturnValue(mockHydratedSession),
      formatOutbound: vi.fn(),
      getApprovalRoutingHint: vi.fn(),
    }

    // Setup mock stores
    mockStores = {
      eventStore: {
        append: vi.fn(),
        query: vi.fn().mockReturnValue([]),
      },
      summaryStore: {
        getSessionMemory: vi.fn().mockReturnValue(null),
      },
      transcriptStore: {
        findBySession: vi.fn().mockReturnValue([]),
      },
      runtimeActionStore: {
        findBySessionId: vi.fn().mockReturnValue([]),
      },
    }

    mockForegroundAgent = {
      runTurn: vi.fn().mockResolvedValue({
        status: 'completed',
        finalResponse: 'Default mock response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Default mock response',
        },
      } as ForegroundTurnResult),
    }

    mockRuntimeDispatcher = {
      dispatch: vi.fn(),
    } as unknown as RuntimeDispatcher

    mockPlannerRuntime = {
      createPlannerRun: vi.fn(),
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
    } as unknown as PlannerRuntime

    // Setup mock agent kernel
    mockAgentKernel = {
      run: vi.fn(),
    } as unknown as AgentKernel

    mockLlmAdapter = {
      providers: [{ providerId: 'test-provider' }],
      complete: vi.fn(),
      getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
    } as unknown as LLMAdapter

    savedTranscripts = []
    mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript)
        return true
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn().mockReturnValue([]),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore

    deps = {
      gateway: mockGateway,
      stores: mockStores,
      foregroundAgent: mockForegroundAgent,
      runtimeDispatcher: mockRuntimeDispatcher,
      plannerRuntime: mockPlannerRuntime,
      agentKernel: mockAgentKernel,
      llmAdapter: mockLlmAdapter,
      transcriptStore: mockTranscriptStore,
    }
  })

  describe('answer_directly route', () => {
    it('should return visible assistant output with same correlation id', async () => {
      const correlationId = 'corr-abc-123'
      const userVisibleResponse = 'Hello! I understand your message.'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: userVisibleResponse,
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question detected',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toBe(userVisibleResponse)
      expect(result.result?.route).toBe('answer_directly')
      expect(result.result?.data?.reason).toBe('Simple question detected')
    })

    it('should handle empty finalResponse gracefully', async () => {
      const correlationId = 'corr-def-456'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: '',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Default fallback',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toBe('')
    })
  })

  describe('status_query route', () => {
    it('should return runner output for status_query', async () => {
      const correlationId = 'corr-status-789'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Checking active work status...',
        decisionTrace: {
          route: 'status_query',
          requiresPlanner: false,
          reason: 'User requested status update',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'What is the status?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toBe('Checking active work status...')
      expect(result.result?.route).toBe('status_query')
      expect(result.result?.data?.reason).toBe('User requested status update')
    })
  })

  describe('dispatch_tool route', () => {
    it('should return runner output with runtimeSummary and kernelResult', async () => {
      const correlationId = 'corr-tool-abc'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Found relevant memory entries.',
        decisionTrace: {
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Simple read task detected',
          suggestedTools: ['memory_retrieve', 'transcript_search'],
        },
        kernelResult: {
          finalStatus: 'completed',
          finalResponse: 'Found relevant memory entries.',
          iterationsUsed: 1,
          toolCallCount: 1,
        },
        runtimeSummary: {
          toolCallSummaries: [{ toolCallId: 'tc-001', toolName: 'memory_retrieve', status: 'completed' }],
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Search for something',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toBe('Found relevant memory entries.')
      expect(result.result?.route).toBe('dispatch_tool')
      expect(result.result?.data?.reason).toBe('Simple read task detected')
      expect(result.result?.data?.runtimeSummary).toBeDefined()
      expect(result.result?.data?.kernelResult).toBeDefined()
    })

    it('should NOT contain "Processing tool request..." in response', async () => {
      const correlationId = 'corr-tool-no-legacy'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'The documentation shows that TypeScript interfaces can be extended.',
        decisionTrace: {
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Tool dispatch via kernel runner',
          suggestedTools: ['docs_search'],
        },
        kernelResult: {
          finalStatus: 'completed',
          finalResponse: 'The documentation shows that TypeScript interfaces can be extended.',
          iterationsUsed: 1,
          toolCallCount: 1,
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'How to extend interfaces?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.result?.text).not.toContain('Processing tool request...')
      expect(result.result?.text).not.toContain('Processing...')
      expect(result.result?.text).toContain('TypeScript')
    })

    it('should return error when runner reports failure for dispatch_tool', async () => {
      const correlationId = 'corr-tool-error-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'failed',
        finalResponse: 'Tool execution failed.',
        decisionTrace: {
          route: 'dispatch_tool',
          requiresPlanner: false,
          reason: 'Tool dispatch failed',
        },
        error: {
          code: 'KERNEL_ERROR',
          message: 'Kernel execution failed',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Search for test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Kernel execution failed')
      expect(result.error?.details).toEqual({ foregroundErrorCode: 'KERNEL_ERROR' })
    })
  })

  describe('spawn_planner route', () => {
    it('should return runner output for spawn_planner', async () => {
      const correlationId = 'corr-planner-xyz'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: "I've created a plan for your task with plan ID plan-001.",
        decisionTrace: {
          route: 'spawn_planner',
          requiresPlanner: true,
          reason: 'Complex task detected (5 steps)',
        },
        runtimeSummary: {
          plannerRunIds: ['planner-run-001'],
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a complex project with multiple steps',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toContain("I've created a plan")
      expect(result.result?.route).toBe('spawn_planner')
      expect(result.result?.data?.reason).toBe('Complex task detected (5 steps)')
      expect(result.result?.data?.runtimeSummary).toBeDefined()
    })

    it('should return error when runner reports planner failure', async () => {
      const correlationId = 'corr-planner-error-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'failed',
        finalResponse: '',
        decisionTrace: {
          route: 'spawn_planner',
          requiresPlanner: true,
          reason: 'Complex task requiring planning',
        },
        error: {
          code: 'SPAWN_PLANNER_ERROR',
          message: 'Planner runtime unavailable',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a project',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Planner runtime unavailable')
      expect(result.error?.details).toEqual({ foregroundErrorCode: 'SPAWN_PLANNER_ERROR' })
    })
  })

  describe('resume_existing_planner route', () => {
    it('should return runner output for resume', async () => {
      const correlationId = 'corr-resume-123'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Resuming your previous task...',
        decisionTrace: {
          route: 'resume_existing_planner',
          requiresPlanner: true,
          reason: 'Resuming existing planner run',
          targetRef: { plannerRunId: 'planner-run-456' },
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Continue with my task',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.text).toBe('Resuming your previous task...')
      expect(result.result?.route).toBe('resume_existing_planner')
      expect(result.result?.data?.reason).toBe('Resuming existing planner run')
    })
  })

  describe('processing error handling', () => {
    it('should return PROCESSING_ERROR when runner throws', async () => {
      const correlationId = 'corr-error-111'

      vi.mocked(mockForegroundAgent.runTurn!).mockRejectedValue(new Error('Foreground runner failed'))

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.correlationId).toBe(correlationId)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Foreground runner failed')
    })

    it('should return visible error when gateway hydration fails', async () => {
      const correlationId = 'corr-error-222'

      vi.mocked(mockGateway.assembleHydratedState).mockImplementation(() => {
        throw new Error('Hydration failed')
      })

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.correlationId).toBe(correlationId)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Hydration failed')
    })

    it('should handle non-Error exceptions gracefully', async () => {
      const correlationId = 'corr-error-333'

      vi.mocked(mockForegroundAgent.runTurn!).mockRejectedValue('String error')

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.correlationId).toBe(correlationId)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('Unknown processing error')
    })
  })

  describe('input transformation', () => {
    it('should correctly build ForegroundTurnInput for runner.runTurn()', async () => {
      const correlationId = 'corr-transform-444'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test transformation',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-transform',
        sessionId: 'session-transform',
        text: 'Test message content',
        timestamp: '2024-01-15T12:00:00.000Z',
        metadata: { customField: 'customValue' },
      }

      await processor(input)

      // Verify the runner was called with correct ForegroundTurnInput
      const callArgs = vi.mocked(mockForegroundAgent.runTurn!).mock.calls[0]
      const turnInput = callArgs[0]

      expect(turnInput.message).toBe('Test message content')
      expect(turnInput.userId).toBe('user-transform')
      expect(turnInput.sessionId).toBe('session-transform')
      expect(turnInput.turnId).toBe(correlationId)
      expect(turnInput.timestamp).toBe('2024-01-15T12:00:00.000Z')
      expect(turnInput.hydratedState).toBeDefined()
      expect(turnInput.foregroundState).toBeDefined()
    })

    it('should correctly build ForegroundSessionState from hydrated state', async () => {
      const correlationId = 'corr-state-555'

      const customHydratedState: HydratedSessionState = {
        userContext: {
          userId: 'user-custom',
          sessionId: 'session-custom',
          preferences: { theme: 'dark' },
        },
        sessionContext: {
          messageCount: 42,
          lastActivityAt: '2024-01-15T11:00:00.000Z',
          activePlannerRunIds: ['planner-1'],
          activeBackgroundRunIds: ['bg-1'],
        },
        activeWorkRefs: {
          pendingApprovals: ['approval-1'],
          activeRuns: ['run-1'],
        },
      }

      vi.mocked(mockGateway.assembleHydratedState).mockReturnValue(customHydratedState)

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test state building',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-custom',
        sessionId: 'session-custom',
        text: 'Test',
        timestamp: '2024-01-15T12:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      // Verify the runner was called with correct foregroundState
      const callArgs = vi.mocked(mockForegroundAgent.runTurn!).mock.calls[0]
      const turnInput = callArgs[0]
      const foregroundState = turnInput.foregroundState

      expect(foregroundState.hydratedSession).toBe(customHydratedState)
      expect(foregroundState.activeWorkRefs).toEqual(customHydratedState.activeWorkRefs)
      expect(foregroundState.currentPersona.personaId).toBe('default')
      expect(foregroundState.currentPersona.name).toBe('Assistant')
      expect(foregroundState.effectivePolicy.estimatedStepsGte).toBe(3)
    })

    it('should include prior transcript turns as conversation history', async () => {
      const correlationId = 'corr-history-555'
      vi.mocked(mockTranscriptStore.findBySession).mockReturnValue([
        {
          turnId: 'turn-history-1',
          sessionId: 'session-history',
          userId: 'user-history',
          input: {
            userMessageSummary: 'My project codename is Mercury.',
            inboundTimestamp: '2024-01-15T09:00:00.000Z',
          },
          output: {
            visibleMessages: [
              {
                messageId: 'msg-history-1-assistant',
                role: 'assistant',
                content: 'I will remember Mercury for this session.',
              },
            ],
          },
          visibility: 'public',
          createdAt: '2024-01-15T09:00:10.000Z',
        },
      ])

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test history',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-history',
        sessionId: 'session-history',
        text: 'What is the codename?',
        timestamp: '2024-01-15T12:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const callArgs = vi.mocked(mockForegroundAgent.runTurn!).mock.calls[0]
      const turnInput = callArgs[0]
      const foregroundState = turnInput.foregroundState

      expect(mockTranscriptStore.findBySession).toHaveBeenCalledWith('session-history')
      expect(foregroundState.conversationHistory).toEqual([
        {
          turnId: 'turn-history-1',
          role: 'user',
          message: 'My project codename is Mercury.',
          timestamp: '2024-01-15T09:00:00.000Z',
        },
        {
          turnId: 'turn-history-1',
          role: 'assistant',
          message: 'I will remember Mercury for this session.',
          timestamp: '2024-01-15T09:00:10.000Z',
        },
      ])
    })
  })

  describe('persona customization', () => {
    it('should use custom persona when provided', async () => {
      const correlationId = 'corr-persona-666'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test custom persona',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({
        deps,
        defaultPersonaId: 'custom-persona',
        defaultPersonaName: 'Custom Assistant',
      })

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const callArgs = vi.mocked(mockForegroundAgent.runTurn!).mock.calls[0]
      const turnInput = callArgs[0]
      const foregroundState = turnInput.foregroundState

      expect(foregroundState.currentPersona.personaId).toBe('custom-persona')
      expect(foregroundState.currentPersona.name).toBe('Custom Assistant')
    })
  })

  describe('additional routes', () => {
    it('should handle dispatch_subagent route', async () => {
      const correlationId = 'corr-subagent-777'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Dispatching subagent...',
        decisionTrace: {
          route: 'dispatch_subagent',
          requiresPlanner: false,
          reason: 'Delegating to subagent',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Do something in background',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.route).toBe('dispatch_subagent')
    })

    it('should handle approval_handler route', async () => {
      const correlationId = 'corr-approval-888'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Processing your approval response...',
        decisionTrace: {
          route: 'approval_handler',
          requiresPlanner: false,
          reason: 'Processing approval response',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Yes, approve it',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.route).toBe('approval_handler')
    })

    it('should handle cancel_or_modify_task route', async () => {
      const correlationId = 'corr-cancel-999'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Task cancelled.',
        decisionTrace: {
          route: 'cancel_or_modify_task',
          requiresPlanner: false,
          reason: 'Cancel request for active work: run-123',
          targetRef: { plannerRunId: 'run-123' },
        },
        runtimeSummary: {
          plannerRunIds: ['run-123'],
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Cancel my task',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.correlationId).toBe(correlationId)
      expect(result.result?.route).toBe('cancel_or_modify_task')
      expect(result.result?.data?.reason).toBe('Cancel request for active work: run-123')
    })
  })

  describe('channel neutrality verification', () => {
    it('should not include channel-specific fields in output', async () => {
      const correlationId = 'corr-neutral-000'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test channel neutrality',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      // Verify output is channel-neutral
      expect(result).not.toHaveProperty('sourceChannel')
      expect(result).not.toHaveProperty('channel')
      expect(result).not.toHaveProperty('recipient')
      expect(result).not.toHaveProperty('channelRegistry')
      expect(result).not.toHaveProperty('sseBroadcaster')
      expect(result).toHaveProperty('correlationId')
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('timestamp')
    })
  })

  describe('transcript persistence', () => {
    beforeEach(() => {
      savedTranscripts = []
      vi.mocked(mockTranscriptStore.saveTurn).mockClear()
    })

    it('should persist transcript on successful processing', async () => {
      const correlationId = 'corr-transcript-success-001'
      const userVisibleResponse = 'I understand your message.'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: userVisibleResponse,
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question detected',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello, can you help me?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { inboundEventId: 'evt-123' },
      }

      await processor(input)

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
      expect(savedTranscripts).toHaveLength(1)

      const savedTranscript = savedTranscripts[0]
      expect(savedTranscript.turnId).toBe(correlationId)
      expect(savedTranscript.sessionId).toBe('session-456')
      expect(savedTranscript.userId).toBe('user-123')
      expect(savedTranscript.input.inboundEventId).toBe('evt-123')
      expect(savedTranscript.input.userMessageSummary).toBe('Hello, can you help me?')
      expect(savedTranscript.visibility).toBe('public')
      expect(savedTranscript.output.visibleMessages).toHaveLength(1)
      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant')
      expect(savedTranscript.output.visibleMessages[0].content).toBe(userVisibleResponse)
    })

    it('should persist transcript with error message on processing failure', async () => {
      const correlationId = 'corr-transcript-error-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockRejectedValue(new Error('Foreground runner crashed'))

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message that causes error',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
      expect(savedTranscripts).toHaveLength(1)

      const savedTranscript = savedTranscripts[0]
      expect(savedTranscript.turnId).toBe(correlationId)
      expect(savedTranscript.output.visibleMessages).toHaveLength(1)
      expect(savedTranscript.output.visibleMessages[0].role).toBe('error')
      expect(savedTranscript.output.visibleMessages[0].content).toContain('PROCESSING_ERROR')
      expect(savedTranscript.output.visibleMessages[0].content).toContain('Foreground runner crashed')
    })

    it('should persist transcript with system_status for non-answer_directly routes', async () => {
      const correlationId = 'corr-transcript-status-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: "I've created a plan for your task.",
        decisionTrace: {
          route: 'spawn_planner',
          requiresPlanner: true,
          reason: 'Complex task requiring planning',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Plan a complex project',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
      expect(savedTranscripts).toHaveLength(1)

      const savedTranscript = savedTranscripts[0]
      expect(savedTranscript.output.visibleMessages).toHaveLength(2)
      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant')
      expect(savedTranscript.output.visibleMessages[0].content).toBe("I've created a plan for your task.")
      expect(savedTranscript.output.visibleMessages[1].role).toBe('system_status')
      expect(savedTranscript.output.visibleMessages[1].content).toContain('spawn_planner')
    })

    it('should not include raw internal reasoning in thinking_summary', async () => {
      const correlationId = 'corr-transcript-safe-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Here is my public response.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Internal chain-of-thought reasoning that should not be persisted',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'What do you think?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const savedTranscript = savedTranscripts[0]

      const thinkingMessages = savedTranscript.output.visibleMessages.filter((m) => m.role === 'thinking')
      expect(thinkingMessages).toHaveLength(0)

      const hasInternalReasoning = savedTranscript.output.visibleMessages.some((m) =>
        m.content.includes('Internal chain-of-thought'),
      )
      expect(hasInternalReasoning).toBe(false)

      expect(savedTranscript.output.visibleMessages[0].role).toBe('assistant')
      expect(savedTranscript.output.visibleMessages[0].content).toBe('Here is my public response.')
    })

    it('should continue processing even if transcript persistence fails', async () => {
      const correlationId = 'corr-transcript-fail-001'

      vi.mocked(mockTranscriptStore.saveTurn).mockImplementation(() => {
        throw new Error('Database error')
      })

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response despite persistence failure',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test persistence failure handling',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(true)
      expect(result.result?.text).toBe('Response despite persistence failure')
    })

    it('should return error and persist transcript when no LLM providers configured', async () => {
      const correlationId = 'corr-no-providers-001'

      const noProviderAdapter = {
        providers: [],
        complete: vi.fn(),
        getProviderHealth: vi.fn().mockReturnValue({ healthy: false }),
      } as unknown as LLMAdapter

      const noProviderDeps = {
        ...deps,
        llmAdapter: noProviderAdapter,
      }

      const processor = createOrchestrationProcessor({ deps: noProviderDeps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Test message with no providers',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('No LLM providers configured. Message received but cannot be processed.')

      expect(mockTranscriptStore.saveTurn).toHaveBeenCalled()
      const savedTranscript = savedTranscripts[savedTranscripts.length - 1]
      expect(savedTranscript.output.visibleMessages).toHaveLength(1)
      expect(savedTranscript.output.visibleMessages[0].role).toBe('error')
      expect(savedTranscript.output.visibleMessages[0].content).toContain('PROCESSING_ERROR')
    })
  })

  describe('timeline visibility', () => {
    beforeEach(() => {
      savedTranscripts = []
      vi.mocked(mockTranscriptStore.saveTurn).mockClear()
    })

    it('timeline query should include user_message and assistant_message after success', async () => {
      const correlationId = 'corr-timeline-success-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Yes, I can help with that!',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Can you help me?',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const savedTranscript = savedTranscripts[0]

      expect(savedTranscript.input.userMessageSummary).toBe('Can you help me?')
      expect(savedTranscript.output.visibleMessages.some((m) => m.role === 'assistant')).toBe(true)

      const assistantMsg = savedTranscript.output.visibleMessages.find((m) => m.role === 'assistant')
      expect(assistantMsg?.content).toBe('Yes, I can help with that!')
    })

    it('timeline query should include user_message and error after failure', async () => {
      const correlationId = 'corr-timeline-error-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockRejectedValue(new Error('Processing pipeline error'))

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'This will fail',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const savedTranscript = savedTranscripts[0]

      expect(savedTranscript.input.userMessageSummary).toBe('This will fail')
      expect(savedTranscript.output.visibleMessages.some((m) => m.role === 'error')).toBe(true)

      const errorMsg = savedTranscript.output.visibleMessages.find((m) => m.role === 'error')
      expect(errorMsg?.content).toContain('PROCESSING_ERROR')
    })

    it('should include correlation metadata in transcript for timeline linkage', async () => {
      const correlationId = 'corr-timeline-link-001'

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response with correlation.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test correlation',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps })
      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Test correlation linkage',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { inboundEventId: 'evt-correlation-001' },
      }

      await processor(input)

      const savedTranscript = savedTranscripts[0]

      expect(savedTranscript.turnId).toBe(correlationId)
      expect(savedTranscript.input.inboundEventId).toBe('evt-correlation-001')
      expect(savedTranscript.sessionId).toBe('session-789')
      expect(savedTranscript.userId).toBe('user-456')
    })
  })

  describe('provider resolver integration', () => {
    it('should pass resolved provider and effective agent config into runner', async () => {
      const agentConfig: AgentConfig = {
        agentConfigId: 'agent-config-1',
        agentId: 'foreground.default',
        scope: 'user',
        userId: 'user-123',
        displayName: 'User Config',
        enabled: true,
        systemPrompt: 'User system prompt',
        routingPrompt: null,
        providerId: 'selected-provider',
        model: 'selected-model',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 25000,
        repairAttempts: 0,
        promptType: null,
        promptVersion: null,
        searchLlmProviderId: null,
        searchLlmModel: null,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
      }

      const mockProviderConfigStore = {
        listByUser: vi.fn().mockReturnValue([
          {
            providerId: 'selected-provider',
            userId: 'user-123',
            providerType: 'openrouter',
            displayName: 'Selected Provider',
            enabled: true,
            configured: true,
            selectedModel: 'provider-model',
          },
        ]),
        getByIdWithSecret: vi.fn().mockReturnValue(null),
        getById: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        updateTestStatus: vi.fn(),
      } as unknown as ProviderConfigStore

      const mockAgentConfigStore = {
        getGlobalDefault: vi.fn().mockReturnValue(null),
        getByUser: vi.fn().mockReturnValue(agentConfig),
        listByUser: vi.fn().mockReturnValue([agentConfig]),
        upsert: vi.fn(),
        remove: vi.fn(),
      } as unknown as AgentConfigStore

      const providerScopes: Array<{ userId: string; preferredProviderId?: string }> = []
      const runWithProvidersForUser: ProcessorOrchestrationDeps['runWithProvidersForUser'] = async <T>(
        userId: string,
        fn: () => Promise<T>,
        preferredProviderId?: string,
      ): Promise<T> => {
        providerScopes.push({ userId, preferredProviderId })
        return fn()
      }

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'I understand.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({
        deps: {
          ...deps,
          providerConfigStore: mockProviderConfigStore,
          agentConfigStore: mockAgentConfigStore,
          runWithProvidersForUser,
        },
      })

      await processor({
        correlationId: 'corr-config-001',
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      })

      expect(providerScopes).toEqual([{ userId: 'user-123', preferredProviderId: 'selected-provider' }])

      const turnInput = vi.mocked(mockForegroundAgent.runTurn!).mock.calls[0][0]
      expect(turnInput.agentConfig).toBe(agentConfig)
      expect(turnInput.foregroundState.resolvedProvider).toBe('selected-provider')
      expect(turnInput.foregroundState.resolvedModel).toBe('selected-model')
    })

    it('should log fallback event when provider resolution triggers fallback', async () => {
      const correlationId = 'corr-fallback-001'
      const mockAppendEvent = vi.fn()

      const mockEventStore = {
        append: mockAppendEvent,
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      }

      const mockProviderConfigStore = {
        listByUser: vi.fn().mockReturnValue([
          {
            providerId: 'fallback-provider',
            userId: 'user-123',
            providerType: 'openai',
            displayName: 'Fallback Provider',
            enabled: true,
            configured: true,
            selectedModel: 'fallback-model',
            apiKey: 'sk-test',
          },
        ]),
        getByIdWithSecret: vi.fn().mockReturnValue(null),
        getById: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      }

      const depsWithResolver = {
        ...deps,
        eventStore: mockEventStore,
        providerConfigStore:
          mockProviderConfigStore as unknown as import('../../../src/storage/provider-config-store.js').ProviderConfigStore,
      }

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'I understand.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({
        deps: depsWithResolver,
        sessionProviderSelection: {
          selectedProviderId: 'nonexistent-provider',
        },
      })

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      expect(mockAppendEvent).toHaveBeenCalled()
      const loggedEvent = mockAppendEvent.mock.calls[0][0]
      expect(loggedEvent.eventType).toBe('llm_provider_fallback')
      expect(loggedEvent.payload.originalProviderId).toBe('nonexistent-provider')
      expect(loggedEvent.payload.actualProviderId).toBe('fallback-provider')
      expect(loggedEvent.payload.fallbackReason).toBeDefined()
      expect(loggedEvent.sensitivity).toBe('low')
    })

    it('should not include secrets in fallback event payload', async () => {
      const correlationId = 'corr-fallback-002'
      const mockAppendEvent = vi.fn()

      const mockEventStore = {
        append: mockAppendEvent,
        query: vi.fn().mockReturnValue([]),
        findByCorrelationId: vi.fn().mockReturnValue([]),
        findByCausationId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      }

      const mockProviderConfigStore = {
        listByUser: vi.fn().mockReturnValue([
          {
            providerId: 'fallback-provider',
            userId: 'user-123',
            providerType: 'openai',
            displayName: 'Fallback Provider',
            enabled: true,
            configured: true,
            selectedModel: 'fallback-model',
            apiKey: 'sk-secret-key-12345',
          },
        ]),
        getByIdWithSecret: vi.fn().mockReturnValue(null),
        getById: vi.fn().mockReturnValue(null),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      }

      const depsWithResolver = {
        ...deps,
        eventStore: mockEventStore,
        providerConfigStore:
          mockProviderConfigStore as unknown as import('../../../src/storage/provider-config-store.js').ProviderConfigStore,
      }

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'I understand.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Simple question',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({
        deps: depsWithResolver,
        sessionProviderSelection: {
          selectedProviderId: 'nonexistent-provider',
        },
      })

      const input: MessageProcessorInput = {
        correlationId,
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      const loggedEvent = mockAppendEvent.mock.calls[0][0]
      const payloadStr = JSON.stringify(loggedEvent.payload)
      expect(payloadStr).not.toContain('sk-secret-key')
      expect(payloadStr).not.toContain('12345')
      expect(loggedEvent.payload).toHaveProperty('originalProviderId')
      expect(loggedEvent.payload).toHaveProperty('actualProviderId')
      expect(loggedEvent.payload).toHaveProperty('fallbackReason')
    })
  })

  describe('legacy fallback removed', () => {
    it('should fail fast when foregroundAgent.runTurn is missing', async () => {
      const depsWithoutRunTurn = {
        ...deps,
        foregroundAgent: {} as unknown as ForegroundAgent,
      }

      const processor = createOrchestrationProcessor({ deps: depsWithoutRunTurn })
      const input: MessageProcessorInput = {
        correlationId: 'no-runt-turn',
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('ForegroundAgent.runTurn is not configured')
    })

    it('should fail fast when foregroundAgent is undefined', async () => {
      const depsWithoutAgent = {
        ...deps,
        foregroundAgent: undefined,
      }

      const processor = createOrchestrationProcessor({ deps: depsWithoutAgent })
      const input: MessageProcessorInput = {
        correlationId: 'no-agent',
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const result = await processor(input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PROCESSING_ERROR')
      expect(result.error?.message).toBe('ForegroundAgent.runTurn is not configured')
    })

    it('should NOT call processMessage as fallback', async () => {
      const processMessageSpy = vi.fn()
      const depsWithSpy = {
        ...deps,
        foregroundAgent: {
          runTurn: mockForegroundAgent.runTurn,
          processMessage: processMessageSpy,
        } as unknown as ForegroundAgent,
      }

      vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
        status: 'completed',
        finalResponse: 'Response via runTurn',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Test',
        },
      } as ForegroundTurnResult)

      const processor = createOrchestrationProcessor({ deps: depsWithSpy })
      const input: MessageProcessorInput = {
        correlationId: 'spy-check',
        userId: 'user-123',
        sessionId: 'session-456',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      await processor(input)

      expect(processMessageSpy).not.toHaveBeenCalled()
    })
  })
})
