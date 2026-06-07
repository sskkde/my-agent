import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

export function registerChannelRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/v1/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply
    }
    const channels = context.channelRegistry.list()
    return reply.code(200).send(success({ channels }, request.requestId))
  })
}
