import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import type { ToolResultResponse } from '../types.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

interface ToolResultParams {
  resultId: string
}

export function registerToolResultsRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get(
    '/api/v1/tool-results/:resultId',
    async (request: FastifyRequest<{ Params: ToolResultParams }>, reply: FastifyReply) => {
      if (!request.requirePermission('tool-result' as ResourceType, Action.read)) {
        return reply
      }
      const { resultId } = request.params
      const userId = request.user?.userId

      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const resultBlob = context.stores.toolResultStore.findById(resultId)

      if (!resultBlob) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Tool result not found: ${resultId}`, request.requestId))
      }

      if (resultBlob.userId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Tool result not found: ${resultId}`, request.requestId))
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
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
