import type { ConsoleTimelineEvent } from '../../../api/types'
import {
  extractDurationMs,
  extractParameters,
  extractResultText,
  extractToolName,
  getMetaString,
  normalizeToolStatus,
} from './toolEventMeta'

export type { ToolStatus } from './toolEventMeta'
import type { ToolStatus } from './toolEventMeta'

export type ChatStreamMessageItem = {
  kind: 'message'
  key: string
  event: ConsoleTimelineEvent
}

export type ChatStreamToolItem = {
  kind: 'tool'
  key: string
  call?: ConsoleTimelineEvent
  result?: ConsoleTimelineEvent
  toolName: string
  parameters: Record<string, unknown>
  resultText?: string
  status: ToolStatus
  durationMs?: number
}

export type ChatStreamItem = ChatStreamMessageItem | ChatStreamToolItem

type IndexedEvent = {
  index: number
  event: ConsoleTimelineEvent
}

type Pair = {
  call?: IndexedEvent
  result?: IndexedEvent
}

/**
 * Stable tool card key. Early→formal tool_call replacement (upsertTimelineEvent)
 * changes the eventId but keeps (turnId, toolCallIndex); keying on those keeps
 * the React element stable across the replacement and status transitions.
 */
const stableToolKey = (event: ConsoleTimelineEvent): string | undefined => {
  const turnId = getMetaString(event, 'turnId')
  const toolCallIndex = event.metadata?.toolCallIndex
  if (turnId && typeof toolCallIndex === 'number') return `tool-${turnId}-${toolCallIndex}`
  const toolCallId = getMetaString(event, 'toolCallId')
  if (toolCallId) return `tool-${toolCallId}`
  return undefined
}

const projectToolItem = (pair: Pair): ChatStreamToolItem => {
  const call = pair.call?.event
  const result = pair.result?.event
  const earliestIndex = Math.min(
    pair.call?.index ?? Number.POSITIVE_INFINITY,
    pair.result?.index ?? Number.POSITIVE_INFINITY,
  )
  const keyEvent =
    pair.call?.index === earliestIndex ? pair.call?.event : pair.result?.event

  const statusEvent = result ?? call
  if (!statusEvent || !keyEvent) {
    throw new Error('tool pair missing events')
  }

  const fromCall = extractParameters(call)
  const parameters = Object.keys(fromCall).length > 0 ? fromCall : extractParameters(result)

  return {
    kind: 'tool',
    key: stableToolKey(keyEvent) ?? keyEvent.eventId,
    call,
    result,
    toolName: extractToolName(call, result),
    parameters,
    resultText: extractResultText(result, call),
    status: normalizeToolStatus(statusEvent),
    durationMs: extractDurationMs(result, call),
  }
}

const canPairByConstraints = (call: ConsoleTimelineEvent, result: ConsoleTimelineEvent): boolean => {
  if (call.sessionId !== result.sessionId) return false

  const callId = getMetaString(call, 'toolCallId')
  const resultId = getMetaString(result, 'toolCallId')
  if (callId && resultId && callId !== resultId) return false

  const callTurn = getMetaString(call, 'turnId')
  const resultTurn = getMetaString(result, 'turnId')
  if (callTurn && resultTurn && callTurn !== resultTurn) return false

  const callName = getMetaString(call, 'toolName')
  const resultName = getMetaString(result, 'toolName')
  if (callName && resultName && callName !== resultName) return false

  return true
}

/**
 * Merge timeline events into chat stream items.
 * Pairs tool_call + tool_result via toolCallId, then turnId ordinal, then sequential fallback.
 */
