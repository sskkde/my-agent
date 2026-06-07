/**
 * Command result formatters
 * Converts CommandResult to ConsoleTimelineEvent for display in the timeline
 */

import type { ConsoleTimelineEvent } from '../api/types.js'
import type { FrontendCommandResult } from './types.js'

/** localStorage key for command event counter */
const EVENT_COUNTER_KEY = 'agent-platform.console.commandEventCounter'

/**
 * Get the next counter value for event IDs
 * Uses a session counter stored in localStorage for uniqueness
 */
function getNextCounter(): number {
  try {
    const current = parseInt(localStorage.getItem(EVENT_COUNTER_KEY) || '0', 10)
    const next = (isNaN(current) ? 0 : current) + 1
    localStorage.setItem(EVENT_COUNTER_KEY, String(next))
    return next
  } catch {
    // If localStorage is not available, use timestamp-based fallback
    return Date.now() % 10000
  }
}

/**
 * Sanitizes command output for safe display
 * - Removes ANSI escape codes
 * - Limits length to prevent overflow
 * - Ensures content is a string
 */
function sanitizeOutput(output: string | undefined | { type: string; content: string }): string {
  if (!output) {
    return ''
  }

  // Handle object output format
  const contentString = typeof output === 'string' ? output : output.content

  // Remove ANSI escape codes
  const cleaned = contentString
    .replace(/\u001b\[[0-9;]*m/g, '') // ANSI color codes
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') // Other ANSI sequences
    .replace(/\x1b\[[0-9;]*m/g, '') // Alternative escape sequences

  // Limit length to reasonable maximum
  const MAX_LENGTH = 10000
  if (cleaned.length > MAX_LENGTH) {
    return cleaned.substring(0, MAX_LENGTH) + '\n... (output truncated)'
  }

  return cleaned
}

/**
 * Creates a ConsoleTimelineEvent from a CommandResult
 *
 * @param result - The command result to convert
 * @param sessionId - The session ID for the event context
 * @returns A ConsoleTimelineEvent suitable for timeline display
 */
export function createCommandEvent(result: FrontendCommandResult, sessionId: string): ConsoleTimelineEvent {
  const counter = getNextCounter()
  const timestamp = new Date().toISOString()

  // Determine event type based on success/failure
  const eventType = result.success ? 'system_status' : 'error'

  // Build event content
  let content: string
  if (result.success) {
    content = sanitizeOutput(result.output)
  } else {
    content = sanitizeOutput(result.error) || 'Command failed'
  }

  return {
    eventId: `local-command-${Date.now()}-${counter}`,
    eventType,
    sessionId,
    timestamp,
    content,
    actor: 'command',
    metadata: {
      commandName: result.commandName,
      success: result.success,
    },
  }
}
