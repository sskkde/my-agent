import type { FastifyInstance } from 'fastify';
import type { RunsResponse, RunInfo } from '../types.js';
import type { ApiContext } from '../context.js';
import type { BackgroundSubagentState } from '../../shared/states.js';

export function registerRunRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Reply: RunsResponse }>('/api/runs', async (): Promise<RunsResponse> => {
    const runs: RunInfo[] = [];

    try {
      const plannerRuns = context.stores.plannerRunStore.findByUser('default');
      for (const run of plannerRuns) {
        runs.push({
          runId: run.plannerRunId,
          status: run.status as RunInfo['status'],
          objective: run.planId,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch planner runs:', err);
    }

    try {
      const backgroundRuns = context.stores.backgroundRunStore.getByUserAndStatus('default', 'running' as BackgroundSubagentState);
      const pendingRuns = context.stores.backgroundRunStore.getByUserAndStatus('default', 'pending' as BackgroundSubagentState);
      const allBackgroundRuns = [...backgroundRuns, ...pendingRuns];

      for (const run of allBackgroundRuns) {
        runs.push({
          runId: run.backgroundRunId,
          status: run.status as RunInfo['status'],
          createdAt: run.createdAt ?? new Date().toISOString(),
          updatedAt: run.updatedAt,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch background runs:', err);
    }

    try {
      const kernelRuns = context.stores.kernelRunStore.getByStatus('pending' as never);
      const runningKernels = context.stores.kernelRunStore.getByStatus('running' as never);
      const allKernelRuns = [...kernelRuns, ...runningKernels];

      for (const run of allKernelRuns) {
        runs.push({
          runId: run.runId,
          status: run.status as RunInfo['status'],
          createdAt: run.createdAt ?? new Date().toISOString(),
          updatedAt: run.updatedAt,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch kernel runs:', err);
    }

    return {
      runs,
      total: runs.length,
    };
  });

  server.get('/api/runs/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const snapshotEvent = {
      type: 'snapshot',
      runs: [] as RunInfo[],
      timestamp: new Date().toISOString(),
    };

    reply.raw.write(`data: ${JSON.stringify(snapshotEvent)}\n\n`);

    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 5000);

    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  });
}