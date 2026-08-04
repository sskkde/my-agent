import type { ChildTaskStatus, ConsoleTimelineEvent } from '../../../api/types'
import {
  getChildTaskCardKey,
  getChildTaskId,
  getChildTaskLifecycleStatus,
  isChildTaskLifecycleEvent,
} from '../session-utils'
import {
  extractDurationMs,
  extractChildTaskMeta,
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
  taskId?: string
  childSessionId?: string
  parentSessionId?: string
  launchMode?: 'foreground' | 'background'
  taskStatus?: ChildTaskStatus
}

export type ChatStreamTaskItem = {
  kind: 'task'
  key: string
  taskId: string
  childSessionId?: string
  runId?: string
  agentProfile?: string
  launchMode?: 'foreground' | 'background'
  status: ChildTaskStatus
  progress?: number
  safeMessage?: string
  event: ConsoleTimelineEvent
}

export type ChatStreamItem = ChatStreamMessageItem | ChatStreamToolItem | ChatStreamTaskItem

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

  const toolName = extractToolName(call, result)
  const taskMeta =
    toolName === 'foreground_launch_subagent'
      ? extractChildTaskMeta(call, result, extractResultText(result, call))
      : {}
  const taskId = taskMeta.taskId ?? taskMeta.childSessionId
  const launchMode = taskMeta.launchMode ?? (toolName === 'foreground_launch_subagent' && taskId ? 'foreground' : undefined)
  const taskStatus = taskId ? (taskMeta.status ?? normalizeToolStatus(statusEvent)) : undefined
  return {
    kind: 'tool',
    key: stableToolKey(keyEvent) ?? keyEvent.eventId,
    call,
    result,
    toolName,
    parameters,
    resultText: extractResultText(result, call),
    status: normalizeToolStatus(statusEvent),
    durationMs: extractDurationMs(result, call),
    ...(taskId ? { taskId } : {}),
    ...(taskMeta.childSessionId ? { childSessionId: taskMeta.childSessionId } : {}),
    ...(keyEvent.sessionId ? { parentSessionId: keyEvent.sessionId } : {}),
    ...(launchMode ? { launchMode } : {}),
    ...(taskStatus ? { taskStatus } : {}),
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
  const taskIndexes = new Map<string, { index: number; event: ConsoleTimelineEvent }>()
  const calls: IndexedEvent[] = []
  const results: IndexedEvent[] = []

  events.forEach((event, index) => {
    if (isChildTaskLifecycleEvent(event)) {
      const taskKey = getChildTaskCardKey(event)
      if (taskKey) {
        const existing = taskIndexes.get(taskKey)
        if (!existing || shouldPreferTaskEvent(existing.event, event)) {
          taskIndexes.set(taskKey, { index: existing?.index ?? index, event })
        }
      }
      return
    }
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

  for (const [key, task] of taskIndexes) {
    const metadata = task.event.metadata
    placed.push({
      sortIndex: task.index,
      item: {
        kind: 'task',
        key,
        taskId: getChildTaskId(task.event) ?? key.slice('task-'.length),
        childSessionId: typeof metadata?.childSessionId === 'string' ? metadata.childSessionId : undefined,
        runId: typeof metadata?.runId === 'string' ? metadata.runId : undefined,
        agentProfile: typeof metadata?.agentProfile === 'string' ? metadata.agentProfile : undefined,
        launchMode: metadata?.launchMode === 'background' ? 'background' : metadata?.launchMode === 'foreground' ? 'foreground' : undefined,
        status: getChildTaskLifecycleStatus(task.event),
        progress: typeof metadata?.progress === 'number' ? metadata.progress : undefined,
        safeMessage: getSafeTaskMessage(task.event),
        event: task.event,
      },
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

const terminalStatuses = new Set<ChildTaskStatus>(['completed', 'failed', 'cancelled'])
const taskStatusRank: Record<ChildTaskStatus, number> = {
  queued: 0,
  running: 1,
  cancelled: 2,
  failed: 3,
  completed: 4,
}

const getSafeTaskMessage = (event: ConsoleTimelineEvent): string | undefined => {
  const safeMessage = event.metadata?.safeMessage
  if (typeof safeMessage === 'string' && safeMessage.trim()) return safeMessage
  const status = getChildTaskLifecycleStatus(event)
  if (status === 'failed') return '子任务执行失败，请稍后重试'
  if (status === 'cancelled') return '任务已取消'
  return undefined
}

const shouldPreferTaskEvent = (existing: ConsoleTimelineEvent, incoming: ConsoleTimelineEvent): boolean => {
  const existingStatus = getChildTaskLifecycleStatus(existing)
  const incomingStatus = getChildTaskLifecycleStatus(incoming)
  const existingTerminal = terminalStatuses.has(existingStatus)
  const incomingTerminal = terminalStatuses.has(incomingStatus)
  if (existingTerminal !== incomingTerminal) return incomingTerminal

  if (existingTerminal && incomingTerminal && taskStatusRank[existingStatus] !== taskStatusRank[incomingStatus]) {
    return taskStatusRank[incomingStatus] > taskStatusRank[existingStatus]
  }

  const existingTime = Date.parse(existing.timestamp)
  const incomingTime = Date.parse(incoming.timestamp)
  if (existingTerminal && incomingTerminal && existingTime !== incomingTime) return incomingTime > existingTime
  if (!existingTerminal && !incomingTerminal) {
    const existingProgress = typeof existing.metadata?.progress === 'number' ? existing.metadata.progress : -1
    const incomingProgress = typeof incoming.metadata?.progress === 'number' ? incoming.metadata.progress : -1
    if (incomingProgress !== existingProgress) return incomingProgress > existingProgress
  }
  if (taskStatusRank[existingStatus] !== taskStatusRank[incomingStatus]) {
    return taskStatusRank[incomingStatus] > taskStatusRank[existingStatus]
  }
  return incoming.eventId.localeCompare(existing.eventId) > 0
}
