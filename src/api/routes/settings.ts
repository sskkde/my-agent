import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SettingsConfig } from '../types.js';
import type { ApiContext } from '../context.js';
import { success } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

export function registerSettingsRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get('/api/v1/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply;
    }
    const settings: SettingsConfig = {
      localOnly: true,
      providers: {
        openrouter: {
          configured: !!process.env.OPENROUTER_API_KEY,
        },
        ollama: {
          configured: !!process.env.OLLAMA_BASE_URL,
        },
      },
      retentionDays: 30,
    };

    return reply.code(200).send(success({ settings }, request.requestId));
  });
}
