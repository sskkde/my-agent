import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import type { ToolResultResponse } from '../types.js';
import { ApiErrorFactory } from '../errors.js';

interface ToolResultParams {
  resultId: string;
}

export function registerToolResultsRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get(
    '/api/tool-results/:resultId',
    async (
      request: FastifyRequest<{ Params: ToolResultParams }>,
      reply: FastifyReply
    ) => {
      const { resultId } = request.params;
      const userId = request.user?.userId;

      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const resultBlob = context.stores.toolResultStore.findById(resultId);

      if (!resultBlob) {
        const error = ApiErrorFactory.notFound(`Tool result not found: ${resultId}`);
        return reply.code(404).send(error);
      }

      if (resultBlob.userId !== userId) {
        const error = ApiErrorFactory.notFound(`Tool result not found: ${resultId}`);
        return reply.code(404).send(error);
      }

      const response: ToolResultResponse = {
        resultId: resultBlob.id,
        toolExecutionId: resultBlob.toolCallId,
        toolName: resultBlob.toolName,
        userId: resultBlob.userId,
        sessionId: resultBlob.sessionId,
        sizeBytes: resultBlob.structuredContent 
          ? Buffer.byteLength(JSON.stringify(resultBlob.structuredContent), 'utf-8')
          : 0,
        contentType: 'application/json',
        preview: resultBlob.preview,
        sensitivity: resultBlob.sensitivity,
        createdAt: resultBlob.createdAt,
      };

      return reply.code(200).send({ data: response });
    }
  );
}