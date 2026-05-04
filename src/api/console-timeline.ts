import type { TranscriptStore, TurnTranscript } from '../storage/transcript-store.js';
import type { EventStore, EventRecord } from '../storage/event-store.js';
import type {
  ConsoleTimelineEvent,
  ConsoleTimelineEventType,
  PaginationParams,
} from './types.js';

export interface ConsoleTimelineStores {
  transcriptStore: TranscriptStore;
  eventStore: EventStore;
}

export interface TimelineOptions extends PaginationParams {
  /** Optional filter for specific event types */
  eventTypes?: ConsoleTimelineEventType[];
}

export interface TimelineResult {
  events: ConsoleTimelineEvent[];
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Maps a transcript turn to console timeline events.
 *
 * Emits:
 * - user_message: for each turn's input (if userMessageSummary exists)
 * - assistant_message: for each visible message with role 'assistant'
 * - tool_call: for each toolCallSummary in runtimeSummary
 * - approval_request: for each approvalSummary in runtimeSummary
 * - artifact_created: for each artifactRef in output
 */
function mapTurnToTimelineEvents(turn: TurnTranscript): ConsoleTimelineEvent[] {
  const events: ConsoleTimelineEvent[] = [];
  const baseMetadata: Record<string, unknown> = {
    turnId: turn.turnId,
    userId: turn.userId,
  };

  // User message event from input
  if (turn.input.userMessageSummary) {
    events.push({
      eventId: `turn-${turn.turnId}-input`,
      eventType: 'user_message',
      sessionId: turn.sessionId,
      timestamp: turn.createdAt,
      content: turn.input.userMessageSummary,
      metadata: { ...baseMetadata },
      actor: turn.userId,
    });
  }

  // Assistant visible messages and thinking summaries
  if (turn.output.visibleMessages && turn.output.visibleMessages.length > 0) {
    turn.output.visibleMessages.forEach((msg, index) => {
      if (msg.role === 'assistant') {
        events.push({
          eventId: `turn-${turn.turnId}-msg-${index}`,
          eventType: 'assistant_message',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'assistant',
        });
      } else if (msg.role === 'thinking') {
        events.push({
          eventId: `turn-${turn.turnId}-thinking-${index}`,
          eventType: 'thinking_summary',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'assistant',
        });
      } else if (msg.role === 'system_status') {
        events.push({
          eventId: `turn-${turn.turnId}-status-${index}`,
          eventType: 'system_status',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'system',
        });
      } else if (msg.role === 'approval') {
        events.push({
          eventId: `turn-${turn.turnId}-approval-decision-${index}`,
          eventType: 'approval_decision',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'system',
        });
      } else if (msg.role === 'tool') {
        events.push({
          eventId: `turn-${turn.turnId}-tool-result-${index}`,
          eventType: 'tool_result',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'system',
        });
      } else if (msg.role === 'error') {
        events.push({
          eventId: `turn-${turn.turnId}-error-${index}`,
          eventType: 'error',
          sessionId: turn.sessionId,
          timestamp: turn.createdAt,
          content: msg.content,
          metadata: {
            ...baseMetadata,
            messageId: msg.messageId,
            messageIndex: index,
          },
          actor: 'system',
        });
      }
    });
  }

  // Tool call summaries
  if (turn.runtimeSummary?.toolCallSummaries && turn.runtimeSummary.toolCallSummaries.length > 0) {
    turn.runtimeSummary.toolCallSummaries.forEach((summary, index) => {
      events.push({
        eventId: `turn-${turn.turnId}-tool-${index}`,
        eventType: 'tool_call',
        sessionId: turn.sessionId,
        timestamp: turn.createdAt,
        content: summary,
        metadata: {
          ...baseMetadata,
          toolCallIndex: index,
        },
        actor: 'system',
      });
    });
  }

  // Approval summaries
  if (turn.runtimeSummary?.approvalSummaries && turn.runtimeSummary.approvalSummaries.length > 0) {
    turn.runtimeSummary.approvalSummaries.forEach((summary, index) => {
      events.push({
        eventId: `turn-${turn.turnId}-approval-${index}`,
        eventType: 'approval_request',
        sessionId: turn.sessionId,
        timestamp: turn.createdAt,
        content: summary,
        metadata: {
          ...baseMetadata,
          approvalIndex: index,
        },
        actor: 'system',
      });
    });
  }

  // Artifact references
  if (turn.output.artifactRefs && turn.output.artifactRefs.length > 0) {
    turn.output.artifactRefs.forEach((artifactRef, index) => {
      events.push({
        eventId: `turn-${turn.turnId}-artifact-${index}`,
        eventType: 'artifact_created',
        sessionId: turn.sessionId,
        timestamp: turn.createdAt,
        content: `Artifact created: ${artifactRef}`,
        metadata: {
          ...baseMetadata,
          artifactRef,
          artifactIndex: index,
        },
        actor: 'system',
      });
    });
  }

  return events;
}

/**
 * Maps EventStore events to console timeline events.
 *
 * Maps relevant event types:
 * - run_started, run_progress, run_completed, run_failed, run_cancelled
 * - error events
 * - Other events as system_status
 */
function mapEventRecordToTimelineEvent(event: EventRecord): ConsoleTimelineEvent | null {
  const eventType = event.eventType;
  const sessionId = event.sessionId;

  if (!sessionId) {
    return null;
  }

  // Map run events
  const runEventTypes: ConsoleTimelineEventType[] = [
    'run_started',
    'run_progress',
    'run_completed',
    'run_failed',
    'run_cancelled',
  ];

  if (runEventTypes.includes(eventType as ConsoleTimelineEventType)) {
    return {
      eventId: event.eventId,
      eventType: eventType as ConsoleTimelineEventType,
      sessionId,
      timestamp: event.createdAt,
      content: typeof event.payload?.message === 'string' ? event.payload.message : undefined,
      metadata: {
        ...event.payload,
        sourceModule: event.sourceModule,
        ...(event.relatedRefs || {}),
      },
      actor: event.sourceModule,
    };
  }

  // Map error events
  if (eventType === 'error' || eventType.endsWith('_error') || eventType.endsWith('_failed')) {
    return {
      eventId: event.eventId,
      eventType: 'error',
      sessionId,
      timestamp: event.createdAt,
      content: typeof event.payload?.error === 'string'
        ? event.payload.error
        : typeof event.payload?.message === 'string'
          ? event.payload.message
          : 'An error occurred',
      metadata: {
        originalEventType: eventType,
        ...event.payload,
        sourceModule: event.sourceModule,
      },
      actor: event.sourceModule || 'system',
    };
  }

  // Skip unknown/irrelevant event types for the console timeline
  return null;
}

/**
 * Service for building console timeline events from transcript and event store data.
 */
export interface ConsoleTimelineService {
  /**
   * Get timeline events for a session with pagination.
   */
  getTimeline(sessionId: string, options?: TimelineOptions): TimelineResult;
}

class ConsoleTimelineServiceImpl implements ConsoleTimelineService {
  private stores: ConsoleTimelineStores;

