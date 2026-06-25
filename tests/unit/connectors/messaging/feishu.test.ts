/**
 * Tests for FeishuAdapter — inbound normalization, outbound delegation,
 * verification token/signature validation, and capability reporting.
 *
 * Uses MockMessagingTransport — no real HTTP requests.
 */

import { describe, it, expect } from 'vitest'
import {
  FeishuAdapter,
  createFeishuAdapter,
} from '../../../../src/connectors/messaging/providers/feishu.js'
import type { FeishuConfig } from '../../../../src/connectors/messaging/providers/feishu.js'
import {
  createMockTransport,
} from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  InboundRawEvent,
  DeliveryTarget,
  OutboundTextMessage,
} from '../../../../src/connectors/messaging/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const feishuConfig: FeishuConfig = {
  appId: 'cli_test_app_id',
  appSecret: 'test_app_secret_value',
  verificationToken: 'test_verification_token_abc123',
}

const feishuConfigWithEncrypt: FeishuConfig = {
  ...feishuConfig,
  encryptKey: 'test_encrypt_key',
}

function makeFeishuEventCallback(
  overrides: {
    token?: string
    messageType?: string
    content?: string
    chatId?: string
    messageId?: string
    openId?: string
    chatType?: string
    createTime?: string
  } = {},
): Record<string, unknown> {
  return {
    schema: '2.0',
    header: {
      event_id: 'evt_001',
      event_type: 'im.message.receive_v1',
      create_time: '1700000000000',
      token: overrides.token ?? feishuConfig.verificationToken,
      app_id: feishuConfig.appId,
      tenant_key: 'tenant_001',
    },
    event: {
      sender: {
        sender_id: {
          open_id: overrides.openId ?? 'ou_user_001',
          user_id: 'uid_001',
          union_id: 'union_001',
        },
        sender_type: 'user',
        tenant_key: 'tenant_001',
      },
      message: {
        chat_id: overrides.chatId ?? 'oc_chat_001',
        chat_type: overrides.chatType ?? 'p2p',
        message_id: overrides.messageId ?? 'om_msg_001',
        root_id: '',
        parent_id: '',
        create_time: overrides.createTime ?? '1700000000000',
        message_type: overrides.messageType ?? 'text',
        content: overrides.content ?? '{"text":"hello from feishu"}',
      },
    },
  }
}

function makeRawEvent(
  rawPayload: unknown,
  overrides?: Partial<InboundRawEvent>,
): InboundRawEvent {
  return {
    provider: 'feishu',
    connectorInstanceId: 'inst-feishu-001',
    rawPayload,
    receivedAt: '2026-01-01T00:00:00Z',
    headers: {},
    ...overrides,
  }
}

const sampleTarget: DeliveryTarget = {
  provider: 'feishu',
  connectorInstanceId: 'inst-feishu-001',
  conversationId: 'oc_chat_001',
  userId: 'ou_user_001',
}

