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
import type { EventStore } from '../../../src/storage/event-store.js'
import type { FileUploadStore } from '../../../src/storage/file-upload-store.js'
import { createRealModelInputBuilder } from '../../helpers/model-input.js'
import type { ForegroundTurnResult } from '../../../src/foreground/foreground-runner-types.js'
import { createConsoleTimelineService, type ConsoleTimelineStores } from '../../../src/api/console-timeline.js'

/**
 * T6: zero user-message pollution from auto-continued (background_notification)
 * synthetic turns. The single-point fix lives in persistTurnTranscript: when the
 * turn's metadata.envelopeEventType === 'background_notification', the
 * transcript's input.userMessageSummary is written as '' instead of the
 * (already empty) input.text. Downstream consumers (console-timeline,
 * session-history, transcript-search, memory extractor, usage stats,
 * buildConversationHistory) must naturally skip empty summaries.
 */
describe('background notification zero pollution (T6)', () => {
  let mockGateway: Gateway
  let mockStores: Stores
  let mockForegroundAgent: ForegroundAgent
  let mockTranscriptStore: TranscriptStore
  let savedTranscripts: TurnTranscript[]
  let deps: ProcessorOrchestrationDeps

  beforeEach(() => {
    const mockHydratedSession: HydratedSessionState = {
      userContext: {
        userId: 'user-bg',
        sessionId: 'session-bg',
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
        finalResponse: 'Background task completed.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Background notification response',
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
      // console-timeline test queries findBySession; return the captured
      // transcripts so the timeline service maps them.
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

  /**
   * (a) Synthetic notification turn persisted via persistTurnTranscript -> the
   * transcript's input.userMessageSummary is '' (empty). This is the single-point
   * fix that guarantees zero downstream pollution.
   */
  it('persists empty userMessageSummary for synthetic background_notification turn', async () => {
    const correlationId = 'turn-bg-bg-run-xyz-abc'
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId,
      userId: 'user-bg',
      sessionId: 'session-bg',
      // Synthetic turns set text to '' (T4 contract).
      text: '',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {
        envelopeEventType: 'background_notification',
        sourceBackgroundRunId: 'bg-run-xyz',
        autoTrigger: true,
        notificationType: 'completed',
      },
    }

    await processor(input)

    expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
    expect(savedTranscripts).toHaveLength(1)

    const savedTranscript = savedTranscripts[0]
    // Single-point fix: synthetic notification turn MUST NOT write a
    // userMessageSummary (empty string, not the input.text which is also ''
    // here, but the guard is on the marker - see malformed_input test below).
    expect(savedTranscript.input.userMessageSummary).toBe('')
    // inboundEventId and other fields are preserved as-is.
    expect(savedTranscript.turnId).toBe(correlationId)
    expect(savedTranscript.sessionId).toBe('session-bg')
  })

  /**
   * (b) console-timeline does NOT produce a user_message event for an
   * empty-summary transcript entry. The existing `if (turn.input.userMessageSummary)`
   * guard at console-timeline.ts:202 already skips falsy summaries, so an
   * empty string naturally yields no user_message event. This test asserts
   * that behavior holds end-to-end through the real timeline service.
   */
  it('console-timeline emits no user_message event for empty-summary synthetic turn', () => {
    const sessionId = 'session-bg'
    const turnId = 'turn-bg-bg-run-xyz-abc'

    // Simulate a persisted synthetic-notification transcript exactly as the
    // single-point fix in persistTurnTranscript would produce it.
    const transcript: TurnTranscript = {
      turnId,
      sessionId,
      userId: 'user-bg',
      input: {
        // Empty summary is the contract for synthetic notification turns.
        userMessageSummary: '',
        inboundTimestamp: '2024-01-15T10:00:00.000Z',
      },
      output: {
        visibleMessages: [
          {
            messageId: `msg-${turnId}-assistant`,
            role: 'assistant',
            content: 'Background task completed.',
          },
        ],
      },
      visibility: 'public',
      createdAt: '2024-01-15T10:00:05.000Z',
    }

    const mockEventStore = {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore

    const timelineStores: ConsoleTimelineStores = {
      transcriptStore: {
        saveTurn: vi.fn(),
        getTurn: vi.fn().mockReturnValue(null),
        findBySession: vi.fn().mockReturnValue([transcript]),
        search: vi.fn().mockReturnValue([]),
        findByArtifactRef: vi.fn().mockReturnValue([]),
        findByPlannerRunId: vi.fn().mockReturnValue([]),
        updateUserIdForSession: vi.fn().mockReturnValue(0),
      } as unknown as TranscriptStore,
      eventStore: mockEventStore,
      fileUploadStore: undefined as unknown as FileUploadStore | undefined,
    }

    const timelineService = createConsoleTimelineService(timelineStores)
    const result = timelineService.getTimeline(sessionId)

    const userMessageEvents = result.events.filter((e) => e.eventType === 'user_message')
    expect(userMessageEvents).toHaveLength(0)

    // Assistant message still surfaces (legitimate assistant output, no pollution).
    const assistantEvents = result.events.filter((e) => e.eventType === 'assistant_message')
    expect(assistantEvents).toHaveLength(1)
    expect(assistantEvents[0].content).toBe('Background task completed.')
  })

  /**
   * (c) Regression: a normal user turn (non-empty text, no background_notification
   * marker) MUST still persist its userMessageSummary verbatim. Guards against
   * accidentally applying the empty-summary rule to non-synthetic turns.
   */
  it('regression: normal turn preserves non-empty userMessageSummary', async () => {
    const correlationId = 'corr-normal-user-001'
    const userText = 'Hello, can you help me with my project?'
    const processor = createOrchestrationProcessor({ deps })
    const input: MessageProcessorInput = {
      correlationId,
      userId: 'user-bg',
      sessionId: 'session-bg',
      text: userText,
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: { inboundEventId: 'evt-normal-001' },
    }

    await processor(input)

    expect(mockTranscriptStore.saveTurn).toHaveBeenCalledTimes(1)
    const savedTranscript = savedTranscripts[0]
    // Non-synthetic turn: summary preserved exactly.
    expect(savedTranscript.input.userMessageSummary).toBe(userText)
    expect(savedTranscript.input.inboundEventId).toBe('evt-normal-001')
  })

  /**
   * Adversarial - malformed_input: a turn whose text is empty but that does
   * NOT carry the background_notification marker must NOT be treated as
   * synthetic by the persist path. The single-point fix keys off the marker,
   * not off empty text. With no marker, input.text passes through verbatim
   * (which happens to be '' here, but the logic path is the normal one).
   *
   * The contrapositive guard: a turn WITH the marker but non-empty text (e.g.
   * a malformed synthetic input) must still be zeroed - the marker is the
   * sole trigger, regardless of text content.
   */
  it('malformed_input: marker (not empty text) is the sole trigger for empty summary', async () => {
    // Case 1: empty text + NO marker -> normal path, summary = input.text = ''
    const processor = createOrchestrationProcessor({ deps })
    const noMarkerInput: MessageProcessorInput = {
      correlationId: 'corr-empty-no-marker',
      userId: 'user-bg',
      sessionId: 'session-bg',
      text: '',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {},
    }
    await processor(noMarkerInput)
    expect(savedTranscripts[savedTranscripts.length - 1].input.userMessageSummary).toBe('')

    // Case 2: non-empty text + marker -> synthetic path, summary zeroed
    // (marker wins over text content).
    vi.mocked(mockForegroundAgent.runTurn!).mockResolvedValue({
      status: 'completed',
      finalResponse: 'Auto-responded.',
      decisionTrace: {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Auto response',
      },
    } as ForegroundTurnResult)

    const markerInput: MessageProcessorInput = {
      correlationId: 'corr-marker-nonempty-text',
      userId: 'user-bg',
      sessionId: 'session-bg',
      // Synthetic turn that erroneously carries text - must be discarded.
      text: 'should-be-discarded',
      timestamp: '2024-01-15T10:00:00.000Z',
      metadata: {
        envelopeEventType: 'background_notification',
        sourceBackgroundRunId: 'bg-run-malformed',
        autoTrigger: true,
        notificationType: 'completed',
      },
    }
    await processor(markerInput)
    const markerTranscript = savedTranscripts[savedTranscripts.length - 1]
    // Marker is the sole trigger: text is discarded, summary is empty.
    expect(markerTranscript.input.userMessageSummary).toBe('')
    expect(markerTranscript.input.userMessageSummary).not.toBe('should-be-discarded')
  })
})
