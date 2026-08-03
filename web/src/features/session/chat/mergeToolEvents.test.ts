import { describe, it, expect } from 'vitest'
import type { ConsoleTimelineEvent, ConsoleTimelineEventType } from '../../../api/types'
import { mergeToolEvents, type ChatStreamItem } from './mergeToolEvents'

const makeEvent = (
  overrides: Partial<ConsoleTimelineEvent> & {
    eventId: string
    eventType: ConsoleTimelineEventType
  },
): ConsoleTimelineEvent => ({
  sessionId: 'session-1',
  timestamp: '2026-07-15T12:00:00.000Z',
  ...overrides,
})

const toolItems = (items: ChatStreamItem[]) => items.filter((item) => item.kind === 'tool')

const messageItems = (items: ChatStreamItem[]) => items.filter((item) => item.kind === 'message')

describe('mergeToolEvents', () => {
  it('pairs tool_call and tool_result by exact toolCallId (S1)', () => {
    const call = makeEvent({
      eventId: 'call-1',
      eventType: 'tool_call',
      content: 'file.read: running',
      metadata: {
        toolCallId: 'tc-1',
        toolName: 'file.read',
        status: 'running',
        parameters: { path: '/src/a.ts' },
      },
    })
    const result = makeEvent({
      eventId: 'result-1',
      eventType: 'tool_result',
      content: 'file contents',
      metadata: {
        toolCallId: 'tc-1',
        toolName: 'file.read',
        status: 'completed',
        result: 'file contents',
        durationMs: 120,
      },
    })
    const user = makeEvent({
      eventId: 'user-1',
      eventType: 'user_message',
      content: 'read the file',
      actor: 'user',
    })
    const assistant = makeEvent({
      eventId: 'asst-1',
      eventType: 'assistant_message',
      content: 'done',
      actor: 'assistant',
    })

    const items = mergeToolEvents([user, call, result, assistant])

    expect(messageItems(items)).toHaveLength(2)
    expect(toolItems(items)).toHaveLength(1)
    expect(items.map((item) => item.kind)).toEqual(['message', 'tool', 'message'])

    const tool = toolItems(items)[0]
    expect(tool.toolName).toBe('file.read')
    expect(tool.parameters).toEqual({ path: '/src/a.ts' })
    expect(tool.resultText).toBe('file contents')
    expect(tool.status).toBe('completed')
    expect(tool.durationMs).toBe(120)
    expect(tool.call?.eventId).toBe('call-1')
    expect(tool.result?.eventId).toBe('result-1')
  })

  it('pairs result-before-call backend order by shared turnId and ordinal', () => {
    const result = makeEvent({
      eventId: 'turn-1-tool-result-0',
      eventType: 'tool_result',
      content: 'search hits',
      metadata: {
        turnId: 'turn-1',
        toolName: 'web_search',
        status: 'completed',
        result: 'search hits',
      },
    })
    const call = makeEvent({
      eventId: 'turn-1-tool-0',
      eventType: 'tool_call',
      content: 'web_search: completed',
      metadata: {
        turnId: 'turn-1',
        toolCallId: 'tc-search',
        toolName: 'web_search',
        status: 'completed',
        toolCallIndex: 0,
        parameters: { query: 'agent platforms' },
      },
    })

    const items = mergeToolEvents([result, call])
    const tools = toolItems(items)

    expect(tools).toHaveLength(1)
    expect(tools[0].toolName).toBe('web_search')
    expect(tools[0].parameters).toEqual({ query: 'agent platforms' })
    expect(tools[0].resultText).toBe('search hits')
    expect(tools[0].status).toBe('completed')
    expect(tools[0].call?.eventId).toBe('turn-1-tool-0')
    expect(tools[0].result?.eventId).toBe('turn-1-tool-result-0')
    expect(items[0].kind).toBe('tool')
    expect(items[0].key).toBe('turn-1-tool-result-0')
  })

  it('pairs two calls and two results in one turn by independent ordinal', () => {
    const resultA = makeEvent({
      eventId: 'r-a',
      eventType: 'tool_result',
      content: 'a-out',
      metadata: { turnId: 't1', toolName: 'read_file', status: 'completed', result: 'a-out' },
    })
    const resultB = makeEvent({
      eventId: 'r-b',
      eventType: 'tool_result',
      content: 'b-out',
      metadata: { turnId: 't1', toolName: 'write_file', status: 'completed', result: 'b-out' },
    })
    const callA = makeEvent({
      eventId: 'c-a',
      eventType: 'tool_call',
      content: 'read_file: completed',
      metadata: {
        turnId: 't1',
        toolCallId: 'tc-a',
        toolName: 'read_file',
        status: 'completed',
        toolCallIndex: 0,
        parameters: { path: 'a' },
      },
    })
    const callB = makeEvent({
      eventId: 'c-b',
      eventType: 'tool_call',
      content: 'write_file: completed',
      metadata: {
        turnId: 't1',
        toolCallId: 'tc-b',
        toolName: 'write_file',
        status: 'completed',
        toolCallIndex: 1,
        parameters: { path: 'b' },
      },
    })

    const items = mergeToolEvents([resultA, resultB, callA, callB])
    const tools = toolItems(items)

    expect(tools).toHaveLength(2)
    expect(tools[0].toolName).toBe('read_file')
    expect(tools[0].resultText).toBe('a-out')
    expect(tools[0].parameters).toEqual({ path: 'a' })
    expect(tools[1].toolName).toBe('write_file')
    expect(tools[1].resultText).toBe('b-out')
    expect(tools[1].parameters).toEqual({ path: 'b' })
  })

  it('sequential fallback does not consume incompatible results for later calls', () => {
    // calls A,B with results B,A (by toolName) — both must merge independently
    const callA = makeEvent({
      eventId: 'call-a',
      eventType: 'tool_call',
      metadata: { toolName: 'tool-a', status: 'running', parameters: { n: 1 } },
    })
    const callB = makeEvent({
      eventId: 'call-b',
      eventType: 'tool_call',
      metadata: { toolName: 'tool-b', status: 'running', parameters: { n: 2 } },
    })
    const resultB = makeEvent({
      eventId: 'result-b',
      eventType: 'tool_result',
      content: 'out-b',
      metadata: { toolName: 'tool-b', status: 'completed', result: 'out-b' },
    })
    const resultA = makeEvent({
      eventId: 'result-a',
      eventType: 'tool_result',
      content: 'out-a',
      metadata: { toolName: 'tool-a', status: 'completed', result: 'out-a' },
    })

    const tools = toolItems(mergeToolEvents([callA, callB, resultB, resultA]))
    expect(tools).toHaveLength(2)
    expect(tools.every((t) => Boolean(t.call && t.result))).toBe(true)

    const byName = Object.fromEntries(tools.map((t) => [t.toolName, t]))
    expect(byName['tool-a'].resultText).toBe('out-a')
    expect(byName['tool-b'].resultText).toBe('out-b')
    expect(byName['tool-a'].status).toBe('completed')
    expect(byName['tool-b'].status).toBe('completed')
  })

  it('pairs sequential call/result when IDs and turnIds are absent', () => {
    const call = makeEvent({
      eventId: 'c1',
      eventType: 'tool_call',
      content: 'status_query: running',
      metadata: { toolName: 'status_query', parameters: { q: 'health' } },
    })
    const result = makeEvent({
      eventId: 'r1',
      eventType: 'tool_result',
      content: 'ok',
      metadata: { toolName: 'status_query', result: 'ok' },
    })

    const items = mergeToolEvents([call, result])
    const tools = toolItems(items)

    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('completed')
    expect(tools[0].resultText).toBe('ok')
    expect(tools[0].parameters).toEqual({ q: 'health' })
  })

  it('places merged tool at earlier constituent index and keys by stable tool identity', () => {
    const earlyResult = makeEvent({
      eventId: 'early-result',
      eventType: 'tool_result',
      content: 'out',
      metadata: { toolCallId: 'tc-stable', toolName: 'grep', status: 'completed', result: 'out' },
    })
    const lateCall = makeEvent({
      eventId: 'late-call',
      eventType: 'tool_call',
      content: 'grep: completed',
      metadata: { toolCallId: 'tc-stable', toolName: 'grep', status: 'completed' },
    })
    const after = makeEvent({
      eventId: 'asst',
      eventType: 'assistant_message',
      content: 'found it',
    })

    const items = mergeToolEvents([earlyResult, lateCall, after])

    expect(items[0].kind).toBe('tool')
    expect(items[0].key).toBe('tool-tc-stable')
    expect(items[1].kind).toBe('message')
  })

  it('does not mutate input array or event objects', () => {
    const call = makeEvent({
      eventId: 'c',
      eventType: 'tool_call',
      metadata: { toolCallId: 'tc', toolName: 'x', status: 'running', parameters: { a: 1 } },
    })
    const result = makeEvent({
      eventId: 'r',
      eventType: 'tool_result',
      content: 'y',
      metadata: { toolCallId: 'tc', toolName: 'x', status: 'completed', result: 'y' },
    })
    const input = [call, result]
    const snapshot = structuredClone(input)

    mergeToolEvents(input)

    expect(input).toEqual(snapshot)
    expect(input[0]).toBe(call)
    expect(input[1]).toBe(result)
  })

  it('keeps orphan call with default running status', () => {
    const call = makeEvent({
      eventId: 'orphan-call',
      eventType: 'tool_call',
      content: 'web_fetch: running',
      metadata: { toolName: 'web_fetch' },
    })

    const tools = toolItems(mergeToolEvents([call]))
    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('running')
    expect(tools[0].resultText).toBeUndefined()
    expect(tools[0].call?.eventId).toBe('orphan-call')
    expect(tools[0].result).toBeUndefined()
  })

  it('keeps orphan completed call without fabricating a result', () => {
    const call = makeEvent({
      eventId: 'completed-call',
      eventType: 'tool_call',
      content: 'memory_retrieve: completed',
      metadata: { toolName: 'memory_retrieve', status: 'completed' },
    })

    const tools = toolItems(mergeToolEvents([call]))
    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('completed')
    expect(tools[0].resultText).toBeUndefined()
  })

  it('keeps orphan result defaulting to completed', () => {
    const result = makeEvent({
      eventId: 'orphan-result',
      eventType: 'tool_result',
      content: 'payload',
      metadata: { toolName: 'exec_command', result: 'payload' },
    })

    const tools = toolItems(mergeToolEvents([result]))
    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('completed')
    expect(tools[0].resultText).toBe('payload')
    expect(tools[0].call).toBeUndefined()
  })

  it('lets failed result control merged status over running call', () => {
    const call = makeEvent({
      eventId: 'c-fail',
      eventType: 'tool_call',
      metadata: { toolCallId: 'tc-f', toolName: 'bash', status: 'running' },
    })
    const result = makeEvent({
      eventId: 'r-fail',
      eventType: 'tool_result',
      content: 'boom',
      metadata: { toolCallId: 'tc-f', toolName: 'bash', status: 'failed', result: 'boom' },
    })

    const tools = toolItems(mergeToolEvents([call, result]))
    expect(tools).toHaveLength(1)
    expect(tools[0].status).toBe('failed')
    expect(tools[0].resultText).toBe('boom')
  })

  it('normalizes failed via metadata.failed and content patterns', () => {
    const failedFlag = makeEvent({
      eventId: 'f1',
      eventType: 'tool_call',
      metadata: { toolName: 'tool-a', failed: true },
    })
    const completedContent = makeEvent({
      eventId: 'f2',
      eventType: 'tool_call',
      content: 'tool-b: completed',
      metadata: { toolName: 'tool-b' },
    })
    const failedContent = makeEvent({
      eventId: 'f3',
      eventType: 'tool_result',
      content: 'tool-c: failed',
      metadata: { toolName: 'tool-c' },
    })

    const items = mergeToolEvents([failedFlag, completedContent, failedContent])
    const tools = toolItems(items)
    expect(tools.map((t) => t.status)).toEqual(['failed', 'completed', 'failed'])
  })

  it('uses empty object for missing or invalid parameters', () => {
    const missing = makeEvent({
      eventId: 'p1',
      eventType: 'tool_call',
      metadata: { toolName: 'a', status: 'running' },
    })
    const invalid = makeEvent({
      eventId: 'p2',
      eventType: 'tool_call',
      metadata: { toolName: 'b', status: 'running', parameters: 'not-an-object' },
    })

    const tools = toolItems(mergeToolEvents([missing, invalid]))
    expect(tools[0].parameters).toEqual({})
    expect(tools[1].parameters).toEqual({})
  })

  it('falls back resultText from metadata.result to content', () => {
    const withMeta = makeEvent({
      eventId: 'rt1',
      eventType: 'tool_result',
      content: 'content-fallback',
      metadata: { toolName: 'a', result: 'meta-result' },
    })
    const contentOnly = makeEvent({
      eventId: 'rt2',
      eventType: 'tool_result',
      content: 'content-only',
      metadata: { toolName: 'b' },
    })

    const tools = toolItems(mergeToolEvents([withMeta, contentOnly]))
    expect(tools[0].resultText).toBe('meta-result')
    expect(tools[1].resultText).toBe('content-only')
  })

  it('uses Unknown tool when toolName is missing', () => {
    const call = makeEvent({
      eventId: 'u1',
      eventType: 'tool_call',
      metadata: { status: 'running' },
    })

    const tools = toolItems(mergeToolEvents([call]))
    expect(tools[0].toolName).toBe('Unknown tool')
  })

  it('does not pair across sessions or conflicting IDs/turns/names', () => {
    const callSessionA = makeEvent({
      eventId: 'c-a',
      eventType: 'tool_call',
      sessionId: 's-a',
      metadata: { toolCallId: 'same', toolName: 'read_file', status: 'running' },
    })
    const resultSessionB = makeEvent({
      eventId: 'r-b',
      eventType: 'tool_result',
      sessionId: 's-b',
      content: 'x',
      metadata: { toolCallId: 'same', toolName: 'read_file', status: 'completed', result: 'x' },
    })
    // Both sides carry conflicting IDs so sequential fallback must reject
    const callIdConflict = makeEvent({
      eventId: 'c2',
      eventType: 'tool_call',
      metadata: { toolCallId: 'id-1', toolName: 'tool-id', status: 'running' },
    })
    const resultIdConflict = makeEvent({
      eventId: 'r2',
      eventType: 'tool_result',
      content: 'y',
      metadata: { toolCallId: 'id-2', toolName: 'tool-id', status: 'completed', result: 'y' },
    })
    // Both sides carry conflicting turnIds
    const callTurnConflict = makeEvent({
      eventId: 'c3',
      eventType: 'tool_call',
      metadata: { turnId: 't-a', toolName: 'tool-turn', status: 'running' },
    })
    const resultTurnConflict = makeEvent({
      eventId: 'r3',
      eventType: 'tool_result',
      content: 'z',
      metadata: { turnId: 't-b', toolName: 'tool-turn', status: 'completed', result: 'z' },
    })
    // Both sides carry conflicting tool names
    const callNameConflict = makeEvent({
      eventId: 'c4',
      eventType: 'tool_call',
      metadata: { toolName: 'read_file', status: 'running' },
    })
    const resultNameConflict = makeEvent({
      eventId: 'r4',
      eventType: 'tool_result',
      content: 'w',
      metadata: { toolName: 'write_file', status: 'completed', result: 'w' },
    })

    const tools = toolItems(
      mergeToolEvents([
        callSessionA,
        resultSessionB,
        callIdConflict,
        resultIdConflict,
        callTurnConflict,
        resultTurnConflict,
        callNameConflict,
        resultNameConflict,
      ]),
    )

    expect(tools).toHaveLength(8)
    expect(tools.every((t) => !(t.call && t.result))).toBe(true)
  })

  it('preserves pure user/assistant order and content (S3)', () => {
    const user = makeEvent({
      eventId: 'u',
      eventType: 'user_message',
      content: 'hi',
      actor: 'user',
    })
    const assistant = makeEvent({
      eventId: 'a',
      eventType: 'assistant_message',
      content: 'hello',
      actor: 'assistant',
    })

    const items = mergeToolEvents([user, assistant])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'message', key: 'u' })
    expect(items[1]).toMatchObject({ kind: 'message', key: 'a' })
    if (items[0].kind === 'message') {
      expect(items[0].event.content).toBe('hi')
    }
    if (items[1].kind === 'message') {
      expect(items[1].event.content).toBe('hello')
    }
  })

  it('includes thinking_summary as a first-class message item', () => {
    const thinking = makeEvent({
      eventId: 'th',
      eventType: 'thinking_summary',
      content: 'REASONING_FIXTURE_12345',
    })
    const user = makeEvent({
      eventId: 'u',
      eventType: 'user_message',
      content: 'hi',
    })

    const items = mergeToolEvents([thinking, user])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'message', key: 'th' })
    expect(items[1]).toMatchObject({ kind: 'message', key: 'u' })
    if (items[0].kind === 'message') {
      expect(items[0].event.eventType).toBe('thinking_summary')
      expect(items[0].event.content).toBe('REASONING_FIXTURE_12345')
    }
  })

  it('preserves order when tools are interleaved around thinking_summary', () => {
    const user = makeEvent({
      eventId: 'u',
      eventType: 'user_message',
      content: 'do it',
    })
    const call = makeEvent({
      eventId: 'call-1',
      eventType: 'tool_call',
      content: 'web_search: running',
      metadata: {
        toolCallId: 'tc-1',
        toolName: 'web_search',
        status: 'running',
        parameters: { query: 'agent platforms' },
      },
    })
    const result = makeEvent({
      eventId: 'result-1',
      eventType: 'tool_result',
      content: 'search hits',
      metadata: {
        toolCallId: 'tc-1',
        toolName: 'web_search',
        status: 'completed',
        result: 'search hits',
      },
    })
    const thinking = makeEvent({
      eventId: 'th',
      eventType: 'thinking_summary',
      content: 'REASONING_FIXTURE_12345',
    })
    const assistant = makeEvent({
      eventId: 'asst',
      eventType: 'assistant_message',
      content: 'here you go',
    })

    const items = mergeToolEvents([user, call, result, thinking, assistant])

    expect(items).toHaveLength(4)
    expect(items.map((item) => item.kind)).toEqual(['message', 'tool', 'message', 'message'])
    expect(items[0].key).toBe('u')
    expect(items[1].key).toBe('tool-tc-1')
    expect(items[2].key).toBe('th')
    expect(items[3].key).toBe('asst')
    if (items[2].kind === 'message') {
      expect(items[2].event.eventType).toBe('thinking_summary')
      expect(items[2].event.content).toBe('REASONING_FIXTURE_12345')
    }
  })

  it('still drops unknown event types such as token_stream', () => {
    const tokenStream = makeEvent({
      eventId: 'tok',
      eventType: 'token_stream',
      content: 'a delta',
    })
    const user = makeEvent({
      eventId: 'u',
      eventType: 'user_message',
      content: 'hi',
    })

    const items = mergeToolEvents([tokenStream, user])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('message')
    expect(items[0].key).toBe('u')
  })

  it('T6: thinking_summary content never leaks into assistant_message items', () => {
    const thinking = makeEvent({
      eventId: 'th',
      eventType: 'thinking_summary',
      content: 'REASONING_FIXTURE_12345',
    })
    const assistant = makeEvent({
      eventId: 'asst',
      eventType: 'assistant_message',
      content: 'public answer',
    })

    const items = mergeToolEvents([thinking, assistant])

    expect(items).toHaveLength(2)
    // SAFETY: reasoning fixture appears only in the thinking_summary item.
    const thinkingItem = items.find((i) => i.kind === 'message' && i.key === 'th')
    const assistantItem = items.find((i) => i.kind === 'message' && i.key === 'asst')
    expect(thinkingItem).toBeDefined()
    expect(assistantItem).toBeDefined()
    if (thinkingItem?.kind === 'message' && assistantItem?.kind === 'message') {
      expect(thinkingItem.event.content).toBe('REASONING_FIXTURE_12345')
      expect(assistantItem.event.content).toBe('public answer')
      expect(assistantItem.event.content).not.toContain('REASONING_FIXTURE_12345')
    }
  })

  it('treats error events as message items', () => {
    const user = makeEvent({
      eventId: 'u',
      eventType: 'user_message',
      content: 'hi',
      actor: 'user',
    })
    const error = makeEvent({
      eventId: 'err',
      eventType: 'error',
      content: '[PROCESSING_ERROR] something went wrong',
    })

    const items = mergeToolEvents([user, error])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'message', key: 'u' })
    expect(items[1]).toMatchObject({ kind: 'message', key: 'err' })
    if (items[1].kind === 'message') {
      expect(items[1].event.eventType).toBe('error')
      expect(items[1].event.content).toBe('[PROCESSING_ERROR] something went wrong')
    }
  })
})
