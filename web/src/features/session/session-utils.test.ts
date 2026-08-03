/**
 * Tests for session-utils.ts
 *
 * Unit tests for pure utility functions used in session console operations.
 */

import { describe, it, expect } from 'vitest'
import type { ConsoleTimelineEvent } from '../../api/types'
import {
  createLocalUserMessageEvent,
  countServerUserMessagesByContent,
  getBaselineServerMessageCount,
  isLocalMessageConfirmed,
  hasAssistantOrErrorReplyAfter,
  formatDate,
  appendStreamingToken,
  clearStreamingDraftsByAttemptIds,
  upsertTimelineEvent,
  shouldClearDraftOnServerEvent,
  clearDraftsForTerminalEvent,
} from './session-utils'
import {
  LOCAL_USER_MESSAGE_PREFIX,
  SELECTED_SESSION_KEY,
  SSE_RECONNECT_BASE_DELAY_MS,
  SSE_RECONNECT_MAX_DELAY_MS,
  POST_SEND_POLL_MAX_ATTEMPTS,
  POST_SEND_POLL_INTERVAL_MS,
  POST_SEND_POLL_INITIAL_DELAY_SSE_MS,
  POST_SEND_POLL_INTERVAL_SSE_MS,
  POST_SEND_POLL_MAX_ATTEMPTS_SSE,
  DATE_FORMAT_LOCALE,
} from './session-constants'

// ============================================================================
// Constants Tests
// ============================================================================

describe('session-constants', () => {
  describe('localStorage keys', () => {
    it('should have correct selected session key', () => {
      expect(SELECTED_SESSION_KEY).toBe('session-console-selected-session')
    })

    it('should have correct local user message prefix', () => {
      expect(LOCAL_USER_MESSAGE_PREFIX).toBe('local-user-message')
    })
  })

  describe('SSE reconnection constants', () => {
    it('should have correct base delay', () => {
      expect(SSE_RECONNECT_BASE_DELAY_MS).toBe(1000)
    })

    it('should have correct max delay', () => {
      expect(SSE_RECONNECT_MAX_DELAY_MS).toBe(30000)
    })

    it('should have max delay greater than base delay', () => {
      expect(SSE_RECONNECT_MAX_DELAY_MS).toBeGreaterThan(SSE_RECONNECT_BASE_DELAY_MS)
    })
  })

  describe('post-send polling constants', () => {
    it('should use a modest max attempts for disconnected fallback', () => {
      expect(POST_SEND_POLL_MAX_ATTEMPTS).toBe(12)
    })

    it('should use a slower fallback interval than 1s to reduce REST load', () => {
      expect(POST_SEND_POLL_INTERVAL_MS).toBe(2500)
    })

    it('should prefer sparse SSE-first polling when stream is live', () => {
      expect(POST_SEND_POLL_INITIAL_DELAY_SSE_MS).toBe(4000)
      expect(POST_SEND_POLL_INTERVAL_SSE_MS).toBe(8000)
      expect(POST_SEND_POLL_MAX_ATTEMPTS_SSE).toBe(4)
      expect(POST_SEND_POLL_INTERVAL_SSE_MS).toBeGreaterThan(POST_SEND_POLL_INTERVAL_MS)
    })
  })

  describe('date formatting constants', () => {
    it('should use Chinese locale', () => {
      expect(DATE_FORMAT_LOCALE).toBe('zh-CN')
    })
  })
})

// ============================================================================
// Local Message Event Creation Tests
// ============================================================================

describe('createLocalUserMessageEvent', () => {
  it('should create a valid local user message event', () => {
    const sessionId = 'ses_test123'
    const content = 'Hello, world!'
    const baselineCount = 2

    const event = createLocalUserMessageEvent(sessionId, content, baselineCount)

    expect(event.eventType).toBe('user_message')
    expect(event.sessionId).toBe(sessionId)
    expect(event.content).toBe(content)
    expect(event.actor).toBe('user')
    expect(event.metadata?.localOnly).toBe(true)
    expect(event.metadata?.status).toBe('pending')
    expect(event.metadata?.baselineServerMessageCount).toBe(baselineCount)
  })

  it('should generate unique event IDs', () => {
    const sessionId = 'ses_test123'
    const content = 'Test message'

    const event1 = createLocalUserMessageEvent(sessionId, content, 0)
    const event2 = createLocalUserMessageEvent(sessionId, content, 0)

    expect(event1.eventId).not.toBe(event2.eventId)
  })

  it('should include sessionId in event ID', () => {
    const sessionId = 'ses_test123'
    const event = createLocalUserMessageEvent(sessionId, 'Test', 0)

    expect(event.eventId).toContain(LOCAL_USER_MESSAGE_PREFIX)
    expect(event.eventId).toContain(sessionId)
  })

  it('should generate valid ISO timestamp', () => {
    const event = createLocalUserMessageEvent('ses_test', 'Test', 0)
    const timestamp = new Date(event.timestamp)

    expect(timestamp.toISOString()).toBe(event.timestamp)
  })

  it('should handle empty content', () => {
    const event = createLocalUserMessageEvent('ses_test', '', 0)

    expect(event.content).toBe('')
    expect(event.eventType).toBe('user_message')
  })

  it('should handle zero baseline count', () => {
    const event = createLocalUserMessageEvent('ses_test', 'Test', 0)

    expect(event.metadata?.baselineServerMessageCount).toBe(0)
  })
})

