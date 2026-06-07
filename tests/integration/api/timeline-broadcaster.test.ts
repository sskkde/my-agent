import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createTimelineBroadcaster,
  TimelineBroadcaster,
  type CreateBroadcasterOptions,
  type WriteFn,
} from '../../../src/api/timeline-broadcaster.js'
import type { ConsoleTimelineEvent, ConsoleTimelineEventType } from '../../../src/api/types.js'
import type { ConsoleTimelineService, TimelineResult } from '../../../src/api/console-timeline.js'

function createMockTimelineService(events: ConsoleTimelineEvent[] = []): ConsoleTimelineService {
  return {
    getTimeline: vi.fn(
      (): TimelineResult => ({
        events,
        total: events.length,
      }),
    ),
  }
}

function createTestEvent(
  eventId: string,
  eventType: ConsoleTimelineEventType = 'user_message',
  sessionId: string = 'sess-001',
): ConsoleTimelineEvent {
  return {
    eventId,
    eventType,
    sessionId,
    timestamp: new Date().toISOString(),
    content: `Test content for ${eventId}`,
    actor: 'user',
  }
}

function createCaptureWrite(): { writes: string[]; writeFn: WriteFn } {
  const writes: string[] = []
  const writeFn: WriteFn = (data: string) => {
    writes.push(data)
    return true
  }
  return { writes, writeFn }
}

