import { describe, it, expect } from 'vitest'
import {
  appendStreamingToken,
  sealStreamingDraftsForTool,
  clearStreamingDraftsByAttemptIds,
  streamingDraftKey,
  type StreamingDraft,
} from './session-utils'

describe('streaming draft segments', () => {
  it('appends tokens into segment 0 until sealed', () => {
    let map = new Map<string, StreamingDraft>()
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 1, delta: 'Hello' }, 1000)
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 2, delta: ' world' }, 1000)
    expect(map.size).toBe(1)
    const draft = map.get(streamingDraftKey('a1', 0))!
    expect(draft.content).toBe('Hello world')
    expect(draft.segment).toBe(0)
    expect(draft.sealed).toBe(false)
    expect(draft.timestamp).toBe(1000)
  })

  it('opens a new segment after tool seal so post-tool text sorts later', () => {
    let map = new Map<string, StreamingDraft>()
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 1, delta: 'Before tool' }, 1000)
    map = sealStreamingDraftsForTool(map, { sessionId: 's1', attemptId: 'a1', turnId: 'a1' })
    expect(map.get(streamingDraftKey('a1', 0))!.sealed).toBe(true)

    const before = Date.now()
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 10, delta: 'After tool' })
    const seg0 = map.get(streamingDraftKey('a1', 0))!
    const seg1 = map.get(streamingDraftKey('a1', 1))!
    expect(seg0.content).toBe('Before tool')
    expect(seg1.content).toBe('After tool')
    expect(seg1.segment).toBe(1)
    expect(seg1.timestamp).toBeGreaterThanOrEqual(before)
    expect(seg1.timestamp).toBeGreaterThan(seg0.timestamp)
  })

  it('clears all segments for an attempt', () => {
    let map = new Map<string, StreamingDraft>()
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 1, delta: 'x' }, 1)
    map = sealStreamingDraftsForTool(map, { sessionId: 's1', turnId: 'a1' })
    map = appendStreamingToken(map, { attemptId: 'a1', sessionId: 's1', sequence: 2, delta: 'y' })
    expect(map.size).toBe(2)
    map = clearStreamingDraftsByAttemptIds(map, ['a1'])
    expect(map.size).toBe(0)
  })
})

  it('seals all unsealed session drafts even when attempt ids do not match', () => {
    let map = new Map()
    map = appendStreamingToken(map, { attemptId: 'placeholder-xyz', sessionId: 's1', sequence: 1, delta: 'Hi' }, 1000)
    // tool carries turnId different from placeholder attemptId
    map = sealStreamingDraftsForTool(map, { sessionId: 's1', turnId: 'run-real-id' })
    expect(map.get(streamingDraftKey('placeholder-xyz', 0))!.sealed).toBe(true)
    map = appendStreamingToken(map, { attemptId: 'placeholder-xyz', sessionId: 's1', sequence: 2, delta: ' after' })
    expect(map.size).toBe(2)
    expect(map.get(streamingDraftKey('placeholder-xyz', 1))!.content).toBe(' after')
  })

  it('compareTimelineEventsForChat places tools between sealed and open drafts', async () => {
    const { compareTimelineEventsForChat } = await import('./session-utils')
    const sealed = {
      eventId: 'd0',
      eventType: 'assistant_message' as const,
      sessionId: 's1',
      timestamp: '2026-01-01T00:00:01.000Z',
      content: 'before',
      metadata: { streamingDraft: true, sealed: true, draftSegment: 0 },
    }
    const tool = {
      eventId: 't0',
      eventType: 'tool_call' as const,
      sessionId: 's1',
      timestamp: '2026-01-01T00:00:01.000Z',
      metadata: { turnId: 'r1' },
    }
    const open = {
      eventId: 'd1',
      eventType: 'assistant_message' as const,
      sessionId: 's1',
      timestamp: '2026-01-01T00:00:01.000Z',
      content: 'after',
      metadata: { streamingDraft: true, sealed: false, draftSegment: 1 },
    }
    const sorted = [open, tool, sealed].sort(compareTimelineEventsForChat)
    expect(sorted.map((e) => e.eventId)).toEqual(['d0', 't0', 'd1'])
  })

