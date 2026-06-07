import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { DeadLetterListFilters, DeadLetterStatus } from '../../dead-letter/types.js'

const VALID_STATUSES: DeadLetterStatus[] = ['pending', 'retrying', 'discarded', 'resolved']

function parseLimitOffset(limit?: string, offset?: string): { limit: number; offset: number } {
  const parsedLimit = Number.parseInt(limit ?? '50', 10)
  const parsedOffset = Number.parseInt(offset ?? '0', 10)
  return {
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50,
    offset: Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0,
  }
}

function isDeadLetterStatus(value: string | undefined): value is DeadLetterStatus {
  return value !== undefined && VALID_STATUSES.includes(value as DeadLetterStatus)
}

export function registerDlqRoutes(server: FastifyInstance, context: ApiContext): void {
  const deadLetterStore = context.stores.deadLetterStore

  server.get<{ Querystring: { status?: string; module?: string; limit?: string; offset?: string } }>(
    '/api/v1/dlq',
    async (
      request: FastifyRequest<{ Querystring: { status?: string; module?: string; limit?: string; offset?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply
      }

      const { status, module, limit, offset } = request.query
      if (status && !isDeadLetterStatus(status)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid DLQ status filter', request.requestId))
      }
      const pagination = parseLimitOffset(limit, offset)
      const filters: DeadLetterListFilters = {
        ...(module ? { module } : {}),
        ...(isDeadLetterStatus(status) ? { status } : {}),
      }
      const allEntries = deadLetterStore.list(filters)
      const entries = allEntries.slice(pagination.offset, pagination.offset + pagination.limit)
      return reply.code(200).send(success({ entries, total: allEntries.length }, request.requestId))
    },
  )

  server.post<{ Body: { eventIds: string[] } }>(
    '/api/v1/dlq/batch-retry',
    async (request: FastifyRequest<{ Body: { eventIds: string[] } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.update)) {
        return reply
      }
      const eventIds = Array.isArray(request.body?.eventIds) ? request.body.eventIds : []
      const results = eventIds.map((eventId) => {
        const entry = deadLetterStore.findByEventId(eventId)
        if (!entry) {
          return { eventId, success: false, error: 'DLQ entry not found' }
        }
        deadLetterStore.updateStatus(eventId, 'retrying')
        return { eventId, success: true }
      })
      const successCount = results.filter((result) => result.success).length
      return reply
        .code(200)
        .send(success({ results, successCount, failedCount: results.length - successCount }, request.requestId))
    },
  )

  server.post<{ Body: { eventIds: string[] } }>(
    '/api/v1/dlq/batch-discard',
    async (request: FastifyRequest<{ Body: { eventIds: string[] } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.update)) {
        return reply
      }
      const eventIds = Array.isArray(request.body?.eventIds) ? request.body.eventIds : []
      const results = eventIds.map((eventId) => {
        const entry = deadLetterStore.findByEventId(eventId)
        if (!entry) {
          return { eventId, success: false }
        }
        deadLetterStore.updateStatus(eventId, 'discarded')
        return { eventId, success: true }
      })
      const successCount = results.filter((result) => result.success).length
      return reply.code(200).send(success({ results, successCount }, request.requestId))
    },
  )

  server.get<{ Params: { eventId: string } }>(
    '/api/v1/dlq/:eventId',
    async (request: FastifyRequest<{ Params: { eventId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply
      }
      const entry = deadLetterStore.findByEventId(request.params.eventId)
      if (!entry) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'DLQ entry not found', request.requestId))
      }
      return reply.code(200).send(success({ entry }, request.requestId))
    },
  )

  server.post<{ Params: { eventId: string } }>(
    '/api/v1/dlq/:eventId/retry',
    async (request: FastifyRequest<{ Params: { eventId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.update)) {
        return reply
      }
      const entry = deadLetterStore.findByEventId(request.params.eventId)
      if (!entry) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'DLQ entry not found', request.requestId))
      }
      deadLetterStore.updateStatus(request.params.eventId, 'retrying')
      return reply.code(200).send(success({ success: true, eventId: request.params.eventId }, request.requestId))
    },
  )

  server.delete<{ Params: { eventId: string } }>(
    '/api/v1/dlq/:eventId',
    async (request: FastifyRequest<{ Params: { eventId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.delete)) {
        return reply
      }
      const entry = deadLetterStore.findByEventId(request.params.eventId)
      if (!entry) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'DLQ entry not found', request.requestId))
      }
      deadLetterStore.updateStatus(request.params.eventId, 'discarded')
      return reply.code(200).send(success({ success: true, eventId: request.params.eventId }, request.requestId))
    },
  )
}
