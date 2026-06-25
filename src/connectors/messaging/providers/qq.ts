/**
 * QQ Bot plain-text messaging adapter.
 *
 * Handles inbound QQ event callback payloads for C2C (direct),
 * group, and channel text messages. Delegates outbound delivery
 * through an injected MessagingTransport with token refresh seam.
 *
 * Only plain text and markdown messages are supported — rich media
 * uploads and live WebSocket are out of scope.
 */

import { createHmac } from 'node:crypto'
import type {
  MessagingAdapter,
  MessagingCapabilities,
  MessagingTransport,
  MessagingTransportResult,
  DeliveryTarget,
  OutboundTextMessage,
  InboundRawEvent,
  NormalizedInboundMessage,
  MessagingProviderId,
} from '../types.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface QQConfig {
  appId: string
  appSecret: string
  sandbox?: boolean
}

// ---------------------------------------------------------------------------
// QQ event shapes
// ---------------------------------------------------------------------------

/** QQ event types for different message sources. */
type QQEventType =
  | 'C2C_MESSAGE_CREATE'
  | 'GROUP_AT_MESSAGE_CREATE'
  | 'AT_MESSAGE_CREATE'

interface QQEventAuthor {
  id: string
  username?: string
  member_openid?: string
}

interface QQEventData {
  id: string
  content: string
  author: QQEventAuthor
  channel_id?: string
  group_openid?: string
  guild_id?: string
  timestamp?: string
}

interface QQEventPayload {
  d: QQEventData
  event_type: QQEventType
}

// ---------------------------------------------------------------------------
// QQAdapter
// ---------------------------------------------------------------------------

const PROVIDER_ID: MessagingProviderId = 'qq'

export class QQAdapter implements MessagingAdapter {
  private readonly config: QQConfig
  private readonly transport: MessagingTransport
  private readonly fetchFn: typeof fetch

  constructor(
    config: QQConfig,
    transport: MessagingTransport,
    fetchFn?: typeof fetch,
  ) {
    this.config = config
    this.transport = transport
    this.fetchFn = fetchFn ?? fetch
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  async handleInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const payload = this.parsePayload(event.rawPayload)
    if (!payload) {
      return null
    }

    const { d, event_type } = payload

    // Validate required fields
    if (!d.id || !d.content || !d.author?.id) {
      return null
    }

    const externalConversationId = this.resolveConversationId(
      event_type,
      d,
    )
    if (!externalConversationId) {
      return null
    }

    const timestamp = d.timestamp
      ? new Date(Number(d.timestamp) * 1000).toISOString()
      : event.receivedAt

    return {
      provider: PROVIDER_ID,
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId,
      externalUserId: d.author.id,
      externalUserName: d.author.username,
      text: d.content,
      messageId: d.id,
      timestamp,
      metadata: {
        eventType: event_type,
        groupId: d.group_openid,
        guildId: d.guild_id,
        channelId: d.channel_id,
        memberOpenid: d.author.member_openid,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  async sendOutbound(
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ): Promise<MessagingTransportResult> {
    // Token refresh seam: obtain access token before sending
    const tokenResult = await this.refreshAccessToken()
    if (!tokenResult.success) {
      const errorMessage =
        'error' in tokenResult ? tokenResult.error : 'Token refresh failed'
      return {
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: errorMessage,
          recoverable: false,
        },
      }
    }

    return this.transport.sendText(target, message)
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  async verifyInbound(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<boolean> {
    // QQ Bot webhooks may include a signature header
    const signature =
      headers['x-qq-bot-signature'] ?? headers['X-QQ-Bot-Signature']

    if (!signature) {
      return false
    }

    // Validate HMAC-SHA1 signature of the payload using appSecret
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const expected = createHmac('sha1', this.config.appSecret)
      .update(rawBody)
      .digest('hex')

    return signature === expected
  }

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities(): MessagingCapabilities {
    return {
      supportsText: true,
      supportsRichCards: false,
      supportsMedia: false,
      maxTextLength: 4096,
      supportedMessageTypes: ['text', 'markdown'],
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private parsePayload(raw: unknown): QQEventPayload | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }

    const obj = raw as Record<string, unknown>

    if (!obj.d || typeof obj.d !== 'object') {
      return null
    }

    if (typeof obj.event_type !== 'string') {
      return null
    }

    const eventType = obj.event_type as QQEventType
    const validTypes: QQEventType[] = [
      'C2C_MESSAGE_CREATE',
      'GROUP_AT_MESSAGE_CREATE',
      'AT_MESSAGE_CREATE',
    ]

    if (!validTypes.includes(eventType)) {
      return null
    }

    return obj as unknown as QQEventPayload
  }

  private resolveConversationId(
    eventType: QQEventType,
    data: QQEventData,
  ): string | null {
    switch (eventType) {
      case 'C2C_MESSAGE_CREATE':
        // C2C: conversation is the channel_id (direct message channel)
        return data.channel_id ?? null
      case 'GROUP_AT_MESSAGE_CREATE':
        // Group: conversation is the group_openid
        return data.group_openid ?? null
      case 'AT_MESSAGE_CREATE':
        // Channel: conversation is the channel_id
        return data.channel_id ?? null
      default:
        return null
    }
  }

  private async refreshAccessToken(): Promise<
    { success: true; token: string } | { success: false; error: string }
  > {
    try {
      const url = this.config.sandbox
        ? 'https://bots.qq.com/app/getAppAccessToken?sandbox=true'
        : 'https://bots.qq.com/app/getAppAccessToken'

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: this.config.appId,
          clientSecret: this.config.appSecret,
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          error: `Token endpoint returned ${response.status}`,
        }
      }

      const data = (await response.json()) as Record<string, unknown>
      if (typeof data.access_token !== 'string') {
        return { success: false, error: 'Invalid token response' }
      }

      return { success: true, token: data.access_token }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown token error'
      return { success: false, error: message }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createQQAdapter(
  config: QQConfig,
  transport: MessagingTransport,
  fetchFn?: typeof fetch,
): QQAdapter {
  return new QQAdapter(config, transport, fetchFn)
}
