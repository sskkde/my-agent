import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { getToolCatalog } from '../tool-catalog.js';
import { success } from '../response-envelope.js';

export function registerToolsRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get(
    '/api/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tools = getToolCatalog();

      return reply.code(200).send(success({
        tools,
        total: tools.length,
      }, request.requestId));
    }
  );
}