describe('TimelineBroadcaster', () => {
  let broadcaster: TimelineBroadcaster
  let mockTimelineService: ConsoleTimelineService

  beforeEach(() => {
    mockTimelineService = createMockTimelineService()
    const options: CreateBroadcasterOptions = {
      timelineService: mockTimelineService,
    }
    broadcaster = createTimelineBroadcaster(options)
  })

  describe('subscribe', () => {
    it('should create a connection for a session', () => {
      const connection = broadcaster.subscribe('sess-001')

      expect(connection).toBeDefined()
      expect(connection.sessionId).toBe('sess-001')
      expect(connection.connectionId).toBeDefined()
      expect(connection.isActive()).toBe(true)
    })

    it('should create multiple connections for the same session', () => {
      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-001')

      expect(conn1.connectionId).not.toBe(conn2.connectionId)
      expect(broadcaster.getConnectionCount('sess-001')).toBe(2)
    })

    it('should create connections for different sessions', () => {
      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-002')

      expect(conn1.sessionId).toBe('sess-001')
      expect(conn2.sessionId).toBe('sess-002')
    })

    it('should not call timeline service when no afterEventId provided', () => {
      broadcaster.subscribe('sess-001')

      expect(mockTimelineService.getTimeline).not.toHaveBeenCalled()
    })

    it('should fetch timeline when afterEventId is provided', () => {
      const events: ConsoleTimelineEvent[] = [createTestEvent('evt-001'), createTestEvent('evt-002')]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      broadcaster.subscribe('sess-001', { afterEventId: 'evt-000' })

      expect(mockTimelineService.getTimeline).toHaveBeenCalledWith('sess-001')
    })

    it('should use lastEventId over afterEventId when both provided', () => {
      const events: ConsoleTimelineEvent[] = [
        createTestEvent('evt-001'),
        createTestEvent('evt-002'),
        createTestEvent('evt-003'),
      ]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { afterEventId: 'evt-000', lastEventId: 'evt-001', write: writeFn })

      expect(mockTimelineService.getTimeline).toHaveBeenCalledWith('sess-001')
      expect(writes.length).toBe(2)
      expect(writes[0]).toContain('evt-002')
      expect(writes[1]).toContain('evt-003')
    })
  })

  describe('broadcast', () => {
    it('should broadcast event to single connection with correct SSE format', () => {
      const { writes, writeFn } = createCaptureWrite()
      const connection = broadcaster.subscribe('sess-001')
      broadcaster.bindConnection(connection.connectionId, writeFn, () => {})

      const event = createTestEvent('evt-001')
      broadcaster.broadcast('sess-001', event)

      expect(writes.length).toBe(1)
      expect(writes[0]).toContain('id: evt-001')
      expect(writes[0]).toContain('event: timeline_event')
      expect(writes[0]).toContain('"eventId":"evt-001"')
    })

    it('should broadcast event to multiple connections in same session', () => {
      const { writes: writes1, writeFn: writeFn1 } = createCaptureWrite()
      const { writes: writes2, writeFn: writeFn2 } = createCaptureWrite()

      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-001')
      broadcaster.bindConnection(conn1.connectionId, writeFn1, () => {})
      broadcaster.bindConnection(conn2.connectionId, writeFn2, () => {})

      const event = createTestEvent('evt-001')
      broadcaster.broadcast('sess-001', event)

      expect(writes1.length).toBe(1)
      expect(writes2.length).toBe(1)
      expect(writes1[0]).toContain('evt-001')
      expect(writes2[0]).toContain('evt-001')
    })

    it('should not broadcast to closed connections', () => {
      const { writes, writeFn } = createCaptureWrite()
      const conn = broadcaster.subscribe('sess-001')
      broadcaster.bindConnection(conn.connectionId, writeFn, () => {})
      conn.close()

      const event = createTestEvent('evt-001')
      broadcaster.broadcast('sess-001', event)

      expect(writes.length).toBe(0)
      expect(conn.isActive()).toBe(false)
    })

    it('should not broadcast to connections in different sessions', () => {
      const { writes: writes1, writeFn: writeFn1 } = createCaptureWrite()
      const { writes: writes2, writeFn: writeFn2 } = createCaptureWrite()

      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-002')
      broadcaster.bindConnection(conn1.connectionId, writeFn1, () => {})
      broadcaster.bindConnection(conn2.connectionId, writeFn2, () => {})

      const event = createTestEvent('evt-001', 'user_message', 'sess-001')
      broadcaster.broadcast('sess-001', event)

      expect(writes1.length).toBe(1)
      expect(writes1[0]).toContain('evt-001')
      expect(writes2.length).toBe(0)
    })
  })

  describe('no cross-session delivery', () => {
    it('should isolate events between sessions', () => {
      const { writes: writes1, writeFn: writeFn1 } = createCaptureWrite()
      const { writes: writes2, writeFn: writeFn2 } = createCaptureWrite()
      const { writes: writes3, writeFn: writeFn3 } = createCaptureWrite()

      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-002')
      const conn3 = broadcaster.subscribe('sess-001')

      broadcaster.bindConnection(conn1.connectionId, writeFn1, () => {})
      broadcaster.bindConnection(conn2.connectionId, writeFn2, () => {})
      broadcaster.bindConnection(conn3.connectionId, writeFn3, () => {})

      const eventA = createTestEvent('evt-a', 'user_message', 'sess-001')
      const eventB = createTestEvent('evt-b', 'assistant_message', 'sess-002')

      broadcaster.broadcast('sess-001', eventA)
      broadcaster.broadcast('sess-002', eventB)

      expect(writes1.length).toBe(1)
      expect(writes1[0]).toContain('evt-a')
      expect(writes3.length).toBe(1)
      expect(writes3[0]).toContain('evt-a')
      expect(writes2.length).toBe(1)
      expect(writes2[0]).toContain('evt-b')
    })

    it('should maintain separate connection counts per session', () => {
      broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-002')
      broadcaster.subscribe('sess-003')
      broadcaster.subscribe('sess-003')
      broadcaster.subscribe('sess-003')

      expect(broadcaster.getConnectionCount('sess-001')).toBe(2)
      expect(broadcaster.getConnectionCount('sess-002')).toBe(1)
      expect(broadcaster.getConnectionCount('sess-003')).toBe(3)
    })
  })

  describe('disconnect cleanup', () => {
    it('should remove connection from count when closed', () => {
      const conn = broadcaster.subscribe('sess-001')
      expect(broadcaster.getConnectionCount('sess-001')).toBe(1)

      conn.close()
      expect(broadcaster.getConnectionCount('sess-001')).toBe(0)
    })

    it('should handle multiple connection closures', () => {
      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-001')
      const conn3 = broadcaster.subscribe('sess-001')

      expect(broadcaster.getConnectionCount('sess-001')).toBe(3)

      conn2.close()
      expect(broadcaster.getConnectionCount('sess-001')).toBe(2)

      conn1.close()
      expect(broadcaster.getConnectionCount('sess-001')).toBe(1)

      conn3.close()
      expect(broadcaster.getConnectionCount('sess-001')).toBe(0)
    })

    it('should not affect other sessions when closing connections', () => {
      const conn1 = broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-002')

      conn1.close()

      expect(broadcaster.getConnectionCount('sess-001')).toBe(0)
      expect(broadcaster.getConnectionCount('sess-002')).toBe(1)
    })
  })

  describe('closeSession', () => {
    it('should close all connections for a session', () => {
      const conn1 = broadcaster.subscribe('sess-001')
      const conn2 = broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-002')

      broadcaster.closeSession('sess-001')

      expect(broadcaster.getConnectionCount('sess-001')).toBe(0)
      expect(conn1.isActive()).toBe(false)
      expect(conn2.isActive()).toBe(false)
      expect(broadcaster.getConnectionCount('sess-002')).toBe(1)
    })

    it('should handle closing non-existent session gracefully', () => {
      expect(() => broadcaster.closeSession('non-existent')).not.toThrow()
    })
  })

  describe('catch-up behavior', () => {
    it('should send events after afterEventId exclusively', () => {
      const events: ConsoleTimelineEvent[] = [
        createTestEvent('evt-001'),
        createTestEvent('evt-002'),
        createTestEvent('evt-003'),
        createTestEvent('evt-004'),
      ]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { afterEventId: 'evt-002', write: writeFn })

      expect(writes.length).toBe(2)
      expect(writes[0]).toContain('evt-003')
      expect(writes[1]).toContain('evt-004')
      expect(writes[0]).not.toContain('evt-002')
      expect(writes[1]).not.toContain('evt-002')
    })

    it('should send events after lastEventId exclusively', () => {
      const events: ConsoleTimelineEvent[] = [
        createTestEvent('evt-001'),
        createTestEvent('evt-002'),
        createTestEvent('evt-003'),
      ]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { lastEventId: 'evt-001', write: writeFn })

      expect(writes.length).toBe(2)
      expect(writes[0]).toContain('evt-002')
      expect(writes[1]).toContain('evt-003')
      expect(writes[0]).not.toContain('evt-001')
    })

    it('should send all events when afterEventId not found in history', () => {
      const events: ConsoleTimelineEvent[] = [createTestEvent('evt-001'), createTestEvent('evt-002')]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { afterEventId: 'unknown-id', write: writeFn })

      expect(writes.length).toBe(2)
      expect(writes[0]).toContain('evt-001')
      expect(writes[1]).toContain('evt-002')
    })

    it('should send no events when afterEventId is the last event', () => {
      const events: ConsoleTimelineEvent[] = [createTestEvent('evt-001'), createTestEvent('evt-002')]
      mockTimelineService = createMockTimelineService(events)
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { afterEventId: 'evt-002', write: writeFn })

      expect(writes.length).toBe(0)
    })

    it('should handle empty timeline for catch-up', () => {
      mockTimelineService = createMockTimelineService([])
      broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })

      const { writes, writeFn } = createCaptureWrite()
      broadcaster.subscribe('sess-001', { afterEventId: 'evt-001', write: writeFn })

      expect(writes.length).toBe(0)
    })
  })

  describe('getConnectionCount', () => {
    it('should return 0 for session with no connections', () => {
      expect(broadcaster.getConnectionCount('sess-001')).toBe(0)
    })

    it('should return correct count for session with connections', () => {
      broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-001')

      expect(broadcaster.getConnectionCount('sess-001')).toBe(2)
    })

    it('should only count active connections', () => {
      const conn = broadcaster.subscribe('sess-001')
      broadcaster.subscribe('sess-001')

      conn.close()

      expect(broadcaster.getConnectionCount('sess-001')).toBe(1)
    })
  })
})