const sampleMessage: OutboundTextMessage = {
  text: 'hello from agent',
  targetConversationId: 'oc_chat_001',
  targetUserId: 'ou_user_001',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeishuAdapter', () => {
  describe('constructor / factory', () => {
    it('should create an instance via new FeishuAdapter()', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      expect(adapter).toBeInstanceOf(FeishuAdapter)
    })

    it('should create an instance via createFeishuAdapter()', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createFeishuAdapter(feishuConfig, transport)
      expect(adapter).toBeInstanceOf(FeishuAdapter)
    })

    it('should implement MessagingAdapter interface', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      expect(typeof adapter.handleInbound).toBe('function')
      expect(typeof adapter.sendOutbound).toBe('function')
      expect(typeof adapter.verifyInbound).toBe('function')
      expect(typeof adapter.getCapabilities).toBe('function')
    })
  })

  // =========================================================================
  // handleInbound
  // =========================================================================

  describe('handleInbound', () => {
    it('should normalize a valid text message event', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback()
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('feishu')
      expect(result!.connectorInstanceId).toBe('inst-feishu-001')
      expect(result!.externalConversationId).toBe('oc_chat_001')
      expect(result!.externalUserId).toBe('ou_user_001')
      expect(result!.text).toBe('hello from feishu')
      expect(result!.messageId).toBe('om_msg_001')
    })

    it('should parse create_time epoch millis into ISO timestamp', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ createTime: '1700000000000' })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.timestamp).toBe(new Date(1700000000000).toISOString())
    })

    it('should include metadata with chatType, senderType, tenantKey', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ chatType: 'group' })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.chatType).toBe('group')
      expect(result!.metadata!.senderType).toBe('user')
      expect(result!.metadata!.tenantKey).toBe('tenant_001')
    })

    it('should return null for non-text message types (image)', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({
        messageType: 'image',
        content: '{"image_key":"img_001"}',
      })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null for non-text message types (file)', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({
        messageType: 'file',
        content: '{"file_key":"file_001"}',
      })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when rawPayload is null', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const event = makeRawEvent(null)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when rawPayload is not schema 2.0', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const event = makeRawEvent({ schema: '1.0', event: {} })

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when message body is missing', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = {
        schema: '2.0',
        header: { event_type: 'im.message.receive_v1', token: feishuConfig.verificationToken },
        event: { sender: { sender_id: { open_id: 'ou_1' } } },
      }
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when content JSON is malformed', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ content: 'not-json' })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when content JSON lacks text field', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ content: '{"image_key":"img"}' })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when chat_id is missing', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      // Force chat_id to undefined
      const rawPayload = makeFeishuEventCallback()
      const event = makeRawEvent(rawPayload)
      // Manually delete chat_id
      const msg = (rawPayload.event as Record<string, unknown>).message as Record<string, unknown>
      delete msg.chat_id

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when open_id is missing', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const rawPayload = makeFeishuEventCallback()
      const senderId = (rawPayload.event as Record<string, unknown>).sender as Record<string, unknown>
      delete (senderId.sender_id as Record<string, unknown>).open_id
      const event = makeRawEvent(rawPayload)

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null when rawPayload is a primitive', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const result = await adapter.handleInbound(makeRawEvent('string-payload'))
      expect(result).toBeNull()
    })

    it('should handle different text content correctly', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({
        content: '{"text":"你好世界 🌍"}',
      })
      const event = makeRawEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result).not.toBeNull()
      expect(result!.text).toBe('你好世界 🌍')
    })
  })

  // =========================================================================
  // sendOutbound
  // =========================================================================

  describe('sendOutbound', () => {
    it('should delegate to transport.sendText()', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: 'om_sent_001' }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const result = await adapter.sendOutbound(sampleTarget, sampleMessage)

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('om_sent_001')

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].target.conversationId).toBe('oc_chat_001')
      expect(calls[0].message.text).toBe('hello from agent')
    })

    it('should propagate transport errors', async () => {
      const transport = createMockTransport({
        sendText: async () => ({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many', recoverable: true },
          rateLimitInfo: { retryAfterMs: 5000 },
        }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const result = await adapter.sendOutbound(sampleTarget, sampleMessage)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('RATE_LIMITED')
      expect(result.rateLimitInfo?.retryAfterMs).toBe(5000)
    })

    it('should build correct Feishu send body shape', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const body = adapter.buildSendBody(sampleMessage)

      expect(body.receive_id_type).toBe('chat_id')
      expect(body.receive_id).toBe('oc_chat_001')
      expect(body.msg_type).toBe('text')
      expect(JSON.parse(body.content)).toEqual({ text: 'hello from agent' })
    })
  })

  // =========================================================================
  // verifyInbound
  // =========================================================================

  describe('verifyInbound', () => {
    it('should return true for matching verification token', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ token: feishuConfig.verificationToken })

      const result = await adapter.verifyInbound(payload, {})
      expect(result).toBe(true)
    })

    it('should reject when verification token does not match', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = makeFeishuEventCallback({ token: 'wrong_token' })

      const result = await adapter.verifyInbound(payload, {})
      expect(result).toBe(false)
    })

    it('should reject when token is missing from header', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)
      const payload = {
        schema: '2.0',
        header: { event_type: 'im.message.receive_v1' },
        event: { message: { chat_id: 'c1', message_id: 'm1', content: '{"text":"hi"}', message_type: 'text' } },
      }

      const result = await adapter.verifyInbound(payload, {})
      expect(result).toBe(false)
    })

    it('should reject when payload is null', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const result = await adapter.verifyInbound(null, {})
      expect(result).toBe(false)
    })

    it('should reject when payload is not schema 2.0', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const result = await adapter.verifyInbound({ schema: '1.0' }, {})
      expect(result).toBe(false)
    })

    it('should require x-lark-signature header when encryptKey is configured', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfigWithEncrypt, transport)
      const payload = makeFeishuEventCallback({ token: feishuConfig.verificationToken })

      // Without signature header → false
      const resultNoSig = await adapter.verifyInbound(payload, {})
      expect(resultNoSig).toBe(false)

      // With signature header → true (token matches)
      const resultWithSig = await adapter.verifyInbound(payload, {
        'x-lark-signature': 'some_signature',
      })
      expect(resultWithSig).toBe(true)
    })

    it('should not require signature header when encryptKey is not configured', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport) // no encryptKey
      const payload = makeFeishuEventCallback({ token: feishuConfig.verificationToken })

      const result = await adapter.verifyInbound(payload, {})
      expect(result).toBe(true)
    })
  })

  // =========================================================================
  // getCapabilities
  // =========================================================================

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      const caps = adapter.getCapabilities()

      expect(caps.supportsText).toBe(true)
      expect(caps.supportsRichCards).toBe(false)
      expect(caps.supportsMedia).toBe(false)
      expect(caps.maxTextLength).toBe(4096)
      expect(caps.supportedMessageTypes).toEqual(['text'])
    })
  })

  // =========================================================================
  // Integration: inbound → outbound round-trip
  // =========================================================================

  describe('round-trip (inbound → outbound)', () => {
    it('should normalize inbound then send outbound through transport', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: 'om_reply_001' }),
        verifyWebhook: async () => true,
      })
      const adapter = new FeishuAdapter(feishuConfig, transport)

      // Inbound
      const payload = makeFeishuEventCallback()
      const inbound = await adapter.handleInbound(makeRawEvent(payload))
      expect(inbound).not.toBeNull()

      // Outbound using inbound data
      const target: DeliveryTarget = {
        provider: 'feishu',
        connectorInstanceId: inbound!.connectorInstanceId,
        conversationId: inbound!.externalConversationId,
        userId: inbound!.externalUserId,
      }
      const reply: OutboundTextMessage = {
        text: 'Got your message!',
        targetConversationId: inbound!.externalConversationId,
      }

      const result = await adapter.sendOutbound(target, reply)

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('om_reply_001')

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].target.conversationId).toBe('oc_chat_001')
      expect(calls[0].message.text).toBe('Got your message!')
    })
  })

  // =========================================================================
  // redactSecrets integration
  // =========================================================================

  describe('redactSecrets integration', () => {
    it('should not leak secrets in error paths', async () => {
      const { redactSecrets } = await import(
        '../../../../src/connectors/messaging/secret-redaction.js'
      )

      const safeConfig = redactSecrets(feishuConfig)
      expect(safeConfig).toEqual({
        appId: 'cli_test_app_id',
        appSecret: '[REDACTED]',
        verificationToken: '[REDACTED]',
      })
    })
  })
})
