/**
 * Tests for messaging type contracts and mock transport default behavior.
 */

import { describe, it, expect } from 'vitest'
import { createMockTransport } from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  MessagingProviderId,
  InboundRawEvent,
  NormalizedInboundMessage,
  OutboundTextMessage,
  DeliveryTarget,
  MessagingCapabilities,
  MessagingTransportResult,
  MessagingTransport,
} from '../../../../src/connectors/messaging/types.js'

describe('Messaging type contracts', () => {
  describe('MessagingProviderId', () => {
    it('should accept all known provider ids', () => {
      const providers: MessagingProviderId[] = [
        'feishu',
        'telegram',
        'dingtalk',
        'qq',
        'wechat',
      ]
      expect(providers).toHaveLength(5)
    })
  })

  describe('InboundRawEvent', () => {
    it('should satisfy the expected shape', () => {
      const event: InboundRawEvent = {
        provider: 'telegram',
        connectorInstanceId: 'inst-1',
        rawPayload: { update_id: 123 },
        receivedAt: '2026-01-01T00:00:00Z',
        headers: { 'x-signature': 'abc' },
      }
      expect(event.provider).toBe('telegram')
      expect(event.connectorInstanceId).toBe('inst-1')
      expect(event.rawPayload).toBeDefined()
    })
  })

  describe('NormalizedInboundMessage', () => {
    it('should satisfy the expected shape', () => {
      const msg: NormalizedInboundMessage = {
        provider: 'feishu',
        connectorInstanceId: 'inst-2',
        externalConversationId: 'conv-1',
        externalUserId: 'user-1',
        externalUserName: 'Alice',
        text: 'Hello',
        messageId: 'msg-1',
        timestamp: '2026-01-01T00:00:00Z',
        metadata: { raw: true },
      }
      expect(msg.text).toBe('Hello')
      expect(msg.externalUserName).toBe('Alice')
    })
  })

  describe('OutboundTextMessage', () => {
    it('should satisfy the expected shape', () => {
      const msg: OutboundTextMessage = {
        text: 'Reply',
        targetConversationId: 'conv-1',
        targetUserId: 'user-1',
      }
      expect(msg.text).toBe('Reply')
    })
  })

  describe('DeliveryTarget', () => {
    it('should satisfy the expected shape', () => {
      const target: DeliveryTarget = {
        provider: 'dingtalk',
        connectorInstanceId: 'inst-3',
        conversationId: 'conv-2',
        userId: 'user-2',
      }
      expect(target.provider).toBe('dingtalk')
    })
  })

  describe('MessagingCapabilities', () => {
    it('should satisfy the expected shape', () => {
      const caps: MessagingCapabilities = {
        supportsText: true,
        supportsRichCards: false,
        supportsMedia: true,
        maxTextLength: 4096,
        supportedMessageTypes: ['text', 'image'],
      }
      expect(caps.supportsText).toBe(true)
      expect(caps.supportedMessageTypes).toContain('text')
    })
  })

  describe('MessagingTransportResult', () => {
    it('should represent success', () => {
      const result: MessagingTransportResult = {
        success: true,
        messageId: 'msg-123',
      }
      expect(result.success).toBe(true)
    })

    it('should represent failure with error', () => {
      const result: MessagingTransportResult = {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests', recoverable: true },
        rateLimitInfo: { retryAfterMs: 5000, remaining: 0 },
      }
      expect(result.success).toBe(false)
      expect(result.error?.recoverable).toBe(true)
    })
  })

  describe('MessagingTransport interface', () => {
    it('MockMessagingTransport should implement MessagingTransport', () => {
      const transport: MessagingTransport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      expect(typeof transport.sendText).toBe('function')
      expect(typeof transport.verifyWebhook).toBe('function')
    })
  })

  describe('Mock transport blocks real network by default', () => {
    it('should throw when sendText is called without override', async () => {
      const transport = createMockTransport()
      const target: DeliveryTarget = {
        provider: 'telegram',
        connectorInstanceId: 'inst-1',
        conversationId: 'conv-1',
      }
      const msg: OutboundTextMessage = {
        text: 'test',
        targetConversationId: 'conv-1',
      }
      await expect(transport.sendText(target, msg)).rejects.toThrow(
        'MockMessagingTransport: real network blocked',
      )
    })

    it('should throw when verifyWebhook is called without override', async () => {
      const transport = createMockTransport()
      await expect(
        transport.verifyWebhook({}, {}, {}),
      ).rejects.toThrow('MockMessagingTransport: real network blocked')
    })
  })
})
