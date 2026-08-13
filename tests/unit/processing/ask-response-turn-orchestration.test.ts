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
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'

/**
 * ask_response synthetic turns: the orchestration processor must
 * 1. mark the turn source 'ask_response' (like 'background_notification'),
 * 2. inject the user's answers into the model context via
 *    turnInput.syntheticContextItems (the same orderedItems path background
 *    run notifications use), and
 * 3. never write a userMessageSummary for the synthetic turn.
 */
describe('ask_response synthetic turn handling', () => {
  let mockGateway: Gateway
  let mockStores: Stores
  let mockForegroundAgent: ForegroundAgent
  let mockTranscriptStore: TranscriptStore
  let savedTranscripts: TurnTranscript[]
  let deps: ProcessorOrchestrationDeps

  beforeEach(() => {
    const mockHydratedSession: HydratedSessionState = {
      userContext: {
        userId: 'user-ask',
        sessionId: 'session-ask',
        preferences: {},
      },
      sessionContext: {
        messageCount: 0,
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
      activeWorkRefs: {
        pendingApprovals: [],
        activeRuns: [],
      },
    }

    mockGateway = {
      receiveUserMessage: vi.fn(),
      normalizeInbound: vi.fn(),
      assembleHydratedState: vi.fn().mockReturnValue(mockHydratedSession),
      formatOutbound: vi.fn(),
      getApprovalRoutingHint: vi.fn(),
    }

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
        finalResponse: 'Thanks — I will book Shanghai.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Ask response continuation',
        },
      } as ForegroundTurnResult),
    }

    const mockRuntimeDispatcher = {
      dispatch: vi.fn(),
    } as unknown as RuntimeDispatcher

    const mockPlannerRuntime = {
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

    const mockAgentKernel = {
      run: vi.fn(),
    } as unknown as AgentKernel

    const mockLlmAdapter = {
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
      findBySession: vi.fn((sessionId: string) => savedTranscripts.filter((t) => t.sessionId === sessionId)),
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
      modelInputBuilder: createRealModelInputBuilder(),
      transcriptStore: mockTranscriptStore,
    }
  })

  it('marks the turn source ask_response and injects the answers as a system-note context item', async () => {
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId: 'turn-ask-ask_1-xyz',
      userId: 'user-ask',
      sessionId: 'session-ask',
      text: '',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {
        envelopeEventType: 'ask_response',
        askResponse: {
          askId: 'ask_1',
          answers: [{ value: 'shanghai', label: 'Shanghai' }],
          question: 'Which city should I book the hotel in?',
        },
        autoTrigger: true,
      },
    }

    await processor(input)

    const turnInput = vi.mocked(mockForegroundAgent.runTurn).mock.calls[0]?.[0]
    expect(turnInput?.source).toBe('ask_response')

    expect(turnInput?.syntheticContextItems).toHaveLength(1)
    const item = turnInput?.syntheticContextItems?.[0]
    expect(item?.sourceType).toBe('system_note')
    expect(item?.content).toBe(
      'User answered your question (ask_1): Which city should I book the hotel in? → Shanghai (shanghai)',
    )
    expect(item?.structuredPayload).toEqual({
      askId: 'ask_1',
      answers: [{ value: 'shanghai', label: 'Shanghai' }],
    })
  })

  it('formats the note without a question when question metadata is absent', async () => {
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId: 'turn-ask-ask_2-xyz',
      userId: 'user-ask',
      sessionId: 'session-ask',
      text: '',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {
        envelopeEventType: 'ask_response',
        askResponse: {
          askId: 'ask_2',
          answers: [{ value: '42' }],
        },
        autoTrigger: true,
      },
    }

    await processor(input)

    const turnInput = vi.mocked(mockForegroundAgent.runTurn).mock.calls[0]?.[0]
    expect(turnInput?.syntheticContextItems?.[0]?.content).toBe('User answered your question (ask_2): 42')
  })

  it('persists an empty userMessageSummary for the ask_response synthetic turn', async () => {
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId: 'turn-ask-ask_3-xyz',
      userId: 'user-ask',
      sessionId: 'session-ask',
      text: '',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {
        envelopeEventType: 'ask_response',
        askResponse: {
          askId: 'ask_3',
          answers: [{ value: 'yes' }],
        },
        autoTrigger: true,
      },
    }

    await processor(input)

    expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
    expect(savedTranscripts[0]?.input.userMessageSummary).toBe('')
  })

  it('regression: a normal user turn still preserves its userMessageSummary and injects nothing', async () => {
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId: 'corr-normal-ask-001',
      userId: 'user-ask',
      sessionId: 'session-ask',
      text: 'Hello there',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: { inboundEventId: 'evt-normal-001' },
    }

    await processor(input)

    const turnInput = vi.mocked(mockForegroundAgent.runTurn).mock.calls[0]?.[0]
    expect(turnInput?.source).toBe('user')
    expect(turnInput?.syntheticContextItems).toBeUndefined()
    expect(savedTranscripts[0]?.input.userMessageSummary).toBe('Hello there')
  })
})