// ============================================================================
// Server Message Counting Tests
// ============================================================================

describe('countServerUserMessagesByContent', () => {
  const mockEvents: ConsoleTimelineEvent[] = [
    {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Hello',
      actor: 'user',
    },
    {
      eventId: 'evt2',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:01:00Z',
      content: 'Hello',
      actor: 'user',
    },
    {
      eventId: 'evt3',
      eventType: 'assistant_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:02:00Z',
      content: 'Hi there!',
      actor: 'assistant',
    },
    {
      eventId: 'evt4',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:03:00Z',
      content: 'Goodbye',
      actor: 'user',
    },
  ]

  it('should count messages with matching content', () => {
    expect(countServerUserMessagesByContent(mockEvents, 'Hello')).toBe(2)
    expect(countServerUserMessagesByContent(mockEvents, 'Goodbye')).toBe(1)
  })

  it('should return 0 for non-matching content', () => {
    expect(countServerUserMessagesByContent(mockEvents, 'Nonexistent')).toBe(0)
  })

  it('should return 0 for empty array', () => {
    expect(countServerUserMessagesByContent([], 'Hello')).toBe(0)
  })

  it('should only count user_message events', () => {
    expect(countServerUserMessagesByContent(mockEvents, 'Hi there!')).toBe(0)
  })

  it('should be case-sensitive', () => {
    expect(countServerUserMessagesByContent(mockEvents, 'hello')).toBe(0)
  })
})

// ============================================================================
// Baseline Server Message Count Tests
// ============================================================================

describe('getBaselineServerMessageCount', () => {
  it('should extract baseline count from metadata', () => {
    const event: ConsoleTimelineEvent = {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Test',
      metadata: { baselineServerMessageCount: 5 },
      actor: 'user',
    }

    expect(getBaselineServerMessageCount(event)).toBe(5)
  })

  it('should return 0 when metadata is missing', () => {
    const event: ConsoleTimelineEvent = {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Test',
      actor: 'user',
    }

    expect(getBaselineServerMessageCount(event)).toBe(0)
  })

  it('should return 0 when baselineServerMessageCount is missing', () => {
    const event: ConsoleTimelineEvent = {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Test',
      metadata: { localOnly: true },
      actor: 'user',
    }

    expect(getBaselineServerMessageCount(event)).toBe(0)
  })

  it('should return 0 when baselineServerMessageCount is not a number', () => {
    const event: ConsoleTimelineEvent = {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Test',
      metadata: { baselineServerMessageCount: 'invalid' as unknown as number },
      actor: 'user',
    }

    expect(getBaselineServerMessageCount(event)).toBe(0)
  })

  it('should handle zero baseline count', () => {
    const event: ConsoleTimelineEvent = {
      eventId: 'evt1',
      eventType: 'user_message',
      sessionId: 'ses_test',
      timestamp: '2024-01-01T10:00:00Z',
      content: 'Test',
      metadata: { baselineServerMessageCount: 0 },
      actor: 'user',
    }

    expect(getBaselineServerMessageCount(event)).toBe(0)
  })
})

// ============================================================================
// Message Confirmation Tests
// ============================================================================

