/**
 * WeChat Official Account plain-text messaging adapter.
 *
 * Handles inbound WeChat webhook payloads (XML for official accounts,
 * JSON for iLink mode) and delegates outbound delivery through an
 * injected MessagingTransport.
 *
 * Only plain text messages are supported — rich cards, media uploads,
 * AES encryption, and personal-account automation are out of scope.
 */

import * as crypto from 'node:crypto'
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

export interface WeChatConfig {
  botToken: string
  appSecret: string
  appId?: string
  encodingAesKey?: string
  mode?: 'official' | 'ilink'
}

// ---------------------------------------------------------------------------
// Parsed WeChat XML message shape
// ---------------------------------------------------------------------------

interface WeChatXmlMessage {
  toUserName: string
  fromUserName: string
  createTime: string
  msgType: string
  content?: string
  msgId?: string
  event?: string
  eventKey?: string
}

// ---------------------------------------------------------------------------
// iLink JSON message shape
// ---------------------------------------------------------------------------

interface WeChatILinkMessage {
  FromUserName: string
  ToUserName: string
  CreateTime: number
  MsgType: string
  Content?: string
  MsgId?: string
}

// ---------------------------------------------------------------------------
// WeChatAdapter
// ---------------------------------------------------------------------------

const PROVIDER_ID: MessagingProviderId = 'wechat'

export class WeChatAdapter implements MessagingAdapter {
  private readonly config: WeChatConfig
  private readonly transport: MessagingTransport

  constructor(config: WeChatConfig, transport: MessagingTransport) {
    this.config = config
    this.transport = transport
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  async handleInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const mode = this.config.mode ?? 'official'

    if (mode === 'ilink') {
      return this.handleILinkInbound(event)
    }
    return this.handleOfficialInbound(event)
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
    const mode = this.config.mode ?? 'official'

    if (mode === 'ilink') {
      return this.verifyILinkInbound(payload, headers)
    }
    return this.verifyOfficialInbound(payload, headers)
  }

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  getCapabilities(): MessagingCapabilities {
    return {
      supportsText: true,
      supportsRichCards: false,
      supportsMedia: false,
      maxTextLength: 2048,
      supportedMessageTypes: ['text'],
    }
  }

  // -------------------------------------------------------------------------
  // Private: Official account XML handling
  // -------------------------------------------------------------------------

  private handleOfficialInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const msg = this.parseXmlMessage(event.rawPayload)
    if (!msg) {
      return Promise.resolve(null)
    }

    // Only handle plain text messages
    if (msg.msgType !== 'text' || !msg.content) {
      return Promise.resolve(null)
    }

    const fromUser = msg.fromUserName
    const toUser = msg.toUserName
    const msgId = msg.msgId

    if (!fromUser || !toUser || !msgId) {
      return Promise.resolve(null)
    }

    const timestamp = msg.createTime
      ? new Date(Number(msg.createTime) * 1000).toISOString()
      : event.receivedAt

