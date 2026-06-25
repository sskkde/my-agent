/**
 * Telegram plain-text messaging adapter.
 *
 * Handles inbound Telegram Update webhook payloads and delegates
 * outbound delivery through an injected MessagingTransport.
 *
 * Only plain text messages are supported — rich cards, media uploads,
 * and polling are out of scope.
 */

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
import { redactSecrets } from '../secret-redaction.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  botToken: string
  webhookSecret: string
}

// ---------------------------------------------------------------------------
// Telegram Update shapes
// ---------------------------------------------------------------------------

interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramChat {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
  // Other fields omitted — photos, stickers, etc.
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
}

// ---------------------------------------------------------------------------
// TelegramAdapter
// ---------------------------------------------------------------------------

const PROVIDER_ID: MessagingProviderId = 'telegram'

export class TelegramAdapter implements MessagingAdapter {
  private readonly config: TelegramConfig
  private readonly transport: MessagingTransport

  constructor(config: TelegramConfig, transport: MessagingTransport) {
    this.config = config
    this.transport = transport
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  async handleInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const update = this.parseUpdate(event.rawPayload)
    if (!update) {
      return null
    }

    // Use message, edited_message, channel_post, or edited_channel_post
    const msg =
      update.message ??
      update.edited_message ??
      update.channel_post ??
      update.edited_channel_post

    if (!msg) {
      return null
    }

    // Only handle text messages
    if (typeof msg.text !== 'string' || msg.text.length === 0) {
      return null
    }

    const chatId = String(msg.chat.id)
    const messageId = String(msg.message_id)

    // from may be absent for channel posts sent by the channel itself
    const fromId = msg.from ? String(msg.from.id) : chatId
    const fromName = msg.from?.first_name

    const timestamp = msg.date
      ? new Date(msg.date * 1000).toISOString()
      : event.receivedAt

    return {
      provider: PROVIDER_ID,
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId: chatId,
      externalUserId: fromId,
      externalUserName: fromName,
      text: msg.text,
      messageId,
      timestamp,
      metadata: {
        chatType: msg.chat.type,
        chatTitle: msg.chat.title,
        updateId: update.update_id,
        fromUsername: msg.from?.username,
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
    return this.transport.sendText(target, message)
  }

  /**
   * Build the outbound request body that would be sent to the Telegram
   * sendMessage API. Exposed for transport integration but currently
   * delegated through MessagingTransport.sendText().
   */
  buildSendBody(message: OutboundTextMessage): {
    url: string
    body: { chat_id: string; text: string; parse_mode: string }
  } {
    return {
      url: `/bot${this.config.botToken}/sendMessage`,
      body: {
        chat_id: message.targetConversationId,
        text: message.text,
        parse_mode: 'HTML',
      },
    }
  }

  /**
   * Build evidence-safe payload (token redacted).
   * Structures the botToken in a named field so redactSecrets can mask it.
   */
  buildSendEvidence(message: OutboundTextMessage): Record<string, unknown> {
    return redactSecrets({
      botToken: this.config.botToken,
      chatId: message.targetConversationId,
      text: message.text,
      parseMode: 'HTML',
    }) as Record<string, unknown>
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  async verifyInbound(
    _payload: unknown,
    headers: Record<string, string>,
  ): Promise<boolean> {
    // Telegram sends the secret token in this header when a webhook
    // secret is configured via setWebhook(secret_token=...).
    const secretToken =
      headers['x-telegram-bot-api-secret-token'] ??
      headers['X-Telegram-Bot-Api-Secret-Token']

    if (!secretToken) {
      return false
    }

    return secretToken === this.config.webhookSecret
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
      supportedMessageTypes: ['text'],
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private parseUpdate(raw: unknown): TelegramUpdate | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }
    const obj = raw as Record<string, unknown>

    if (typeof obj.update_id !== 'number') {
      return null
    }

    return obj as unknown as TelegramUpdate
  }
}

// ---------------------------------------------------------------------------
// 429 parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a Telegram 429 response body into rate-limit metadata.
 *
 * Telegram returns JSON like:
 *   { "ok": false, "error_code": 429, "description": "Too Many Requests: retry after 5" }
 *
 * @param body - Parsed JSON body of the 429 response.
 * @returns Retry-after metadata, or undefined if unparseable.
 */
export function parseTelegram429(body: Record<string, unknown>): {
  retryAfterMs?: number
} | undefined {
  if (body.error_code !== 429) {
    return undefined
  }

  const description = typeof body.description === 'string' ? body.description : ''

  // Extract "retry after N" from the description
  const match = description.match(/retry after (\d+)/i)
  if (match?.[1]) {
    const seconds = Number(match[1])
    if (!Number.isNaN(seconds) && seconds > 0) {
      return { retryAfterMs: seconds * 1000 }
    }
  }

  return { retryAfterMs: undefined }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTelegramAdapter(
  config: TelegramConfig,
  transport: MessagingTransport,
): TelegramAdapter {
  return new TelegramAdapter(config, transport)
}
