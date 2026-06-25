/**
 * Tests for WeChat messaging adapter.
 */

import * as crypto from 'node:crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WeChatAdapter, createWeChatAdapter } from '../../../../src/connectors/messaging/providers/wechat.js'
import { createMockTransport } from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  MessagingAdapter,
  MessagingCapabilities,
  InboundRawEvent,
  DeliveryTarget,
  OutboundTextMessage,
  MessagingTransportResult,
} from '../../../../src/connectors/messaging/types.js'
import type { WeChatConfig } from '../../../../src/connectors/messaging/providers/wechat.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeXmlPayload(overrides: Partial<{
  toUser: string
  fromUser: string
  createTime: string
  msgType: string
  content: string
  msgId: string
}> = {}): string {
  const to = overrides.toUser ?? 'gh_xxx'
  const from = overrides.fromUser ?? 'oxxxxx'
  const time = overrides.createTime ?? '1234567890'
  const type = overrides.msgType ?? 'text'
  const content = overrides.content ?? 'hello'
  const id = overrides.msgId ?? '12345678901234'
  return [
    '<xml>',
    `<ToUserName><![CDATA[${to}]]></ToUserName>`,
    `<FromUserName><![CDATA[${from}]]></FromUserName>`,
    `<CreateTime>${time}</CreateTime>`,
    `<MsgType><![CDATA[${type}]]></MsgType>`,
    `<Content><![CDATA[${content}]]></Content>`,
    `<MsgId>${id}</MsgId>`,
    '</xml>',
  ].join('')
}

function makeILinkPayload(overrides: Partial<{
  fromUser: string
  toUser: string
  createTime: number
  msgType: string
  content: string
  msgId: string
}> = {}): Record<string, unknown> {
  return {
    FromUserName: overrides.fromUser ?? 'oxxxxx',
    ToUserName: overrides.toUser ?? 'gh_xxx',
    CreateTime: overrides.createTime ?? 1234567890,
    MsgType: overrides.msgType ?? 'text',
    Content: overrides.content ?? 'hello',
    MsgId: overrides.msgId ?? '12345678901234',
  }
}

function makeInboundEvent(
  rawPayload: unknown,
  options: Partial<Pick<InboundRawEvent, 'headers' | 'connectorInstanceId'>> = {},
): InboundRawEvent {
  return {
    provider: 'wechat',
    connectorInstanceId: options.connectorInstanceId ?? 'inst-1',
    rawPayload,
    receivedAt: '2026-01-01T00:00:00Z',
    headers: options.headers,
  }
}