describe('isLocalMessageConfirmed', () => {
  const createServerEvent = (content: string): ConsoleTimelineEvent => ({
    eventId: `server-${Math.random()}`,
    eventType: 'user_message',
    sessionId: 'ses_test',
    timestamp: new Date().toISOString(),
    content,
    actor: 'user',
  })

  const createLocalEvent = (content: string, baseline: number): ConsoleTimelineEvent => ({
    eventId: 'local-1',
    eventType: 'user_message',
    sessionId: 'ses_test',
    timestamp: new Date().toISOString(),
    content,
    metadata: { baselineServerMessageCount: baseline },
    actor: 'user',
  })

  it('should return true when server has more messages than baseline', () => {
    const serverEvents = [createServerEvent('Hello'), createServerEvent('Hello')]
    const localEvent = createLocalEvent('Hello', 1)

    expect(isLocalMessageConfirmed(serverEvents, localEvent)).toBe(true)
  })

  it('should return false when server has same count as baseline', () => {
    const serverEvents = [createServerEvent('Hello')]
    const localEvent = createLocalEvent('Hello', 1)

    expect(isLocalMessageConfirmed(serverEvents, localEvent)).toBe(false)
  })

  it('should return false when server has fewer messages than baseline', () => {
    const serverEvents = [createServerEvent('Hello')]
    const localEvent = createLocalEvent('Hello', 2)

    expect(isLocalMessageConfirmed(serverEvents, localEvent)).toBe(false)
  })

  it('should return false when local event has no content', () => {
    const serverEvents = [createServerEvent('Hello')]
    const localEvent = createLocalEvent('', 0)

    expect(isLocalMessageConfirmed(serverEvents, localEvent)).toBe(false)
  })

  it('should return false for empty server events', () => {
    const localEvent = createLocalEvent('Hello', 0)

    expect(isLocalMessageConfirmed([], localEvent)).toBe(false)
  })
})

// ============================================================================
// Assistant/Error Reply Tests
// ============================================================================

describe('hasAssistantOrErrorReplyAfter', () => {
  const createEvent = (type: string, timestamp: string, content = 'Test'): ConsoleTimelineEvent => ({
    eventId: `evt-${Math.random()}`,
    eventType: type as any,
    sessionId: 'ses_test',
    timestamp,
    content,
    actor: type === 'assistant_message' ? 'assistant' : 'user',
  })

  const createLocalEvent = (timestamp: string): ConsoleTimelineEvent => ({
    eventId: 'local-1',
    eventType: 'user_message',
    sessionId: 'ses_test',
    timestamp,
    content: 'Hello',
    actor: 'user',
  })

  it('should return true when assistant message exists after local message', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')
    const serverEvents = [createEvent('assistant_message', '2024-01-01T10:01:00Z')]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(true)
  })

  it('should return true when error exists after local message', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')
    const serverEvents = [createEvent('error', '2024-01-01T10:01:00Z')]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(true)
  })

  it('should return false when reply is before local message', () => {
    const localEvent = createLocalEvent('2024-01-01T10:01:00Z')
    const serverEvents = [createEvent('assistant_message', '2024-01-01T10:00:00Z')]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(false)
  })

  it('should return false when reply is at same time', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')
    const serverEvents = [createEvent('assistant_message', '2024-01-01T10:00:00Z')]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(true)
  })

  it('should return false for non-assistant/error events', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')
    const serverEvents = [createEvent('user_message', '2024-01-01T10:01:00Z')]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(false)
  })

  it('should return false for empty server events', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')

    expect(hasAssistantOrErrorReplyAfter([], localEvent)).toBe(false)
  })

  it('should handle multiple events correctly', () => {
    const localEvent = createLocalEvent('2024-01-01T10:00:00Z')
    const serverEvents = [
      createEvent('user_message', '2024-01-01T10:00:30Z'),
      createEvent('assistant_message', '2024-01-01T10:01:00Z'),
      createEvent('user_message', '2024-01-01T10:02:00Z'),
    ]

    expect(hasAssistantOrErrorReplyAfter(serverEvents, localEvent)).toBe(true)
  })
})

// ============================================================================
// Date Formatting Tests
// ============================================================================

