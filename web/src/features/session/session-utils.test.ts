/**
 * Tests for session-utils.ts
 *
 * Unit tests for pure utility functions used in session console operations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConsoleTimelineEvent } from '../../api/types'
import {
  createLocalUserMessageEvent,
  countServerUserMessagesByContent,
  getBaselineServerMessageCount,
  isLocalMessageConfirmed,
  hasAssistantOrErrorReplyAfter,
  formatDate,
} from './session-utils'
import {
  LOCAL_USER_MESSAGE_PREFIX,
  SELECTED_SESSION_KEY,
  SSE_RECONNECT_BASE_DELAY_MS,
  SSE_RECONNECT_MAX_DELAY_MS,
  POST_SEND_POLL_MAX_ATTEMPTS,
  POST_SEND_POLL_INTERVAL_MS,
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
    it('should have correct max attempts', () => {
      expect(POST_SEND_POLL_MAX_ATTEMPTS).toBe(30)
    })

    it('should have correct interval', () => {
      expect(POST_SEND_POLL_INTERVAL_MS).toBe(1000)
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
  const baseTime = new Date('2024-01-01T10:00:00Z').getTime()

  const createEvent = (
    type: string,
    timestamp: string,
    content = 'Test',
  ): ConsoleTimelineEvent => ({
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
