import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success } from '../response-envelope.js';

export function registerChannelRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    const channels = context.channelRegistry.list();
    return reply.code(200).send(success({ channels }, request.requestId));
  });
}
