import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import type { ToolsResponse } from '../types.js';
import { getToolCatalog } from '../tool-catalog.js';

export function registerToolsRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get(
    '/api/tools',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const tools = getToolCatalog();

      const response: ToolsResponse = {
        tools,
        total: tools.length,
      };

      return reply.code(200).send({ data: response });
    }
  );
}