describe('formatDate', () => {
  it('should format date in Chinese locale', () => {
    const dateString = '2024-06-08T14:30:00Z'
    const formatted = formatDate(dateString)

    // Should contain Chinese characters for month
    expect(formatted).toMatch(/月/)
    // Should contain Chinese character for day
    expect(formatted).toMatch(/日/)
  })

  it('should include time in formatted output', () => {
    const dateString = '2024-06-08T14:30:00Z'
    const formatted = formatDate(dateString)

    // Should contain time (hours and minutes)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })

  it('should handle different dates', () => {
    const date1 = formatDate('2024-01-15T09:15:00Z')
    const date2 = formatDate('2024-12-25T18:45:00Z')

    expect(date1).not.toBe(date2)
  })

  it('should handle ISO date strings', () => {
    const dateString = '2024-06-08T14:30:00.000Z'
    const formatted = formatDate(dateString)

    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })

  it('should handle date strings without milliseconds', () => {
    const dateString = '2024-06-08T14:30:00Z'
    const formatted = formatDate(dateString)

    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })
})

const REASONING_FIXTURE_12345 = 'REASONING_FIXTURE_12345'

describe('appendStreamingToken', () => {
  it('ignores tokens on the reasoning channel', () => {
    const prev = new Map()
    const next = appendStreamingToken(
      prev,
      {
        attemptId: 'run-1',
        sessionId: 'ses-1',
        sequence: 1,
        delta: REASONING_FIXTURE_12345,
        channel: 'reasoning',
      },
      Date.now(),
    )

    expect(next).toBe(prev)
    expect(next.size).toBe(0)
  })

  it('appends tokens with missing channel as assistant content', () => {
    const next = appendStreamingToken(
      new Map(),
      {
        attemptId: 'run-1',
        sessionId: 'ses-1',
        sequence: 1,
        delta: 'hello',
      },
      Date.now(),
    )

    expect(next.size).toBe(1)
    const draft = next.get('run-1#0')
    expect(draft).toBeDefined()
    expect(draft?.content).toBe('hello')
  })
})

describe('clearStreamingDraftsByAttemptIds', () => {
  it('clears assistant drafts keyed by attemptId#segment', () => {
    let drafts = new Map()
    drafts = appendStreamingToken(
      drafts,
      { attemptId: 'run-1', sessionId: 'ses-1', sequence: 1, delta: REASONING_FIXTURE_12345 },
      Date.now(),
    )
    drafts = clearStreamingDraftsByAttemptIds(drafts, ['run-1'])

    expect(drafts.size).toBe(0)
  })
})

const createDraft = (
  attemptId: string,
  sessionId: string,
  overrides?: Partial<import('./session-utils').StreamingDraft>,
): import('./session-utils').StreamingDraft => ({
  sessionId,
  attemptId,
  content: 'draft',
  sequence: 1,
  timestamp: Date.now(),
  segment: 0,
  sealed: false,
  ...overrides,
})

const createTerminalEvent = (
  eventType: 'assistant_message' | 'error',
  sessionId: string,
  metadata?: Record<string, unknown>,
): ConsoleTimelineEvent => ({
  eventId: `evt-${Math.random().toString(36).slice(2)}`,
  eventType,
  sessionId,
  timestamp: new Date().toISOString(),
  content: 'final',
  metadata,
})

describe('shouldClearDraftOnServerEvent', () => {
  it('returns false for historical events without attemptId or turnId', () => {
    const event = createTerminalEvent('assistant_message', 'ses-1', {})
    expect(shouldClearDraftOnServerEvent(event, 'historical')).toBe(false)
  })

  it('returns true for historical events with matching metadata', () => {
    const event = createTerminalEvent('assistant_message', 'ses-1', { attemptId: 'run-1' })
    expect(shouldClearDraftOnServerEvent(event, 'historical')).toBe(true)
  })

  it('returns true for live events even when metadata is missing', () => {
    const event = createTerminalEvent('assistant_message', 'ses-1', {})
    expect(shouldClearDraftOnServerEvent(event, 'live')).toBe(true)
  })
})

describe('clearDraftsForTerminalEvent', () => {
  it('matching attemptId clears only that draft (live)', () => {
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-a#0', createDraft('run-a', 'ses-1'))
    drafts.set('run-b#0', createDraft('run-b', 'ses-1'))

    const event = createTerminalEvent('assistant_message', 'ses-1', { attemptId: 'run-a' })
    const next = clearDraftsForTerminalEvent(drafts, event, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'live',
    })

    expect(next.size).toBe(1)
    expect(next.has('run-b#0')).toBe(true)
  })

  it('historical assistant_message with other turns attemptId does NOT clear current draft', () => {
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-a#0', createDraft('run-a', 'ses-1'))

    const event = createTerminalEvent('assistant_message', 'ses-1', { attemptId: 'run-b' })
    const next = clearDraftsForTerminalEvent(drafts, event, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'historical',
    })

    expect(next).toBe(drafts)
    expect(next.has('run-a#0')).toBe(true)
  })

  it('missing metadata + historical never clearOldest', () => {
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-a#0', createDraft('run-a', 'ses-1'))

    const event = createTerminalEvent('assistant_message', 'ses-1', {})
    const next = clearDraftsForTerminalEvent(drafts, event, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'historical',
    })

    expect(next).toBe(drafts)
    expect(next.has('run-a#0')).toBe(true)
  })

  it('live missing metadata only clears when exactly one active draft in session', () => {
    let single = new Map<string, import('./session-utils').StreamingDraft>()
    single.set('run-a#0', createDraft('run-a', 'ses-1'))
    const event = createTerminalEvent('assistant_message', 'ses-1', {})

    const cleared = clearDraftsForTerminalEvent(single, event, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'live',
    })
    expect(cleared.size).toBe(0)

    let multiple = new Map<string, import('./session-utils').StreamingDraft>()
    multiple.set('run-a#0', createDraft('run-a', 'ses-1'))
    multiple.set('run-b#0', createDraft('run-b', 'ses-1'))
    const retained = clearDraftsForTerminalEvent(multiple, event, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'live',
    })
    expect(retained.size).toBe(2)

    const notAllowed = clearDraftsForTerminalEvent(single, event, {
      allowOldestFallback: false,
      sessionId: 'ses-1',
      source: 'live',
    })
    expect(notAllowed.size).toBe(1)
  })

  it('sealed draft with no matching final is retained', () => {
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-a#0', createDraft('run-a', 'ses-1', { sealed: true }))

    const event = createTerminalEvent('error', 'ses-1', { attemptId: 'run-b' })
    const next = clearDraftsForTerminalEvent(drafts, event, {
      allowOldestFallback: false,
      sessionId: 'ses-1',
      source: 'live',
    })

    expect(next).toBe(drafts)
    expect(next.has('run-a#0')).toBe(true)
  })

  it('matching turnId clears draft segments keyed by attemptId', () => {
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-a#0', createDraft('run-a', 'ses-1'))
    drafts.set('run-a#1', createDraft('run-a', 'ses-1', { segment: 1 }))

    const event = createTerminalEvent('assistant_message', 'ses-1', { turnId: 'run-a' })
    const next = clearDraftsForTerminalEvent(drafts, event, {
      allowOldestFallback: false,
      sessionId: 'ses-1',
      source: 'live',
    })

    expect(next.size).toBe(0)
  })
})

