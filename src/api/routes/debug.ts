import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { EventRecord } from '../../storage/event-store.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

interface ReplayParams {
  sessionId: string
}

interface RedactedPreview {
  eventId: string
  eventType: string
  preview: string
}

interface ReplayResponse {
  eventCount: number
  transcriptCount: number
  runRefs: string[]
  approvalRefs: string[]
  lastEventId: string | null
  redactedPreviews: RedactedPreview[]
}

const PREVIEW_MAX_LENGTH = 100

const SENSITIVE_FIELDS = new Set([
  'apiKey',
  'api_key',
  'password',
  'secret',
  'token',
  'credential',
  'authorization',
  'auth',
])

function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = '[redacted]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactSensitiveFields(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

function createRedactedPreview(event: EventRecord): RedactedPreview {
  if (event.sensitivity !== 'low') {
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      preview: '[redacted]',
    }
  }

  const redactedPayload = redactSensitiveFields(event.payload)
  let previewStr = JSON.stringify(redactedPayload)

  if (previewStr.length > PREVIEW_MAX_LENGTH) {
    previewStr = previewStr.substring(0, PREVIEW_MAX_LENGTH) + '...'
  }

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    preview: previewStr,
  }
}

export function registerDebugRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{
    Params: ReplayParams
  }>(
    '/api/v1/debug/replay/:sessionId',
    async (request: FastifyRequest<{ Params: ReplayParams }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.sessions, Action.read)) {
        return reply
      }
      const { sessionId } = request.params

      const events = context.stores.eventStore.query({ sessionId })
      const transcripts = context.stores.transcriptStore.findBySession(sessionId)

      if (events.length === 0 && transcripts.length === 0) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      const eventCount = events.length
      const transcriptCount = transcripts.length

      const runRefs = new Set<string>()
      const approvalRefs = new Set<string>()

      for (const event of events) {
        if (event.relatedRefs?.runId) {
          runRefs.add(event.relatedRefs.runId)
        }
        if (event.relatedRefs?.plannerRunId) {
          runRefs.add(event.relatedRefs.plannerRunId)
        }
        if (event.relatedRefs?.backgroundRunId) {
          runRefs.add(event.relatedRefs.backgroundRunId)
        }
        if (event.relatedRefs?.subagentRunId) {
          runRefs.add(event.relatedRefs.subagentRunId)
        }
        if (event.relatedRefs?.workflowRunId) {
          runRefs.add(event.relatedRefs.workflowRunId)
        }
        if (event.relatedRefs?.approvalId) {
          approvalRefs.add(event.relatedRefs.approvalId)
        }
      }

      for (const transcript of transcripts) {
        if (transcript.runtimeSummary?.plannerRunIds) {
          for (const runId of transcript.runtimeSummary.plannerRunIds) {
            runRefs.add(runId)
          }
        }
      }

      const lastEvent = events.length > 0 ? events[events.length - 1] : null

      const redactedPreviews = events.slice(0, 10).map(createRedactedPreview)

      const response: ReplayResponse = {
        eventCount,
        transcriptCount,
        runRefs: Array.from(runRefs),
        approvalRefs: Array.from(approvalRefs),
        lastEventId: lastEvent?.eventId ?? null,
        redactedPreviews,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
