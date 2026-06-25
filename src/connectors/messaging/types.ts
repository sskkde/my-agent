/**
 * Shared messaging contracts for multi-provider messaging connectors.
 * Provider-agnostic types for inbound/outbound message flows.
 */

// ---------------------------------------------------------------------------
// Provider identifiers
// ---------------------------------------------------------------------------

export type MessagingProviderId = 'feishu' | 'telegram' | 'dingtalk' | 'qq' | 'wechat'

// ---------------------------------------------------------------------------
// Inbound types
// ---------------------------------------------------------------------------

/** Raw event received from a provider webhook / polling endpoint. */
export interface InboundRawEvent {
  provider: MessagingProviderId
  connectorInstanceId: string
  rawPayload: unknown
  receivedAt: string
  headers?: Record<string, string>
}

/** Normalized inbound message after provider-specific parsing. */
export interface NormalizedInboundMessage {
  provider: MessagingProviderId
  connectorInstanceId: string
  externalConversationId: string
  externalUserId: string
  externalUserName?: string
  text: string
  messageId: string
  timestamp: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Outbound types
// ---------------------------------------------------------------------------

/** Outbound text message to be delivered through a provider transport. */
export interface OutboundTextMessage {
  text: string
  targetConversationId: string
  targetUserId?: string
  metadata?: Record<string, unknown>
}

/** Routing information for delivering a message. */
export interface DeliveryTarget {
  provider: MessagingProviderId
  connectorInstanceId: string
  conversationId: string
  userId?: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** Declares what a messaging provider/connector supports. */
export interface MessagingCapabilities {
  supportsText: boolean
  supportsRichCards: boolean
  supportsMedia: boolean
  maxTextLength?: number
  supportedMessageTypes: string[]
}

// ---------------------------------------------------------------------------
// Transport result
// ---------------------------------------------------------------------------

/** Result returned by transport send operations. */
export interface MessagingTransportResult {
  success: boolean
  messageId?: string
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
  rateLimitInfo?: {
    retryAfterMs?: number
    remaining?: number
  }
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

/**
 * Low-level transport for sending messages and verifying webhooks.
 * Implementations should be injectable and testable without real network.
 */
export interface MessagingTransport {
  sendText(target: DeliveryTarget, message: OutboundTextMessage): Promise<MessagingTransportResult>
  verifyWebhook(
    payload: unknown,
    headers: Record<string, string>,
    config: Record<string, unknown>,
  ): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * High-level messaging adapter that bridges raw provider events to
 * normalized messages and delegates outbound delivery to a transport.
 * Integrates with the existing ConnectorAdapter concept.
 */
export interface MessagingAdapter {
  handleInbound(event: InboundRawEvent): Promise<NormalizedInboundMessage | null>
  sendOutbound(target: DeliveryTarget, message: OutboundTextMessage): Promise<MessagingTransportResult>
  verifyInbound(payload: unknown, headers: Record<string, string>): Promise<boolean>
  getCapabilities(): MessagingCapabilities
}
