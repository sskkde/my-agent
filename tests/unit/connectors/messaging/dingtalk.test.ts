/**
 * Tests for DingTalk plain-text inbound/outbound provider.
 */

import { createHmac } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { DingTalkAdapter } from '../../../../src/connectors/messaging/providers/dingtalk.js'
import { createMockTransport } from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  InboundRawEvent,
  DeliveryTarget,
  OutboundTextMessage,
} from '../../../../src/connectors/messaging/types.js'
import type { DingTalkConfig } from '../../../../src/connectors/messaging/providers/dingtalk.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: DingTalkConfig = {
  appKey: 'app-key-001',
  appSecret: 'app-secret-xyz',
  robotCode: 'bot789',
  signSecret: 'sign-secret-abc',
}

function buildCallbackPayload(overrides?: Record<string, unknown>) {
  return {
    msgtype: 'text',
    text: { content: 'hello' },
    senderStaffId: 'user123',
    conversationId: 'conv456',
    conversationType: '1',
    senderNick: 'User',
    robotCode: 'bot789',
    msgId: 'msg-001',
    createAt: 1735689600000, // 2025-01-01T00:00:00Z
    ...overrides,
  }
}

function buildInboundEvent(
  payload: unknown,
  connectorInstanceId = 'inst-dt-1',
): InboundRawEvent {
  return {
    provider: 'dingtalk',
    connectorInstanceId,
    rawPayload: payload,
    receivedAt: '2025-01-01T00:00:01Z',
  }
}

function signPayload(timestamp: string, signSecret: string): string {
  const stringToSign = `${timestamp}\n${signSecret}`
  return createHmac('sha256', signSecret).update(stringToSign).digest('base64')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DingTalkAdapter', () => {
  describe('handleInbound', () => {
    it('should normalize a text message callback', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const event = buildInboundEvent(buildCallbackPayload())

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('dingtalk')
      expect(result!.connectorInstanceId).toBe('inst-dt-1')
      expect(result!.externalConversationId).toBe('conv456')
      expect(result!.externalUserId).toBe('user123')
      expect(result!.externalUserName).toBe('User')
      expect(result!.text).toBe('hello')
      expect(result!.messageId).toBe('msg-001')
      expect(result!.timestamp).toBe('2025-01-01T00:00:00.000Z')
      expect(result!.metadata).toBeDefined()
      expect(result!.metadata!.conversationType).toBe('1')
      expect(result!.metadata!.robotCode).toBe('bot789')
    })

    it('should return null for non-text messages', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const event = buildInboundEvent(
        buildCallbackPayload({ msgtype: 'image' }),
      )

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should return null for text messages with missing content', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const event = buildInboundEvent(
        buildCallbackPayload({ text: { content: '' } }),
      )

      const result = await adapter.handleInbound(event)
      expect(result).toBeNull()
    })

    it('should trim whitespace from text content', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const event = buildInboundEvent(
        buildCallbackPayload({ text: { content: '  hello world  ' } }),
      )

      const result = await adapter.handleInbound(event)
      expect(result!.text).toBe('hello world')
    })

    it('should generate messageId from senderStaffId + createAt when msgId is absent', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const payload = buildCallbackPayload()
      delete (payload as Record<string, unknown>).msgId
      const event = buildInboundEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result!.messageId).toBe('user123-1735689600000')
    })

    it('should fall back to receivedAt when createAt is absent', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const payload = buildCallbackPayload()
      delete (payload as Record<string, unknown>).createAt
      const event = buildInboundEvent(payload)

      const result = await adapter.handleInbound(event)
      expect(result!.timestamp).toBe('2025-01-01T00:00:01Z')
    })

    it('should redact secrets in metadata.raw', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const payload = buildCallbackPayload({ appSecret: 'super-secret' })
      const event = buildInboundEvent(payload)

      const result = await adapter.handleInbound(event)
      const raw = result!.metadata!.raw as Record<string, unknown>
      expect(raw.appSecret).toBe('[REDACTED]')
    })
  })

  describe('sendOutbound', () => {
    it('should delegate to transport.sendText', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: 'dt-msg-1' }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const target: DeliveryTarget = {
        provider: 'dingtalk',
        connectorInstanceId: 'inst-dt-1',
        conversationId: 'conv456',
      }
      const message: OutboundTextMessage = {
        text: 'Reply from bot',
        targetConversationId: 'conv456',
      }

      const result = await adapter.sendOutbound(target, message)

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('dt-msg-1')

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].target.conversationId).toBe('conv456')
      expect(calls[0].message.text).toBe('Reply from bot')
    })

    it('should propagate transport errors', async () => {
      const transport = createMockTransport({
        sendText: async () => ({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many', recoverable: true },
        }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const target: DeliveryTarget = {
        provider: 'dingtalk',
        connectorInstanceId: 'inst-dt-1',
        conversationId: 'conv456',
      }
      const message: OutboundTextMessage = {
        text: 'test',
        targetConversationId: 'conv456',
      }

      const result = await adapter.sendOutbound(target, message)
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('RATE_LIMITED')
    })
  })

  describe('verifyInbound', () => {
    it('should accept a valid signature with correct timestamp', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const now = Date.now().toString()
      const sign = signPayload(now, BASE_CONFIG.signSecret!)

      const result = await adapter.verifyInbound({}, {
        timestamp: now,
        sign,
      })

      expect(result).toBe(true)
    })

    it('should reject wrong signature', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const now = Date.now().toString()

      const result = await adapter.verifyInbound({}, {
        timestamp: now,
        sign: 'wrong-signature',
      })

      expect(result).toBe(false)
    })

    it('should reject stale timestamp (outside 1-hour skew)', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      // 2 hours ago
      const staleTs = (Date.now() - 2 * 60 * 60 * 1000).toString()
      const sign = signPayload(staleTs, BASE_CONFIG.signSecret!)

      const result = await adapter.verifyInbound({}, {
        timestamp: staleTs,
        sign,
      })

      expect(result).toBe(false)
    })

    it('should reject when sign header is missing', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const now = Date.now().toString()
      const result = await adapter.verifyInbound({}, { timestamp: now })
      expect(result).toBe(false)
    })

    it('should reject when timestamp header is missing', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const result = await adapter.verifyInbound({}, { sign: 'abc' })
      expect(result).toBe(false)
    })

    it('should reject non-numeric timestamp', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      const result = await adapter.verifyInbound({}, {
        timestamp: 'not-a-number',
        sign: 'abc',
      })

      expect(result).toBe(false)
    })

    it('should skip verification when signSecret is not configured', async () => {
      const configNoSign: DingTalkConfig = {
        appKey: 'key',
        appSecret: 'secret',
        robotCode: 'bot',
      }
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(configNoSign, transport)

      const result = await adapter.verifyInbound({}, {})
      expect(result).toBe(true)
    })
  })

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)
      const caps = adapter.getCapabilities()

      expect(caps.supportsText).toBe(true)
      expect(caps.supportsRichCards).toBe(false)
      expect(caps.supportsMedia).toBe(false)
      expect(caps.maxTextLength).toBe(20000)
      expect(caps.supportedMessageTypes).toEqual(['text'])
    })
  })

  describe('MessagingAdapter interface compliance', () => {
    it('should implement all MessagingAdapter methods', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new DingTalkAdapter(BASE_CONFIG, transport)

      expect(typeof adapter.handleInbound).toBe('function')
      expect(typeof adapter.sendOutbound).toBe('function')
      expect(typeof adapter.verifyInbound).toBe('function')
      expect(typeof adapter.getCapabilities).toBe('function')
    })
  })
})
