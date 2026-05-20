import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { getToolCatalog } from '../tool-catalog.js';
import { success } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

export function registerToolsRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get(
    '/api/v1/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.read)) {
        return reply;
      }
      const tools = getToolCatalog();

      return reply.code(200).send(success({
        tools,
        total: tools.length,
      }, request.requestId));
    }
  );
}
