import type { ConsoleTimelineEvent } from './types.js';
import type { ConsoleTimelineService } from './console-timeline.js';

/**
 * Represents a connected SSE client for timeline events.
 */
export interface TimelineConnection {
  /** Unique identifier for this connection */
  connectionId: string;
  /** The session this connection is subscribed to */
  sessionId: string;
  /** Write an event to this connection */
  write(event: TimelineSseEvent): void;
  /** Close this connection */
  close(): void;
  /** Whether the connection is still active */
  isActive(): boolean;
}

/**
 * SSE event format for timeline events.
 */
export interface TimelineSseEvent {
  /** Event type for SSE id field */
  id?: string;
  /** Event name for SSE event field */
  event?: string;
  /** Event data payload */
  data: unknown;
}

/**
 * Options for subscribing to timeline events.
 */
export interface SubscribeOptions {
  /** Send events after this event ID (exclusive) for catch-up */
  afterEventId?: string;
  /** Last-Event-ID header value from client (takes precedence over after) */
  lastEventId?: string;
  /** Write function for SSE output (required for catch-up and broadcast) */
  write?: WriteFn;
  /** Close function for connection cleanup */
  closeFn?: () => void;
}

/**
 * Minimal timeline broadcaster for session-scoped SSE.
 * No token streaming, no presence tracking, no multi-topic pub/sub, no durable queue.
 */
export interface TimelineBroadcaster {
  /**
   * Subscribe to timeline events for a session.
   * Returns a connection object that can be used to write events.
   */
  subscribe(sessionId: string, options?: SubscribeOptions): TimelineConnection;

  /**
   * Broadcast an event to all active connections for a session.
   */
  broadcast(sessionId: string, event: ConsoleTimelineEvent): void;

  /**
   * Get the count of active connections for a session.
   */
  getConnectionCount(sessionId: string): number;

  /**
   * Close all connections for a session.
   */
  closeSession(sessionId: string): void;

  /**
   * Bind write and close functions to a connection.
   * This is called by the route handler after creating the connection.
   */
  bindConnection(connectionId: string, write: WriteFn, closeFn: () => void): void;
}

/**
 * Factory function type for creating write functions.
 */
export type WriteFn = (data: string) => boolean;

interface ConnectionState {
  connectionId: string;
  sessionId: string;
  write: WriteFn;
  closeFn: () => void;
  active: boolean;
}

/**
 * Creates a minimal timeline broadcaster.
 */
export interface CreateBroadcasterOptions {
  timelineService: ConsoleTimelineService;
}

class TimelineConnectionImpl implements TimelineConnection {
  private state: ConnectionState;

  constructor(state: ConnectionState) {
    this.state = state;
  }

  get connectionId(): string {
    return this.state.connectionId;
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  write(event: TimelineSseEvent): void {
    if (!this.state.active) return;

    let sseData = '';
    if (event.id) {
      sseData += `id: ${event.id}\n`;
    }
    if (event.event) {
      sseData += `event: ${event.event}\n`;
    }
    sseData += `data: ${JSON.stringify(event.data)}\n\n`;

    const success = this.state.write(sseData);
    if (!success) {
      this.state.active = false;
    }
  }

  close(): void {
    if (this.state.active) {
      this.state.active = false;
      this.state.closeFn();
    }
  }

  isActive(): boolean {
    return this.state.active;
  }
}

class TimelineBroadcasterImpl implements TimelineBroadcaster {
  private connections = new Map<string, ConnectionState>();
  private sessionConnections = new Map<string, Set<string>>();
  private timelineService: ConsoleTimelineService;

  constructor(options: CreateBroadcasterOptions) {
    this.timelineService = options.timelineService;
  }

  subscribe(sessionId: string, options: SubscribeOptions = {}): TimelineConnection {
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const state: ConnectionState = {
      connectionId,
      sessionId,
      write: options.write ?? (() => true),
      closeFn: options.closeFn ?? (() => {}),
      active: true,
    };

    this.connections.set(connectionId, state);

    if (!this.sessionConnections.has(sessionId)) {
      this.sessionConnections.set(sessionId, new Set());
    }
    this.sessionConnections.get(sessionId)!.add(connectionId);

    const afterEventId = options.lastEventId ?? options.afterEventId;

    if (afterEventId) {
      this.sendCatchUpEvents(connectionId, sessionId, afterEventId);
    }

    return new TimelineConnectionImpl(state);
  }

  private sendCatchUpEvents(connectionId: string, sessionId: string, afterEventId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.active) return;

    // Get all timeline events for this session
    const result = this.timelineService.getTimeline(sessionId);
    const events = result.events;

    // Find the index of the after event
    const afterIndex = events.findIndex(e => e.eventId === afterEventId);
    if (afterIndex === -1) {
      // If after event not found, send all events (client may have stale ID)
      // This is a safe fallback - client will dedupe by eventId
      for (const event of events) {
        this.sendEventToConnection(connection, event);
      }
    } else {
      // Send events after the afterEventId (exclusive)
      const eventsToSend = events.slice(afterIndex + 1);
      for (const event of eventsToSend) {
        this.sendEventToConnection(connection, event);
      }
    }
  }

  private sendEventToConnection(connection: ConnectionState, event: ConsoleTimelineEvent): void {
    if (!connection.active) return;

    const sseData = `id: ${event.eventId}\nevent: timeline_event\ndata: ${JSON.stringify(event)}\n\n`;
    const success = connection.write(sseData);
    if (!success) {
      connection.active = false;
    }
  }

  broadcast(sessionId: string, event: ConsoleTimelineEvent): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds || connectionIds.size === 0) return;

    const sseData = `id: ${event.eventId}\nevent: timeline_event\ndata: ${JSON.stringify(event)}\n\n`;

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.active) {
        const success = connection.write(sseData);
        if (!success) {
          connection.active = false;
        }
      }
    }
  }

  getConnectionCount(sessionId: string): number {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds) return 0;

    // Count only active connections
    let count = 0;
    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection?.active) {
        count++;
      }
    }
    return count;
  }

  closeSession(sessionId: string): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds) return;

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.active = false;
        connection.closeFn();
        this.connections.delete(connectionId);
      }
    }

    this.sessionConnections.delete(sessionId);
  }

  /**
   * Internal method to bind a write function to a connection.
   * This is called by the route handler after creating the connection.
   */
  bindConnection(connectionId: string, write: WriteFn, closeFn: () => void): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.write = write;
      connection.closeFn = closeFn;
    }
  }

  /**
   * Clean up closed connections (can be called periodically).
   */
  cleanup(): void {
    for (const [connectionId, connection] of this.connections) {
      if (!connection.active) {
        this.connections.delete(connectionId);
        const sessionConnections = this.sessionConnections.get(connection.sessionId);
        if (sessionConnections) {
          sessionConnections.delete(connectionId);
          if (sessionConnections.size === 0) {
            this.sessionConnections.delete(connection.sessionId);
          }
        }
      }
    }
  }
}

/**
 * Factory function to create a TimelineBroadcaster.
 */
export function createTimelineBroadcaster(options: CreateBroadcasterOptions): TimelineBroadcaster {
  return new TimelineBroadcasterImpl(options);
}

// Re-export types for convenience
export type { ConnectionState };
export { TimelineBroadcasterImpl };
