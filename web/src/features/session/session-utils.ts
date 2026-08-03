/**
 * Session Console Utilities
 *
 * Pure utility functions for session console operations including:
 * - Local message event creation
 * - Server message counting and comparison
 * - Timeline event filtering
 * - Date formatting
 */

import type { ConsoleTimelineEvent } from '../../api/types'
import { LOCAL_USER_MESSAGE_PREFIX, DATE_FORMAT_LOCALE, DATE_FORMAT_OPTIONS } from './session-constants'

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Represents a pending assistant placeholder shown while waiting for
 * the assistant to begin responding.
 */
export interface AssistantPlaceholder {
  sessionId: string
  timestamp: number
}

/**
 * Represents a streaming draft being accumulated from token-by-token SSE events.
 *
 * A single assistant turn may produce multiple draft segments when tools run mid-stream:
 * seal the current segment on tool_call, then open a new segment for post-tool tokens so
 * the live UI keeps tools interleaved (OpenCode-style) instead of pinning tools under the
 * growing bubble.
 */
export interface StreamingDraft {
  sessionId: string
  content: string
  sequence: number
  timestamp: number
  /** Segment index within an attempt (0 = first text block before any tool). */
  segment: number
  /** When true, further tokens open a new segment instead of appending. */
  sealed: boolean
  /** Kernel attempt / turn id this draft belongs to. */
  attemptId: string
}

// ============================================================================
// Local Message Event Creation
// ============================================================================

/**
 * Creates a local user message event for optimistic UI updates.
 * These events are client-generated and marked as pending until confirmed by the server.
 *
 * @param sessionId - The session ID this message belongs to
 * @param content - The message content
 * @param baselineServerMessageCount - The count of server messages with this content at send time
 * @returns A ConsoleTimelineEvent representing the local message
 */
