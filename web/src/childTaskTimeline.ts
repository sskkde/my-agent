import type { ConsoleTimelineEvent } from './api/types'

/**
 * Child-task lifecycle events are persisted and broadcast on the PARENT
 * session's timeline (event.sessionId === parent session id) with the child
 * identity in metadata.taskId/childSessionId. A child event matches either by
 * its own session id or by that child metadata.
 */
export const isChildTimelineEvent = (event: ConsoleTimelineEvent, childSessionId: string): boolean => {
  if (event.sessionId === childSessionId) return true
  const metadata = event.metadata
  if (!metadata) return false
  return metadata.taskId === childSessionId || metadata.childSessionId === childSessionId
}

export const filterChildTimelineEvents = (
  events: readonly ConsoleTimelineEvent[],
  childSessionId: string,
): ConsoleTimelineEvent[] => events.filter((event) => isChildTimelineEvent(event, childSessionId))
