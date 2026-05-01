import type { FastifyInstance } from 'fastify';
import type { ChannelsResponse } from '../types.js';
import type { ApiContext } from '../context.js';

export function registerChannelRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get<{ Reply: { data: ChannelsResponse } }>('/api/channels', async (): Promise<{ data: ChannelsResponse }> => {
    return { data: { channels: [] } };
  });
}