export function mergeToolEvents(events: readonly ConsoleTimelineEvent[]): ChatStreamItem[] {
  const messageIndexes = new Map<number, ConsoleTimelineEvent>()
  const calls: IndexedEvent[] = []
  const results: IndexedEvent[] = []

  events.forEach((event, index) => {
    if (
      event.eventType === 'user_message' ||
      event.eventType === 'assistant_message' ||
      event.eventType === 'thinking_summary' ||
      event.eventType === 'error'
    ) {
      messageIndexes.set(index, event)
      return
    }
    if (event.eventType === 'tool_call') {
      calls.push({ index, event })
      return
    }
    if (event.eventType === 'tool_result') {
      results.push({ index, event })
    }
  })

  const pairedCallIndexes = new Set<number>()
  const pairedResultIndexes = new Set<number>()
  const pairs: Pair[] = []

  const markPair = (call: IndexedEvent, result: IndexedEvent) => {
    pairs.push({ call, result })
    pairedCallIndexes.add(call.index)
    pairedResultIndexes.add(result.index)
  }

  // Pass 1: exact toolCallId within same session
  const resultsById = new Map<string, IndexedEvent[]>()
  for (const result of results) {
    const id = getMetaString(result.event, 'toolCallId')
    if (!id) continue
    const key = `${result.event.sessionId}::${id}`
    const list = resultsById.get(key) ?? []
    list.push(result)
    resultsById.set(key, list)
  }

  for (const call of calls) {
    if (pairedCallIndexes.has(call.index)) continue
    const id = getMetaString(call.event, 'toolCallId')
    if (!id) continue
    const key = `${call.event.sessionId}::${id}`
    const candidates = resultsById.get(key)
    if (!candidates || candidates.length === 0) continue
    const matchIndex = candidates.findIndex((candidate) => !pairedResultIndexes.has(candidate.index))
    if (matchIndex < 0) continue
    const [match] = candidates.splice(matchIndex, 1)
    markPair(call, match)
  }

  // Pass 2: turnId ordinal pairing
  const unpairedCallsByTurn = new Map<string, IndexedEvent[]>()
  const unpairedResultsByTurn = new Map<string, IndexedEvent[]>()

  for (const call of calls) {
    if (pairedCallIndexes.has(call.index)) continue
    const turnId = getMetaString(call.event, 'turnId')
    if (!turnId) continue
    const key = `${call.event.sessionId}::${turnId}`
    const list = unpairedCallsByTurn.get(key) ?? []
    list.push(call)
    unpairedCallsByTurn.set(key, list)
  }

  for (const result of results) {
    if (pairedResultIndexes.has(result.index)) continue
    const turnId = getMetaString(result.event, 'turnId')
    if (!turnId) continue
    const key = `${result.event.sessionId}::${turnId}`
    const list = unpairedResultsByTurn.get(key) ?? []
    list.push(result)
    unpairedResultsByTurn.set(key, list)
  }

  for (const [key, turnCalls] of unpairedCallsByTurn) {
    const turnResults = unpairedResultsByTurn.get(key) ?? []
    const count = Math.min(turnCalls.length, turnResults.length)
    for (let i = 0; i < count; i += 1) {
      const call = turnCalls[i]
      const result = turnResults[i]
      if (pairedCallIndexes.has(call.index) || pairedResultIndexes.has(result.index)) continue
      markPair(call, result)
    }
  }

  // Pass 3: sequential fallback per session
  const remainingCallsBySession = new Map<string, IndexedEvent[]>()
  const remainingResultsBySession = new Map<string, IndexedEvent[]>()

  for (const call of calls) {
    if (pairedCallIndexes.has(call.index)) continue
    const list = remainingCallsBySession.get(call.event.sessionId) ?? []
    list.push(call)
    remainingCallsBySession.set(call.event.sessionId, list)
  }
  for (const result of results) {
    if (pairedResultIndexes.has(result.index)) continue
    const list = remainingResultsBySession.get(result.event.sessionId) ?? []
    list.push(result)
    remainingResultsBySession.set(result.event.sessionId, list)
  }

  for (const [sessionId, sessionCalls] of remainingCallsBySession) {
    const sessionResults = remainingResultsBySession.get(sessionId) ?? []
    for (const call of sessionCalls) {
      if (pairedCallIndexes.has(call.index)) continue
      const match = sessionResults.find(
        (result) =>
          !pairedResultIndexes.has(result.index) && canPairByConstraints(call.event, result.event),
      )
      if (!match) continue
      markPair(call, match)
    }
  }

  for (const call of calls) {
    if (!pairedCallIndexes.has(call.index)) pairs.push({ call })
  }
  for (const result of results) {
    if (!pairedResultIndexes.has(result.index)) pairs.push({ result })
  }

  type Placed = { sortIndex: number; item: ChatStreamItem }
  const placed: Placed[] = []

  for (const [index, event] of messageIndexes) {
    placed.push({
      sortIndex: index,
      item: { kind: 'message', key: event.eventId, event },
    })
  }

  for (const pair of pairs) {
    const sortIndex = Math.min(
      pair.call?.index ?? Number.POSITIVE_INFINITY,
      pair.result?.index ?? Number.POSITIVE_INFINITY,
    )
    placed.push({ sortIndex, item: projectToolItem(pair) })
  }

  placed.sort((a, b) => a.sortIndex - b.sortIndex)
  return placed.map((entry) => entry.item)
}