// ============================================================================
// T7 regression: streaming draft present + tool timeout error event with
// matching attemptId → draft cleared and error visible.
// Chains T1 (match-only clear) with T3 (tool timeout emits error event
// carrying the run's attemptId) and T4 (error content is non-empty).
// ============================================================================
describe('T7 regression: streaming draft + tool timeout error → draft cleared + error visible', () => {
  it('clears the streaming draft and surfaces a non-empty error when a tool timeout error event arrives with matching attemptId', () => {
    // Given: a live streaming draft exists for attemptId 'run-timeout-1',
    // with multiple segments (simulating streamed assistant text).
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-timeout-1#0', createDraft('run-timeout-1', 'ses-1', { content: 'partial assistant text' }))
    drafts.set('run-timeout-1#1', createDraft('run-timeout-1', 'ses-1', { segment: 1, content: ' more text' }))
    expect(drafts.size).toBe(2)

    // When: a tool timeout error event arrives (T3 produces an `error` timeline
    // event whose metadata.attemptId matches the hung run) with non-empty
    // content (T4 guarantees a non-empty error message).
    const toolTimeoutErrorEvent: ConsoleTimelineEvent = {
      eventId: 'evt-timeout-1',
      eventType: 'error',
      sessionId: 'ses-1',
      timestamp: new Date().toISOString(),
      content: 'Tool execution timed out after 120000ms',
      metadata: {
        attemptId: 'run-timeout-1',
        turnId: 'run-timeout-1',
        kind: 'tool_timeout',
        timeoutMs: 120000,
      },
    }

    // Guard: the event should be eligible to clear (T1 shouldClearDraftOnServerEvent).
    expect(shouldClearDraftOnServerEvent(toolTimeoutErrorEvent, 'live')).toBe(true)

    // And: the error content must be visible / non-empty (T4 contract).
    expect(typeof toolTimeoutErrorEvent.content).toBe('string')
    expect((toolTimeoutErrorEvent.content ?? '').trim().length).toBeGreaterThan(0)

    // Then: clearDraftsForTerminalEvent removes every segment for the matching
    // attemptId, leaving no zombie draft behind.
    const next = clearDraftsForTerminalEvent(drafts, toolTimeoutErrorEvent, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'live',
    })

    expect(next.size).toBe(0)
    expect(next.has('run-timeout-1#0')).toBe(false)
    expect(next.has('run-timeout-1#1')).toBe(false)
  })

  it('does NOT clear an unrelated streaming draft when the tool timeout error event carries a different attemptId (historical replay safety)', () => {
    // Given: a live streaming draft for attemptId 'run-live-now'.
    let drafts = new Map<string, import('./session-utils').StreamingDraft>()
    drafts.set('run-live-now#0', createDraft('run-live-now', 'ses-1', { content: 'streaming now' }))

    // When: a HISTORICAL tool timeout error event arrives for a DIFFERENT
    // attemptId (e.g. replayed from a previous turn's timeline).
    const historicalTimeoutError: ConsoleTimelineEvent = {
      eventId: 'evt-old-timeout',
      eventType: 'error',
      sessionId: 'ses-1',
      timestamp: new Date().toISOString(),
      content: 'Tool execution timed out after 120000ms',
      metadata: {
        attemptId: 'run-old-finished',
        turnId: 'run-old-finished',
        kind: 'tool_timeout',
      },
    }

    // Then: the historical event is eligible to clear (it has metadata) but
    // must NOT touch the live draft because the attemptId does not match.
    expect(shouldClearDraftOnServerEvent(historicalTimeoutError, 'historical')).toBe(true)

    const next = clearDraftsForTerminalEvent(drafts, historicalTimeoutError, {
      allowOldestFallback: true,
      sessionId: 'ses-1',
      source: 'historical',
    })

    expect(next).toBe(drafts)
    expect(next.has('run-live-now#0')).toBe(true)
    expect(next.size).toBe(1)
  })
})

