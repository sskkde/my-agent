/**
 * DingTalk plain-text inbound/outbound provider.
 * Implements MessagingAdapter for DingTalk robot callback and send API.
 *
 * Supports:
 * - Inbound: normalizes text message callbacks
 * - Outbound: sends text via DingTalk robot API
 * - Verification: HMAC-SHA256 signature + timestamp skew check
 */

import { createHmac } from 'node:crypto'
import { redactSecrets } from '../secret-redaction.js'
import type {
  MessagingAdapter,
  MessagingCapabilities,
  MessagingTransport,
  MessagingTransportResult,
  DeliveryTarget,
  OutboundTextMessage,
  InboundRawEvent,
  NormalizedInboundMessage,
} from '../types.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DingTalkConfig {
  appKey: string
  appSecret: string
  robotCode: string
  signSecret?: string
}

// ---------------------------------------------------------------------------
// Inbound payload types (DingTalk callback shape)
// ---------------------------------------------------------------------------

interface DingTalkTextContent {
  content: string
}

interface DingTalkCallbackPayload {
  msgtype: string
  text?: DingTalkTextContent
  senderStaffId: string
  conversationId: string
  conversationType: string
  senderNick: string
  robotCode: string
  msgId?: string
  createAt?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SKEW_MS = 60 * 60 * 1000 // 1 hour

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DingTalkAdapter implements MessagingAdapter {
  private readonly config: DingTalkConfig
  private readonly transport: MessagingTransport

  constructor(config: DingTalkConfig, transport: MessagingTransport) {
    this.config = config
    this.transport = transport
  }

  // ---- Inbound -------------------------------------------------------------

  async handleInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const payload = event.rawPayload as DingTalkCallbackPayload

    // Only handle text messages
    if (payload.msgtype !== 'text' || !payload.text?.content) {
      return null
    }

    return {
      provider: 'dingtalk',
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId: payload.conversationId,
      externalUserId: payload.senderStaffId,
      externalUserName: payload.senderNick,
      text: payload.text.content.trim(),
      messageId: payload.msgId ?? `${payload.senderStaffId}-${payload.createAt ?? Date.now()}`,
      timestamp: payload.createAt
        ? new Date(payload.createAt).toISOString()
        : event.receivedAt,
      metadata: {
        conversationType: payload.conversationType,
        robotCode: payload.robotCode,
        raw: redactSecrets(payload),
      },
    }
  }

  // ---- Outbound ------------------------------------------------------------

  async sendOutbound(
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ): Promise<MessagingTransportResult> {
    return this.transport.sendText(target, message)
  }

  // ---- Verification --------------------------------------------------------

  async verifyInbound(
    _payload: unknown,
    headers: Record<string, string>,
  ): Promise<boolean> {
    const signSecret = this.config.signSecret
    if (!signSecret) {
      // No sign secret configured — skip verification
      return true
    }

    const sign = headers['sign']
    const timestamp = headers['timestamp']

    if (!sign || !timestamp) {
      return false
    }

    // Reject stale timestamps
    const now = Date.now()
    const tsMs = Number(timestamp)
    if (Number.isNaN(tsMs) || Math.abs(now - tsMs) > MAX_SKEW_MS) {
      return false
    }

    // Compute expected signature: Base64(HmacSHA256(timestamp + "\n" + signSecret, signSecret))
    const stringToSign = `${timestamp}\n${signSecret}`
    const expected = createHmac('sha256', signSecret)
      .update(stringToSign)
      .digest('base64')

    return sign === expected
  }

  // ---- Capabilities --------------------------------------------------------

  getCapabilities(): MessagingCapabilities {
    return {
      supportsText: true,
      supportsRichCards: false,
      supportsMedia: false,
      maxTextLength: 20000,
      supportedMessageTypes: ['text'],
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDingTalkAdapter(
  config: DingTalkConfig,
  transport: MessagingTransport,
): DingTalkAdapter {
  return new DingTalkAdapter(config, transport)
}
