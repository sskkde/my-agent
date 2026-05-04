import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type {
  SessionResponse,
  TranscriptsResponse,
  TranscriptTurn,
  SendMessageRequest,
  SendMessageResponse,
  ConsoleSessionInfo,
  PaginatedResponse,
  ConsoleTimelineEvent,
  ConsoleTimelineEventType,
  SetModelRequest,
} from '../types.js';
import type { Stores } from '../../gateway/types.js';
import type { SessionStore, Session } from '../../storage/session-store.js';
import type { ProviderConfigStore } from '../../storage/provider-config-store.js';
import type { ConsoleTimelineService, TimelineOptions } from '../console-timeline.js';
import { createConsoleTimelineService } from '../console-timeline.js';
import type { TimelineBroadcaster, TimelineConnection } from '../timeline-broadcaster.js';
import { convertInboundEnvelopeToProcessorInput } from '../../processing/message-processor.js';

interface CreateSessionBody {
  userId?: string;
}

interface SendMessageParams {
  sessionId: string;
}

interface ListSessionsQuery {
  status?: 'active' | 'archived' | 'closed';
  limit?: string;
  offset?: string;
}

interface PatchSessionBody {
  title?: string;
  status?: 'active' | 'archived' | 'closed';
}

interface TimelineQuery {
  limit?: string;
  offset?: string;
  eventTypes?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(value: string | undefined, defaultValue: number, maxValue: number): number {
  const parsed = parseInt(value ?? String(defaultValue), 10);
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function parseOffset(value: string | undefined): number {
  const parsed = parseInt(value ?? '0', 10);
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function sessionToConsoleSessionInfo(session: Session): ConsoleSessionInfo {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    title: session.title,
    status: session.status,
    messageCount: session.messageCount,
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    selectedModel: session.selectedModel,
    selectedProviderId: session.selectedProviderId,
  };
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function generateDefaultTitle(): string {
  return `New Session ${new Date().toLocaleString()}`;
}

export async function registerSessionsRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const sessionStore: SessionStore | undefined = 'stores' in context ? context.stores.sessionStore : undefined;
  const consoleTimelineService: ConsoleTimelineService | undefined = 'consoleTimelineService' in context
    ? context.consoleTimelineService
    : undefined;

  server.post<{ Body: CreateSessionBody }>(
    '/api/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      const sessionId = generateSessionId();

      const now = new Date().toISOString();

      if (sessionStore) {
        sessionStore.create({
          sessionId,
          userId,
          title: generateDefaultTitle(),
          status: 'active',
          messageCount: 0,
        });
      }

      const sessionInfo = {
        sessionId,
        userId,
        messageCount: 0,
        lastActivityAt: now,
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      };

      const response: SessionResponse = { session: sessionInfo };
      return reply.code(201).send({ data: response });
    }
  );

  server.get<{ Querystring: ListSessionsQuery }>(
    '/api/sessions',
    async (request: FastifyRequest<{ Querystring: ListSessionsQuery }>, reply: FastifyReply) => {
      const status = request.query.status;
      const limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const offset = parseOffset(request.query.offset);

      if (status && !['active', 'archived', 'closed'].includes(status)) {
        const error = ApiErrorFactory.badRequest('Invalid status filter. Must be one of: active, archived, closed');
        error.error.code = 'INVALID_STATUS_FILTER';
        return reply.code(400).send(error);
      }

      let sessions: Session[] = [];
      let total = 0;

      const userId = request.user?.userId ?? 'local-user';

      if (sessionStore) {
        sessions = sessionStore.list({
          userId,
          status,
          limit,
          offset,
        });
        total = sessionStore.getCount({ userId, status });
      }

      const items = sessions.map(sessionToConsoleSessionInfo);
      const response: PaginatedResponse<ConsoleSessionInfo> = {
        items,
        total,
        limit,
        offset,
      };

      return reply.code(200).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      const userId = request.user?.userId ?? persistedSession.userId ?? 'local-user';

      if ('gateway' in context) {
        const stores: Stores = {
          eventStore: {
            append: (event: unknown) => context.stores.eventStore.append(event as Parameters<typeof context.stores.eventStore.append>[0]),
            query: (filters: { sessionId?: string; eventType?: string }) => context.stores.eventStore.query(filters) as unknown[],
          },
          summaryStore: {
            getSessionMemory: (sessionId: string) => context.stores.summaryStore.getSessionMemory(sessionId),
          },
          transcriptStore: {
            findBySession: (sessionId: string) => context.stores.transcriptStore.findBySession(sessionId),
          },
          runtimeActionStore: {
            findBySessionId: (sessionId: string) => context.stores.runtimeActionStore.query({ sessionId }) as unknown as Array<{ actionId: string; status: string; targetRef?: Record<string, unknown> }>,
          },
        };
        const hydratedState = context.gateway.assembleHydratedState(userId, sessionId, stores);

        const sessionInfo = {
          sessionId,
          userId: hydratedState.userContext?.userId || persistedSession?.userId || userId,
          messageCount: persistedSession.messageCount ?? hydratedState.sessionContext?.messageCount ?? 0,
          lastActivityAt: persistedSession.lastActivityAt ?? hydratedState.sessionContext?.lastActivityAt ?? new Date().toISOString(),
          activePlannerRunIds: hydratedState.sessionContext?.activePlannerRunIds || [],
          activeBackgroundRunIds: hydratedState.sessionContext?.activeBackgroundRunIds || [],
          selectedModel: persistedSession.selectedModel,
          selectedProviderId: persistedSession.selectedProviderId,
        };

        const response: SessionResponse = { session: sessionInfo };
        return reply.code(200).send({ data: response });
      }

      const sessionInfo = {
        sessionId,
        userId: persistedSession?.userId || userId,
        messageCount: persistedSession?.messageCount || 0,
        lastActivityAt: persistedSession?.lastActivityAt || new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
        selectedModel: persistedSession?.selectedModel,
        selectedProviderId: persistedSession?.selectedProviderId,
      };

      const response: SessionResponse = { session: sessionInfo };
      return reply.code(200).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/transcripts',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      let transcripts: TranscriptTurn[] = [];
      let total = 0;

      if ('stores' in context && context.stores.transcriptStore) {
        const transcriptStore = context.stores.transcriptStore;
        transcripts = transcriptStore.findBySession(sessionId);
        total = transcripts.length;
      }

      const response: TranscriptsResponse = { transcripts, total };
      return reply.code(200).send({ data: response });
    }
  );

  server.post<{ Params: SendMessageParams; Body: SendMessageRequest }>(
    '/api/sessions/:sessionId/messages',
    async (request: FastifyRequest<{ Params: SendMessageParams; Body: SendMessageRequest }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const { text } = request.body || {};

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('Message text is required and cannot be empty or whitespace');
        error.error.code = 'INVALID_MESSAGE_TEXT';
        return reply.code(400).send(error);
      }

      if (!('gateway' in context)) {
        const error = ApiErrorFactory.internalError('Gateway not available');
        return reply.code(500).send(error);
      }

      const userId = request.user?.userId ?? persistedSession.userId ?? 'local-user';

      const envelope = context.gateway.receiveUserMessage(userId, sessionId, text, 'webui');
      const processorInput = convertInboundEnvelopeToProcessorInput(envelope);

      // Process message asynchronously and route outbound via Gateway
      context.messageProcessor.process(processorInput).then((output) => {
        // Format outbound envelope using Gateway-owned correlation state
        const messageType = output.success ? 'text' : 'error';
        const outboundEnvelope = context.gateway.formatOutbound(
          messageType,
          {
            text: output.success ? output.result?.text : undefined,
            error: output.success ? undefined : output.error,
          },
          {
            userId,
            sessionId,
            channel: envelope.sourceChannel, // Route back through original channel (webui)
          },
          envelope.envelopeId // Use envelopeId as correlationId for tracing
        );

        // Deliver via channel registry - this publishes to timeline/SSE for webui
        context.channelRegistry.deliver(envelope.sourceChannel, outboundEnvelope);
      }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown processing error';

        // Create error outbound envelope
        const errorEnvelope = context.gateway.formatOutbound(
          'error',
          {
            error: {
              code: 'PROCESSING_ERROR',
              message: errorMessage,
            },
          },
          {
            userId,
            sessionId,
            channel: envelope.sourceChannel,
          },
          envelope.envelopeId
        );

        // Deliver error via channel registry
        context.channelRegistry.deliver(envelope.sourceChannel, errorEnvelope);

        // Also record error in event store for audit
        context.stores.eventStore.append({
          eventId: `error-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          eventType: 'gateway_error',
          sourceModule: 'gateway',
          userId,
          sessionId,
          correlationId: envelope.envelopeId,
          payload: {
            error: errorMessage,
            phase: 'async_processing',
            envelopeId: envelope.envelopeId,
          },
          sensitivity: 'low',
          retentionClass: 'short',
          createdAt: new Date().toISOString(),
        });
      });

      const response: SendMessageResponse = {
        accepted: true,
        status: 'accepted',
        correlationId: envelope.envelopeId,
        envelopeId: envelope.envelopeId,
      };
      return reply.code(202).send({ data: response });
    }
  );

  server.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/resume',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      const now = new Date().toISOString();
      sessionStore?.updateActivity(sessionId, now);

      let recentTimeline: ConsoleTimelineEvent[] = [];
      if (consoleTimelineService) {
        const timelineResult = consoleTimelineService.getTimeline(sessionId, { limit: 10, offset: 0 });
        recentTimeline = timelineResult.events;
      }

      const response = {
        session: sessionToConsoleSessionInfo({
          ...persistedSession,
          lastActivityAt: now,
        }),
        timeline: recentTimeline,
      };

      return reply.code(200).send({ data: response });
    }
  );

  server.patch<{ Params: { sessionId: string }; Body: PatchSessionBody }>(
    '/api/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Body: PatchSessionBody }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const { title, status } = request.body || {};

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      if (status && !['active', 'archived', 'closed'].includes(status)) {
        const error = ApiErrorFactory.badRequest('Invalid status. Must be one of: active, archived, closed');
        error.error.code = 'INVALID_STATUS';
        return reply.code(400).send(error);
      }

      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        const error = ApiErrorFactory.badRequest('Title must be a non-empty string');
        error.error.code = 'INVALID_TITLE';
        return reply.code(400).send(error);
      }

      if (status) {
        sessionStore?.updateStatus(sessionId, status);
      }
      if (title) {
        sessionStore?.updateTitle(sessionId, title.trim());
      }

      const updatedSession = sessionStore?.getById(sessionId);
      if (!updatedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      const response = {
        session: sessionToConsoleSessionInfo(updatedSession),
      };

      return reply.code(200).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string }; Querystring: TimelineQuery }>(
    '/api/sessions/:sessionId/timeline',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Querystring: TimelineQuery }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const offset = parseOffset(request.query.offset);
      const eventTypesParam = request.query.eventTypes;

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      let eventTypes: ConsoleTimelineEventType[] | undefined;
      if (eventTypesParam) {
        eventTypes = eventTypesParam.split(',').map(t => t.trim()).filter(Boolean) as ConsoleTimelineEventType[];
      }

      let events: ConsoleTimelineEvent[] = [];
      let total = 0;

      if (consoleTimelineService) {
        const options: TimelineOptions = { limit, offset };
        if (eventTypes && eventTypes.length > 0) {
          options.eventTypes = eventTypes;
        }
        const result = consoleTimelineService.getTimeline(sessionId, options);
        events = result.events;
        total = result.total;
      }

      const response: PaginatedResponse<ConsoleTimelineEvent> = {
        items: events,
        total,
        limit,
        offset,
      };

      return reply.code(200).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string }; Querystring: { after?: string } }>(
    '/api/sessions/:sessionId/timeline/stream',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Querystring: { after?: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const { after } = request.query;
      const lastEventId = request.headers['last-event-id'] as string | undefined;

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const timelineBroadcaster: TimelineBroadcaster | undefined = context.timelineBroadcaster;
      let connection: TimelineConnection | undefined;

      const timelineService = createConsoleTimelineService({
        transcriptStore: context.stores.transcriptStore,
        eventStore: context.stores.eventStore,
      });

      const result = timelineService.getTimeline(sessionId);
      let events = result.events;

      // Compute effective replay cursor: Last-Event-ID takes precedence over ?after=
      const effectiveAfter = lastEventId ?? after;

      if (effectiveAfter) {
        const afterIndex = events.findIndex(e => e.eventId === effectiveAfter);
        if (afterIndex !== -1) {
          events = events.slice(afterIndex + 1);
        }
      }

      const snapshotEvent = {
        type: 'snapshot',
        events,
        timestamp: new Date().toISOString(),
      };
      reply.raw.write(`data: ${JSON.stringify(snapshotEvent)}\n\n`);

      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeatEvent = {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          };
          reply.raw.write(`data: ${JSON.stringify(heartbeatEvent)}\n\n`);
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 5000);

      if (timelineBroadcaster) {
        const writeFn = (data: string): boolean => {
          try {
            reply.raw.write(data);
            return true;
          } catch {
            return false;
          }
        };

        const closeFn = () => {
          clearInterval(heartbeatInterval);
        };

        // Subscribe for live events only - catch-up already handled in snapshot
        connection = timelineBroadcaster.subscribe(sessionId, {
          write: writeFn,
          closeFn,
        });
      }

      request.raw.on('close', () => {
        clearInterval(heartbeatInterval);
        if (connection) {
          connection.close();
        }
      });
    }
  );

  server.patch<{ Params: { sessionId: string }; Body: SetModelRequest }>(
    '/api/sessions/:sessionId/model',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Body: SetModelRequest }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const { providerId, model } = request.body || {};

      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const persistedSession = sessionStore?.getById(sessionId);
      if (!persistedSession) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      if (persistedSession.userId !== userId) {
        const error = ApiErrorFactory.forbidden('Access denied to this session');
        return reply.code(403).send(error);
      }

      if (!providerId || typeof providerId !== 'string' || providerId.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('providerId is required and must be a non-empty string');
        error.error.code = 'INVALID_PROVIDER_ID';
        return reply.code(400).send(error);
      }

      if (!model || typeof model !== 'string' || model.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('model is required and must be a non-empty string');
        error.error.code = 'INVALID_MODEL';
        return reply.code(400).send(error);
      }

      const providerConfigStore: ProviderConfigStore | undefined = context.providerConfigStore;
      const settingsProviders = ['openrouter', 'ollama'];
      const isEnvProvider = settingsProviders.includes(providerId);

      if (!isEnvProvider && providerConfigStore) {
        const provider = providerConfigStore.getById(providerId);
        if (!provider) {
          const error = ApiErrorFactory.notFound('Provider not found');
          return reply.code(404).send(error);
        }

        if (provider.userId !== userId) {
          const error = ApiErrorFactory.forbidden('Access denied to this provider');
          return reply.code(403).send(error);
        }

        if (!provider.enabled) {
          const error = ApiErrorFactory.badRequest('Provider is disabled');
          error.error.code = 'PROVIDER_DISABLED';
          return reply.code(400).send(error);
        }
      }

      const success = sessionStore?.setModel(sessionId, model.trim(), providerId);
      if (!success) {
        const error = ApiErrorFactory.internalError('Failed to set model for session');
        return reply.code(500).send(error);
      }

      const updatedSession = sessionStore?.getById(sessionId);
      if (!updatedSession) {
        const error = ApiErrorFactory.notFound('Session not found after update');
        return reply.code(404).send(error);
      }

      const response = {
        session: sessionToConsoleSessionInfo(updatedSession),
      };

      return reply.code(200).send({ data: response });
    }
  );
}