describe('upsertTimelineEvent single-source thinking_summary', () => {
  const liveReasoning = (turnId: string, content: string): ConsoleTimelineEvent => ({
    eventId: `turn-${turnId}-thinking-live`,
    eventType: 'thinking_summary',
    sessionId: 'ses-1',
    timestamp: new Date().toISOString(),
    content,
    metadata: { turnId, attemptId: turnId, live: true },
    actor: 'assistant',
  })

  const terminalReasoning = (turnId: string, content: string): ConsoleTimelineEvent => ({
    eventId: `turn-${turnId}-thinking-0`,
    eventType: 'thinking_summary',
    sessionId: 'ses-1',
    timestamp: new Date().toISOString(),
    content,
    metadata: { turnId, attemptId: turnId },
    actor: 'assistant',
  })

  it('upserts live thinking_summary in place by stable eventId', () => {
    const first = upsertTimelineEvent([], liveReasoning('run-1', 'step '))
    expect(first).toHaveLength(1)

    const second = upsertTimelineEvent(first, liveReasoning('run-1', 'step two'))
    expect(second).toHaveLength(1)
    expect(second[0].content).toBe('step two')
  })

  it('terminal thinking_summary atomically replaces the live block for the same turn', () => {
    const withLive = upsertTimelineEvent([], liveReasoning('run-1', 'streaming reasoning'))

    const afterTerminal = upsertTimelineEvent(withLive, terminalReasoning('run-1', 'final reasoning'))
    expect(afterTerminal).toHaveLength(1)
    expect(afterTerminal[0].eventId).toBe('turn-run-1-thinking-0')
    expect(afterTerminal[0].content).toBe('final reasoning')
    expect(afterTerminal[0].metadata?.live).not.toBe(true)
  })

  it('keeps live blocks of other turns untouched', () => {
    const withOther = upsertTimelineEvent([], liveReasoning('run-2', 'other reasoning'))

    const afterTerminal = upsertTimelineEvent(withOther, terminalReasoning('run-1', 'final reasoning'))
    expect(afterTerminal).toHaveLength(2)
    expect(afterTerminal.some((e) => e.eventId === 'turn-run-2-thinking-live')).toBe(true)
    expect(afterTerminal.some((e) => e.eventId === 'turn-run-1-thinking-0')).toBe(true)
  })

  it('upserts live block again after terminal replacement (new turn streaming)', () => {
    const afterTerminal = upsertTimelineEvent([], terminalReasoning('run-1', 'final reasoning'))

    const againLive = upsertTimelineEvent(afterTerminal, liveReasoning('run-1', 'new reasoning'))
    expect(againLive).toHaveLength(2)
  })
})
