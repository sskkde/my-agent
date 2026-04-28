import type { FastifyInstance } from 'fastify';
import type { HealthResponse, ModuleHealth } from '../types.js';
import type { ApiContext } from '../context.js';

export function registerStatusRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Reply: HealthResponse }>('/api/health', async (): Promise<HealthResponse> => {
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

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      modules,
    };
  });
}