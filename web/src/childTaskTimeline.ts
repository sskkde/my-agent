import type { ConsoleTimelineEvent } from './api/types'

export const isChildTimelineEvent = (event: ConsoleTimelineEvent, childSessionId: string): boolean =>
  event.sessionId === childSessionId

export const filterChildTimelineEvents = (
  events: readonly ConsoleTimelineEvent[],
  childSessionId: string,
): ConsoleTimelineEvent[] => events.filter((event) => isChildTimelineEvent(event, childSessionId))
