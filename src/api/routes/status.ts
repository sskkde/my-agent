import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ModuleHealth } from '../types.js';
import type { ApiContext } from '../context.js';
import { success } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

export function registerStatusRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/v1/health', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply;
    }
    const modules: Record<string, ModuleHealth> = {};

    try {
      const pendingApprovals = context.stores.approvalStore.findPendingByUser('health-check');
      modules.approvals = {
        status: pendingApprovals !== null ? 'healthy' : 'healthy',
        message: `${pendingApprovals.length} pending`,
      };
    } catch {
      modules.approvals = {
        status: 'unhealthy',
        message: 'Failed to query approvals',
      };
    }

    try {
      const pendingRuns = context.stores.backgroundRunStore.getByStatus('pending' as never);
      const runningRuns = context.stores.backgroundRunStore.getByStatus('running' as never);
      modules.runs = {
        status: 'healthy',
        message: `${pendingRuns.length} pending, ${runningRuns.length} running`,
      };
    } catch {
      modules.runs = {
        status: 'unhealthy',
        message: 'Failed to query runs',
      };
    }

    try {
      context.stores.plannerRunStore.findActive('health-check');
      modules.planner = {
        status: 'healthy',
        message: 'Planner store accessible',
      };
    } catch {
      modules.planner = {
        status: 'unhealthy',
        message: 'Failed to query planner runs',
      };
    }

    try {
      context.stores.kernelRunStore.getByStatus('pending' as never);
      modules.kernel = {
        status: 'healthy',
        message: 'Kernel store accessible',
      };
    } catch {
      modules.kernel = {
        status: 'unhealthy',
        message: 'Failed to query kernel runs',
      };
    }

    let overallStatus: 'healthy' | 'degraded' = 'healthy';
    for (const mod of Object.values(modules)) {
      if (mod.status === 'unhealthy') {
        overallStatus = 'degraded';
        break;
      }
    }

    return reply.code(200).send(success({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      modules,
    }, request.requestId));
  });

  server.get('/api/v1/health/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply;
    }
    try {
      const stores = context.stores;
      const dbHealthy = stores.sessionStore !== undefined;

      if (dbHealthy) {
        return reply.code(200).send(success({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          checks: {
            database: { status: 'healthy' },
            stores: { status: 'healthy' },
          },
        }, request.requestId));
      }

      return reply.code(503).send(success({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'unhealthy', message: 'Database not available' },
          stores: { status: 'unhealthy' },
        },
      }, request.requestId));
    } catch (err) {
      return reply.code(503).send(success({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: {
          database: { status: 'unhealthy', message: err instanceof Error ? err.message : 'Unknown error' },
        },
      }, request.requestId));
    }
  });
}