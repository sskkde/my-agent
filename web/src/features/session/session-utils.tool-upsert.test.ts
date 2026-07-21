import { describe, it, expect } from 'vitest'
import { upsertTimelineEvent, mergeTimelineEvents } from './session-utils'
import type { ConsoleTimelineEvent } from '../../api/types'

const base = (overrides: Partial<ConsoleTimelineEvent> & { eventId: string; eventType: ConsoleTimelineEvent['eventType'] }): ConsoleTimelineEvent => ({
  sessionId: 's1',
  timestamp: new Date().toISOString(),
  ...overrides,
})

describe('upsertTimelineEvent (scheme 1 tool identity)', () => {
  it('replaces same eventId in place', () => {
    const prev = [
      base({
        eventId: 'turn-1-tool-callA-call',
        eventType: 'tool_call',
        content: 'Tool running: search',
        metadata: { turnId: '1', toolCallId: 'callA', early: true, toolCallIndex: 0 },
      }),
    ]
    const next = upsertTimelineEvent(prev, {
      ...prev[0],
      content: 'Tool running: search',
      metadata: { turnId: '1', toolCallId: 'callA', toolCallIndex: 0 },
    })
    expect(next).toHaveLength(1)
    expect(next[0].metadata?.early).toBeUndefined()
  })

  it('replaces early card when formal has different eventId but same turn+index', () => {
    const early = base({
      eventId: 'turn-1-tool-pending-tool-1-0-call',
      eventType: 'tool_call',
      content: 'Tool running: search',
      metadata: {
        turnId: '1',
        toolCallId: 'pending-tool-1-0',
        early: true,
        toolCallIndex: 0,
        toolName: 'search',
      },
    })
    const formal = base({
      eventId: 'turn-1-tool-call_real-call',
      eventType: 'tool_call',
      content: 'Tool running: search',
      metadata: {
        turnId: '1',
        toolCallId: 'call_real',
        toolCallIndex: 0,
        toolName: 'search',
        replacesEarlyEventId: early.eventId,
      },
    })
    const next = upsertTimelineEvent([early], formal)
    expect(next).toHaveLength(1)
    expect(next[0].eventId).toBe(formal.eventId)
    expect(next[0].metadata?.toolCallId).toBe('call_real')
    expect(next[0].metadata?.early).toBeUndefined()
  })

  it('mergeTimelineEvents applies sequential upserts', () => {
    const early = base({
      eventId: 'e1',
      eventType: 'tool_call',
      metadata: { turnId: 't', early: true, toolCallIndex: 0, toolCallId: 'p' },
    })
    const formal = base({
      eventId: 'e2',
      eventType: 'tool_call',
      metadata: {
        turnId: 't',
        toolCallIndex: 0,
        toolCallId: 'real',
        replacesEarlyEventId: 'e1',
      },
    })
    const result = base({
      eventId: 'e3',
      eventType: 'tool_result',
      metadata: { turnId: 't', toolCallId: 'real' },
    })
    const next = mergeTimelineEvents([], [early, formal, result])
    expect(next.map((e) => e.eventId)).toEqual(['e2', 'e3'])
  })
})