    return Promise.resolve({
      provider: PROVIDER_ID,
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId: fromUser,
      externalUserId: fromUser,
      text: msg.content,
      messageId: msgId,
      timestamp,
      metadata: {
        toUserName: toUser,
      },
    })
  }

  private verifyOfficialInbound(
    _payload: unknown,
    headers: Record<string, string>,
  ): boolean {
    // WeChat sends signature via query params; we expect them in headers
    // from the webhook framework layer.
    const signature =
      headers['signature'] ?? headers['Signature'] ?? undefined
    const timestamp =
      headers['timestamp'] ?? headers['Timestamp'] ?? undefined
    const nonce = headers['nonce'] ?? headers['Nonce'] ?? undefined

    if (!signature || !timestamp || !nonce) {
      return false
    }

    return this.validateSignature(signature, timestamp, nonce)
  }

  /**
   * Validate WeChat signature: SHA1(sort([token, timestamp, nonce])).
   */
  validateSignature(signature: string, timestamp: string, nonce: string): boolean {
    const arr = [this.config.botToken, timestamp, nonce].sort()
    const joined = arr.join('')
    const hash = crypto.createHash('sha1').update(joined).digest('hex')
    return hash === signature
  }

  /**
   * Parse a WeChat XML message payload into a structured object.
   * Returns null if the payload is not valid XML or missing required fields.
   */
  parseXmlMessage(raw: unknown): WeChatXmlMessage | null {
    if (typeof raw !== 'string') {
      return null
    }

    const xml = raw.trim()
    if (!xml.startsWith('<xml>') || !xml.includes('<MsgType>')) {
      return null
    }

    const extractCData = (tag: string): string | undefined => {
      const regex = new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]></${tag}>`)
      const match = xml.match(regex)
      return match?.[1]
    }

    const extractValue = (tag: string): string | undefined => {
      const cdata = extractCData(tag)
      if (cdata !== undefined) return cdata
      const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`)
      const match = xml.match(regex)
      return match?.[1]
    }

    const toUserName = extractValue('ToUserName')
    const fromUserName = extractValue('FromUserName')
    const createTime = extractValue('CreateTime')
    const msgType = extractValue('MsgType')

    if (!toUserName || !fromUserName || !createTime || !msgType) {
      return null
    }

    return {
      toUserName,
      fromUserName,
      createTime,
      msgType,
      content: extractValue('Content'),
      msgId: extractValue('MsgId'),
      event: extractValue('Event'),
      eventKey: extractValue('EventKey'),
    }
  }

  // -------------------------------------------------------------------------
  // Private: iLink JSON handling
  // -------------------------------------------------------------------------

  private handleILinkInbound(
    event: InboundRawEvent,
  ): Promise<NormalizedInboundMessage | null> {
    const msg = this.parseILinkMessage(event.rawPayload)
    if (!msg) {
      return Promise.resolve(null)
    }

    if (msg.MsgType !== 'text' || !msg.Content) {
      return Promise.resolve(null)
    }

    const fromUser = msg.FromUserName
    const toUser = msg.ToUserName
    const msgId = msg.MsgId

    if (!fromUser || !toUser || !msgId) {
      return Promise.resolve(null)
    }

    const timestamp = msg.CreateTime
      ? new Date(msg.CreateTime * 1000).toISOString()
      : event.receivedAt

    return Promise.resolve({
      provider: PROVIDER_ID,
      connectorInstanceId: event.connectorInstanceId,
      externalConversationId: fromUser,
      externalUserId: fromUser,
      text: msg.Content,
      messageId: msgId,
      timestamp,
      metadata: {
        toUserName: toUser,
      },
    })
  }

  private verifyILinkInbound(
    _payload: unknown,
    headers: Record<string, string>,
  ): boolean {
    // iLink verification uses the same SHA1 pattern
    const signature = headers['signature'] ?? headers['Signature']
    const timestamp = headers['timestamp'] ?? headers['Timestamp']
    const nonce = headers['nonce'] ?? headers['Nonce']

    if (!signature || !timestamp || !nonce) {
      return false
    }

    return this.validateSignature(signature, timestamp, nonce)
  }

  private parseILinkMessage(raw: unknown): WeChatILinkMessage | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }

    const obj = raw as Record<string, unknown>
    if (
      typeof obj.FromUserName !== 'string' ||
      typeof obj.ToUserName !== 'string' ||
      typeof obj.MsgType !== 'string'
    ) {
      return null
    }

    return {
      FromUserName: obj.FromUserName,
      ToUserName: obj.ToUserName,
      CreateTime: typeof obj.CreateTime === 'number' ? obj.CreateTime : 0,
      MsgType: obj.MsgType,
      Content: typeof obj.Content === 'string' ? obj.Content : undefined,
      MsgId: typeof obj.MsgId === 'string' ? obj.MsgId : undefined,
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWeChatAdapter(
  config: WeChatConfig,
  transport: MessagingTransport,
): WeChatAdapter {
  return new WeChatAdapter(config, transport)
}
