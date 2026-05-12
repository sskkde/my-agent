import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type { MemoryType } from '../../storage/long-term-memory-store.js';
import { createLongTermMemoryRecallService } from '../../memory/long-term-memory-recall.js';

interface ListMemoriesQuery {
  query?: string;
  type?: string;
  limit?: string;
}

interface MemoryParams {
  memoryId: string;
}

interface ExtractionRunsQuery {
  sessionId?: string;
  limit?: string;
}

interface DebugExtractBody {
  sessionId: string;
  turnId: string;
}

const VALID_MEMORY_TYPES: MemoryType[] = [
  'user_profile',
  'user_preference',
  'user_safety_rule',
  'project_state',
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(value: string | undefined, defaultVal: number, maxVal: number): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    throw new Error('Invalid limit value');
  }
  return Math.min(parsed, maxVal);
}

export async function registerMemoryRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const { longTermMemoryStore, memoryExtractionRunStore, sessionStore } = context.stores;
  const recallService = createLongTermMemoryRecallService(longTermMemoryStore);

  // Debug routes MUST be registered BEFORE :memoryId routes
  // GET /api/memory/debug/extraction-runs
  server.get<{ Querystring: ExtractionRunsQuery }>(
    '/api/memory/debug/extraction-runs',
    async (request: FastifyRequest<{ Querystring: ExtractionRunsQuery }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      let limit: number;
      
      try {
        limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      } catch {
        const error = ApiErrorFactory.badRequest('Invalid limit value');
        return reply.code(400).send(error);
      }

      let runs = memoryExtractionRunStore.listByUser(userId);
      
      const sessionId = request.query.sessionId;
      if (sessionId) {
        const session = sessionStore.getById(sessionId);
        if (!session || session.userId !== userId) {
          const error = ApiErrorFactory.notFound('Session not found');
          return reply.code(404).send(error);
        }
      }

      runs = runs.slice(0, limit);

      const response = {
        data: {
          runs: runs.map(run => ({
            runId: run.runId,
            userId: run.userId,
            sessionId: run.sessionId,
            triggerTurnId: run.triggerTurnId,
            windowHash: run.windowHash,
            includedTurnIds: run.includedTurnIds,
            status: run.status,
            attempts: run.attempts,
            resultCounts: run.resultCounts,
            failureCode: run.failureCode,
            failureMessage: run.failureMessage,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          })),
          total: runs.length,
        },
      };

      return reply.code(200).send(response);
    }
  );

  // POST /api/memory/debug/extract
  server.post<{ Body: DebugExtractBody }>(
    '/api/memory/debug/extract',
    async (request: FastifyRequest<{ Body: DebugExtractBody }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      const { sessionId, turnId } = request.body;

      if (!sessionId) {
        const error = ApiErrorFactory.badRequest('Missing sessionId');
        return reply.code(400).send(error);
      }

      if (!turnId) {
        const error = ApiErrorFactory.badRequest('Missing turnId');
        return reply.code(400).send(error);
      }

      const session = sessionStore.getById(sessionId);
      if (!session || session.userId !== userId) {
        const error = ApiErrorFactory.notFound('Session not found');
        return reply.code(404).send(error);
      }

      const scheduler = context.memoryExtractionScheduler;
      if (!scheduler) {
        const error = ApiErrorFactory.internalError('Memory extraction scheduler not available');
        return reply.code(500).send(error);
      }

      try {
        const result = await scheduler.runOnce({
          userId,
          sessionId,
          triggerTurnId: turnId,
        });

        return reply.code(200).send({
          data: {
            status: result.status,
            ...(result.status === 'succeeded' && {
              resultCounts: result.resultCounts,
            }),
            ...(result.status === 'failed' && {
              errorCode: result.errorCode,
            }),
          },
        });
      } catch (err) {
        const error = ApiErrorFactory.internalError(
          err instanceof Error ? err.message : 'Extraction failed'
        );
        return reply.code(500).send(error);
      }
    }
  );

  // GET /api/memory
  server.get<{ Querystring: ListMemoriesQuery }>(
    '/api/memory',
    async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      const { query, type } = request.query;

      let limit: number;
      try {
        limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      } catch {
        const error = ApiErrorFactory.badRequest('Invalid limit value');
        return reply.code(400).send(error);
      }

      let memoryTypes: MemoryType[] | undefined;
      if (type) {
        if (!VALID_MEMORY_TYPES.includes(type as MemoryType)) {
          const error = ApiErrorFactory.badRequest(
            `Invalid memory type. Must be one of: ${VALID_MEMORY_TYPES.join(', ')}`
          );
          return reply.code(400).send(error);
        }
        memoryTypes = [type as MemoryType];
      }

      const result = await recallService.recall({
        userId,
        query,
        limit,
        memoryTypes,
      });

      return reply.code(200).send({
        data: {
          memories: result.memories,
          total: result.total,
        },
      });
    }
  );

  // GET /api/memory/:memoryId
  server.get<{ Params: MemoryParams }>(
    '/api/memory/:memoryId',
    async (request: FastifyRequest<{ Params: MemoryParams }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      const { memoryId } = request.params;

      const memory = longTermMemoryStore.getByMemoryId(memoryId);

      if (!memory || memory.userId !== userId || memory.lifecycle.status === 'deleted') {
        const error = ApiErrorFactory.notFound('Memory not found');
        return reply.code(404).send(error);
      }

      return reply.code(200).send({
        data: {
          memory,
        },
      });
    }
  );

  // DELETE /api/memory/:memoryId
  server.delete<{ Params: MemoryParams }>(
    '/api/memory/:memoryId',
    async (request: FastifyRequest<{ Params: MemoryParams }>, reply: FastifyReply) => {
      const userId = request.user?.userId ?? 'local-user';
      const { memoryId } = request.params;

      const memory = longTermMemoryStore.getByMemoryId(memoryId);

      if (!memory || memory.userId !== userId) {
        const error = ApiErrorFactory.notFound('Memory not found');
        return reply.code(404).send(error);
      }

      longTermMemoryStore.delete(memoryId);

      context.auditRecorder.recordMemoryWrite({
        memoryId,
        userId,
        operation: 'delete',
        contentSummary: memory.content.text.substring(0, 200),
      });

      return reply.code(200).send({
        data: {
          deleted: true,
          memoryId,
        },
      });
    }
  );
}