/**
 * Tests for QQ Bot messaging adapter.
 * Covers C2C, group, and channel inbound normalization,
 * outbound with token refresh seam, auth failure, and capabilities.
 */

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { QQAdapter, createQQAdapter } from '../../../../src/connectors/messaging/providers/qq.js'
import { createMockTransport } from '../../../../src/connectors/messaging/mock-transport.js'
import type {
  InboundRawEvent,
  DeliveryTarget,
  OutboundTextMessage,
} from '../../../../src/connectors/messaging/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInboundEvent(
  rawPayload: unknown,
  overrides?: Partial<InboundRawEvent>,
): InboundRawEvent {
  return {
    provider: 'qq',
    connectorInstanceId: 'qq-inst-1',
    rawPayload,
    receivedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

const c2cPayload = {
  d: {
    id: 'msg-c2c-001',
    content: 'Hello bot',
    author: {
      id: 'user-123',
      username: 'TestUser',
    },
    channel_id: 'c2c-channel-abc',
  },
  event_type: 'C2C_MESSAGE_CREATE' as const,
}

const groupPayload = {
  d: {
    id: 'msg-group-001',
    content: '@bot help me',
    author: {
      id: 'user-456',
      member_openid: 'member-open-789',
    },
    group_openid: 'group-open-xyz',
  },
  event_type: 'GROUP_AT_MESSAGE_CREATE' as const,
}

const channelPayload = {
  d: {
    id: 'msg-channel-001',
    content: 'Channel message',
    author: {
      id: 'user-789',
      username: 'ChannelUser',
    },
    channel_id: 'channel-111',
    guild_id: 'guild-222',
  },
  event_type: 'AT_MESSAGE_CREATE' as const,
}

const defaultTarget: DeliveryTarget = {
  provider: 'qq',
  connectorInstanceId: 'qq-inst-1',
  conversationId: 'c2c-channel-abc',
}

const defaultMessage: OutboundTextMessage = {
  text: 'Reply from bot',
  targetConversationId: 'c2c-channel-abc',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSuccessfulFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ access_token: 'test-token-abc', expires_in: 7200 }),
  } as Response)
}

function createFailingFetch(status = 401): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'invalid_client' }),
  } as Response)
}

function createThrowingFetch(error: Error): typeof fetch {
  return vi.fn().mockRejectedValue(error)
}

function createAdapterWithFetch(fetchFn: typeof fetch): QQAdapter {
  const transport = createMockTransport({
    sendText: async () => ({ success: true, messageId: 'sent-001' }),
    verifyWebhook: async () => true,
  })
  return new QQAdapter(
    { appId: 'test-app', appSecret: 'test-secret' },
    transport,
    fetchFn,
  )
}

