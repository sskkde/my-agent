import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { UsageSummary, PaginatedResponse } from '../types.js'
import type { TurnTranscript } from '../../storage/transcript-store.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

/**
 * Estimates token count from text content.
 * Uses a simple heuristic: approximately 4 characters per token.
 * This is an ESTIMATE and should be marked as such.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Calculates usage summary from a collection of transcripts for a session.
 *
 * @param sessionId - The session ID
 * @param transcripts - Array of turn transcripts
 * @param updatedAt - Timestamp for when this summary was generated
 * @returns UsageSummary with estimated counts
 */
function calculateUsageSummary(sessionId: string, transcripts: TurnTranscript[], updatedAt: string): UsageSummary {
  let messageCount = 0
  let turnCount = transcripts.length
  let toolCallCount = 0
  let approvalCount = 0
  let artifactCount = 0
  let runCount = 0
  let totalInputLength = 0
  let totalOutputLength = 0

  for (const transcript of transcripts) {
    // Count input content
    if (transcript.input?.userMessageSummary) {
      totalInputLength += transcript.input.userMessageSummary.length
    }
    if (transcript.input?.contentRefs) {
      totalInputLength += transcript.input.contentRefs.join('').length
    }

    // Count visible messages and output content
    if (transcript.output?.visibleMessages) {
      messageCount += transcript.output.visibleMessages.length
      for (const msg of transcript.output.visibleMessages) {
        if (msg.content) {
          totalOutputLength += msg.content.length
        }
      }
    }

    // Count artifacts
    if (transcript.output?.artifactRefs) {
      artifactCount += transcript.output.artifactRefs.length
    }

    // Count tool calls, approvals, and runs from runtime summary
    if (transcript.runtimeSummary) {
      if (transcript.runtimeSummary.toolCallSummaries) {
        toolCallCount += transcript.runtimeSummary.toolCallSummaries.length
      }
      if (transcript.runtimeSummary.approvalSummaries) {
        approvalCount += transcript.runtimeSummary.approvalSummaries.length
      }
      if (transcript.runtimeSummary.plannerRunIds) {
        runCount += transcript.runtimeSummary.plannerRunIds.length
      }
    }
  }

  // Calculate estimated token counts
  // These are ESTIMATES based on character length, not actual token counts
  const estimatedInputTokens = estimateTokens(' '.repeat(totalInputLength))
  const estimatedOutputTokens = estimateTokens(' '.repeat(totalOutputLength))
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens

  return {
    sessionId,
    messageCount,
    turnCount,
    toolCallCount,
    approvalCount,
    artifactCount,
    runCount,
    /** @estimated Based on character length, not actual tokenizer */
    estimatedInputTokens,
    /** @estimated Based on character length, not actual tokenizer */
    estimatedOutputTokens,
    /** @estimated Based on character length, not actual tokenizer */
    estimatedTotalTokens,
    /** @estimated No pricing source available - always null */
    estimatedCostCents: null,
    updatedAt,
  }
}

interface GetUsageQuery {
  sessionId?: string
  limit?: number
  offset?: number
}

interface GetSessionUsageParams {
  sessionId: string
}

export function registerUsageRoutes(server: FastifyInstance, context: ApiContext): void {
  const transcriptStore = context.stores.transcriptStore
  const sessionStore = context.stores.sessionStore

  /**
   * GET /api/usage
   * Returns paginated usage summaries for all sessions or a specific session.
   * Query params:
   *   - sessionId: optional filter by session ID
   *   - limit: max items per page (default 50, max 200)
   *   - offset: pagination offset (default 0)
   */
  server.get<{ Querystring: GetUsageQuery }>(
    '/api/v1/usage',
    async (
      request: FastifyRequest<{ Querystring: GetUsageQuery }>,
      reply: FastifyReply,
    ): Promise<{ data: PaginatedResponse<UsageSummary> }> => {
      if (!request.requirePermission(ResourceType.observability, Action.read)) {
        return reply
      }
      const { sessionId, limit = 50, offset = 0 } = request.query
      const now = new Date().toISOString()

      // Enforce max limit
      const effectiveLimit = Math.min(limit, 200)
      const effectiveOffset = Math.max(0, offset)

      const usageSummaries: UsageSummary[] = []

      if (sessionId) {
        // Get usage for specific session
        const transcripts = transcriptStore.findBySession(sessionId)
        if (transcripts.length > 0) {
          const summary = calculateUsageSummary(sessionId, transcripts, now)
          usageSummaries.push(summary)
        } else {
          // Session has no transcripts - return empty summary
          const summary: UsageSummary = {
            sessionId,
            messageCount: 0,
            turnCount: 0,
            toolCallCount: 0,
            approvalCount: 0,
            artifactCount: 0,
            runCount: 0,
            estimatedInputTokens: 0,
            estimatedOutputTokens: 0,
            estimatedTotalTokens: 0,
            estimatedCostCents: null,
            updatedAt: now,
          }
          usageSummaries.push(summary)
        }
      } else {
        // Get all sessions and calculate usage for each
        const sessions = sessionStore.list({ limit: 1000 })

        for (const session of sessions) {
          const transcripts = transcriptStore.findBySession(session.sessionId)
          const summary = calculateUsageSummary(session.sessionId, transcripts, now)
          usageSummaries.push(summary)
        }
      }

      // Apply pagination
      const total = usageSummaries.length
      const paginatedItems = usageSummaries.slice(effectiveOffset, effectiveOffset + effectiveLimit)

      const response: PaginatedResponse<UsageSummary> = {
        items: paginatedItems,
        total,
        limit: effectiveLimit,
        offset: effectiveOffset,
        hasMore: effectiveOffset + paginatedItems.length < total,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  /**
   * GET /api/sessions/:sessionId/usage
   * Returns usage summary for a specific session.
   */
  server.get<{ Params: GetSessionUsageParams }>(
    '/api/v1/sessions/:sessionId/usage',
    async (
      request: FastifyRequest<{ Params: GetSessionUsageParams }>,
      reply: FastifyReply,
    ): Promise<{ data: UsageSummary }> => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params
      const now = new Date().toISOString()

      // Verify session exists
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      // Get transcripts for this session
      const transcripts = transcriptStore.findBySession(sessionId)

      // Calculate usage summary
      const summary = calculateUsageSummary(sessionId, transcripts, now)

      return { data: summary }
    },
  )
}