  constructor(stores: ConsoleTimelineStores) {
    this.stores = stores;
  }

  getTimeline(sessionId: string, options: TimelineOptions = {}): TimelineResult {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = options.offset ?? 0;
    const eventTypesFilter = options.eventTypes;

    // Collect all events from transcripts
    const transcriptEvents: ConsoleTimelineEvent[] = [];
    const turns = this.stores.transcriptStore.findBySession(sessionId);

    for (const turn of turns) {
      const events = mapTurnToTimelineEvents(turn);
      transcriptEvents.push(...events);
    }

    // Collect events from event store
    const storeEvents: ConsoleTimelineEvent[] = [];
    const eventRecords = this.stores.eventStore.query({ sessionId });

    for (const record of eventRecords) {
      const event = mapEventRecordToTimelineEvent(record);
      if (event) {
        storeEvents.push(event);
      }
    }

    // Merge and sort all events
    // Primary: createdAt ASC, Secondary: eventId for deterministic ordering
    const allEvents = [...transcriptEvents, ...storeEvents];
    allEvents.sort((a, b) => {
      const timeCompare = a.timestamp.localeCompare(b.timestamp);
      if (timeCompare !== 0) {
        return timeCompare;
      }
      return a.eventId.localeCompare(b.eventId);
    });

    // Apply event type filter if specified
    let filteredEvents = allEvents;
    if (eventTypesFilter && eventTypesFilter.length > 0) {
      filteredEvents = allEvents.filter(e => eventTypesFilter.includes(e.eventType));
    }

    const total = filteredEvents.length;

    // Apply pagination
    const paginatedEvents = filteredEvents.slice(offset, offset + limit);

    return {
      events: paginatedEvents,
      total,
    };
  }
}

/**
 * Factory function to create a ConsoleTimelineService.
 */
export function createConsoleTimelineService(stores: ConsoleTimelineStores): ConsoleTimelineService {
  return new ConsoleTimelineServiceImpl(stores);
}