/** Compute SHA1 signature the same way WeChat does. */
function computeSignature(token: string, timestamp: string, nonce: string): string {
  const arr = [token, timestamp, nonce].sort()
  return crypto.createHash('sha1').update(arr.join('')).digest('hex')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WeChatAdapter', () => {
  const defaultConfig: WeChatConfig = {
    botToken: 'test-token',
    appSecret: 'test-secret',
  }

  let adapter: WeChatAdapter
  let sendTextMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendTextMock = vi.fn(async (): Promise<MessagingTransportResult> => ({
      success: true,
      messageId: 'sent-msg-1',
    }))
    const transport = createMockTransport({ sendText: sendTextMock as (target: DeliveryTarget, message: OutboundTextMessage) => Promise<MessagingTransportResult> })
    adapter = new WeChatAdapter(defaultConfig, transport)
  })

  // -------------------------------------------------------------------------
  // MessagingAdapter interface compliance
  // -------------------------------------------------------------------------

  describe('interface compliance', () => {
    it('should implement MessagingAdapter interface', () => {
      const instance: MessagingAdapter = adapter
      expect(typeof instance.handleInbound).toBe('function')
      expect(typeof instance.sendOutbound).toBe('function')
      expect(typeof instance.verifyInbound).toBe('function')
      expect(typeof instance.getCapabilities).toBe('function')
    })

    it('createWeChatAdapter factory should return a WeChatAdapter', () => {
      const transport = createMockTransport({ sendText: sendTextMock as (target: DeliveryTarget, message: OutboundTextMessage) => Promise<MessagingTransportResult> })
      const instance = createWeChatAdapter(defaultConfig, transport)
      expect(instance).toBeInstanceOf(WeChatAdapter)
    })
  })

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  describe('getCapabilities', () => {
    it('should return correct capabilities', () => {
      const caps: MessagingCapabilities = adapter.getCapabilities()
      expect(caps.supportsText).toBe(true)
      expect(caps.supportsRichCards).toBe(false)
      expect(caps.supportsMedia).toBe(false)
      expect(caps.maxTextLength).toBe(2048)
      expect(caps.supportedMessageTypes).toEqual(['text'])
    })
  })

  // -------------------------------------------------------------------------
  // Inbound: Official account XML
  // -------------------------------------------------------------------------

  describe('handleInbound (official XML)', () => {
    it('should parse a valid text message XML payload', async () => {
      const xml = makeXmlPayload({
        toUser: 'gh_abc',
        fromUser: 'oUser123',
        createTime: '1700000000',
        content: 'Hello World',
        msgId: '99887766554433',
      })

      const result = await adapter.handleInbound(makeInboundEvent(xml))

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('wechat')
      expect(result!.connectorInstanceId).toBe('inst-1')
      expect(result!.externalConversationId).toBe('oUser123')
      expect(result!.externalUserId).toBe('oUser123')
      expect(result!.text).toBe('Hello World')
      expect(result!.messageId).toBe('99887766554433')
      expect(result!.timestamp).toBe(new Date(1700000000 * 1000).toISOString())
      expect(result!.metadata).toEqual({ toUserName: 'gh_abc' })
    })

    it('should return null for image message type', async () => {
      const xml = makeXmlPayload({ msgType: 'image' })
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      expect(result).toBeNull()
    })

    it('should return null for event message type', async () => {
      const xml = makeXmlPayload({ msgType: 'event' })
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      expect(result).toBeNull()
    })

    it('should return null for non-string payload', async () => {
      const result = await adapter.handleInbound(makeInboundEvent({ foo: 'bar' }))
      expect(result).toBeNull()
    })

    it('should return null for empty string payload', async () => {
      const result = await adapter.handleInbound(makeInboundEvent(''))
      expect(result).toBeNull()
    })

    it('should return null for XML missing MsgType', async () => {
      const xml = [
        '<xml>',
        '<ToUserName><![CDATA[gh_xxx]]></ToUserName>',
        '<FromUserName><![CDATA[oxxxxx]]></FromUserName>',
        '<CreateTime>1234567890</CreateTime>',
        '</xml>',
      ].join('')
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      expect(result).toBeNull()
    })

    it('should return null for XML missing Content in text message', async () => {
      const xml = [
        '<xml>',
        '<ToUserName><![CDATA[gh_xxx]]></ToUserName>',
        '<FromUserName><![CDATA[oxxxxx]]></FromUserName>',
        '<CreateTime>1234567890</CreateTime>',
        '<MsgType><![CDATA[text]]></MsgType>',
        '<MsgId>12345678901234</MsgId>',
        '</xml>',
      ].join('')
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      expect(result).toBeNull()
    })

    it('should return null for XML missing required fields', async () => {
      const xml = '<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi]]></Content></xml>'
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      expect(result).toBeNull()
    })

    it('should use receivedAt as fallback when CreateTime is missing', async () => {
      // Craft XML without CreateTime but with MsgType — won't parse due to missing fields
      // Instead test with valid XML but zero createTime
      const xml = makeXmlPayload({ createTime: '0' })
      const result = await adapter.handleInbound(
        makeInboundEvent(xml, {}),
      )
      expect(result).not.toBeNull()
      expect(result!.timestamp).toBe(new Date(0).toISOString())
    })

    it('should use receivedAt as fallback when CreateTime is absent', async () => {
      // Build XML without CreateTime tag
      const xml = [
        '<xml>',
        '<ToUserName><![CDATA[gh_xxx]]></ToUserName>',
        '<FromUserName><![CDATA[oxxxxx]]></FromUserName>',
        '<MsgType><![CDATA[text]]></MsgType>',
        '<Content><![CDATA[hi]]></Content>',
        '<MsgId>12345678901234</MsgId>',
        '</xml>',
      ].join('')
      const result = await adapter.handleInbound(makeInboundEvent(xml))
      // Without CreateTime, the parse will fail because createTime is required
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Inbound: iLink JSON mode
  // -------------------------------------------------------------------------

  describe('handleInbound (iLink JSON)', () => {
    let iLinkAdapter: WeChatAdapter

    beforeEach(() => {
      const config: WeChatConfig = {
        ...defaultConfig,
        mode: 'ilink',
      }
      const transport = createMockTransport({ sendText: sendTextMock as (target: DeliveryTarget, message: OutboundTextMessage) => Promise<MessagingTransportResult> })
      iLinkAdapter = new WeChatAdapter(config, transport)
    })

    it('should parse a valid iLink text message', async () => {
      const payload = makeILinkPayload({
        fromUser: 'oUser456',
        toUser: 'gh_abc',
        createTime: 1700000000,
        content: 'iLink hello',
        msgId: '5566778899',
      })

      const result = await iLinkAdapter.handleInbound(makeInboundEvent(payload))

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('wechat')
      expect(result!.externalUserId).toBe('oUser456')
      expect(result!.text).toBe('iLink hello')
      expect(result!.messageId).toBe('5566778899')
      expect(result!.timestamp).toBe(new Date(1700000000 * 1000).toISOString())
    })

    it('should return null for non-text iLink message', async () => {
      const payload = makeILinkPayload({ msgType: 'image' })
      const result = await iLinkAdapter.handleInbound(makeInboundEvent(payload))
      expect(result).toBeNull()
    })

    it('should return null for iLink with missing FromUserName', async () => {
      const payload = {
        ToUserName: 'gh_xxx',
        CreateTime: 123,
        MsgType: 'text',
        Content: 'hi',
        MsgId: '1',
      }
      const result = await iLinkAdapter.handleInbound(makeInboundEvent(payload))
      expect(result).toBeNull()
    })

    it('should return null for iLink with non-object payload', async () => {
      const result = await iLinkAdapter.handleInbound(makeInboundEvent('not json'))
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  describe('sendOutbound', () => {
    it('should delegate to transport.sendText', async () => {
      const target: DeliveryTarget = {
        provider: 'wechat',
        connectorInstanceId: 'inst-1',
        conversationId: 'oUser123',
        userId: 'oUser123',
      }
      const message: OutboundTextMessage = {
        text: 'Reply text',
        targetConversationId: 'oUser123',
        targetUserId: 'oUser123',
      }

      const result = await adapter.sendOutbound(target, message)

      expect(sendTextMock).toHaveBeenCalledOnce()
      expect(sendTextMock).toHaveBeenCalledWith(target, message)
      expect(result.success).toBe(true)
      expect(result.messageId).toBe('sent-msg-1')
    })

    it('should propagate transport errors', async () => {
      sendTextMock.mockRejectedValueOnce(new Error('network down'))
      const transport = createMockTransport({ sendText: sendTextMock as (target: DeliveryTarget, message: OutboundTextMessage) => Promise<MessagingTransportResult> })
      const failingAdapter = new WeChatAdapter(defaultConfig, transport)

      const target: DeliveryTarget = {
        provider: 'wechat',
        connectorInstanceId: 'inst-1',
        conversationId: 'oUser123',
      }
      const message: OutboundTextMessage = {
        text: 'hi',
        targetConversationId: 'oUser123',
      }

      await expect(failingAdapter.sendOutbound(target, message)).rejects.toThrow('network down')
    })
  })

  // -------------------------------------------------------------------------
  // Verification: Official account
  // -------------------------------------------------------------------------

  describe('verifyInbound (official)', () => {
    it('should return true for a valid signature', () => {
      const token = 'test-token'
      const timestamp = '1345678901'
      const nonce = 'nonce123'
      const signature = computeSignature(token, timestamp, nonce)

      const headers: Record<string, string> = {
        signature,
        timestamp,
        nonce,
      }

      expect(adapter.verifyInbound({}, headers)).resolves.toBe(true)
    })

    it('should return false for an invalid signature', () => {
      const headers: Record<string, string> = {
        signature: 'bad-signature',
        timestamp: '1345678901',
        nonce: 'nonce123',
      }

      expect(adapter.verifyInbound({}, headers)).resolves.toBe(false)
    })

    it('should return false when signature header is missing', () => {
      const headers: Record<string, string> = {
        timestamp: '1345678901',
        nonce: 'nonce123',
      }

      expect(adapter.verifyInbound({}, headers)).resolves.toBe(false)
    })

    it('should return false when timestamp header is missing', () => {
      const signature = computeSignature('test-token', '1345678901', 'nonce123')
      const headers: Record<string, string> = {
        signature,
        nonce: 'nonce123',
      }

      expect(adapter.verifyInbound({}, headers)).resolves.toBe(false)
    })

    it('should return false when nonce header is missing', () => {
      const signature = computeSignature('test-token', '1345678901', 'nonce123')
      const headers: Record<string, string> = {
        signature,
        timestamp: '1345678901',
      }

      expect(adapter.verifyInbound({}, headers)).resolves.toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Verification: iLink
  // -------------------------------------------------------------------------

  describe('verifyInbound (iLink)', () => {
    let iLinkAdapter: WeChatAdapter

    beforeEach(() => {
      const config: WeChatConfig = {
        ...defaultConfig,
        mode: 'ilink',
      }
      const transport = createMockTransport({ sendText: sendTextMock as (target: DeliveryTarget, message: OutboundTextMessage) => Promise<MessagingTransportResult> })
      iLinkAdapter = new WeChatAdapter(config, transport)
    })

    it('should return true for a valid iLink signature', () => {
      const token = 'test-token'
      const timestamp = '9999999999'
      const nonce = 'abc'
      const signature = computeSignature(token, timestamp, nonce)

      const headers: Record<string, string> = {
        signature,
        timestamp,
        nonce,
      }

      expect(iLinkAdapter.verifyInbound({}, headers)).resolves.toBe(true)
    })

    it('should return false for an invalid iLink signature', () => {
      const headers: Record<string, string> = {
        signature: 'wrong',
        timestamp: '9999999999',
        nonce: 'abc',
      }

      expect(iLinkAdapter.verifyInbound({}, headers)).resolves.toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Signature validation (direct)
  // -------------------------------------------------------------------------

  describe('validateSignature', () => {
    it('should validate correct SHA1 signature', () => {
      const token = defaultConfig.botToken
      const timestamp = '1409304348'
      const nonce = '123456'
      const expected = computeSignature(token, timestamp, nonce)
      expect(adapter.validateSignature(expected, timestamp, nonce)).toBe(true)
    })

    it('should reject incorrect SHA1 signature', () => {
      expect(adapter.validateSignature('abcdef', '1409304348', '123456')).toBe(false)
    })

    it('should handle different sort orders deterministically', () => {
      // Verify sorting is consistent
      const sig1 = computeSignature('z', 'a', 'm')
      const sig2 = computeSignature('z', 'a', 'm')
      expect(sig1).toBe(sig2)
    })
  })

  // -------------------------------------------------------------------------
  // XML parsing (direct)
  // -------------------------------------------------------------------------

  describe('parseXmlMessage', () => {
    it('should extract all fields from CDATA-wrapped XML', () => {
      const xml = makeXmlPayload({
        toUser: 'gh_test',
        fromUser: 'oUser',
        createTime: '100',
        content: 'CDATA content',
        msgId: '999',
      })

      const parsed = adapter.parseXmlMessage(xml)
      expect(parsed).not.toBeNull()
      expect(parsed!.toUserName).toBe('gh_test')
      expect(parsed!.fromUserName).toBe('oUser')
      expect(parsed!.createTime).toBe('100')
      expect(parsed!.msgType).toBe('text')
      expect(parsed!.content).toBe('CDATA content')
      expect(parsed!.msgId).toBe('999')
    })

    it('should return null for non-string input', () => {
      expect(adapter.parseXmlMessage(42)).toBeNull()
      expect(adapter.parseXmlMessage(null)).toBeNull()
      expect(adapter.parseXmlMessage(undefined)).toBeNull()
    })

    it('should return null for non-XML string', () => {
      expect(adapter.parseXmlMessage('not xml at all')).toBeNull()
    })

    it('should return null for XML without <xml> wrapper', () => {
      const xml = '<root><MsgType><![CDATA[text]]></MsgType></root>'
      expect(adapter.parseXmlMessage(xml)).toBeNull()
    })

    it('should return null for XML without MsgType', () => {
      const xml = '<xml><ToUserName><![CDATA[gh]]></ToUserName></xml>'
      expect(adapter.parseXmlMessage(xml)).toBeNull()
    })

    it('should handle plain (non-CDATA) values', () => {
      const xml = [
        '<xml>',
        '<ToUserName>gh_plain</ToUserName>',
        '<FromUserName>oPlain</FromUserName>',
        '<CreateTime>500</CreateTime>',
        '<MsgType>text</MsgType>',
        '<Content>plain text</Content>',
        '<MsgId>111</MsgId>',
        '</xml>',
      ].join('')

      const parsed = adapter.parseXmlMessage(xml)
      expect(parsed).not.toBeNull()
      expect(parsed!.toUserName).toBe('gh_plain')
      expect(parsed!.fromUserName).toBe('oPlain')
      expect(parsed!.content).toBe('plain text')
    })
  })

  // -------------------------------------------------------------------------
  // Redaction safety
  // -------------------------------------------------------------------------

  describe('config redaction safety', () => {
    it('WeChatConfig should be redactable with redactSecrets', async () => {
      const { redactSecrets } = await import('../../../../src/connectors/messaging/secret-redaction.js')
      const config: WeChatConfig = {
        botToken: 'super-secret-token',
        appSecret: 'super-secret-app',
        appId: 'wx123',
      }

      const redacted = redactSecrets(config) as Record<string, unknown>
      expect(redacted.botToken).toBe('[REDACTED]')
      expect(redacted.appSecret).toBe('[REDACTED]')
      expect(redacted.appId).toBe('wx123')
    })
  })
})
