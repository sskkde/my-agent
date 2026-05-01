import type { FastifyInstance } from 'fastify';
import type { InstanceSummary, InstancesResponse } from '../types.js';
import type { ApiContext } from '../context.js';

export function registerInstanceRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get<{ Reply: { data: InstancesResponse } }>('/api/instances', async (): Promise<{ data: InstancesResponse }> => {
    const apiPort = parseInt(process.env.PORT || '3003', 10);

    const instanceSummary: InstanceSummary = {
      type: 'local',
      status: 'healthy',
      uptime: process.uptime(),
      apiPort,
      storeStatus: 'connected',
    };

    return { data: { instances: [instanceSummary] } };
  });
}
