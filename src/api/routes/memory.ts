import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { memoryIdParamsSchema } from '../schemas/shared.js';
import type { MemoryType } from '../../storage/long-term-memory-store.js';
import { createLongTermMemoryRecallService } from '../../memory/long-term-memory-recall.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

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
    '/api/v1/memory/debug/extraction-runs',
    async (request: FastifyRequest<{ Querystring: ExtractionRunsQuery }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.memory, Action.read)) {
        return reply;
      }
      const userId = request.user?.userId ?? 'local-user';
      let limit: number;
      
      try {
        limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      } catch {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid limit value', request.requestId));
      }

      let runs = memoryExtractionRunStore.listByUser(userId);
      
      const sessionId = request.query.sessionId;
      if (sessionId) {
        const session = sessionStore.getById(sessionId);
        if (!session || session.userId !== userId) {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId));
        }
      }

      runs = runs.slice(0, limit);

      return reply.code(200).send(success({
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
      }, request.requestId));
    }
  );

  // POST /api/memory/debug/extract
  server.post<{ Body: DebugExtractBody }>(
    '/api/v1/memory/debug/extract',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sessionId', 'turnId'],
          properties: {
            sessionId: { type: 'string', minLength: 1 },
            turnId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: DebugExtractBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.memory, Action.execute)) {
        return reply;
      }
      const userId = request.user?.userId ?? 'local-user';
      const { sessionId, turnId } = request.body;

      const session = sessionStore.getById(sessionId);
      if (!session || session.userId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId));
      }

      const scheduler = context.memoryExtractionScheduler;
      if (!scheduler) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Memory extraction scheduler not available', request.requestId));
      }

      try {
        const result = await scheduler.runOnce({
          userId,
          sessionId,
          triggerTurnId: turnId,
        });

        return reply.code(200).send(success({
          status: result.status,
          ...(result.status === 'succeeded' && {
            resultCounts: result.resultCounts,
          }),
          ...(result.status === 'failed' && {
            errorCode: result.errorCode,
          }),
        }, request.requestId));
      } catch (err) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR',
          err instanceof Error ? err.message : 'Extraction failed',
          request.requestId));
      }
    }
  );

  // GET /api/memory
  server.get<{ Querystring: ListMemoriesQuery }>(
    '/api/v1/memory',
    async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.memory, Action.read)) {
        return reply;
      }
      const userId = request.user?.userId ?? 'local-user';
      const { query, type } = request.query;

      let limit: number;
      try {
        limit = parseLimit(request.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      } catch {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid limit value', request.requestId));
      }

      let memoryTypes: MemoryType[] | undefined;
      if (type) {
        if (!VALID_MEMORY_TYPES.includes(type as MemoryType)) {
          return reply.code(400).send(envelopeError('BAD_REQUEST',
            `Invalid memory type. Must be one of: ${VALID_MEMORY_TYPES.join(', ')}`,
            request.requestId));
        }
        memoryTypes = [type as MemoryType];
      }

      const result = await recallService.recall({
        userId,
        query,
        limit,
        memoryTypes,
      });

      return reply.code(200).send(success({
        memories: result.memories,
        total: result.total,
      }, request.requestId));
    }
  );

  // GET /api/memory/:memoryId
  server.get<{ Params: MemoryParams }>(
    '/api/v1/memory/:memoryId',
    {
      schema: {
        params: memoryIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: MemoryParams }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.memory, Action.read)) {
        return reply;
      }
      const userId = request.user?.userId ?? 'local-user';
      const { memoryId } = request.params;

      const memory = longTermMemoryStore.getByMemoryId(memoryId);

      if (!memory || memory.userId !== userId || memory.lifecycle.status === 'deleted') {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Memory not found', request.requestId));
      }

      return reply.code(200).send(success({
        memory,
      }, request.requestId));
    }
  );

  // DELETE /api/memory/:memoryId
  server.delete<{ Params: MemoryParams }>(
    '/api/v1/memory/:memoryId',
    {
      schema: {
        params: memoryIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: MemoryParams }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.memory, Action.delete)) {
        return reply;
      }
      const userId = request.user?.userId ?? 'local-user';
      const { memoryId } = request.params;

      const memory = longTermMemoryStore.getByMemoryId(memoryId);

      if (!memory || memory.userId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Memory not found', request.requestId));
      }

      longTermMemoryStore.delete(memoryId);

      context.auditRecorder.recordMemoryWrite({
        memoryId,
        userId,
        operation: 'delete',
        contentSummary: memory.content.text.substring(0, 200),
      });

      return reply.code(200).send(success({
        deleted: true,
        memoryId,
      }, request.requestId));
    }
  );
}