describe('TimelineConnection', () => {
  let broadcaster: TimelineBroadcaster
  let mockTimelineService: ConsoleTimelineService

  beforeEach(() => {
    mockTimelineService = createMockTimelineService()
    broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })
  })

  describe('write', () => {
    it('should write event in SSE format', () => {
      const { writes, writeFn } = createCaptureWrite()
      const connection = broadcaster.subscribe('sess-001')
      broadcaster.bindConnection(connection.connectionId, writeFn, () => {})

      const event = createTestEvent('evt-001')
      connection.write({
        id: event.eventId,
        event: 'timeline_event',
        data: event,
      })

      expect(writes.length).toBe(1)
      expect(writes[0]).toContain('id: evt-001')
      expect(writes[0]).toContain('event: timeline_event')
      expect(writes[0]).toContain('"eventId":"evt-001"')
    })

    it('should not write to inactive connection', () => {
      const { writes, writeFn } = createCaptureWrite()
      const connection = broadcaster.subscribe('sess-001')
      broadcaster.bindConnection(connection.connectionId, writeFn, () => {})
      connection.close()

      connection.write({
        id: 'evt-001',
        event: 'timeline_event',
        data: {},
      })

      expect(writes.length).toBe(0)
    })
  })

  describe('close', () => {
    it('should mark connection as inactive', () => {
      const connection = broadcaster.subscribe('sess-001')

      connection.close()

      expect(connection.isActive()).toBe(false)
    })

    it('should be idempotent', () => {
      const connection = broadcaster.subscribe('sess-001')

      connection.close()
      connection.close()
      connection.close()

      expect(connection.isActive()).toBe(false)
    })
  })

  describe('isActive', () => {
    it('should return true for active connection', () => {
      const connection = broadcaster.subscribe('sess-001')

      expect(connection.isActive()).toBe(true)
    })

    it('should return false for closed connection', () => {
      const connection = broadcaster.subscribe('sess-001')
      connection.close()

      expect(connection.isActive()).toBe(false)
    })
  })
})

