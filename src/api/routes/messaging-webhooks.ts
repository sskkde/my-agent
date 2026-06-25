/**
 * Messaging Webhook Ingress Routes
 *
 * Accepts provider-specific webhook payloads (Telegram, Feishu, DingTalk, etc.)
 * and routes them through the existing message processing pipeline.
 *
 * Flow:
 * 1. Resolve connector instance by connectorInstanceId
 * 2. Verify instance exists and is an active messaging connector
 * 3. Resolve the MessagingAdapter for the provider
 * 4. Verify inbound payload signature via adapter
 * 5. Normalize the raw event into a NormalizedInboundMessage
 * 6. Look up or create a session channel mapping
 * 7. Feed through the gateway → message processor → outbound delivery
 *
 * Provider-specific logic lives entirely in the MessagingAdapter implementations;
 * this route handler is provider-agnostic.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { ConnectorStore, ConnectorInstance, ConnectorDefinition } from '../../storage/connector-store.js'
import type { SessionChannelMapStore } from '../../storage/session-channel-map-store.js'
import type {
  MessagingAdapter,
  MessagingProviderId,
  InboundRawEvent,
  NormalizedInboundMessage,
} from '../../connectors/messaging/types.js'
import { redactSecrets } from '../../connectors/messaging/secret-redaction.js'
import { convertInboundEnvelopeToProcessorInput } from '../../processing/message-processor.js'
import { generateId, SESSION_ID_PREFIX } from '../../shared/ids.js'

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

/**
 * Additional dependencies for the messaging webhook route that are not
 * part of the core ApiContext. Kept separate so the test can inject mocks
 * without touching context.ts.
 */
export interface MessagingWebhookRouteDeps {
  /**
   * Resolve a MessagingAdapter for a given connector instance ID.
   * Returns undefined when no adapter is registered for the instance.
   */
  adapterResolver: (connectorInstanceId: string) => MessagingAdapter | undefined

