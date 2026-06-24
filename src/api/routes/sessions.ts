import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { sessionIdParamsSchema } from '../schemas/shared.js'
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
} from '../types.js'
import type { CursorPaginatedResponse } from '../pagination/cursor-types.js'
import { decodeCursor, applyCursorPagination } from '../pagination/cursor-pagination.js'
import type { Stores } from '../../gateway/types.js'
import type { SessionStore, Session } from '../../storage/session-store.js'
import type { ProviderConfigStore } from '../../storage/provider-config-store.js'
import type { ConsoleTimelineService, TimelineOptions } from '../console-timeline.js'
import { createConsoleTimelineService } from '../console-timeline.js'
import type { TimelineBroadcaster, TimelineConnection } from '../timeline-broadcaster.js'
import { convertInboundEnvelopeToProcessorInput } from '../../processing/message-processor.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import { getUploadConfig } from '../../config/upload-config.js'

interface CreateSessionBody {
  userId?: string
}

interface SendMessageParams {
  sessionId: string
}

interface ListSessionsQuery {
  status?: 'active' | 'archived' | 'closed'
  limit?: string
  offset?: string
  cursor?: string
}

interface PatchSessionBody {
  title?: string
  status?: 'active' | 'archived' | 'closed'
}

interface TimelineQuery {
  limit?: string
  offset?: string
  eventTypes?: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function parseLimit(value: string | undefined, defaultValue: number, maxValue: number): number {
  const parsed = parseInt(value ?? String(defaultValue), 10)
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue
  }
  return Math.min(parsed, maxValue)
}

function parseOffset(value: string | undefined): number {
  const parsed = parseInt(value ?? '0', 10)
  return isNaN(parsed) || parsed < 0 ? 0 : parsed
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
  }
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

function generateDefaultTitle(): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return `新会话 ${timestamp}`
}

function canAccessSession(request: FastifyRequest, session: Session): boolean {
  const userId = request.user?.userId
  return !userId || session.userId === userId
}

function sendSessionAccessDenied(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
}

