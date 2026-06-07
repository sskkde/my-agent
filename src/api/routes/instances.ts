import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { InstanceSummary } from '../types.js'
import type { ApiContext } from '../context.js'
import { success } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

export function registerInstanceRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get('/api/v1/instances', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply
    }
    const apiPort = parseInt(process.env.PORT || '3003', 10)

    const instanceSummary: InstanceSummary = {
      type: 'local',
      status: 'healthy',
      uptime: process.uptime(),
      apiPort,
      storeStatus: 'connected',
    }

    return reply.code(200).send(success({ instances: [instanceSummary] }, request.requestId))
  })
}
