/**
 * Bridge that registers active messaging connector instances as deliverable
 * channels in the ChannelRegistry. Inactive/draft instances are ignored.
 */

import type {
  ChannelRegistry,
  ChannelHandler,
  DeliveryResult,
} from '../../gateway/channel-registry.js'
import type { OutboundEnvelope } from '../../gateway/types.js'
import type {
  ConnectorStore,
  ConnectorInstance,
  ConnectorDefinition,
} from '../../storage/connector-store.js'
import type {
  MessagingAdapter,
  MessagingProviderId,
  DeliveryTarget,
  OutboundTextMessage,
} from './types.js'
import { redactSecrets } from './secret-redaction.js'

/**
 * Dependencies for the MessagingChannelBridge.
 */
export interface MessagingChannelBridgeDeps {
  channelRegistry: ChannelRegistry
  connectorStore: ConnectorStore
  /** Resolve a MessagingAdapter for a given connector instance ID. */
  adapterResolver: (connectorInstanceId: string) => MessagingAdapter | undefined
}

/**
 * Scans for active messaging connector instances and registers each one as a
 * deliverable channel in the ChannelRegistry.
 */
export class MessagingChannelBridge {
  private readonly channelRegistry: ChannelRegistry
  private readonly connectorStore: ConnectorStore
  private readonly adapterResolver: (connectorInstanceId: string) => MessagingAdapter | undefined

  constructor(deps: MessagingChannelBridgeDeps) {
    this.channelRegistry = deps.channelRegistry
    this.connectorStore = deps.connectorStore
    this.adapterResolver = deps.adapterResolver
  }

  /**
   * Scan for active messaging connector instances and register each as a
   * channel handler in the ChannelRegistry.
   *
   * Only instances whose definition has `connectorType: 'messaging'` AND whose
   * adapter can be resolved are registered. Inactive, draft, and non-messaging
   * instances are silently skipped.
   */
  registerActiveProviders(): void {
    const activeInstances = this.connectorStore.findInstancesByStatus('active')

    for (const instance of activeInstances) {
      const definition = this.connectorStore.findDefinitionById(
        instance.connectorDefinitionId,
      )

      if (!definition || definition.connectorType !== 'messaging') {
        continue
      }

      const adapter = this.adapterResolver(instance.connectorInstanceId)
      if (!adapter) {
        continue
      }

      const handler = this.createDeliveryHandler(instance, definition, adapter)

      this.channelRegistry.register(instance.connectorInstanceId, handler, {
        type: 'messaging',
        status: 'active',
        configured: true,
      })
    }
  }

  /**
   * Build a ChannelHandler that delegates outbound delivery to the given
   * MessagingAdapter.
   */
  private createDeliveryHandler(
    instance: ConnectorInstance,
    definition: ConnectorDefinition,
    adapter: MessagingAdapter,
  ): ChannelHandler {
    const provider = definition.connectorId as MessagingProviderId
    const connectorInstanceId = instance.connectorInstanceId

    return {
      deliver(envelope: OutboundEnvelope): Promise<DeliveryResult> {
        const conversationId =
          (envelope.metadata?.externalConversationId as string | undefined) ??
          envelope.recipient.sessionId

        const target: DeliveryTarget = {
          provider,
          connectorInstanceId,
          conversationId,
          userId: envelope.recipient.userId,
        }

        const message: OutboundTextMessage = {
          text: envelope.content.text ?? '',
          targetConversationId: conversationId,
          targetUserId: envelope.recipient.userId,
        }

        return adapter.sendOutbound(target, message).then(
          (transportResult): DeliveryResult => ({
            success: transportResult.success,
            error: transportResult.error
              ? {
                  code: transportResult.error.code,
                  message: typeof redactSecrets(transportResult.error.message) === 'string'
                    ? (redactSecrets(transportResult.error.message) as string)
                    : transportResult.error.message,
                }
              : undefined,
            metadata: transportResult.rateLimitInfo
              ? { rateLimitInfo: transportResult.rateLimitInfo }
              : undefined,
          }),
        )
      },
    }
  }
}

/**
 * Factory function for creating a MessagingChannelBridge.
 */
export function createMessagingChannelBridge(
  deps: MessagingChannelBridgeDeps,
): MessagingChannelBridge {
  return new MessagingChannelBridge(deps)
}
