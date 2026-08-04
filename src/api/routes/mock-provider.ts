import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import {
  getMockProviderRegistry,
  type MockResponseConfig,
} from '../../llm/mock-provider-registry.js'

interface SetResponseQueueBody {
  responses: MockResponseConfig[]
}

interface SetModeBody {
  mode: 'queue' | 'echo' | 'default'
}

export function registerMockProviderRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get('/api/v1/mock-provider/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = getMockProviderRegistry().getStats()
    return reply.code(200).send(success(stats, request.requestId))
  })

  server.get<{ Querystring: { limit?: string } }>(
    '/api/v1/mock-provider/interactions',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const limitParam = request.query.limit
      const limit = limitParam !== undefined ? Number(limitParam) : undefined
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'limit must be a non-negative integer', request.requestId))
      }
      const interactions = getMockProviderRegistry().getInteractions(limit)
      return reply.code(200).send(success(interactions, request.requestId))
    },
  )

  server.get<{ Params: { id: string } }>(
    '/api/v1/mock-provider/interactions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params
      const interaction = getMockProviderRegistry().getInteraction(id)
      if (!interaction) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Interaction not found', request.requestId))
      }
      return reply.code(200).send(success(interaction, request.requestId))
    },
  )

  server.delete(
    '/api/v1/mock-provider/interactions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.delete)) {
        return reply
      }
      getMockProviderRegistry().clearInteractions()
      return reply.code(204).send()
    },
  )

  server.get('/api/v1/mock-provider/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const queue = getMockProviderRegistry().getResponseQueue()
    return reply.code(200).send(success(queue, request.requestId))
  })

  server.post<{ Body: SetResponseQueueBody }>(
    '/api/v1/mock-provider/responses',
    async (request: FastifyRequest<{ Body: SetResponseQueueBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.execute)) {
        return reply
      }
      const body = request.body ?? {}
      const responses = body.responses
      if (!Array.isArray(responses)) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'responses must be an array', request.requestId))
      }
      getMockProviderRegistry().setResponseQueue(responses)
      return reply.code(200).send(success(getMockProviderRegistry().getResponseQueue(), request.requestId))
    },
  )

  server.post<{ Body: SetModeBody }>(
    '/api/v1/mock-provider/mode',
    async (request: FastifyRequest<{ Body: SetModeBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.observability, Action.execute)) {
        return reply
      }
      const mode = request.body?.mode
      if (mode !== 'queue' && mode !== 'echo' && mode !== 'default') {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              'mode must be one of: queue, echo, default',
              request.requestId,
            ),
          )
      }
      getMockProviderRegistry().setResponseMode(mode)
      return reply.code(200).send(success({ mode: getMockProviderRegistry().getResponseMode() }, request.requestId))
    },
  )

  server.post('/api/v1/mock-provider/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.execute)) {
      return reply
    }
    getMockProviderRegistry().reset()
    return reply.code(200).send(success(getMockProviderRegistry().getStats(), request.requestId))
  })
}
