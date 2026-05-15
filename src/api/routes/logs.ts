import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../context.js';
import type { LogEntry, PaginatedResponse } from '../types.js';
import type { EventRecord, SensitivityLevel } from '../../storage/event-store.js';
import { success } from '../response-envelope.js';

interface LogsQueryParams {
  sessionId?: string;
  sourceModule?: string;
  eventType?: string;
  runRef?: string;
  limit?: string;
  offset?: string;
}

interface LogStreamQueryParams {
  sessionId?: string;
  after?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAYLOAD_PREVIEW_MAX_LENGTH = 200;

const ERROR_EVENT_TYPES = new Set([
  'error',
  'tool_execution_error',
  'kernel_error',
  'planner_error',
  'dispatcher_error',
  'run_failed',
  'workflow_failed',
  'subagent_failed',
  'permission_denied',
  'approval_rejected',
]);

const WARN_EVENT_TYPES = new Set([
  'run_cancelled',
  'workflow_cancelled',
  'subagent_cancelled',
  'approval_expired',
  'rate_limited',
  'memory_warning',
  'retry_attempt',
]);

function deriveSeverity(eventType: string): LogEntry['severity'] {
  if (ERROR_EVENT_TYPES.has(eventType)) {
    return 'error';
  }
  if (WARN_EVENT_TYPES.has(eventType)) {
    return 'warn';
  }
  return 'info';
}

function truncatePayload(payload: Record<string, unknown>): string {
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length <= PAYLOAD_PREVIEW_MAX_LENGTH) {
    return payloadStr;
  }
  return payloadStr.substring(0, PAYLOAD_PREVIEW_MAX_LENGTH) + '...';
}

function createPayloadPreview(
  event: EventRecord,
  sensitivity: SensitivityLevel
): string | undefined {
  if (sensitivity !== 'low') {
    return '[redacted]';
  }
  return truncatePayload(event.payload);
}

function mapEventToLogEntry(event: EventRecord): LogEntry {
  const summary = event.payload.message && typeof event.payload.message === 'string'
    ? event.payload.message
    : `${event.eventType} from ${event.sourceModule}`;

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    sourceModule: event.sourceModule,
    sessionId: event.sessionId,
    severity: deriveSeverity(event.eventType),
    summary,
    createdAt: event.createdAt,
    payloadPreview: createPayloadPreview(event, event.sensitivity),
  };
}

export function registerLogRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{
    Querystring: LogsQueryParams;
    Reply: { data: PaginatedResponse<LogEntry> };
  }>('/api/v1/logs', async (request, reply) => {
    const {
      sessionId,
      sourceModule,
      eventType,
      runRef,
      limit: limitStr,
      offset: offsetStr,
    } = request.query;

    const requestedLimit = limitStr ? parseInt(limitStr, 10) : DEFAULT_LIMIT;
    const limit = Math.min(requestedLimit, MAX_LIMIT);
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const events = context.stores.eventStore.query({
      sessionId,
      sourceModule,
      eventType,
      runId: runRef,
      limit,
      offset,
    });

    const totalEvents = context.stores.eventStore.query({
      sessionId,
      sourceModule,
      eventType,
      runId: runRef,
    });

    const logs = events.map(mapEventToLogEntry);

    const response: PaginatedResponse<LogEntry> = {
      items: logs,
      total: totalEvents.length,
      limit,
      offset,
      hasMore: offset + logs.length < totalEvents.length,
    };

    return reply.code(200).send(success(response, request.requestId));
  });

  server.get<{
    Querystring: LogStreamQueryParams;
  }>('/api/v1/logs/stream', async (request, reply) => {
    const { sessionId, after } = request.query;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const events = context.stores.eventStore.query({
      sessionId,
      limit: 100,
    });

    // Filter events after the specified eventId if provided
    let filteredEvents = events;
    if (after) {
      const afterIndex = events.findIndex(e => e.eventId === after);
      if (afterIndex !== -1) {
        filteredEvents = events.slice(afterIndex + 1);
      }
    }

    const logs = filteredEvents
      .filter(e => e.sensitivity === 'low')
      .map(mapEventToLogEntry);

    const snapshotEvent = {
      type: 'snapshot',
      logs,
      timestamp: new Date().toISOString(),
    };

    reply.raw.write(`data: ${JSON.stringify(snapshotEvent)}\n\n`);

    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`
        );
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 5000);

    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  });
}