export async function registerSessionsRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const sessionStore: SessionStore | undefined = 'stores' in context ? context.stores.sessionStore : undefined
  const consoleTimelineService: ConsoleTimelineService | undefined =
    'consoleTimelineService' in context ? context.consoleTimelineService : undefined

  server.post<{ Body: CreateSessionBody }>(
    '/api/v1/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.create)) {
        return reply
      }
      const userId = request.user?.userId ?? 'local-user'
      const sessionId = generateSessionId()

      const now = new Date().toISOString()

      if (sessionStore) {
        sessionStore.create({
          sessionId,
          userId,
          title: generateDefaultTitle(),
          status: 'active',
          messageCount: 0,
        })
      }

      const sessionInfo = {
        sessionId,
        userId,
        messageCount: 0,
        lastActivityAt: now,
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      }

      const response: SessionResponse = { session: sessionInfo }
      return reply.code(201).send(success(response, request.requestId))
    },
  )

  server.get<{ Querystring: ListSessionsQuery }>(
    '/api/v1/sessions',
    async (request: FastifyRequest<{ Querystring: ListSessionsQuery }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const status = request.query.status
      const cursorParam = request.query.cursor
      const limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT)

      if (status && !['active', 'archived', 'closed'].includes(status)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'INVALID_STATUS_FILTER',
              'Invalid status filter. Must be one of: active, archived, closed',
              request.requestId,
            ),
          )
      }

      if (cursorParam) {
        try {
          decodeCursor(cursorParam)
        } catch {
          return reply
            .code(400)
            .send(envelopeError('INVALID_CURSOR', 'Invalid cursor: unable to decode', request.requestId))
        }
      }

      let sessions: Session[] = []
      let total = 0

      const userId = request.user?.userId ?? 'local-user'

      if (sessionStore) {
        if (cursorParam) {
          sessions = sessionStore.list({ userId, status, limit: limit + 1 })
        } else {
          const offset = parseOffset(request.query.offset)
          sessions = sessionStore.list({ userId, status, limit, offset })
        }
        total = sessionStore.getCount({ userId, status })
      }

      const items = sessions.map(sessionToConsoleSessionInfo)

      if (cursorParam) {
        const cursorPage = applyCursorPagination(items, { cursor: cursorParam, limit }, (item: ConsoleSessionInfo) => ({
          sessionId: item.sessionId,
        }))
        const response: CursorPaginatedResponse<ConsoleSessionInfo> = {
          items: cursorPage.items,
          nextCursor: cursorPage.nextCursor,
          hasMore: cursorPage.hasMore,
          total,
        }
        return reply.code(200).send(success(response, request.requestId))
      }

      const offset = parseOffset(request.query.offset)
      const response: PaginatedResponse<ConsoleSessionInfo> = {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      const userId = request.user?.userId ?? persistedSession.userId ?? 'local-user'

      if ('gateway' in context) {
        const stores: Stores = {
          eventStore: {
            append: (event: unknown) =>
              context.stores.eventStore.append(event as Parameters<typeof context.stores.eventStore.append>[0]),
            query: (filters: { sessionId?: string; eventType?: string }) =>
              context.stores.eventStore.query(filters) as unknown[],
          },
          summaryStore: {
            getSessionMemory: (sessionId: string) => context.stores.summaryStore.getSessionMemory(sessionId),
          },
          transcriptStore: {
            findBySession: (sessionId: string) => context.stores.transcriptStore.findBySession(sessionId),
          },
          runtimeActionStore: {
            findBySessionId: (sessionId: string) =>
              context.stores.runtimeActionStore.query({ sessionId }) as unknown as Array<{
                actionId: string
                status: string
                targetRef?: Record<string, unknown>
              }>,
          },
        }
        const hydratedState = context.gateway.assembleHydratedState(userId, sessionId, stores)

        const sessionInfo = {
          sessionId,
          userId: hydratedState.userContext?.userId || persistedSession?.userId || userId,
          messageCount: persistedSession.messageCount ?? hydratedState.sessionContext?.messageCount ?? 0,
          lastActivityAt:
            persistedSession.lastActivityAt ?? hydratedState.sessionContext?.lastActivityAt ?? new Date().toISOString(),
          activePlannerRunIds: hydratedState.sessionContext?.activePlannerRunIds || [],
          activeBackgroundRunIds: hydratedState.sessionContext?.activeBackgroundRunIds || [],
          selectedModel: persistedSession.selectedModel,
          selectedProviderId: persistedSession.selectedProviderId,
        }

        const response: SessionResponse = { session: sessionInfo }
        return reply.code(200).send(success(response, request.requestId))
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
      }

      const response: SessionResponse = { session: sessionInfo }
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId/transcripts',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      let transcripts: TranscriptTurn[] = []
      let total = 0

      if ('stores' in context && context.stores.transcriptStore) {
        const transcriptStore = context.stores.transcriptStore
        transcripts = transcriptStore.findBySession(sessionId)
        total = transcripts.length
      }

      const response: TranscriptsResponse = { transcripts, total }
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.post<{ Params: SendMessageParams; Body: SendMessageRequest }>(
    '/api/v1/sessions/:sessionId/messages',
    {
      schema: {
        params: sessionIdParamsSchema,
        body: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string' },
            attachmentIds: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: SendMessageParams; Body: SendMessageRequest }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.execute)) {
        return reply
      }
      const { sessionId } = request.params
      const { text, attachmentIds } = request.body

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      if (!('gateway' in context)) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Gateway not available', request.requestId))
      }

      const userId = request.user?.userId ?? persistedSession.userId ?? 'local-user'
      const trimmedText = text.trim()
      const hasAttachments = Array.isArray(attachmentIds) && attachmentIds.length > 0

      if (trimmedText.length === 0 && !hasAttachments) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'INVALID_MESSAGE_TEXT',
              'Message text is required and cannot be empty or whitespace',
              request.requestId,
            ),
          )
      }

      if (hasAttachments) {
        const uploadConfig = getUploadConfig()
        if (attachmentIds!.length > uploadConfig.maxAttachmentsPerMessage) {
          return reply
            .code(400)
            .send(
              envelopeError(
                'TOO_MANY_ATTACHMENTS',
                `Too many attachments. Maximum allowed: ${uploadConfig.maxAttachmentsPerMessage}`,
                request.requestId,
              ),
            )
        }

        const fileUploadStore = context.stores.fileUploadStore
        for (const attachmentId of attachmentIds!) {
          const file = fileUploadStore.getById(attachmentId, { sessionId })
          if (!file) {
            return reply
              .code(404)
              .send(
                envelopeError(
                  'ATTACHMENT_NOT_FOUND',
                  `Attachment not found: ${attachmentId}`,
                  request.requestId,
                ),
              )
          }
          if (file.userId !== userId) {
            return reply
              .code(403)
              .send(
                envelopeError(
                  'ATTACHMENT_FORBIDDEN',
                  `Attachment not accessible: ${attachmentId}`,
                  request.requestId,
                ),
              )
          }
          if (file.status === 'deleted') {
            return reply
              .code(400)
              .send(
                envelopeError(
                  'ATTACHMENT_DELETED',
                  `Attachment has been deleted: ${attachmentId}`,
                  request.requestId,
                ),
              )
          }
        }
      }

      const envelope = context.gateway.receiveUserMessage(userId, sessionId, text, 'webui', attachmentIds)
      const processorInput = convertInboundEnvelopeToProcessorInput(envelope)

      sessionStore?.updateActivity(sessionId, new Date().toISOString())

      // Process message asynchronously and route outbound via Gateway
      void (async () => {
        try {
          const output = await context.messageProcessor.process(processorInput)

          const messageType = output.success ? 'text' : 'error'
          const outboundEnvelope = context.gateway.formatOutbound(
            messageType,
            {
              text: output.success ? output.result?.text : undefined,
              error: output.success ? undefined : output.error,
            },
            {
              userId,
              sessionId,
              channel: envelope.sourceChannel,
            },
            envelope.envelopeId,
          )

          context.channelRegistry.deliver(envelope.sourceChannel, outboundEnvelope)

          if (sessionStore && 'stores' in context) {
            const transcripts = context.stores.transcriptStore.findBySession(sessionId)
            const completedAt = new Date().toISOString()
            sessionStore.updateMetadata(sessionId, {
              messageCount: transcripts.length,
              lastActivityAt: completedAt,
            })
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown processing error'

          try {
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
              envelope.envelopeId,
            )

            context.channelRegistry.deliver(envelope.sourceChannel, errorEnvelope)

            if (sessionStore && 'stores' in context) {
              const transcripts = context.stores.transcriptStore.findBySession(sessionId)
              const errorTime = new Date().toISOString()
              sessionStore.updateMetadata(sessionId, {
                messageCount: transcripts.length,
                lastActivityAt: errorTime,
              })
            }

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
            })
          } catch (reportError) {
            request.log.error(
              {
                err: reportError,
                originalError: errorMessage,
                sessionId,
                envelopeId: envelope.envelopeId,
              },
              'Failed to report asynchronous session processing error',
            )
          }
        }
      })()

      const response: SendMessageResponse = {
        accepted: true,
        status: 'accepted',
        correlationId: envelope.envelopeId,
        envelopeId: envelope.envelopeId,
      }
      return reply.code(202).send(success(response, request.requestId))
    },
  )

  server.post<{ Params: { sessionId: string } }>(
    '/api/v1/sessions/:sessionId/resume',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      const now = new Date().toISOString()
      sessionStore?.updateActivity(sessionId, now)

      let recentTimeline: ConsoleTimelineEvent[] = []
      if (consoleTimelineService) {
        const timelineResult = consoleTimelineService.getTimeline(sessionId, { limit: 10, offset: 0 })
        recentTimeline = timelineResult.events
      }

      const response = {
        session: sessionToConsoleSessionInfo({
          ...persistedSession,
          lastActivityAt: now,
        }),
        timeline: recentTimeline,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.patch<{ Params: { sessionId: string }; Body: PatchSessionBody }>(
    '/api/v1/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Body: PatchSessionBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.update)) {
        return reply
      }
      const { sessionId } = request.params
      const { title, status } = request.body || {}

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      if (status && !['active', 'archived', 'closed'].includes(status)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'INVALID_STATUS',
              'Invalid status. Must be one of: active, archived, closed',
              request.requestId,
            ),
          )
      }

      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_TITLE', 'Title must be a non-empty string', request.requestId))
      }

      if (status) {
        sessionStore?.updateStatus(sessionId, status)
      }
      if (title) {
        sessionStore?.updateTitle(sessionId, title.trim())
      }

      const updatedSession = sessionStore?.getById(sessionId)
      if (!updatedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      const response = {
        session: sessionToConsoleSessionInfo(updatedSession),
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.get<{ Params: { sessionId: string }; Querystring: TimelineQuery }>(
    '/api/v1/sessions/:sessionId/timeline',
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: TimelineQuery }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params
      const limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT)
      const offset = parseOffset(request.query.offset)
      const eventTypesParam = request.query.eventTypes

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      let eventTypes: ConsoleTimelineEventType[] | undefined
      if (eventTypesParam) {
        eventTypes = eventTypesParam
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean) as ConsoleTimelineEventType[]
      }

      let events: ConsoleTimelineEvent[] = []
      let total = 0

      if (consoleTimelineService) {
        const options: TimelineOptions = { limit, offset }
        if (eventTypes && eventTypes.length > 0) {
          options.eventTypes = eventTypes
        }
        const result = consoleTimelineService.getTimeline(sessionId, options)
        events = result.events
        total = result.total
      }

      const response: PaginatedResponse<ConsoleTimelineEvent> = {
        items: events,
        total,
        limit,
        offset,
        hasMore: offset + events.length < total,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  server.get<{ Params: { sessionId: string }; Querystring: { after?: string } }>(
    '/api/v1/sessions/:sessionId/timeline/stream',
    async (
      request: FastifyRequest<{ Params: { sessionId: string }; Querystring: { after?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params
      const { after } = request.query
      const lastEventId = request.headers['last-event-id'] as string | undefined

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }
      if (!canAccessSession(request, persistedSession)) {
        return sendSessionAccessDenied(request, reply)
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const timelineBroadcaster: TimelineBroadcaster | undefined = context.timelineBroadcaster
      let connection: TimelineConnection | undefined

      const timelineService = createConsoleTimelineService({
        transcriptStore: context.stores.transcriptStore,
        eventStore: context.stores.eventStore,
      })

      const result = timelineService.getTimeline(sessionId)
      let events = result.events

      // Compute effective replay cursor: Last-Event-ID takes precedence over ?after=
      const effectiveAfter = lastEventId ?? after

      if (effectiveAfter) {
        const afterIndex = events.findIndex((e) => e.eventId === effectiveAfter)
        if (afterIndex !== -1) {
          events = events.slice(afterIndex + 1)
        }
      }

      const snapshotEvent = {
        type: 'snapshot',
        events,
        timestamp: new Date().toISOString(),
      }
      reply.raw.write(`data: ${JSON.stringify(snapshotEvent)}\n\n`)

      const heartbeatInterval = setInterval(() => {
        try {
          const heartbeatEvent = {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          }
          reply.raw.write(`data: ${JSON.stringify(heartbeatEvent)}\n\n`)
        } catch {
          clearInterval(heartbeatInterval)
        }
      }, 5000)

      if (timelineBroadcaster) {
        const writeFn = (data: string): boolean => {
          try {
            reply.raw.write(data)
            return true
          } catch {
            return false
          }
        }

        const closeFn = () => {
          clearInterval(heartbeatInterval)
        }

        // Subscribe for live events only - catch-up already handled in snapshot
        connection = timelineBroadcaster.subscribe(sessionId, {
          write: writeFn,
          closeFn,
        })
      }

      request.raw.on('close', () => {
        clearInterval(heartbeatInterval)
        if (connection) {
          connection.close()
        }
      })
    },
  )

  server.patch<{ Params: { sessionId: string }; Body: SetModelRequest }>(
    '/api/v1/sessions/:sessionId/model',
    {
      schema: {
        params: sessionIdParamsSchema,
        body: {
          type: 'object',
          required: ['providerId', 'model'],
          properties: {
            providerId: { type: 'string', minLength: 1 },
            model: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string }; Body: SetModelRequest }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.update)) {
        return reply
      }
      const { sessionId } = request.params
      const { providerId, model } = request.body

      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const persistedSession = sessionStore?.getById(sessionId)
      if (!persistedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      if (persistedSession.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      if (providerId.trim().length === 0) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'INVALID_PROVIDER_ID',
              'providerId is required and must be a non-empty string',
              request.requestId,
            ),
          )
      }

      if (model.trim().length === 0) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_MODEL', 'model is required and must be a non-empty string', request.requestId))
      }

      const providerConfigStore: ProviderConfigStore | undefined = context.providerConfigStore
      const settingsProviders = ['openrouter', 'ollama']
      const isEnvProvider = settingsProviders.includes(providerId)

      if (!isEnvProvider && providerConfigStore) {
        const provider = providerConfigStore.getById(providerId)
        if (!provider) {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found', request.requestId))
        }

        if (provider.userId !== userId) {
          return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this provider', request.requestId))
        }

        if (!provider.enabled) {
          return reply.code(400).send(envelopeError('PROVIDER_DISABLED', 'Provider is disabled', request.requestId))
        }
      }

      const modelSetSuccess = sessionStore?.setModel(sessionId, model.trim(), providerId)
      if (!modelSetSuccess) {
        return reply
          .code(500)
          .send(envelopeError('INTERNAL_ERROR', 'Failed to set model for session', request.requestId))
      }

      const updatedSession = sessionStore?.getById(sessionId)
      if (!updatedSession) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found after update', request.requestId))
      }

      const response = {
        session: sessionToConsoleSessionInfo(updatedSession),
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
