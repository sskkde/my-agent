import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from './types.js';
import type { ConsoleTimelineService } from './console-timeline.js';

export type SseEnvelope =
  | { type: 'snapshot'; events: ConsoleTimelineEvent[]; timestamp: string }
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'timeline_event'; event: ConsoleTimelineEvent; timestamp: string }
  | { type: 'processing_status'; status: ProcessingStatusPayload }
  | { type: 'token_stream'; token: TokenStreamPayload };

export interface TimelineConnection {
  connectionId: string;
  sessionId: string;
  write(event: TimelineSseEvent): void;
  close(): void;
  isActive(): boolean;
}

export interface TimelineSseEvent {
  id?: string;
  event?: string;
  data: unknown;
}

export interface SubscribeOptions {
  afterEventId?: string;
  lastEventId?: string;
  write?: WriteFn;
  closeFn?: () => void;
}

export interface TimelineBroadcaster {
  subscribe(sessionId: string, options?: SubscribeOptions): TimelineConnection;
  broadcast(sessionId: string, event: ConsoleTimelineEvent): void;
  broadcastProcessingStatus(sessionId: string, status: ProcessingStatusPayload): void;
  broadcastTokenStream(sessionId: string, token: TokenStreamPayload): void;
  getConnectionCount(sessionId: string): number;
  closeSession(sessionId: string): void;
  bindConnection(connectionId: string, write: WriteFn, closeFn: () => void): void;
}

export type WriteFn = (data: string) => boolean;

interface ConnectionState {
  connectionId: string;
  sessionId: string;
  write: WriteFn;
  closeFn: () => void;
  active: boolean;
}

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

    const result = this.timelineService.getTimeline(sessionId);
    const events = result.events;

    const afterIndex = events.findIndex(e => e.eventId === afterEventId);
    if (afterIndex === -1) {
      for (const event of events) {
        this.sendEventToConnection(connection, event);
      }
    } else {
      const eventsToSend = events.slice(afterIndex + 1);
      for (const event of eventsToSend) {
        this.sendEventToConnection(connection, event);
      }
    }
  }

  private sendEventToConnection(connection: ConnectionState, event: ConsoleTimelineEvent): void {
    if (!connection.active) return;

    const envelope: SseEnvelope = {
      type: 'timeline_event',
      event,
      timestamp: new Date().toISOString(),
    };
    const sseData = `id: ${event.eventId}\nevent: timeline_event\ndata: ${JSON.stringify(envelope)}\n\n`;
    const success = connection.write(sseData);
    if (!success) {
      connection.active = false;
    }
  }

  broadcast(sessionId: string, event: ConsoleTimelineEvent): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds || connectionIds.size === 0) return;

    const envelope: SseEnvelope = {
      type: 'timeline_event',
      event,
      timestamp: new Date().toISOString(),
    };
    const sseData = `id: ${event.eventId}\nevent: timeline_event\ndata: ${JSON.stringify(envelope)}\n\n`;

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

  broadcastProcessingStatus(sessionId: string, status: ProcessingStatusPayload): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds || connectionIds.size === 0) return;

    const envelope: SseEnvelope = {
      type: 'processing_status',
      status,
    };
    const sseData = `data: ${JSON.stringify(envelope)}\n\n`;

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.active) {
        connection.write(sseData);
      }
    }
  }

  broadcastTokenStream(sessionId: string, token: TokenStreamPayload): void {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds || connectionIds.size === 0) return;

    const envelope: SseEnvelope = {
      type: 'token_stream',
      token,
    };
    const sseData = `data: ${JSON.stringify(envelope)}\n\n`;

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.active) {
        connection.write(sseData);
      }
    }
  }

  getConnectionCount(sessionId: string): number {
    const connectionIds = this.sessionConnections.get(sessionId);
    if (!connectionIds) return 0;

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

  bindConnection(connectionId: string, write: WriteFn, closeFn: () => void): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.write = write;
      connection.closeFn = closeFn;
    }
  }

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

export function createTimelineBroadcaster(options: CreateBroadcasterOptions): TimelineBroadcaster {
  return new TimelineBroadcasterImpl(options);
}

export type { ConnectionState };
export { TimelineBroadcasterImpl };
