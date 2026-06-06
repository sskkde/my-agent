import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import type { ToolRegistry } from '../../tools/types.js';
import { getToolCatalogWithMetadata } from '../tool-catalog.js';
import { success } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

interface ToolsResponseWithMetadata {
  tools: Array<{
    name: string;
    description: string;
    category: string;
    sensitivity: string;
  }>;
  total: number;
  metadata?: {
    executionPlane?: string;
    availability?: string;
    isMock?: boolean;
    source?: string;
  }[];
}

export function registerToolsRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get(
    '/api/v1/tools',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.read)) {
        return reply;
      }

      const toolRegistry = (context as unknown as { toolRegistry?: ToolRegistry }).toolRegistry;
      const catalogEntries = getToolCatalogWithMetadata(toolRegistry);

      const tools = catalogEntries.map(entry => ({
        name: entry.name,
        description: entry.description,
        category: entry.category,
        sensitivity: entry.sensitivity,
      }));

      const response: ToolsResponseWithMetadata = {
        tools,
        total: tools.length,
        metadata: catalogEntries.map(entry => ({
          executionPlane: entry.executionPlane,
          availability: entry.availability,
          isMock: entry.isMock,
          source: entry.source,
        })),
      };

      return reply.code(200).send(success(response, request.requestId));
    }
  );
}
