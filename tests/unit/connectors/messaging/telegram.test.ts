/**
 * Tests for Telegram messaging adapter.
 *
 * Covers inbound normalization, outbound delivery delegation,
 * webhook verification, capabilities, and 429 parsing.
 */

import { describe, it, expect } from 'vitest'
import {
  parseTelegram429,
  createTelegramAdapter,
} from '../../../../src/connectors/messaging/providers/telegram.js'
import { createMockTransport } from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  InboundRawEvent,
  DeliveryTarget,
  OutboundTextMessage,
  MessagingCapabilities,
} from '../../../../src/connectors/messaging/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'
const WEBHOOK_SECRET = 'my-webhook-secret'

const PRIVATE_CHAT_UPDATE = {
  update_id: 123,
  message: {
    message_id: 1,
    from: { id: 12345, is_bot: false, first_name: 'User' },
    chat: { id: 12345, type: 'private' },
    date: 1234567890,
    text: 'hello',
  },
}

const GROUP_CHAT_UPDATE = {
  update_id: 124,
  message: {
    message_id: 2,
    from: { id: 67890, is_bot: false, first_name: 'User2' },
    chat: { id: -100123, type: 'group', title: 'Test Group' },
    date: 1234567891,
    text: 'hello group',
  },
}

const NO_TEXT_UPDATE = {
  update_id: 125,
  message: {
    message_id: 3,
    from: { id: 11111, is_bot: false, first_name: 'User3' },
    chat: { id: 11111, type: 'private' },
    date: 1234567892,
  },
}

const EDITED_MESSAGE_UPDATE = {
  update_id: 126,
  edited_message: {
    message_id: 4,
    from: { id: 22222, is_bot: false, first_name: 'Editor' },
    chat: { id: 22222, type: 'private' },
    date: 1234567893,
    text: 'edited text',
  },
}

function makeRawEvent(
  payload: unknown,
  headers?: Record<string, string>,
): InboundRawEvent {
  return {
    provider: 'telegram',
    connectorInstanceId: 'inst-tg-1',
    rawPayload: payload,
    receivedAt: '2026-06-25T00:00:00Z',
    headers,
  }
}

function makeTarget(conversationId: string): DeliveryTarget {
  return {
    provider: 'telegram',
    connectorInstanceId: 'inst-tg-1',
    conversationId,
  }
}