  /** Session ↔ external-ID mapping store. */
  sessionChannelMapStore: SessionChannelMapStore
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Search the connector store for an instance matching `connectorInstanceId`.
 * Returns the instance together with its definition, or undefined when no
 * such instance exists across any status.
 */
function findInstanceByConnectorId(
  connectorStore: ConnectorStore,
  connectorInstanceId: string,
): { instance: ConnectorInstance; definition: ConnectorDefinition } | undefined {
  // Iterate through all statuses to locate the instance
  const statuses = ['active', 'inactive', 'draft', 'deprecated'] as const
  for (const status of statuses) {
    const instances = connectorStore.findInstancesByStatus(status)
    const match = instances.find((i) => i.connectorInstanceId === connectorInstanceId)
    if (match) {
      const definition = connectorStore.findDefinitionById(match.connectorDefinitionId)
      if (definition) {
        return { instance: match, definition }
      }
      // Definition missing — treat as not found
      return undefined
    }
  }
  return undefined
}

/**
 * Derive a human-readable default session title from the provider name.
 */
function defaultSessionTitle(provider: string): string {
  const ts = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${provider} 会话 ${ts}`
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerMessagingWebhookRoutes(
  server: FastifyInstance,
  context: ApiContext,
  deps: MessagingWebhookRouteDeps,
): void {
  const { connectorStore } = context.stores
  const { adapterResolver, sessionChannelMapStore } = deps

  // POST /api/v1/messaging/:provider/:connectorInstanceId/webhook
  server.post<{
    Params: { provider: string; connectorInstanceId: string }
    Body: unknown
  }>(
    '/api/v1/messaging/:provider/:connectorInstanceId/webhook',
    {
      schema: {
        params: {
          type: 'object',
          required: ['provider', 'connectorInstanceId'],
          properties: {
            provider: { type: 'string', minLength: 1 },
            connectorInstanceId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { provider: string; connectorInstanceId: string }
        Body: unknown
      }>,
      reply: FastifyReply,
    ) => {
      const { provider, connectorInstanceId } = request.params

      // ---------------------------------------------------------------
      // 1. Resolve connector instance
      // ---------------------------------------------------------------
      const resolved = findInstanceByConnectorId(connectorStore, connectorInstanceId)

      if (!resolved) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', 'Connector instance not found', request.requestId))
      }

      const { instance, definition } = resolved

      // ---------------------------------------------------------------
      // 2. Verify instance is active and of messaging type
      // ---------------------------------------------------------------
      if (definition.connectorType !== 'messaging') {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', 'Connector instance is not a messaging type', request.requestId))
      }

      if (instance.status !== 'active') {
        return reply
          .code(403)
          .send(envelopeError('FORBIDDEN', 'Connector instance is not active', request.requestId))
      }

      // Verify the URL provider matches the definition's connectorId
      if (definition.connectorId !== provider) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Provider mismatch: URL provider '${provider}' does not match connector '${definition.connectorId}'`,
              request.requestId,
            ),
          )
      }

      // ---------------------------------------------------------------
      // 3. Resolve MessagingAdapter
      // ---------------------------------------------------------------
      const adapter: MessagingAdapter | undefined = adapterResolver(connectorInstanceId)
      if (!adapter) {
        return reply
          .code(404)
          .send(
            envelopeError('NOT_FOUND', 'No messaging adapter available for this connector instance', request.requestId),
          )
      }

      // ---------------------------------------------------------------
      // 4. Verify inbound payload signature
      // ---------------------------------------------------------------
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
      )

      const isValid = await adapter.verifyInbound(request.body, headers)
      if (!isValid) {
        return reply
          .code(401)
          .send(envelopeError('UNAUTHORIZED', 'Invalid webhook signature', request.requestId))
      }

      // ---------------------------------------------------------------
      // 5. Normalize inbound event
      // ---------------------------------------------------------------
      const rawEvent: InboundRawEvent = {
        provider: provider as MessagingProviderId,
        connectorInstanceId,
        rawPayload: request.body,
        receivedAt: new Date().toISOString(),
        headers,
      }

      const normalized: NormalizedInboundMessage | null = await adapter.handleInbound(rawEvent)
      if (!normalized) {
        // Non-text or unsupported message — acknowledge but do not process
        return reply
          .code(200)
          .send(success({ status: 'acknowledged', message: 'Non-text message ignored' }, request.requestId))
      }

      // ---------------------------------------------------------------
      // 6. Look up or create session channel mapping
      // ---------------------------------------------------------------
      const existingMapping = sessionChannelMapStore.findByExternalIds(
        normalized.provider,
        normalized.externalConversationId,
        normalized.externalUserId,
        connectorInstanceId,
      )

      let userId: string
      let sessionId: string

      if (existingMapping) {
        userId = existingMapping.internalUserId
        sessionId = existingMapping.internalSessionId
        sessionChannelMapStore.updateLastSeen(existingMapping.id)
      } else {
        // Create a new internal session and mapping
        userId = instance.userId
        sessionId = generateId(SESSION_ID_PREFIX)

        context.stores.sessionStore.create({
          sessionId,
          userId,
          title: defaultSessionTitle(provider),
          status: 'active',
          messageCount: 0,
        })

        sessionChannelMapStore.createMapping({
          provider: normalized.provider,
          externalConversationId: normalized.externalConversationId,
          externalUserId: normalized.externalUserId,
          connectorInstanceId,
          internalUserId: userId,
          internalSessionId: sessionId,
        })
      }

      // ---------------------------------------------------------------
      // 7. Feed through gateway → message processor → outbound
      // ---------------------------------------------------------------
      const envelope = context.gateway.receiveUserMessage(userId, sessionId, normalized.text, connectorInstanceId)
      const processorInput = convertInboundEnvelopeToProcessorInput(envelope)

      // Update session activity timestamp
      context.stores.sessionStore.updateActivity(sessionId, new Date().toISOString())

      // Process asynchronously — same pattern as sessions.ts
      void (async () => {
        try {
          const output = await context.messageProcessor.process(processorInput)

          const messageType = output.success ? 'text' : 'error'
          const outboundEnvelope = context.gateway.formatOutbound(
            messageType,
            {
              text: output.success ? output.result?.text : undefined,
              error: output.success ? undefined : output.error,
            },
            {
              userId,
              sessionId,
              channel: envelope.sourceChannel,
            },
            envelope.envelopeId,
          )

          await context.channelRegistry.deliver(envelope.sourceChannel, outboundEnvelope)

          // Update session metadata
          const transcripts = context.stores.transcriptStore.findBySession(sessionId)
          context.stores.sessionStore.updateMetadata(sessionId, {
            messageCount: transcripts.length,
            lastActivityAt: new Date().toISOString(),
          })
        } catch (error: unknown) {
          const rawError = error instanceof Error ? error.message : 'Unknown processing error'
          const errorMessage = typeof redactSecrets(rawError) === 'string'
            ? (redactSecrets(rawError) as string)
            : rawError

          try {
            const errorEnvelope = context.gateway.formatOutbound(
              'error',
              {
                error: {
                  code: 'PROCESSING_ERROR',
                  message: errorMessage,
                },
              },
              {
                userId,
                sessionId,
                channel: envelope.sourceChannel,
              },
              envelope.envelopeId,
            )

            await context.channelRegistry.deliver(envelope.sourceChannel, errorEnvelope)
          } catch {
            // Best-effort error delivery — swallow
          }
        }
      })()

      // ---------------------------------------------------------------
      // 8. Return accepted
      // ---------------------------------------------------------------
      return reply
        .code(202)
        .send(success({ status: 'accepted', sessionId, messageId: normalized.messageId }, request.requestId))
    },
  )
}
