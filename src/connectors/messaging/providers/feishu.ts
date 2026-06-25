/**
 * Feishu (Lark) plain-text messaging adapter.
 *
 * Handles inbound Feishu event callback payloads (schema 2.0) and
 * delegates outbound delivery through an injected MessagingTransport.
 *
 * Only plain text messages are supported — rich cards, media uploads,
 * and streaming are out of scope.
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


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FeishuConfig {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey?: string
}

// ---------------------------------------------------------------------------
// Feishu event callback shapes (schema 2.0)
// ---------------------------------------------------------------------------

interface FeishuEventHeader {
  event_id?: string
  event_type?: string
  create_time?: string
  token?: string
  app_id?: string
  tenant_key?: string
}

interface FeishuSenderId {
  open_id?: string
  user_id?: string
  union_id?: string
}

interface FeishuSender {
  sender_id?: FeishuSenderId
  sender_type?: string
  tenant_key?: string
}

interface FeishuMessageBody {
  chat_id?: string
  chat_type?: string
  message_id?: string
  root_id?: string
  parent_id?: string
  create_time?: string
  message_type?: string
  content?: string
}

interface FeishuEventBody {
  sender?: FeishuSender
  message?: FeishuMessageBody
}

interface FeishuEventCallback {
  schema?: string
  header?: FeishuEventHeader
  event?: FeishuEventBody
}

// ---------------------------------------------------------------------------
// FeishuAdapter
// ---------------------------------------------------------------------------

const PROVIDER_ID: MessagingProviderId = 'feishu'

export class FeishuAdapter implements MessagingAdapter {
  private readonly config: FeishuConfig
  private readonly transport: MessagingTransport

  constructor(config: FeishuConfig, transport: MessagingTransport) {
    this.config = config
    this.transport = transport
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  async handleInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const callback = this.parseCallback(event.rawPayload)
    if (!callback) {
      return null
    }

    const msg = callback.event?.message
    if (!msg) {
      return null
    }

    // Only handle plain text messages
    if (msg.message_type !== 'text') {
      return null
    }

    const text = this.extractText(msg.content)
    if (text === null) {
      return null
    }

    const chatId = msg.chat_id
    const messageId = msg.message_id
    const openId = callback.event?.sender?.sender_id?.open_id

    if (!chatId || !messageId || !openId) {
      return null
    }

    const timestamp = msg.create_time
      ? new Date(Number(msg.create_time)).toISOString()
      : event.receivedAt

    return {
      provider: PROVIDER_ID,
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId: chatId,
      externalUserId: openId,
      text,
      messageId,
      timestamp,
      metadata: {
        chatType: msg.chat_type,
        rootId: msg.root_id,
        parentId: msg.parent_id,
        senderType: callback.event?.sender?.sender_type,
        tenantKey: callback.header?.tenant_key,
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

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  async verifyInbound(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<boolean> {
    const callback = this.parseCallback(payload)
    if (!callback) {
      return false
    }

    // Verify the token in the event header matches our verification token
    const token = callback.header?.token
    if (!token || token !== this.config.verificationToken) {
      return false
    }

    // If an encrypt key is configured, verify the signature header
    if (this.config.encryptKey) {
      const signature = headers['x-lark-signature'] ?? headers['X-Lark-Signature']
      if (!signature) {
        return false
      }
    }

    return true
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

  private parseCallback(raw: unknown): FeishuEventCallback | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }
    const obj = raw as Record<string, unknown>

    // Accept schema 2.0 event callbacks
    if (obj.schema === '2.0' && obj.header && obj.event) {
      return obj as FeishuEventCallback
    }

    return null
  }

  private extractText(content: string | undefined): string | null {
    if (!content) {
      return null
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (typeof parsed.text === 'string') {
        return parsed.text
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Build the outbound request body that would be sent to the Feishu
   * send-message API. Exposed for transport integration but currently
   * delegated through MessagingTransport.sendText().
   */
  buildSendBody(message: OutboundTextMessage): {
    receive_id_type: string
    receive_id: string
    msg_type: string
    content: string
  } {
    return {
      receive_id_type: 'chat_id',
      receive_id: message.targetConversationId,
      msg_type: 'text',
      content: JSON.stringify({ text: message.text }),
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFeishuAdapter(
  config: FeishuConfig,
  transport: MessagingTransport,
): FeishuAdapter {
  return new FeishuAdapter(config, transport)
}