function makeOutbound(text: string, targetId: string): OutboundTextMessage {
  return {
    text,
    targetConversationId: targetId,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramAdapter', () => {
  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  describe('handleInbound', () => {
    it('should normalize a private chat text message', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const result = await adapter.handleInbound(makeRawEvent(PRIVATE_CHAT_UPDATE))

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('telegram')
      expect(result!.connectorInstanceId).toBe('inst-tg-1')
      expect(result!.externalConversationId).toBe('12345')
      expect(result!.externalUserId).toBe('12345')
      expect(result!.externalUserName).toBe('User')
      expect(result!.text).toBe('hello')
      expect(result!.messageId).toBe('1')
      expect(result!.timestamp).toBe(new Date(1234567890 * 1000).toISOString())
      expect(result!.metadata?.chatType).toBe('private')
      expect(result!.metadata?.updateId).toBe(123)
    })

    it('should normalize a group chat text message', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const result = await adapter.handleInbound(makeRawEvent(GROUP_CHAT_UPDATE))

      expect(result).not.toBeNull()
      expect(result!.externalConversationId).toBe('-100123')
      expect(result!.externalUserId).toBe('67890')
      expect(result!.externalUserName).toBe('User2')
      expect(result!.text).toBe('hello group')
      expect(result!.metadata?.chatType).toBe('group')
      expect(result!.metadata?.chatTitle).toBe('Test Group')
    })

    it('should return null for non-text messages', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const result = await adapter.handleInbound(makeRawEvent(NO_TEXT_UPDATE))
      expect(result).toBeNull()
    })

    it('should handle edited messages', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const result = await adapter.handleInbound(
        makeRawEvent(EDITED_MESSAGE_UPDATE),
      )

      expect(result).not.toBeNull()
      expect(result!.text).toBe('edited text')
      expect(result!.externalUserId).toBe('22222')
    })

    it('should return null for invalid payload', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      expect(await adapter.handleInbound(makeRawEvent(null))).toBeNull()
      expect(await adapter.handleInbound(makeRawEvent({}))).toBeNull()
      expect(await adapter.handleInbound(makeRawEvent('string'))).toBeNull()
    })

    it('should return null for update with no message fields', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const result = await adapter.handleInbound(
        makeRawEvent({ update_id: 999 }),
      )
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  describe('sendOutbound', () => {
    it('should delegate to transport.sendText', async () => {
      let recordedTarget: DeliveryTarget | undefined
      let recordedMessage: OutboundTextMessage | undefined

      const transport = createMockTransport({
        sendText: async (target, message) => {
          recordedTarget = target
          recordedMessage = message
          return { success: true, messageId: 'sent-123' }
        },
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const target = makeTarget('12345')
      const message = makeOutbound('Hello!', '12345')

      const result = await adapter.sendOutbound(target, message)

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('sent-123')
      expect(recordedTarget).toEqual(target)
      expect(recordedMessage).toEqual(message)
    })

    it('should record calls in mock transport', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const target = makeTarget('99')
      const message = makeOutbound('Test', '99')

      await adapter.sendOutbound(target, message)

      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].target.conversationId).toBe('99')
      expect(calls[0].message.text).toBe('Test')
    })
  })

  // -------------------------------------------------------------------------
  // buildSendBody / buildSendEvidence
  // -------------------------------------------------------------------------

  describe('buildSendBody', () => {
    it('should build correct sendMessage request shape', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const body = adapter.buildSendBody(makeOutbound('Hi', '42'))

      expect(body.url).toBe(`/bot${BOT_TOKEN}/sendMessage`)
      expect(body.body.chat_id).toBe('42')
      expect(body.body.text).toBe('Hi')
      expect(body.body.parse_mode).toBe('HTML')
    })

    it('should redact token in evidence', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const evidence = adapter.buildSendEvidence(makeOutbound('Secret', '1'))

      // botToken key should be redacted by redactSecrets
      expect(evidence.botToken).toBe('[REDACTED]')
      expect(JSON.stringify(evidence)).not.toContain(BOT_TOKEN)
      // Non-secret fields preserved
      expect(evidence.chatId).toBe('1')
      expect(evidence.text).toBe('Secret')
      expect(evidence.parseMode).toBe('HTML')
    })
  })

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  describe('verifyInbound', () => {
    it('should accept matching secret token header', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const headers = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }
      expect(await adapter.verifyInbound({}, headers)).toBe(true)
    })

    it('should accept Pascal-Case header variant', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const headers = { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET }
      expect(await adapter.verifyInbound({}, headers)).toBe(true)
    })

    it('should reject mismatched secret token', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const headers = { 'x-telegram-bot-api-secret-token': 'wrong-secret' }
      expect(await adapter.verifyInbound({}, headers)).toBe(false)
    })

    it('should reject missing secret token header', async () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      expect(await adapter.verifyInbound({}, {})).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  describe('getCapabilities', () => {
    it('should return text-only capabilities', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = createTelegramAdapter(
        { botToken: BOT_TOKEN, webhookSecret: WEBHOOK_SECRET },
        transport,
      )

      const caps: MessagingCapabilities = adapter.getCapabilities()

      expect(caps.supportsText).toBe(true)
      expect(caps.supportsRichCards).toBe(false)
      expect(caps.supportsMedia).toBe(false)
      expect(caps.maxTextLength).toBe(4096)
      expect(caps.supportedMessageTypes).toEqual(['text'])
    })
  })

  // -------------------------------------------------------------------------
  // 429 parsing
  // -------------------------------------------------------------------------

  describe('parseTelegram429', () => {
    it('should parse retry-after from description', () => {
      const body = {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 5',
      }

      const result = parseTelegram429(body)

      expect(result).toBeDefined()
      expect(result!.retryAfterMs).toBe(5000)
    })

    it('should handle different retry-after values', () => {
      const body = {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 30',
      }

      const result = parseTelegram429(body)
      expect(result!.retryAfterMs).toBe(30000)
    })

    it('should return undefined for non-429 responses', () => {
      const body = { ok: false, error_code: 400, description: 'Bad Request' }
      expect(parseTelegram429(body)).toBeUndefined()
    })

    it('should handle missing description gracefully', () => {
      const body = { ok: false, error_code: 429 }

      const result = parseTelegram429(body)
      expect(result).toBeDefined()
      expect(result!.retryAfterMs).toBeUndefined()
    })

    it('should handle non-numeric retry-after', () => {
      const body = {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after abc',
      }

      const result = parseTelegram429(body)
      expect(result).toBeDefined()
      expect(result!.retryAfterMs).toBeUndefined()
    })
  })
})
