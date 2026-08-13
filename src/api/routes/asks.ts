import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { AskAnswerRequest, AskInfo, AskOption, AskAnswer } from '../types.js'
import { success, envelopeError } from '../response-envelope.js'
import type { ApiContext } from '../context.js'
import { ASK_STATES, type AskRequest } from '../../storage/ask-store.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

function toAskInfo(ask: AskRequest): AskInfo {
  return {
    id: ask.id,
    userId: ask.userId,
    sessionId: ask.sessionId,
    status: ask.status,
    question: ask.question,
    options: (ask.options as AskOption[] | null) ?? undefined,
    multiSelect: ask.multiSelect,
    context: ask.context ?? undefined,
    answers: (ask.answers as AskAnswer[] | null) ?? undefined,
    requestedBy: ask.requestedBy,
    requestedAt: ask.requestedAt,
    respondedAt: ask.respondedAt ?? undefined,
    responseBy: ask.responseBy ?? undefined,
  }
}

export function registerAskRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Querystring: { sessionId?: string } }>(
    '/api/v1/asks',
    async (request: FastifyRequest<{ Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.ask, Action.read)) {
        return reply
      }
      const userId = request.user?.userId ?? 'local-user'
      const sessionId = request.query.sessionId

      const asks = context.stores.askStore.findByUser(userId, sessionId ? { sessionId } : undefined)

      return reply.code(200).send(success({ asks: asks.map(toAskInfo), total: asks.length }, request.requestId))
    },
  )

  server.patch<{ Params: { askId: string }; Body: AskAnswerRequest }>(
    '/api/v1/asks/:askId',
    async (request: FastifyRequest<{ Params: { askId: string }; Body: AskAnswerRequest }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.ask, Action.update)) {
        return reply
      }
      const { askId } = request.params
      const { answers } = request.body ?? {}

      if (!Array.isArray(answers) || answers.length === 0) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'answers must be a non-empty array', request.requestId))
      }

      const existing = context.stores.askStore.getById(askId)
      if (!existing) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Ask ${askId} not found`, request.requestId))
      }

      if (existing.status !== ASK_STATES.PENDING) {
        return reply
          .code(409)
          .send(
            envelopeError(
              'CONFLICT',
              `Ask ${askId} already answered with status: ${existing.status}`,
              request.requestId,
            ),
          )
      }

      const now = new Date().toISOString()
      const responseBy = request.user?.userId ?? 'local-user'

      context.stores.askStore.update(askId, {
        status: ASK_STATES.ANSWERED,
        answers,
        respondedAt: now,
        responseBy,
      })

      context.stores.eventStore.append({
        eventId: `evt-ask-${Date.now()}`,
        eventType: 'ask_resolved',
        sourceModule: 'foreground_agent',
        userId: existing.userId,
        sessionId: existing.sessionId,
        correlationId: askId,
        payload: { askId, question: existing.question, answers, respondedAt: now, responseBy },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: now,
      })

      context.scheduleAskResponseTurn?.({
        askId,
        userId: existing.userId,
        sessionId: existing.sessionId,
        answers,
        question: existing.question,
      })

      return reply.code(200).send(
        success(
          {
            success: true,
            askId,
            status: ASK_STATES.ANSWERED,
          },
          request.requestId,
        ),
      )
    },
  )
}