function computeQQSignature(payload: unknown, secret: string): string {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return createHmac('sha1', secret).update(rawBody).digest('hex')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QQAdapter', () => {
  // =========================================================================
  // Inbound: C2C (direct message)
  // =========================================================================

  describe('handleInbound — C2C message', () => {
    it('should normalize a C2C direct message', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const event = makeInboundEvent(c2cPayload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.provider).toBe('qq')
      expect(result!.connectorInstanceId).toBe('qq-inst-1')
      expect(result!.externalConversationId).toBe('c2c-channel-abc')
      expect(result!.externalUserId).toBe('user-123')
      expect(result!.externalUserName).toBe('TestUser')
      expect(result!.text).toBe('Hello bot')
      expect(result!.messageId).toBe('msg-c2c-001')
      expect(result!.metadata?.eventType).toBe('C2C_MESSAGE_CREATE')
    })

    it('should use receivedAt when timestamp is absent', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const event = makeInboundEvent(c2cPayload)

      const result = await adapter.handleInbound(event)

      expect(result!.timestamp).toBe('2026-01-15T10:00:00Z')
    })

    it('should return null when channel_id is missing for C2C', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const payload = {
        d: { ...c2cPayload.d, channel_id: undefined },
        event_type: 'C2C_MESSAGE_CREATE' as const,
      }
      // Remove channel_id explicitly
      delete (payload.d as Record<string, unknown>).channel_id

      const result = await adapter.handleInbound(makeInboundEvent(payload))

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Inbound: Group message
  // =========================================================================

  describe('handleInbound — Group message', () => {
    it('should normalize a group @-mention message', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const event = makeInboundEvent(groupPayload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.externalConversationId).toBe('group-open-xyz')
      expect(result!.externalUserId).toBe('user-456')
      expect(result!.text).toBe('@bot help me')
      expect(result!.messageId).toBe('msg-group-001')
      expect(result!.metadata?.eventType).toBe('GROUP_AT_MESSAGE_CREATE')
      expect(result!.metadata?.memberOpenid).toBe('member-open-789')
      expect(result!.metadata?.groupId).toBe('group-open-xyz')
    })

    it('should return null when group_openid is missing for group message', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const payload = {
        d: { ...groupPayload.d, group_openid: undefined },
        event_type: 'GROUP_AT_MESSAGE_CREATE' as const,
      }
      delete (payload.d as Record<string, unknown>).group_openid

      const result = await adapter.handleInbound(makeInboundEvent(payload))

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Inbound: Channel message
  // =========================================================================

  describe('handleInbound — Channel message', () => {
    it('should normalize a channel @-mention message', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const event = makeInboundEvent(channelPayload)

      const result = await adapter.handleInbound(event)

      expect(result).not.toBeNull()
      expect(result!.externalConversationId).toBe('channel-111')
      expect(result!.externalUserId).toBe('user-789')
      expect(result!.externalUserName).toBe('ChannelUser')
      expect(result!.text).toBe('Channel message')
      expect(result!.messageId).toBe('msg-channel-001')
      expect(result!.metadata?.eventType).toBe('AT_MESSAGE_CREATE')
      expect(result!.metadata?.guildId).toBe('guild-222')
      expect(result!.metadata?.channelId).toBe('channel-111')
    })

    it('should return null for unknown event_type', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const payload = {
        d: c2cPayload.d,
        event_type: 'UNKNOWN_EVENT',
      }

      const result = await adapter.handleInbound(makeInboundEvent(payload))

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Inbound: Edge cases
  // =========================================================================

  describe('handleInbound — Edge cases', () => {
    it('should return null for null payload', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.handleInbound(makeInboundEvent(null))

      expect(result).toBeNull()
    })

    it('should return null for non-object payload', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.handleInbound(makeInboundEvent('string'))

      expect(result).toBeNull()
    })

    it('should return null when d is missing', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.handleInbound(
        makeInboundEvent({ event_type: 'C2C_MESSAGE_CREATE' }),
      )

      expect(result).toBeNull()
    })

    it('should return null when author id is missing', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const payload = {
        d: { ...c2cPayload.d, author: { id: '' } },
        event_type: 'C2C_MESSAGE_CREATE' as const,
      }

      const result = await adapter.handleInbound(makeInboundEvent(payload))

      expect(result).toBeNull()
    })

    it('should return null when message id is missing', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const payload = {
        d: { ...c2cPayload.d, id: '' },
        event_type: 'C2C_MESSAGE_CREATE' as const,
      }

      const result = await adapter.handleInbound(makeInboundEvent(payload))

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // Outbound: Token refresh + send
  // =========================================================================

  describe('sendOutbound', () => {
    it('should refresh token and delegate to transport', async () => {
      const fetchFn = createSuccessfulFetch()
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: 'sent-001' }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'app-1', appSecret: 'secret-1' },
        transport,
        fetchFn,
      )

      const result = await adapter.sendOutbound(defaultTarget, defaultMessage)

      expect(result.success).toBe(true)
      expect(result.messageId).toBe('sent-001')

      // Verify fetch was called for token refresh
      expect(fetchFn).toHaveBeenCalledOnce()
      const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe('https://bots.qq.com/app/getAppAccessToken')
      expect(init.method).toBe('POST')

      // Verify transport was called
      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].message.text).toBe('Reply from bot')
    })

    it('should use sandbox URL when sandbox is true', async () => {
      const fetchFn = createSuccessfulFetch()
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'app-1', appSecret: 'secret-1', sandbox: true },
        transport,
        fetchFn,
      )

      await adapter.sendOutbound(defaultTarget, defaultMessage)

      const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe(
        'https://bots.qq.com/app/getAppAccessToken?sandbox=true',
      )
    })

    it('should send correct token request body', async () => {
      const fetchFn = createSuccessfulFetch()
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'my-app', appSecret: 'my-secret' },
        transport,
        fetchFn,
      )

      await adapter.sendOutbound(defaultTarget, defaultMessage)

      const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body).toEqual({
        appId: 'my-app',
        clientSecret: 'my-secret',
      })
    })
  })

  // =========================================================================
  // Auth failure
  // =========================================================================

  describe('sendOutbound — auth failure', () => {
    it('should return AUTH_FAILED when token endpoint returns error status', async () => {
      const fetchFn = createFailingFetch(401)
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: 'should-not-reach' }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'bad-app', appSecret: 'bad-secret' },
        transport,
        fetchFn,
      )

      const result = await adapter.sendOutbound(defaultTarget, defaultMessage)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('AUTH_FAILED')
      expect(result.error?.recoverable).toBe(false)

      // Transport should NOT have been called
      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(0)
    })

    it('should return AUTH_FAILED when token response has no access_token', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'invalid_grant' }),
      } as Response)
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'app', appSecret: 'secret' },
        transport,
        fetchFn,
      )

      const result = await adapter.sendOutbound(defaultTarget, defaultMessage)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('AUTH_FAILED')
      expect(result.error?.message).toBe('Invalid token response')

      // Transport should NOT have been called
      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(0)
    })

    it('should return AUTH_FAILED when fetch throws network error', async () => {
      const fetchFn = createThrowingFetch(new Error('ECONNREFUSED'))
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const adapter = new QQAdapter(
        { appId: 'app', appSecret: 'secret' },
        transport,
        fetchFn,
      )

      const result = await adapter.sendOutbound(defaultTarget, defaultMessage)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('AUTH_FAILED')
      expect(result.error?.message).toBe('ECONNREFUSED')

      // Transport should NOT have been called
      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(0)
    })
  })

  // =========================================================================
  // Verification
  // =========================================================================

  describe('verifyInbound', () => {
    it('should reject payload without signature header', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.verifyInbound(c2cPayload, {})

      expect(result).toBe(false)
    })

    it('should accept valid payload with correct HMAC-SHA1 signature', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const signature = computeQQSignature(c2cPayload, 'test-secret')

      const result = await adapter.verifyInbound(c2cPayload, {
        'x-qq-bot-signature': signature,
      })

      expect(result).toBe(true)
    })

    it('should reject payload with wrong signature', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.verifyInbound(c2cPayload, {
        'x-qq-bot-signature': 'wrong-signature',
      })

      expect(result).toBe(false)
    })

    it('should reject non-object payload when signature is present', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.verifyInbound(null, {
        'x-qq-bot-signature': 'some-sig',
      })

      expect(result).toBe(false)
    })

    it('should reject null payload when no signature header', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const result = await adapter.verifyInbound(null, {})

      expect(result).toBe(false)
    })

    it('should handle case-insensitive header lookup', async () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())
      const signature = computeQQSignature(c2cPayload, 'test-secret')

      const result = await adapter.verifyInbound(c2cPayload, {
        'X-QQ-Bot-Signature': signature,
      })

      expect(result).toBe(true)
    })
  })

  // =========================================================================
  // Capabilities
  // =========================================================================

  describe('getCapabilities', () => {
    it('should declare text and markdown support', () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const caps = adapter.getCapabilities()

      expect(caps.supportsText).toBe(true)
      expect(caps.supportsRichCards).toBe(false)
      expect(caps.supportsMedia).toBe(false)
      expect(caps.supportedMessageTypes).toContain('text')
      expect(caps.supportedMessageTypes).toContain('markdown')
    })

    it('should set maxTextLength to 4096', () => {
      const adapter = createAdapterWithFetch(createSuccessfulFetch())

      const caps = adapter.getCapabilities()

      expect(caps.maxTextLength).toBe(4096)
    })
  })

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createQQAdapter', () => {
    it('should create a QQAdapter instance', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })

      const adapter = createQQAdapter(
        { appId: 'app', appSecret: 'secret' },
        transport,
      )

      expect(adapter).toBeInstanceOf(QQAdapter)
    })

    it('should accept custom fetch function', () => {
      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
        verifyWebhook: async () => true,
      })
      const customFetch = vi.fn() as unknown as typeof fetch

      const adapter = createQQAdapter(
        { appId: 'app', appSecret: 'secret' },
        transport,
        customFetch,
      )

      expect(adapter).toBeInstanceOf(QQAdapter)
    })
  })
})
