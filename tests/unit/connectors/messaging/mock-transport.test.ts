/**
 * Tests for MockMessagingTransport — call recording, custom responses,
 * and default network blocking.
 */

import { describe, it, expect } from 'vitest'
import {
  MockMessagingTransport,
  createMockTransport,
} from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  DeliveryTarget,
  OutboundTextMessage,
} from '../../../../src/connectors/messaging/types.js'

const sampleTarget: DeliveryTarget = {
  provider: 'telegram',
  connectorInstanceId: 'inst-1',
  conversationId: 'conv-1',
  userId: 'user-1',
}

const sampleMessage: OutboundTextMessage = {
  text: 'Hello world',
  targetConversationId: 'conv-1',
  targetUserId: 'user-1',
}

describe('MockMessagingTransport', () => {
  describe('default network blocking', () => {
    it('should throw on sendText without override', async () => {
      const transport = new MockMessagingTransport()
      await expect(transport.sendText(sampleTarget, sampleMessage)).rejects.toThrow(
        'MockMessagingTransport: real network blocked',
      )
    })

    it('should throw on verifyWebhook without override', async () => {
      const transport = new MockMessagingTransport()
      await expect(
        transport.verifyWebhook({ challenge: 'abc' }, {}, {}),
      ).rejects.toThrow('MockMessagingTransport: real network blocked')
    })
  })

  describe('call recording', () => {
    it('should record sendText calls even when override throws', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => {
          throw new Error('provider error')
        },
      })

      try {
        await transport.sendText(sampleTarget, sampleMessage)
      } catch {
        // expected
      }

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].target.provider).toBe('telegram')
      expect(calls[0].message.text).toBe('Hello world')
      expect(calls[0].timestamp).toBeDefined()
    })

    it('should record multiple sendText calls', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => ({ success: true, messageId: 'msg-1' }),
      })

      await transport.sendText(sampleTarget, sampleMessage)
      await transport.sendText(
        { ...sampleTarget, conversationId: 'conv-2' },
        { ...sampleMessage, text: 'Second' },
      )

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0].message.text).toBe('Hello world')
      expect(calls[1].message.text).toBe('Second')
    })

    it('should deep-clone recorded arguments', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => ({ success: true }),
      })

      const target: DeliveryTarget = { ...sampleTarget }
      const msg: OutboundTextMessage = { ...sampleMessage, metadata: { key: 'val' } }
      await transport.sendText(target, msg)

      // Mutate originals
      target.conversationId = 'mutated'
      msg.text = 'mutated'

      const calls = transport.getRecordedCalls()
      expect(calls[0].target.conversationId).toBe('conv-1')
      expect(calls[0].message.text).toBe('Hello world')
    })
  })

  describe('custom responses', () => {
    it('should return custom sendText response', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => ({
          success: true,
          messageId: 'custom-msg-id',
        }),
      })

      const result = await transport.sendText(sampleTarget, sampleMessage)
      expect(result.success).toBe(true)
      expect(result.messageId).toBe('custom-msg-id')
    })

    it('should return custom verifyWebhook response', async () => {
      const transport = new MockMessagingTransport({
        verifyWebhook: async () => true,
      })

      const result = await transport.verifyWebhook({}, {}, {})
      expect(result).toBe(true)
    })

    it('should return rate limit info from custom response', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => ({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many', recoverable: true },
          rateLimitInfo: { retryAfterMs: 3000, remaining: 0 },
        }),
      })

      const result = await transport.sendText(sampleTarget, sampleMessage)
      expect(result.success).toBe(false)
      expect(result.rateLimitInfo?.retryAfterMs).toBe(3000)
    })
  })

  describe('clearCalls', () => {
    it('should clear recorded call history', async () => {
      const transport = new MockMessagingTransport({
        sendText: async () => ({ success: true }),
      })

      await transport.sendText(sampleTarget, sampleMessage)
      expect(transport.getRecordedCalls()).toHaveLength(1)

      transport.clearCalls()
      expect(transport.getRecordedCalls()).toHaveLength(0)
    })
  })
})

describe('createMockTransport', () => {
  it('should return a MockMessagingTransport instance', () => {
    const transport = createMockTransport()
    expect(transport).toBeInstanceOf(MockMessagingTransport)
  })

  it('should pass overrides through', async () => {
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'from-factory' }),
    })

    const result = await transport.sendText(sampleTarget, sampleMessage)
    expect(result.messageId).toBe('from-factory')
  })
})