export const createLocalUserMessageEvent = (
  sessionId: string,
  content: string,
  baselineServerMessageCount: number,
): ConsoleTimelineEvent => ({
  eventId: `${LOCAL_USER_MESSAGE_PREFIX}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  eventType: 'user_message',
  sessionId,
  timestamp: new Date().toISOString(),
  content,
  metadata: {
    localOnly: true,
    status: 'pending',
    baselineServerMessageCount,
  },
  actor: 'user',
})

// ============================================================================
// Server Message Counting
// ============================================================================

/**
 * Counts how many server user messages exist with a specific content.
 * Used to determine if a local message has been confirmed by the server.
 *
 * @param events - Array of timeline events to search
 * @param content - The message content to match
 * @returns The count of matching server user messages
 */
export const countServerUserMessagesByContent = (events: ConsoleTimelineEvent[], content: string): number =>
  events.filter((event) => event.eventType === 'user_message' && event.content === content).length

/**
 * Extracts the baseline server message count from a local event's metadata.
 * This represents how many server messages with the same content existed when the local message was sent.
 *
 * @param event - The timeline event to extract from
 * @returns The baseline count, or 0 if not present
 */
export const getBaselineServerMessageCount = (event: ConsoleTimelineEvent): number => {
  const value = event.metadata?.baselineServerMessageCount
  return typeof value === 'number' ? value : 0
}

// ============================================================================
// Message Confirmation Helpers
// ============================================================================

/**
 * Determines if a local message has been confirmed by the server.
 * A local message is confirmed when the server has more messages with the same content
 * than the baseline count recorded when the local message was sent.
 *
 * @param serverEvents - Array of server timeline events
 * @param localEvent - The local message event to check
 * @returns true if the local message is confirmed, false otherwise
 */
export const isLocalMessageConfirmed = (
  serverEvents: ConsoleTimelineEvent[],
  localEvent: ConsoleTimelineEvent,
): boolean => {
  if (!localEvent.content) return false
  return countServerUserMessagesByContent(serverEvents, localEvent.content) > getBaselineServerMessageCount(localEvent)
}

/**
 * Checks if there's an assistant message or error reply after a given local message.
 * Used to determine if we should stop polling for responses.
 *
 * @param serverEvents - Array of server timeline events
 * @param localEvent - The local message event to check after
 * @returns true if there's an assistant/error reply after the local message, false otherwise
 */
export const hasAssistantOrErrorReplyAfter = (
  serverEvents: ConsoleTimelineEvent[],
  localEvent: ConsoleTimelineEvent,
): boolean => {
  const sentAt = new Date(localEvent.timestamp).getTime()
  return serverEvents.some((event) => {
    if (!['assistant_message', 'error'].includes(event.eventType)) return false
    return new Date(event.timestamp).getTime() >= sentAt
  })
}

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Formats a date string for display in the session console.
 * Uses Chinese locale with short month, numeric day, and time.
 *
 * @param dateString - ISO date string to format
 * @returns Formatted date string (e.g., "6月 8日 14:30")
 */
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  return date.toLocaleDateString(DATE_FORMAT_LOCALE, DATE_FORMAT_OPTIONS)
}

// ============================================================================
// Streaming draft / placeholder cleanup
// ============================================================================

/**
 * Clear pending assistant placeholders and streaming drafts by attempt ids.
 * When no id matches and clearOldestIfUnmatched is true, drop the oldest
 * entry for the given session so final assistant_message events without
 * attemptId still replace the live draft (avoids "previous message reappears").
 */
export function clearStreamingActivityMaps<T extends { sessionId: string }>(
  map: Map<string, T>,
  attemptIds: Array<string | undefined>,
  options: { clearOldestIfUnmatched?: boolean; sessionId?: string | null } = {},
): Map<string, T> {
  const ids = attemptIds.filter((id): id is string => Boolean(id))
  const clearOldestIfUnmatched = options.clearOldestIfUnmatched === true
  const sessionId = options.sessionId ?? null

  if (ids.length === 0 && !clearOldestIfUnmatched) {
    return map
  }

  const next = new Map(map)
  const sizeBefore = next.size
  for (const id of ids) next.delete(id)
  const matchedAny = next.size < sizeBefore

  if (!matchedAny && clearOldestIfUnmatched) {
    const oldestId = Array.from(next.entries()).find(([, entry]) => !sessionId || entry.sessionId === sessionId)?.[0]
    if (oldestId) next.delete(oldestId)
  }

  return next.size === map.size ? map : next
}

function activeDraftsInSession(
  drafts: Map<string, StreamingDraft>,
  sessionId: string | null,
): Array<[string, StreamingDraft]> {
  return Array.from(drafts.entries()).filter(([, draft]) => !sessionId || draft.sessionId === sessionId)
}

/**
 * Decide whether a server terminal event (assistant_message / error) should be
 * allowed to clear streaming drafts at all.
 *
 * - Historical events (SSE snapshot, REST fetchTimeline) must carry metadata
 *   that identifies the turn. Without attemptId/turnId they cannot be safely
 *   linked to a live draft, so we never fall back to clearing the oldest draft.
 * - Live events are always candidates for clearing; the precise match vs.
 *   fallback decision lives in clearDraftsForTerminalEvent.
 */
export function shouldClearDraftOnServerEvent(event: ConsoleTimelineEvent, source: 'live' | 'historical'): boolean {
  const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined
  const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
  if (source === 'historical') {
    // Historical events must carry matching metadata to clear anything.
    return Boolean(attemptId || turnId)
  }
  return true
}

/**
 * Clear streaming drafts in response to a terminal server event.
 *
 * Rules:
 * 1. If the event metadata contains attemptId or turnId, clear every draft
 *    segment and reasoning draft belonging to that id.
 * 2. For historical events the oldest fallback is never used, even if requested.
 * 3. For live events with no matching ids, the oldest fallback is used only when
 *    explicitly allowed AND the session has exactly one active draft. This is the
 *    documented branch for "terminal reply for the only active draft in the
 *    session"; it preserves drafts when multiple turns are in flight while
 *    avoiding a zombie draft when a lone turn finalizes without metadata.
 */
export function clearDraftsForTerminalEvent(
  drafts: Map<string, StreamingDraft>,
  event: ConsoleTimelineEvent,
  options: {
    allowOldestFallback: boolean
    sessionId?: string | null
    source?: 'live' | 'historical'
  },
): Map<string, StreamingDraft> {
  const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined
  const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
  const sessionId = options.sessionId ?? null
  const source = options.source ?? 'live'
  const allowOldestFallback = source === 'historical' ? false : options.allowOldestFallback === true

  const ids = [attemptId, turnId].filter((id): id is string => Boolean(id))
  const clearedById = clearStreamingDraftsByAttemptIds(drafts, ids)
  if (clearedById !== drafts) return clearedById

  // Live-only single-active-draft fallback: only clear the oldest (and only)
  // draft when this terminal event is clearly the reply for the lone active
  // turn in the session. Never used for historical events.
  if (allowOldestFallback) {
    const active = activeDraftsInSession(drafts, sessionId)
    if (active.length === 1) {
      const next = new Map(drafts)
      next.delete(active[0][0])
      return next
    }
  }

  return drafts
}

// ============================================================================
// Streaming draft segments (tool interleaving)
// ============================================================================

/** Map key for a draft segment: attemptId#segment */
export function streamingDraftKey(attemptId: string, segment: number): string {
  return `${attemptId}#${segment}`
}

export function parseStreamingDraftKey(key: string): { attemptId: string; segment: number } | null {
  const idx = key.lastIndexOf('#')
  if (idx <= 0) {
    // Legacy key = bare attemptId → segment 0
    return { attemptId: key, segment: 0 }
  }
  const attemptId = key.slice(0, idx)
  const segment = Number(key.slice(idx + 1))
  if (!attemptId || !Number.isFinite(segment)) return null
  return { attemptId, segment }
}

function listDraftEntriesForAttempt(
  drafts: Map<string, StreamingDraft>,
  attemptId: string,
): Array<[string, StreamingDraft]> {
  const matches: Array<[string, StreamingDraft]> = []
  for (const [key, draft] of drafts) {
    if (draft.attemptId === attemptId || key === attemptId || key.startsWith(`${attemptId}#`)) {
      matches.push([key, draft])
    }
  }
  matches.sort((a, b) => a[1].segment - b[1].segment)
  return matches
}

/**
 * Append a token delta to the active (unsealed) draft segment for this attempt.
 * If the latest segment is sealed, open a new segment timestamped so it sorts
 * after intervening tool_call events. `anchorTimestamp` is the server-assigned
 * token timestamp (ms) — anchoring client drafts to server clock keeps the
 * timestamp-primary sort stable across client/server clock skew.
 */
export function appendStreamingToken(
  prev: Map<string, StreamingDraft>,
  token: {
    attemptId: string
    sessionId: string
    sequence: number
    delta: string
    channel?: 'assistant' | 'reasoning'
  },
  anchorTimestamp?: number,
): Map<string, StreamingDraft> {
  if (token.channel === 'reasoning') {
    return prev
  }

  const entries = listDraftEntriesForAttempt(prev, token.attemptId)
  const latest = entries.length > 0 ? entries[entries.length - 1] : undefined

  if (latest) {
    const [key, draft] = latest
    if (!draft.sealed) {
      if (token.sequence <= draft.sequence) return prev
      const next = new Map(prev)
      next.set(key, {
        ...draft,
        content: draft.content + token.delta,
        sequence: token.sequence,
      })
      return next
    }
  }

  // No active segment (or latest sealed) → open a new segment after tools.
  const segment = latest ? latest[1].segment + 1 : 0
  const key = streamingDraftKey(token.attemptId, segment)
  const next = new Map(prev)
  // Drop legacy bare-attempt key if present
  next.delete(token.attemptId)
  const now = Date.now()
  const anchor = anchorTimestamp ?? now
  // Ensure post-tool segments sort after the sealed pre-tool bubble (and typical tool events).
  const minTs = latest ? latest[1].timestamp + 2 : anchor
  next.set(key, {
    sessionId: token.sessionId,
    attemptId: token.attemptId,
    content: token.delta,
    sequence: token.sequence,
    timestamp: segment === 0 ? anchor : Math.max(anchor, minTs),
    segment,
    sealed: false,
  })
  return next
}

/**
 * Seal active streaming drafts for a turn when a tool_call arrives so subsequent
 * tokens form a new segment below the tool card.
 */
export function sealStreamingDraftsForTool(
  prev: Map<string, StreamingDraft>,
  options: { sessionId: string; attemptId?: string; turnId?: string },
): Map<string, StreamingDraft> {
  const targetIds = [options.attemptId, options.turnId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  )

  let changed = false
  const next = new Map(prev)

  // Always seal matching attempt/turn drafts first.
  for (const id of targetIds) {
    for (const [key, draft] of listDraftEntriesForAttempt(prev, id)) {
      if (!draft.sealed) {
        next.set(key, { ...draft, sealed: true })
        changed = true
      }
    }
  }

  // Also seal every unsealed draft in this session. Live UI only has one active
  // turn; id mismatches (placeholder vs runId) must not leave a growing bubble
  // that sorts above tools forever.
  for (const [key, draft] of next) {
    if (draft.sessionId === options.sessionId && !draft.sealed) {
      next.set(key, { ...draft, sealed: true })
      changed = true
    }
  }

  return changed ? next : prev
}

/**
 * Clear all draft segments belonging to any of the given attempt/turn ids.
 */
export function clearStreamingDraftsByAttemptIds(
  prev: Map<string, StreamingDraft>,
  attemptIds: Array<string | undefined>,
): Map<string, StreamingDraft> {
  const ids = new Set(attemptIds.filter((id): id is string => Boolean(id)))
  if (ids.size === 0) return prev
  let changed = false
  const next = new Map(prev)
  for (const [key, draft] of prev) {
    if (ids.has(draft.attemptId) || ids.has(key) || [...ids].some((id) => key.startsWith(`${id}#`))) {
      next.delete(key)
      changed = true
    }
  }
  return changed ? next : prev
}

/**
 * Upsert a timeline event for scheme-1 tool_call identity:
 * - Same eventId → replace in place
 * - Formal tool_call may replace an early tool_call for the same turn + toolCallIndex
 * - Formal tool_call may drop early card referenced by metadata.replacesEarlyEventId
 */
export function upsertTimelineEvent(prev: ConsoleTimelineEvent[], event: ConsoleTimelineEvent): ConsoleTimelineEvent[] {
  // Terminal thinking_summary (persisted, non-live) atomically replaces the live
  // streaming block for the same turn so the UI never renders two summaries.
  if (event.eventType === 'thinking_summary' && event.metadata?.live !== true) {
    const turnId = event.metadata?.turnId
    if (typeof turnId === 'string') {
      const withoutLive = prev.filter(
        (e) => !(e.eventType === 'thinking_summary' && e.metadata?.live === true && e.metadata?.turnId === turnId),
      )
      if (withoutLive.length !== prev.length) {
        prev = withoutLive
      }
    }
  }

  const byId = prev.findIndex((e) => e.eventId === event.eventId)
  if (byId >= 0) {
    const next = [...prev]
    next[byId] = event
    return next
  }

  if (event.eventType === 'tool_call') {
    const turnId = typeof event.metadata?.turnId === 'string' ? event.metadata.turnId : undefined
    const toolCallIndex = typeof event.metadata?.toolCallIndex === 'number' ? event.metadata.toolCallIndex : undefined
    const replacesEarlyEventId =
      typeof event.metadata?.replacesEarlyEventId === 'string' ? event.metadata.replacesEarlyEventId : undefined
    const isEarly = event.metadata?.early === true

    let next = prev
    if (replacesEarlyEventId) {
      next = next.filter((e) => e.eventId !== replacesEarlyEventId)
    }

    if (!isEarly && turnId !== undefined && toolCallIndex !== undefined) {
      const earlyIdx = next.findIndex(
        (e) =>
          e.eventType === 'tool_call' &&
          e.metadata?.early === true &&
          e.metadata?.turnId === turnId &&
          e.metadata?.toolCallIndex === toolCallIndex,
      )
      if (earlyIdx >= 0) {
        const replaced = [...next]
        replaced[earlyIdx] = event
        return replaced
      }
    }

    return [...next, event]
  }

  return [...prev, event]
}

/**
 * Merge server timeline events into local state, applying scheme-1 upserts so
 * formal tool_call events replace provisional early cards.
 */
export function mergeTimelineEvents(
  prev: ConsoleTimelineEvent[],
  incoming: ConsoleTimelineEvent[],
): ConsoleTimelineEvent[] {
  let next = prev
  for (const event of incoming) {
    next = upsertTimelineEvent(next, event)
  }
  return next
}

/**
 * Sort comparator for live chat: keep tool cards between sealed pre-tool drafts
 * and unsealed post-tool drafts even when timestamps are close/equal.
 */
export function compareTimelineEventsForChat(a: ConsoleTimelineEvent, b: ConsoleTimelineEvent): number {
  const ta = new Date(a.timestamp).getTime()
  const tb = new Date(b.timestamp).getTime()
  if (ta !== tb) return ta - tb

  const rank = (e: ConsoleTimelineEvent): number => {
    if (e.eventType === 'user_message') return 0
    if (e.metadata?.assistantPlaceholder === true) return 1
    if (e.eventType === 'thinking_summary') return 2
    if (e.metadata?.streamingDraft === true) {
      // Sealed pre-tool draft before tools; open draft after tools.
      return e.metadata?.sealed === true ? 3 : 6
    }
    if (e.eventType === 'tool_call') return 4
    if (e.eventType === 'tool_result') return 5
    if (e.eventType === 'assistant_message') return 7
    return 8
  }

  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb

  const segA = typeof a.metadata?.draftSegment === 'number' ? a.metadata.draftSegment : 0
  const segB = typeof b.metadata?.draftSegment === 'number' ? b.metadata.draftSegment : 0
  if (segA !== segB) return segA - segB

  const seqA = typeof a.metadata?.turnSequence === 'number' ? a.metadata.turnSequence : undefined
  const seqB = typeof b.metadata?.turnSequence === 'number' ? b.metadata.turnSequence : undefined
  if (seqA !== undefined && seqB !== undefined && seqA !== seqB) return seqA - seqB

  return a.eventId.localeCompare(b.eventId)
}
