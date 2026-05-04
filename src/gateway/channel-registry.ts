import type { OutboundEnvelope } from './types.js';
import type { ChannelSummary } from '../api/types.js';
import type { TimelineBroadcaster } from '../api/timeline-broadcaster.js';
import type { ConsoleTimelineService } from '../api/console-timeline.js';

/**
 * Result type for channel delivery operations
 */
export interface DeliveryResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Channel handler contract - implementations must provide deliver method
 */
export interface ChannelHandler {
  /**
   * Deliver an outbound envelope to the channel
   * @param envelope - The outbound envelope to deliver
   * @returns DeliveryResult indicating success or controlled failure
   */
  deliver(envelope: OutboundEnvelope): DeliveryResult;
}

/**
 * Channel registration entry
 */
export interface ChannelEntry {
  id: string;
  handler: ChannelHandler;
  metadata: ChannelSummary;
}

/**
 * Channel registry interface
 */
export interface ChannelRegistry {
  /**
   * Register a channel handler
   * @param id - Unique channel identifier
   * @param handler - Channel handler implementation
   * @param metadata - Channel metadata for listing
   */
  register(id: string, handler: ChannelHandler, metadata?: Partial<ChannelSummary>): void;

  /**
   * Unregister a channel handler
   * @param id - Channel identifier to remove
   * @returns true if channel was found and removed
   */
  unregister(id: string): boolean;

  /**
   * Get a channel handler by ID
   * @param id - Channel identifier
   * @returns ChannelEntry or undefined if not found
   */
  get(id: string): ChannelEntry | undefined;

  /**
   * List all registered channels
   * @returns Array of channel summaries
   */
  list(): ChannelSummary[];

  /**
   * Check if a channel is registered
   * @param id - Channel identifier
   * @returns true if channel exists
   */
  has(id: string): boolean;

  /**
   * Deliver an envelope to a specific channel
   * @param channelId - Target channel identifier
   * @param envelope - Outbound envelope to deliver
   * @returns DeliveryResult - success or controlled failure for unknown channels
   */
  deliver(channelId: string, envelope: OutboundEnvelope): DeliveryResult;
}

/**
 * Create a new channel registry
 * @returns ChannelRegistry instance
 */
export function createChannelRegistry(): ChannelRegistry {
  const channels = new Map<string, ChannelEntry>();

  return {
    register(id: string, handler: ChannelHandler, metadata?: Partial<ChannelSummary>): void {
      const entry: ChannelEntry = {
        id,
        handler,
        metadata: {
          connectorId: id,
          type: metadata?.type ?? 'custom',
          status: metadata?.status ?? 'active',
          configured: metadata?.configured ?? true,
        },
      };
      channels.set(id, entry);
    },

    unregister(id: string): boolean {
      return channels.delete(id);
    },

    get(id: string): ChannelEntry | undefined {
      return channels.get(id);
    },

    list(): ChannelSummary[] {
      return Array.from(channels.values()).map(entry => entry.metadata);
    },

    has(id: string): boolean {
      return channels.has(id);
    },

    deliver(channelId: string, envelope: OutboundEnvelope): DeliveryResult {
      const entry = channels.get(channelId);

      if (!entry) {
        return {
          success: false,
          error: {
            code: 'CHANNEL_NOT_FOUND',
            message: `Channel '${channelId}' is not registered`,
          },
        };
      }

      try {
        const result = entry.handler.deliver(envelope);
        return result;
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'DELIVERY_ERROR',
            message: error instanceof Error ? error.message : 'Unknown delivery error',
          },
        };
      }
    },
  };
}

/**
 * Options for creating WebUI channel handler
 */
export interface WebUIChannelHandlerOptions {
  /** Timeline broadcaster for publishing events to SSE connections */
  timelineBroadcaster?: TimelineBroadcaster;
  /** Console timeline service for fetching events to broadcast */
  consoleTimelineService?: ConsoleTimelineService;
}

/**
 * WebUI channel handler - internal gateway-owned channel for web interface.
 * Publishes timeline events to the SSE broadcaster for delivery to connected clients.
 */
export function createWebUIChannelHandler(options: WebUIChannelHandlerOptions = {}): ChannelHandler {
  const { timelineBroadcaster, consoleTimelineService } = options;

  return {
    deliver(envelope: OutboundEnvelope): DeliveryResult {
      // If timeline services are available, broadcast events for this session
      if (timelineBroadcaster && consoleTimelineService) {
        try {
          const sessionId = envelope.recipient.sessionId;
          const correlationId = envelope.correlationId;

          // Get timeline events for this session
          const timeline = consoleTimelineService.getTimeline(sessionId);

          // Find events related to this correlation (the current turn)
          // Events are sorted by timestamp, so we find the ones matching this turn
          const relatedEvents = timeline.events.filter(event => {
            // Match by correlationId or turnId in metadata
            const metadata = event.metadata as Record<string, unknown> | undefined;
            return metadata?.turnId === correlationId || metadata?.correlationId === correlationId;
          });

          // Broadcast each related event to SSE connections
          for (const event of relatedEvents) {
            timelineBroadcaster.broadcast(sessionId, event);
          }
        } catch {
          // Best-effort broadcast - failures should not block delivery
          // The events are already persisted; clients can catch up on reconnect
        }
      }

      return {
        success: true,
      };
    },
  };
}
