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
import {
  LOCAL_USER_MESSAGE_PREFIX,
  DATE_FORMAT_LOCALE,
  DATE_FORMAT_OPTIONS,
} from './session-constants'

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
 */
export interface StreamingDraft {
  sessionId: string
  content: string
  sequence: number
  timestamp: number
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
export const isLocalMessageConfirmed = (serverEvents: ConsoleTimelineEvent[], localEvent: ConsoleTimelineEvent): boolean => {
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
