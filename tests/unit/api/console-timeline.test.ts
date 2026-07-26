import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createConsoleTimelineService, type ConsoleTimelineStores } from '../../../src/api/console-timeline.js'
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { EventStore, EventRecord } from '../../../src/storage/event-store.js'

describe('ConsoleTimelineService', () => {
  let mockTranscriptStore: TranscriptStore
  let mockEventStore: EventStore
  let stores: ConsoleTimelineStores
  let savedTranscripts: TurnTranscript[]
  let savedEvents: EventRecord[]

  beforeEach(() => {
    savedTranscripts = []
    savedEvents = []

    mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript)
        return true
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn((sessionId: string) => {
        return savedTranscripts.filter((t) => t.sessionId === sessionId)
      }),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore

    mockEventStore = {
      append: vi.fn((event: EventRecord | EventRecord[]) => {
        if (Array.isArray(event)) {
          savedEvents.push(...event)
        } else {
          savedEvents.push(event)
        }
      }),
      query: vi.fn((filters: { sessionId?: string; eventType?: string }) => {
        return savedEvents.filter((e) => {
          if (filters.sessionId && e.sessionId !== filters.sessionId) return false
          if (filters.eventType && e.eventType !== filters.eventType) return false
          return true
        })
      }),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore

    stores = {
      transcriptStore: mockTranscriptStore,
      eventStore: mockEventStore,
    }
  })

  describe('transcript to timeline mapping', () => {
    it('should map successful turn to user_message and assistant_message events', () => {
      const sessionId = 'session-success-001'
      const turnId = 'turn-success-001'
      const correlationId = 'corr-success-001'

      const transcript: TurnTranscript = {
        turnId,
        sessionId,
        userId: 'user-123',
        input: {
          inboundEventId: 'evt-001',
          userMessageSummary: 'Hello, can you help me?',
        },
        output: {
          visibleMessages: [
            {
              messageId: `msg-${correlationId}-assistant`,
              role: 'assistant',
              content: 'Yes, I can help you with that!',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:00:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)

      const userMessageEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userMessageEvent).toBeDefined()
      expect(userMessageEvent?.content).toBe('Hello, can you help me?')
      expect(userMessageEvent?.sessionId).toBe(sessionId)
      expect(userMessageEvent?.metadata?.turnId).toBe(turnId)
      expect(userMessageEvent?.actor).toBe('user-123')

      const assistantMessageEvent = result.events.find((e) => e.eventType === 'assistant_message')
      expect(assistantMessageEvent).toBeDefined()
      expect(assistantMessageEvent?.content).toBe('Yes, I can help you with that!')
      expect(assistantMessageEvent?.sessionId).toBe(sessionId)
      expect(assistantMessageEvent?.metadata?.turnId).toBe(turnId)
      expect(assistantMessageEvent?.metadata?.messageId).toBe(`msg-${correlationId}-assistant`)
      expect(assistantMessageEvent?.actor).toBe('assistant')
    })

    it('should map failed turn to user_message and error events', () => {
      const sessionId = 'session-error-001'
      const turnId = 'turn-error-001'
      const correlationId = 'corr-error-001'

      const transcript: TurnTranscript = {
        turnId,
        sessionId,
        userId: 'user-456',
        input: {
          inboundEventId: 'evt-error-001',
          userMessageSummary: 'This will cause an error',
        },
        output: {
          visibleMessages: [
            {
              messageId: `msg-${correlationId}-error`,
              role: 'error',
              content: '[PROCESSING_ERROR] Something went wrong',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:01:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)

      const userMessageEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userMessageEvent).toBeDefined()
      expect(userMessageEvent?.content).toBe('This will cause an error')
      expect(userMessageEvent?.metadata?.turnId).toBe(turnId)

      const errorEvent = result.events.find((e) => e.eventType === 'error')
      expect(errorEvent).toBeDefined()
      expect(errorEvent?.content).toBe('[PROCESSING_ERROR] Something went wrong')
      expect(errorEvent?.sessionId).toBe(sessionId)
      expect(errorEvent?.metadata?.turnId).toBe(turnId)
      expect(errorEvent?.metadata?.messageId).toBe(`msg-${correlationId}-error`)
      expect(errorEvent?.actor).toBe('system')
    })

    it('should map system_status visible messages to system_status events', () => {
      const sessionId = 'session-status-001'
      const turnId = 'turn-status-001'

      const transcript: TurnTranscript = {
        turnId,
        sessionId,
        userId: 'user-789',
        input: {
          userMessageSummary: 'Plan something complex',
        },
        output: {
          visibleMessages: [
            {
              messageId: `msg-${turnId}-assistant`,
              role: 'assistant',
              content: 'Spawning planner...',
            },
            {
              messageId: `msg-${turnId}-status`,
              role: 'system_status',
              content: 'spawn_planner: Complex task requiring planning',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:02:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const systemStatusEvent = result.events.find((e) => e.eventType === 'system_status')
      expect(systemStatusEvent).toBeDefined()
      expect(systemStatusEvent?.content).toBe('spawn_planner: Complex task requiring planning')
      expect(systemStatusEvent?.metadata?.turnId).toBe(turnId)
    })

    it('should include correlation metadata in all timeline events', () => {
      const sessionId = 'session-meta-001'
      const turnId = 'turn-meta-001'
      const userId = 'user-meta-001'

      const transcript: TurnTranscript = {
        turnId,
        sessionId,
        userId,
        input: {
          inboundEventId: 'evt-meta-001',
          userMessageSummary: 'Test message',
        },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-assistant-001',
              role: 'assistant',
              content: 'Response',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:03:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      result.events.forEach((event) => {
        expect(event.metadata).toBeDefined()
        expect(event.metadata?.turnId).toBe(turnId)
        expect(event.metadata?.userId).toBe(userId)
      })
    })

    it('should sort timeline events by timestamp', () => {
      const sessionId = 'session-sort-001'

      const transcript1: TurnTranscript = {
        turnId: 'turn-001',
        sessionId,
        userId: 'user-001',
        input: { userMessageSummary: 'First message' },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-001',
              role: 'assistant',
              content: 'First response',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:00:00.000Z',
      }

      const transcript2: TurnTranscript = {
        turnId: 'turn-002',
        sessionId,
        userId: 'user-001',
        input: { userMessageSummary: 'Second message' },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-002',
              role: 'assistant',
              content: 'Second response',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:01:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript1)
      mockTranscriptStore.saveTurn(transcript2)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userMessages = result.events.filter((e) => e.eventType === 'user_message')
      expect(userMessages).toHaveLength(2)
      expect(userMessages[0].content).toBe('First message')
      expect(userMessages[1].content).toBe('Second message')
    })

    it('should apply event type filters correctly', () => {
      const sessionId = 'session-filter-001'

      const transcript: TurnTranscript = {
        turnId: 'turn-filter-001',
        sessionId,
        userId: 'user-001',
        input: { userMessageSummary: 'Test' },
        output: {
          visibleMessages: [{ messageId: 'msg-001', role: 'assistant', content: 'Response' }],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:00:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const allResult = timelineService.getTimeline(sessionId)
      expect(allResult.events).toHaveLength(2)

      const filteredResult = timelineService.getTimeline(sessionId, {
        eventTypes: ['assistant_message'],
      })
      expect(filteredResult.events).toHaveLength(1)
      expect(filteredResult.events[0].eventType).toBe('assistant_message')
      expect(filteredResult.total).toBe(1)
    })
  })

  describe('Task 7 acceptance criteria', () => {
    it('timeline query returns user_message + assistant_message after success', () => {
      const sessionId = 'session-task7-success'

      const transcript: TurnTranscript = {
        turnId: 'turn-task7-success',
        sessionId,
        userId: 'user-task7',
        input: {
          inboundEventId: 'evt-task7-success',
          userMessageSummary: 'User query for task 7',
        },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-task7-assistant',
              role: 'assistant',
              content: 'Assistant response for task 7',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:00:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvents = result.events.filter((e) => e.eventType === 'user_message')
      const assistantEvents = result.events.filter((e) => e.eventType === 'assistant_message')

      expect(userEvents).toHaveLength(1)
      expect(assistantEvents).toHaveLength(1)
      expect(userEvents[0].content).toBe('User query for task 7')
      expect(assistantEvents[0].content).toBe('Assistant response for task 7')

      expect(userEvents[0].metadata?.turnId).toBe(assistantEvents[0].metadata?.turnId)
    })

    it('timeline query returns user_message + error after failure', () => {
      const sessionId = 'session-task7-error'

      const transcript: TurnTranscript = {
        turnId: 'turn-task7-error',
        sessionId,
        userId: 'user-task7',
        input: {
          inboundEventId: 'evt-task7-error',
          userMessageSummary: 'User query that fails',
        },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-task7-error',
              role: 'error',
              content: '[PROCESSING_ERROR] Processing failed for task 7',
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:01:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvents = result.events.filter((e) => e.eventType === 'user_message')
      const errorEvents = result.events.filter((e) => e.eventType === 'error')

      expect(userEvents).toHaveLength(1)
      expect(errorEvents).toHaveLength(1)
      expect(userEvents[0].content).toBe('User query that fails')
      expect(errorEvents[0].content).toBe('[PROCESSING_ERROR] Processing failed for task 7')

      expect(userEvents[0].metadata?.turnId).toBe(errorEvents[0].metadata?.turnId)
      expect(errorEvents[0].actor).toBe('system')
    })

    it('T6: thinking_summary CAN appear from role=thinking with public fixture; internal CoT strings NEVER appear', () => {
      const sessionId = 'session-task7-safety'
      const REASONING_FIXTURE = 'REASONING_FIXTURE_12345'
      const ANSWER_TEXT = 'Public safe response'
      const INTERNAL_COT = 'Internal chain-of-thought that must not leak'

      const transcript: TurnTranscript = {
        turnId: 'turn-task7-safety',
        sessionId,
        userId: 'user-task7',
        input: {
          userMessageSummary: 'Test safety',
        },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-thinking',
              role: 'thinking',
              content: REASONING_FIXTURE,
            },
            {
              messageId: 'msg-safe',
              role: 'assistant',
              content: ANSWER_TEXT,
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:02:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      // Opt-in: provider reasoning projected as role=thinking → one thinking_summary event.
      const thinkingEvents = result.events.filter((e) => e.eventType === 'thinking_summary')
      expect(thinkingEvents).toHaveLength(1)
      expect(thinkingEvents[0].content).toBe(REASONING_FIXTURE)

      const assistantEvents = result.events.filter((e) => e.eventType === 'assistant_message')
      expect(assistantEvents).toHaveLength(1)
      expect(assistantEvents[0].content).toBe(ANSWER_TEXT)

      // SAFETY: reasoning fixture must NEVER appear in assistant_message content.
      expect(assistantEvents[0].content).not.toContain(REASONING_FIXTURE)

      // SAFETY: internal CoT strings must NEVER appear in any timeline event.
      const hasInternalCoT = result.events.some((e) => (e.content ?? '').includes(INTERNAL_COT))
      expect(hasInternalCoT).toBe(false)
    })

    it('T6: default path without role=thinking has zero thinking_summary events', () => {
      const sessionId = 'session-task7-default'
      const ANSWER_TEXT = 'Public safe response with no reasoning'

      const transcript: TurnTranscript = {
        turnId: 'turn-task7-default',
        sessionId,
        userId: 'user-task7',
        input: {
          userMessageSummary: 'Test default',
        },
        output: {
          visibleMessages: [
            {
              messageId: 'msg-safe',
              role: 'assistant',
              content: ANSWER_TEXT,
            },
          ],
        },
        visibility: 'public',
        createdAt: '2024-01-15T10:03:00.000Z',
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      // Default path (no role=thinking message) → zero thinking_summary events.
      const thinkingEvents = result.events.filter((e) => e.eventType === 'thinking_summary')
      expect(thinkingEvents).toHaveLength(0)

      const assistantEvents = result.events.filter((e) => e.eventType === 'assistant_message')
      expect(assistantEvents).toHaveLength(1)
      expect(assistantEvents[0].content).toBe(ANSWER_TEXT)
    })
  })

  describe('timestamp mapping', () => {
    it('should use inboundTimestamp for user_message events when available', () => {
      const sessionId = 'session-ts-001'
      const inboundTime = '2024-01-15T09:59:00.000Z'
      const completionTime = '2024-01-15T10:00:05.000Z'

      const transcript: TurnTranscript = {
        turnId: 'turn-ts-001',
        sessionId,
        userId: 'user-ts',
        input: {
          userMessageSummary: 'Hello',
          inboundTimestamp: inboundTime,
        },
        output: {
          visibleMessages: [{ messageId: 'msg-ts-001', role: 'assistant', content: 'Hi there' }],
        },
        visibility: 'public',
        createdAt: completionTime,
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userEvent).toBeDefined()
      expect(userEvent?.timestamp).toBe(inboundTime)

      const assistantEvent = result.events.find((e) => e.eventType === 'assistant_message')
      expect(assistantEvent).toBeDefined()
      expect(assistantEvent?.timestamp).toBe(completionTime)
    })

    it('should fall back to createdAt for user_message when inboundTimestamp is absent', () => {
      const sessionId = 'session-ts-002'
      const createdAt = '2024-01-15T10:00:00.000Z'

      const transcript: TurnTranscript = {
        turnId: 'turn-ts-002',
        sessionId,
        userId: 'user-ts',
        input: {
          userMessageSummary: 'Hello',
        },
        output: {
          visibleMessages: [{ messageId: 'msg-ts-002', role: 'assistant', content: 'Hi there' }],
        },
        visibility: 'public',
        createdAt,
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userEvent).toBeDefined()
      expect(userEvent?.timestamp).toBe(createdAt)

      const assistantEvent = result.events.find((e) => e.eventType === 'assistant_message')
      expect(assistantEvent).toBeDefined()
      expect(assistantEvent?.timestamp).toBe(createdAt)
    })

    it('should use createdAt for error events regardless of inboundTimestamp', () => {
      const sessionId = 'session-ts-003'
      const inboundTime = '2024-01-15T09:59:00.000Z'
      const completionTime = '2024-01-15T10:00:10.000Z'

      const transcript: TurnTranscript = {
        turnId: 'turn-ts-003',
        sessionId,
        userId: 'user-ts',
        input: {
          userMessageSummary: 'Trigger error',
          inboundTimestamp: inboundTime,
        },
        output: {
          visibleMessages: [{ messageId: 'msg-ts-003', role: 'error', content: '[ERROR] Failed' }],
        },
        visibility: 'public',
        createdAt: completionTime,
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userEvent?.timestamp).toBe(inboundTime)

      const errorEvent = result.events.find((e) => e.eventType === 'error')
      expect(errorEvent?.timestamp).toBe(completionTime)
    })

    it('should use createdAt for system_status events regardless of inboundTimestamp', () => {
      const sessionId = 'session-ts-004'
      const inboundTime = '2024-01-15T09:59:00.000Z'
      const completionTime = '2024-01-15T10:00:08.000Z'

      const transcript: TurnTranscript = {
        turnId: 'turn-ts-004',
        sessionId,
        userId: 'user-ts',
        input: {
          userMessageSummary: 'Complex task',
          inboundTimestamp: inboundTime,
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-ts-004a', role: 'assistant', content: 'Working on it' },
            { messageId: 'msg-ts-004b', role: 'system_status', content: 'dispatch_tool: Running search' },
          ],
        },
        visibility: 'public',
        createdAt: completionTime,
      }

      mockTranscriptStore.saveTurn(transcript)

      const timelineService = createConsoleTimelineService(stores)
      const result = timelineService.getTimeline(sessionId)

      const userEvent = result.events.find((e) => e.eventType === 'user_message')
      expect(userEvent?.timestamp).toBe(inboundTime)

      const statusEvent = result.events.find((e) => e.eventType === 'system_status')
      expect(statusEvent?.timestamp).toBe(completionTime)
    })
  })
})



describe('Plan C interleaved tool order', () => {
  it('emits tool_call before tool_result before later assistant text', () => {
    const savedTranscripts: TurnTranscript[] = []
    const mockTranscriptStore = {
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

    const mockEventStore = {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore

    const stores: ConsoleTimelineStores = {
      transcriptStore: mockTranscriptStore,
      eventStore: mockEventStore,
    }

    const sessionId = 'session-plan-c-001'
    const turnId = 'turn-plan-c-001'
    const transcript: TurnTranscript = {
      turnId,
      sessionId,
      userId: 'user-1',
      input: { userMessageSummary: 'check weather', inboundTimestamp: '2026-07-16T09:59:00.000Z' },
      output: {
        visibleMessages: [
          {
            messageId: 'm0',
            role: 'assistant',
            content: 'I will check.',
            turnSequence: 0,
            timestamp: '2026-07-16T10:00:00.000Z',
          },
          {
            messageId: 'm1',
            role: 'tool',
            content: 'Tool completed: search',
            turnSequence: 1,
            toolCallId: 'tc-1',
            toolName: 'search',
            toolStatus: 'completed',
            timestamp: '2026-07-16T10:00:01.000Z',
          },
          {
            messageId: 'm2',
            role: 'assistant',
            content: 'Final answer.',
            turnSequence: 2,
            timestamp: '2026-07-16T10:00:02.000Z',
          },
        ],
      },
      runtimeSummary: {
        toolCallSummaries: [
          {
            toolCallId: 'tc-1',
            toolName: 'search',
            status: 'completed',
            startedAt: '2026-07-16T10:00:00.500Z',
            turnSequence: 0,
          },
        ],
      },
      visibility: 'public',
      createdAt: '2026-07-16T10:00:02.000Z',
    }

    mockTranscriptStore.saveTurn(transcript)
    const service = createConsoleTimelineService(stores)
    const result = service.getTimeline(sessionId)
    const types = result.events.map((e) => e.eventType)
    expect(types).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
    const toolCall = result.events.find((e) => e.eventType === 'tool_call')
    const toolResult = result.events.find((e) => e.eventType === 'tool_result')
    expect(toolCall?.metadata?.toolCallId).toBe('tc-1')
    expect(toolResult?.metadata?.toolCallId).toBe('tc-1')
    expect(toolCall?.eventId).toContain('tc-1')
    expect(toolResult?.eventId).toContain('tc-1')
  })
})

describe('Plan C legacy tool-before-final-answer', () => {
  it('places tool_call/tool_result before final assistant when only summaries exist', () => {
    const savedTranscripts: TurnTranscript[] = []
    const mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript)
        return true
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn((sessionId: string) => savedTranscripts.filter((x) => x.sessionId === sessionId)),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore
    const mockEventStore = {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore
    const stores: ConsoleTimelineStores = {
      transcriptStore: mockTranscriptStore,
      eventStore: mockEventStore,
    }

    const sessionId = 'session-legacy-001'
    mockTranscriptStore.saveTurn({
      turnId: 'turn-legacy-1',
      sessionId,
      userId: 'u1',
      input: {
        userMessageSummary: '今天北京天气怎么样？',
        inboundTimestamp: '2026-07-16T05:57:34.000Z',
      },
      output: {
        visibleMessages: [
          {
            messageId: 'msg-final',
            role: 'assistant',
            content: '根据搜索结果，北京今天…',
          },
        ],
      },
      runtimeSummary: {
        toolCallSummaries: [
          {
            toolCallId: 'call_00_uXf1KD3x087vCm39YWZn9190',
            toolName: 'search_subagent',
            status: 'completed',
          },
        ],
      },
      visibility: 'public',
      createdAt: '2026-07-16T05:57:49.000Z',
    })

    const result = createConsoleTimelineService(stores).getTimeline(sessionId)
    const types = result.events.map((e) => e.eventType)
    expect(types).toEqual(['user_message', 'tool_call', 'tool_result', 'assistant_message'])
  })
})

describe('Plan C multi-tool legacy summary-only order', () => {
  it('places ALL tool pairs before final assistant when timestamps are identical', () => {
    const savedTranscripts: TurnTranscript[] = []
    const mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript)
        return true
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn((sessionId: string) => savedTranscripts.filter((x) => x.sessionId === sessionId)),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore
    const mockEventStore = {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore
    const stores: ConsoleTimelineStores = {
      transcriptStore: mockTranscriptStore,
      eventStore: mockEventStore,
    }

    const sessionId = 'session-legacy-multi-001'
    const sameTs = '2026-07-16T12:00:00.000Z'
    mockTranscriptStore.saveTurn({
      turnId: 'turn-legacy-multi',
      sessionId,
      userId: 'u1',
      input: {
        userMessageSummary: 'do two tools',
        inboundTimestamp: sameTs,
      },
      output: {
        visibleMessages: [
          {
            messageId: 'msg-final',
            role: 'assistant',
            content: 'Final answer after two tools.',
            // Legacy persisted message that DOES carry turnSequence: 0.
            // Even so, legacy path must place assistant after all tool pairs.
            turnSequence: 0,
            timestamp: '2026-07-16T12:00:00.000Z',
          },
        ],
      },
      runtimeSummary: {
        toolCallSummaries: [
          { toolCallId: 'tc-a', toolName: 'search', status: 'completed' },
          { toolCallId: 'tc-b', toolName: 'read', status: 'completed' },
        ],
      },
      visibility: 'public',
      createdAt: sameTs,
    })

    const result = createConsoleTimelineService(stores).getTimeline(sessionId)
    const types = result.events.map((e) => e.eventType)
    expect(types).toEqual([
      'user_message',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
    expect(result.events.filter((e) => e.eventType === 'tool_call')[0].metadata?.toolCallId).toBe('tc-a')
    expect(result.events.filter((e) => e.eventType === 'tool_call')[1].metadata?.toolCallId).toBe('tc-b')
  })
})
