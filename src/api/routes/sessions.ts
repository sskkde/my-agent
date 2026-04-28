import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type { SessionResponse, TranscriptsResponse, SendMessageRequest, SendMessageResponse } from '../types.js';
import type { Stores } from '../../gateway/types.js';

interface CreateSessionBody {
  userId?: string;
}

interface SendMessageParams {
  sessionId: string;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

const knownSessions = new Set<string>();

export async function registerSessionsRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  server.post<{ Body: CreateSessionBody }>(
    '/api/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      const userId = request.body?.userId || 'local-user';
      const sessionId = generateSessionId();
      knownSessions.add(sessionId);

      const sessionInfo = {
        sessionId,
        userId,
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      };

      const response: SessionResponse = { session: sessionInfo };
      return reply.code(201).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;

      if (!knownSessions.has(sessionId)) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

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
        const hydratedState = context.gateway.assembleHydratedState('local-user', sessionId, stores);

        const sessionInfo = {
          sessionId,
          userId: hydratedState.userContext?.userId || 'local-user',
          messageCount: hydratedState.sessionContext?.messageCount || 0,
          lastActivityAt: hydratedState.sessionContext?.lastActivityAt || new Date().toISOString(),
          activePlannerRunIds: hydratedState.sessionContext?.activePlannerRunIds || [],
          activeBackgroundRunIds: hydratedState.sessionContext?.activeBackgroundRunIds || [],
        };

        const response: SessionResponse = { session: sessionInfo };
        return reply.code(200).send({ data: response });
      }

      const sessionInfo = {
        sessionId,
        userId: 'local-user',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      };

      const response: SessionResponse = { session: sessionInfo };
      return reply.code(200).send({ data: response });
    }
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/transcripts',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;

      if (!knownSessions.has(sessionId)) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      let transcripts: unknown[] = [];
      let total = 0;

      if ('stores' in context && context.stores.transcriptStore) {
        const transcriptStore = context.stores.transcriptStore;
        transcripts = transcriptStore.findBySession(sessionId);
        total = transcripts.length;
      }

      const response: TranscriptsResponse = { transcripts: transcripts as any, total };
      return reply.code(200).send({ data: response });
    }
  );

  server.post<{ Params: SendMessageParams; Body: SendMessageRequest }>(
    '/api/sessions/:sessionId/messages',
    async (request: FastifyRequest<{ Params: SendMessageParams; Body: SendMessageRequest }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      const { text } = request.body || {};

      if (!knownSessions.has(sessionId)) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('Message text is required and cannot be empty or whitespace');
        error.error.code = 'INVALID_MESSAGE_TEXT';
        return reply.code(400).send(error);
      }

      if ('gateway' in context) {
        context.gateway.receiveUserMessage('local-user', sessionId, text);
      }

      const response: SendMessageResponse = { accepted: true, status: 'accepted' };
      return reply.code(202).send({ data: response });
    }
  );
}