describe('TimelineBroadcaster - SSE format', () => {
  let broadcaster: TimelineBroadcaster
  let mockTimelineService: ConsoleTimelineService

  beforeEach(() => {
    mockTimelineService = createMockTimelineService()
    broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })
  })

  it('should format events as SSE with id field', () => {
    const { writes, writeFn } = createCaptureWrite()
    const connection = broadcaster.subscribe('sess-001')
    broadcaster.bindConnection(connection.connectionId, writeFn, () => {})

    const event = createTestEvent('evt-001')
    broadcaster.broadcast('sess-001', event)

    expect(writes.length).toBe(1)
    const sseOutput = writes[0]
    expect(sseOutput).toMatch(/^id: evt-001\n/)
    expect(sseOutput).toContain('event: timeline_event')
    expect(sseOutput).toContain('data:')
    expect(sseOutput).toContain('"eventId":"evt-001"')
    expect(sseOutput).toMatch(/\n\n$/)
  })

  it('should include event type in SSE format', () => {
    const { writes, writeFn } = createCaptureWrite()
    const connection = broadcaster.subscribe('sess-001')
    broadcaster.bindConnection(connection.connectionId, writeFn, () => {})

    const event = createTestEvent('evt-001', 'assistant_message')
    broadcaster.broadcast('sess-001', event)

    expect(writes[0]).toContain('"eventType":"assistant_message"')
  })
})

describe('TimelineBroadcaster - reconnection scenarios', () => {
  let broadcaster: TimelineBroadcaster
  let mockTimelineService: ConsoleTimelineService

  beforeEach(() => {
    const events: ConsoleTimelineEvent[] = [
      createTestEvent('evt-001', 'user_message'),
      createTestEvent('evt-002', 'assistant_message'),
      createTestEvent('evt-003', 'tool_call'),
      createTestEvent('evt-004', 'assistant_message'),
    ]
    mockTimelineService = createMockTimelineService(events)
    broadcaster = createTimelineBroadcaster({ timelineService: mockTimelineService })
  })

  it('should handle reconnection with Last-Event-ID header', () => {
    const { writes, writeFn } = createCaptureWrite()
    broadcaster.subscribe('sess-001', { lastEventId: 'evt-002', write: writeFn })

    expect(writes.length).toBe(2)
    expect(writes[0]).toContain('evt-003')
    expect(writes[1]).toContain('evt-004')
  })

  it('should handle reconnection with after query parameter', () => {
    const { writes, writeFn } = createCaptureWrite()
    broadcaster.subscribe('sess-001', { afterEventId: 'evt-002', write: writeFn })

    expect(writes.length).toBe(2)
    expect(writes[0]).toContain('evt-003')
    expect(writes[1]).toContain('evt-004')
  })

  it('should not send duplicate events on reconnection', () => {
    const { writes, writeFn } = createCaptureWrite()
    broadcaster.subscribe('sess-001', { lastEventId: 'evt-002', write: writeFn })

    const writtenEventIds = writes
      .map((w) => {
        const match = w.match(/id: (\S+)/)
        return match ? match[1] : null
      })
      .filter(Boolean)

    const uniqueIds = [...new Set(writtenEventIds)]
    expect(writtenEventIds.length).toBe(uniqueIds.length)
    expect(writtenEventIds).not.toContain('evt-001')
    expect(writtenEventIds).not.toContain('evt-002')
    expect(writtenEventIds).toContain('evt-003')
    expect(writtenEventIds).toContain('evt-004')
  })
})
