/**
 * Cross-provider end-to-end mock flow and regression suite.
 *
 * Verifies that all five messaging providers complete the full
 * inbound → processor → outbound pipeline with no real network.
 *
 * Also includes:
 * - WebUI channel handler regression
 * - Channel-boundary guard (processing doesn't import channel code)
 * - No-network guard (mock transport throws by default)
 * - Secret grep assertions (no leaked secrets in source)
 */

import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

import { createFeishuAdapter } from '../../../../src/connectors/messaging/providers/feishu.js'
import { createTelegramAdapter } from '../../../../src/connectors/messaging/providers/telegram.js'
import { createQQAdapter } from '../../../../src/connectors/messaging/providers/qq.js'
import { createWeChatAdapter } from '../../../../src/connectors/messaging/providers/wechat.js'
import { DingTalkAdapter } from '../../../../src/connectors/messaging/providers/dingtalk.js'
import {
  MockMessagingTransport,
  createMockTransport,
} from '../../../../src/connectors/messaging/mock-transport.js'
import { redactSecrets } from '../../../../src/connectors/messaging/secret-redaction.js'
import {
  createChannelRegistry,
  createWebUIChannelHandler,
} from '../../../../src/gateway/channel-registry.js'
import {
  createMessagingChannelBridge,
} from '../../../../src/connectors/messaging/channel-bridge.js'

import type {
  MessagingAdapter,
  MessagingTransport,
  MessagingTransportResult,
  InboundRawEvent,
  NormalizedInboundMessage,
  DeliveryTarget,
  OutboundTextMessage,
} from '../../../../src/connectors/messaging/types.js'
import type { OutboundEnvelope } from '../../../../src/gateway/types.js'
import type {
  ConnectorStore,
  ConnectorInstance,
  ConnectorDefinition,
  ConnectorStatus,
} from '../../../../src/storage/connector-store.js'

// ---------------------------------------------------------------------------
// Fixtures: connector store stubs
// ---------------------------------------------------------------------------

function makeDefinition(provider: string): ConnectorDefinition {
  return {
    id: `def-${provider}`,
    connectorId: provider,
    name: `${provider} Bot`,
    connectorType: 'messaging',
    version: '1.0.0',
    capabilities: ['send_text'],
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function makeInstance(provider: string, instanceId: string): ConnectorInstance {
  return {
    id: `row-${provider}`,
    connectorInstanceId: instanceId,
    connectorDefinitionId: `def-${provider}`,
    userId: 'owner-1',
    name: `${provider} Bot Instance`,
    authStateRef: `auth-${provider}`,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function createStubConnectorStore(
  definitions: ConnectorDefinition[],
  instances: ConnectorInstance[],
): ConnectorStore {
  const defMap = new Map(definitions.map((d) => [d.id, d]))
  return {
    findInstancesByStatus(status: ConnectorStatus): ConnectorInstance[] {
      if (status === 'active') return instances
      return []
    },
    findDefinitionById(id: string): ConnectorDefinition | undefined {
      return defMap.get(id)
    },
    applyMigrations: () => undefined,
    createDefinition: () => definitions[0],
    findDefinitionByConnectorId: () => undefined,
    findDefinitionsByType: () => [],
    updateDefinition: () => undefined,
    createInstance: () => instances[0],
    findInstanceById: () => undefined,
    findInstancesByUserAndConnector: () => [],
    updateInstance: () => undefined,
    deleteInstance: () => false,
    createEvent: () => ({
      id: 'evt-1',
      eventId: 'evt-1',
      connectorInstanceId: 'inst-1',
      eventType: 'test',
      processed: false,
      createdAt: '2026-01-01T00:00:00Z',
    }),
    findEventsByInstanceId: () => [],
    findEventsByProcessedStatus: () => [],
    markEventProcessed: () => undefined,
  } satisfies ConnectorStore
}

// ---------------------------------------------------------------------------
// Fixtures: inbound raw events per provider
// ---------------------------------------------------------------------------

function feishuInbound(): InboundRawEvent {
  return {
    provider: 'feishu',
    connectorInstanceId: 'inst-feishu-1',
    rawPayload: {
      schema: '2.0',
      header: {
        event_id: 'evt-fs-001',
        event_type: 'im.message.receive_v1',
        token: 'verify-token-feishu',
        tenant_key: 'tenant-fs',
      },
      event: {
        sender: {
          sender_id: { open_id: 'ou-feishu-user-1' },
          sender_type: 'user',
        },
        message: {
          chat_id: 'oc-feishu-chat-1',
          chat_type: 'group',
          message_id: 'om-feishu-msg-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'Hello from Feishu' }),
          create_time: '1750852800000',
        },
      },
    },
    receivedAt: '2026-06-25T12:00:00Z',
  }
}

function telegramInbound(): InboundRawEvent {
  return {
    provider: 'telegram',
    connectorInstanceId: 'inst-telegram-1',
    rawPayload: {
      update_id: 9001,
      message: {
        message_id: 2001,
        from: { id: 42, is_bot: false, first_name: 'Alice', username: 'alice' },
        chat: { id: 5001, type: 'private' },
        text: 'Hello from Telegram',
        date: 1750852800,
      },
    },
    receivedAt: '2026-06-25T12:00:00Z',
  }
}

function dingtalkInbound(): InboundRawEvent {
  return {
    provider: 'dingtalk',
    connectorInstanceId: 'inst-dingtalk-1',
    rawPayload: {
      msgtype: 'text',
      text: { content: 'Hello from DingTalk' },
      senderStaffId: 'dt-user-1',
      conversationId: 'dt-conv-1',
      conversationType: '1',
      senderNick: 'DingTalkUser',
      robotCode: 'dt-robot-1',
      msgId: 'dt-msg-1',
      createAt: 1750852800000,
    },
    receivedAt: '2026-06-25T12:00:00Z',
  }
}

function qqC2cInbound(): InboundRawEvent {
  return {
    provider: 'qq',
    connectorInstanceId: 'inst-qq-1',
    rawPayload: {
      d: {
        id: 'qq-msg-c2c-001',
        content: 'Hello from QQ',
        author: { id: 'qq-user-1', username: 'QQUser' },
        channel_id: 'qq-c2c-channel-1',
      },
      event_type: 'C2C_MESSAGE_CREATE',
    },
    receivedAt: '2026-06-25T12:00:00Z',
  }
}

function wechatOfficialInbound(): InboundRawEvent {
  const xml = [
    '<xml>',
    '<ToUserName><![CDATA[gh_bot]]></ToUserName>',
    '<FromUserName><![CDATA[wxuser1]]></FromUserName>',
    '<CreateTime>1750852800</CreateTime>',
    '<MsgType><![CDATA[text]]></MsgType>',
    '<Content><![CDATA[Hello from WeChat]]></Content>',
    '<MsgId>1001</MsgId>',
    '</xml>',
  ].join('')
  return {
    provider: 'wechat',
    connectorInstanceId: 'inst-wechat-1',
    rawPayload: xml,
    receivedAt: '2026-06-25T12:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessfulTransport(): MessagingTransport {
  return {
    sendText: async (
      _target: DeliveryTarget,
      _message: OutboundTextMessage,
    ): Promise<MessagingTransportResult> => ({
      success: true,
      messageId: 'mock-delivered-1',
    }),
    verifyWebhook: async () => true,
  }
}

function createSuccessfulQQFetch(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ access_token: 'test-token', expires_in: 7200 }),
  } as Response)
}

// ---------------------------------------------------------------------------
// Provider E2E flow tests
// ---------------------------------------------------------------------------

describe('Cross-Provider E2E Mock Flow', () => {
  const providers: Array<{
    name: string
    createAdapter: (transport: MessagingTransport) => MessagingAdapter
    inbound: () => InboundRawEvent
    expectedProvider: string
    expectedText: string
    expectedConversationId: string
    expectedUserId: string
  }> = [
    {
      name: 'feishu',
      createAdapter: (t) =>
        createFeishuAdapter(
          {
            appId: 'app-feishu',
            appSecret: 'secret-feishu',
            verificationToken: 'verify-token-feishu',
          },
          t,
        ),
      inbound: feishuInbound,
      expectedProvider: 'feishu',
      expectedText: 'Hello from Feishu',
      expectedConversationId: 'oc-feishu-chat-1',
      expectedUserId: 'ou-feishu-user-1',
    },
    {
      name: 'telegram',
      createAdapter: (t) =>
        createTelegramAdapter(
          { botToken: 'bot-token-tg', webhookSecret: 'wh-secret-tg' },
          t,
        ),
      inbound: telegramInbound,
      expectedProvider: 'telegram',
      expectedText: 'Hello from Telegram',
      expectedConversationId: '5001',
      expectedUserId: '42',
    },
    {
      name: 'dingtalk',
      createAdapter: (t) =>
        new DingTalkAdapter(
          { appKey: 'dt-key', appSecret: 'dt-secret', robotCode: 'dt-robot-1' },
          t,
        ),
      inbound: dingtalkInbound,
      expectedProvider: 'dingtalk',
      expectedText: 'Hello from DingTalk',
      expectedConversationId: 'dt-conv-1',
      expectedUserId: 'dt-user-1',
    },
    {
      name: 'qq',
      createAdapter: (t) =>
        createQQAdapter(
          { appId: 'qq-app', appSecret: 'qq-secret', sandbox: true },
          t,
          createSuccessfulQQFetch(),
        ),
      inbound: qqC2cInbound,
      expectedProvider: 'qq',
      expectedText: 'Hello from QQ',
      expectedConversationId: 'qq-c2c-channel-1',
      expectedUserId: 'qq-user-1',
    },
    {
      name: 'wechat',
      createAdapter: (t) =>
        createWeChatAdapter(
          { botToken: 'wx-token', appSecret: 'wx-secret', mode: 'official' },
          t,
        ),
      inbound: wechatOfficialInbound,
      expectedProvider: 'wechat',
      expectedText: 'Hello from WeChat',
      expectedConversationId: 'wxuser1',
      expectedUserId: 'wxuser1',
    },
  ]

  for (const provider of providers) {
    describe(`${provider.name} — inbound → outbound`, () => {
      it('handleInbound() returns a valid NormalizedInboundMessage', async () => {
        const transport = makeSuccessfulTransport()
        const adapter = provider.createAdapter(transport)
        const event = provider.inbound()

        const result = await adapter.handleInbound(event)

        expect(result).not.toBeNull()
        const msg = result as NormalizedInboundMessage
        expect(msg.provider).toBe(provider.expectedProvider)
        expect(msg.connectorInstanceId).toBe(event.connectorInstanceId)
        expect(msg.text).toBe(provider.expectedText)
        expect(msg.externalConversationId).toBe(provider.expectedConversationId)
        expect(msg.externalUserId).toBe(provider.expectedUserId)
        expect(msg.messageId).toBeTruthy()
        expect(msg.timestamp).toBeTruthy()
      })

      it('sendOutbound() delegates to mock transport and records the call', async () => {
        const transport = createMockTransport({
          sendText: async () => ({ success: true, messageId: 'out-1' }),
        })
        const adapter = provider.createAdapter(transport)

        const target: DeliveryTarget = {
          provider: provider.expectedProvider as DeliveryTarget['provider'],
          connectorInstanceId: event_connectorInstanceId(provider),
          conversationId: provider.expectedConversationId,
        }
        const message: OutboundTextMessage = {
          text: 'Agent reply',
          targetConversationId: provider.expectedConversationId,
        }

        const result = await adapter.sendOutbound(target, message)

        expect(result.success).toBe(true)
        expect(result.messageId).toBe('out-1')

        const calls = transport.getRecordedCalls()
        expect(calls).toHaveLength(1)
        expect(calls[0].target.provider).toBe(provider.expectedProvider)
        expect(calls[0].message.text).toBe('Agent reply')
      })

      it('sendOutbound() propagates transport failure', async () => {
        const transport = createMockTransport({
          sendText: async () => ({
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many', recoverable: true },
          }),
        })
        const adapter = provider.createAdapter(transport)

        const target: DeliveryTarget = {
          provider: provider.expectedProvider as DeliveryTarget['provider'],
          connectorInstanceId: event_connectorInstanceId(provider),
          conversationId: provider.expectedConversationId,
        }
        const message: OutboundTextMessage = {
          text: 'Should fail',
          targetConversationId: provider.expectedConversationId,
        }

        const result = await adapter.sendOutbound(target, message)

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('RATE_LIMITED')
      })

      it('getCapabilities() returns valid capabilities', () => {
        const transport = makeSuccessfulTransport()
        const adapter = provider.createAdapter(transport)
        const caps = adapter.getCapabilities()

        expect(caps.supportsText).toBe(true)
        expect(Array.isArray(caps.supportedMessageTypes)).toBe(true)
        expect(caps.supportedMessageTypes.length).toBeGreaterThan(0)
      })

      it('redactSecrets() masks secret fields in error paths', () => {
        const sensitivePayload = {
          botToken: 'super-secret-bot-token',
          appSecret: 'super-secret-app-secret',
          webhookSecret: 'super-secret-wh',
          verificationToken: 'super-secret-verify',
          text: 'user message',
        }

        const redacted = redactSecrets(sensitivePayload) as Record<string, unknown>

        expect(redacted.text).toBe('user message')
        expect(redacted.botToken).toBe('[REDACTED]')
        expect(redacted.appSecret).toBe('[REDACTED]')
        expect(redacted.webhookSecret).toBe('[REDACTED]')
        expect(redacted.verificationToken).toBe('[REDACTED]')
      })
    })
  }

  // ---------------------------------------------------------------------------
  // QQ-specific: token refresh failure path
  // ---------------------------------------------------------------------------

  describe('qq — token refresh failure', () => {
    it('returns AUTH_FAILED when token refresh fails', async () => {
      const failingFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'invalid_client' }),
      } as Response)

      const transport = createMockTransport({
        sendText: async () => ({ success: true }),
      })
      const adapter = createQQAdapter(
        { appId: 'qq-app', appSecret: 'qq-secret', sandbox: true },
        transport,
        failingFetch,
      )

      const target: DeliveryTarget = {
        provider: 'qq',
        connectorInstanceId: 'inst-qq-1',
        conversationId: 'qq-c2c-channel-1',
      }
      const message: OutboundTextMessage = {
        text: 'Should fail auth',
        targetConversationId: 'qq-c2c-channel-1',
      }

      const result = await adapter.sendOutbound(target, message)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('AUTH_FAILED')
      expect(result.error?.recoverable).toBe(false)

      // Transport should NOT have been called
      expect(transport.getRecordedCalls()).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// No-network guard
// ---------------------------------------------------------------------------

describe('No-Network Guard', () => {
  it('MockMessagingTransport without overrides throws on sendText', async () => {
    const transport = new MockMessagingTransport()
    const target: DeliveryTarget = {
      provider: 'telegram',
      connectorInstanceId: 'inst-1',
      conversationId: 'conv-1',
    }
    const message: OutboundTextMessage = {
      text: 'test',
      targetConversationId: 'conv-1',
    }

    await expect(transport.sendText(target, message)).rejects.toThrow(
      'MockMessagingTransport: real network blocked',
    )
  })

  it('MockMessagingTransport without overrides throws on verifyWebhook', async () => {
    const transport = new MockMessagingTransport()

    await expect(
      transport.verifyWebhook({}, {}, {}),
    ).rejects.toThrow('MockMessagingTransport: real network blocked')
  })

  it('createMockTransport() without overrides throws on sendText', async () => {
    const transport = createMockTransport()

    await expect(
      transport.sendText(
        { provider: 'feishu', connectorInstanceId: 'x', conversationId: 'y' },
        { text: 'hi', targetConversationId: 'y' },
      ),
    ).rejects.toThrow('real network blocked')
  })
})

// ---------------------------------------------------------------------------
// WebUI channel handler regression
// ---------------------------------------------------------------------------

describe('WebUI Channel Handler Regression', () => {
  it('createWebUIChannelHandler() returns a handler that delivers successfully', async () => {
    const handler = createWebUIChannelHandler()
    const envelope: OutboundEnvelope = {
      envelopeId: 'env-webui-1',
      messageType: 'text',
      recipient: { userId: 'u1', sessionId: 's1', channel: 'webui' },
      content: { text: 'Hello WebUI' },
      correlationId: 'corr-1',
      timestamp: '2026-06-25T12:00:00Z',
      metadata: {},
    }

    const result = await handler.deliver(envelope)
    expect(result.success).toBe(true)
  })

  it('WebUI handler coexists with messaging channels in registry', async () => {
    const registry = createChannelRegistry()

    // Register WebUI
    registry.register('webui', createWebUIChannelHandler(), {
      type: 'webui',
      status: 'active',
      configured: true,
    })

    // Register a messaging channel via bridge
    const telegramDef = makeDefinition('telegram')
    const telegramInst = makeInstance('telegram', 'inst-tg-1')
    const store = createStubConnectorStore([telegramDef], [telegramInst])

    const mockAdapter: MessagingAdapter = {
      handleInbound: async () => null,
      sendOutbound: async () => ({ success: true }),
      verifyInbound: async () => true,
      getCapabilities: () => ({
        supportsText: true,
        supportsRichCards: false,
        supportsMedia: false,
        supportedMessageTypes: ['text'],
      }),
    }

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => mockAdapter,
    })
    bridge.registerActiveProviders()

    // Both channels should be registered
    expect(registry.has('webui')).toBe(true)
    expect(registry.has('inst-tg-1')).toBe(true)
    expect(registry.list()).toHaveLength(2)

    // Both should deliver
    const webuiResult = await registry.deliver('webui', {
      envelopeId: 'e1',
      messageType: 'text',
      recipient: { userId: 'u', sessionId: 's', channel: 'webui' },
      content: { text: 'hi' },
      correlationId: 'c1',
      timestamp: new Date().toISOString(),
      metadata: {},
    })
    expect(webuiResult.success).toBe(true)

    const tgResult = await registry.deliver('inst-tg-1', {
      envelopeId: 'e2',
      messageType: 'text',
      recipient: { userId: 'u', sessionId: 's', channel: 'inst-tg-1' },
      content: { text: 'hi' },
      correlationId: 'c2',
      timestamp: new Date().toISOString(),
      metadata: {},
    })
    expect(tgResult.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Channel-boundary guard
// ---------------------------------------------------------------------------

describe('Channel-Boundary Guard', () => {
  const processingDir = path.join(process.cwd(), 'src/processing')

  it('processing modules do not import channel-registry', () => {
    const files = fs
      .readdirSync(processingDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

    for (const file of files) {
      const content = fs.readFileSync(path.join(processingDir, file), 'utf-8')
      const badImports = content
        .split('\n')
        .filter((line) => line.includes('import') && line.includes('channel-registry'))
      expect(
        badImports,
        `${file} should not import channel-registry`,
      ).toHaveLength(0)
    }
  })

  it('processing modules do not import timeline-broadcaster', () => {
    const files = fs
      .readdirSync(processingDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

    for (const file of files) {
      const content = fs.readFileSync(path.join(processingDir, file), 'utf-8')
      const badImports = content
        .split('\n')
        .filter(
          (line) => line.includes('import') && line.includes('timeline-broadcaster'),
        )
      expect(
        badImports,
        `${file} should not import timeline-broadcaster`,
      ).toHaveLength(0)
    }
  })

  it('processing types do not reference webui or sourceChannel', () => {
    const typesFile = path.join(processingDir, 'types.ts')
    const content = fs.readFileSync(typesFile, 'utf-8')

    // No 'webui' string literals
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
      expect(
        line.includes("'webui'") || line.includes('"webui"'),
        `types.ts line ${i + 1} should not reference 'webui'`,
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Secret grep assertions
// ---------------------------------------------------------------------------

describe('Secret Grep Assertions', () => {
  const srcDir = path.join(process.cwd(), 'src/connectors/messaging')

  const secretPatterns = [
    /(?:sk-|bot\d+:)[A-Za-z0-9_\-]{20,}/, // API keys like sk-xxx or bot tokens
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, // PEM private keys
    /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/, // GitHub tokens
  ]

  const providerFiles = [
    'providers/feishu.ts',
    'providers/telegram.ts',
    'providers/dingtalk.ts',
    'providers/qq.ts',
    'providers/wechat.ts',
    'mock-transport.ts',
    'channel-bridge.ts',
    'secret-redaction.ts',
    'types.ts',
  ]

  for (const relPath of providerFiles) {
    it(`${relPath} contains no leaked secret patterns`, () => {
      const filePath = path.join(srcDir, relPath)
      if (!fs.existsSync(filePath)) return

      const content = fs.readFileSync(filePath, 'utf-8')
      for (const pattern of secretPatterns) {
        const matches = content.match(pattern)
        expect(
          matches,
          `${relPath} contains potential secret: ${matches?.[0]?.substring(0, 30)}...`,
        ).toBeNull()
      }
    })
  }

  it('test fixtures contain no real secret values (only placeholder tokens)', () => {
    const testDir = path.join(process.cwd(), 'tests/integration/connectors/messaging')
    const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))

    for (const file of testFiles) {
      const content = fs.readFileSync(path.join(testDir, file), 'utf-8')
      for (const pattern of secretPatterns) {
        const matches = content.match(pattern)
        expect(
          matches,
          `Test ${file} contains potential real secret: ${matches?.[0]?.substring(0, 30)}...`,
        ).toBeNull()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Full pipeline: inbound → bridge → registry → outbound
// ---------------------------------------------------------------------------

describe('Full Pipeline: inbound → channel-bridge → registry → outbound', () => {
  it('routes telegram inbound through bridge and delivers outbound', async () => {
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'pipe-1' }),
    })
    const adapter = createTelegramAdapter(
      { botToken: 'bot-token', webhookSecret: 'wh-secret' },
      transport,
    )

    // Step 1: Inbound
    const inboundEvent = telegramInbound()
    const normalized = await adapter.handleInbound(inboundEvent)
    expect(normalized).not.toBeNull()
    expect(normalized!.text).toBe('Hello from Telegram')

    // Step 2: Register via bridge
    const registry = createChannelRegistry()
    const tgDef = makeDefinition('telegram')
    const tgInst = makeInstance('telegram', 'inst-telegram-1')
    const store = createStubConnectorStore([tgDef], [tgInst])

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => adapter,
    })
    bridge.registerActiveProviders()
    expect(registry.has('inst-telegram-1')).toBe(true)

    // Step 3: Outbound delivery through registry
    const envelope: OutboundEnvelope = {
      envelopeId: 'env-pipe-1',
      messageType: 'text',
      recipient: {
        userId: normalized!.externalUserId,
        sessionId: 'sess-1',
        channel: 'inst-telegram-1',
      },
      content: { text: 'Agent response to Telegram user' },
      correlationId: 'corr-pipe-1',
      timestamp: new Date().toISOString(),
      metadata: {
        externalConversationId: normalized!.externalConversationId,
      },
    }

    const deliveryResult = await registry.deliver('inst-telegram-1', envelope)
    expect(deliveryResult.success).toBe(true)

    // Step 4: Verify transport received the call
    const calls = transport.getRecordedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].target.provider).toBe('telegram')
    expect(calls[0].target.conversationId).toBe(normalized!.externalConversationId)
    expect(calls[0].message.text).toBe('Agent response to Telegram user')
  })

  it('routes feishu inbound through bridge and delivers outbound', async () => {
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'pipe-fs-1' }),
    })
    const adapter = createFeishuAdapter(
      {
        appId: 'app-fs',
        appSecret: 'secret-fs',
        verificationToken: 'verify-token-feishu',
      },
      transport,
    )

    // Inbound
    const normalized = await adapter.handleInbound(feishuInbound())
    expect(normalized).not.toBeNull()
    expect(normalized!.text).toBe('Hello from Feishu')

    // Bridge + registry
    const registry = createChannelRegistry()
    const fsDef = makeDefinition('feishu')
    const fsInst = makeInstance('feishu', 'inst-feishu-1')
    const store = createStubConnectorStore([fsDef], [fsInst])

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => adapter,
    })
    bridge.registerActiveProviders()

    // Outbound
    const envelope: OutboundEnvelope = {
      envelopeId: 'env-pipe-fs',
      messageType: 'text',
      recipient: {
        userId: normalized!.externalUserId,
        sessionId: 'sess-fs',
        channel: 'inst-feishu-1',
      },
      content: { text: 'Agent reply to Feishu' },
      correlationId: 'corr-pipe-fs',
      timestamp: new Date().toISOString(),
      metadata: { externalConversationId: normalized!.externalConversationId },
    }

    const result = await registry.deliver('inst-feishu-1', envelope)
    expect(result.success).toBe(true)

    const calls = transport.getRecordedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].target.provider).toBe('feishu')
    expect(calls[0].message.text).toBe('Agent reply to Feishu')
  })

  it('routes dingtalk inbound through bridge and delivers outbound', async () => {
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'pipe-dt-1' }),
    })
    const adapter = new DingTalkAdapter(
      { appKey: 'dt-key', appSecret: 'dt-secret', robotCode: 'dt-robot-1' },
      transport,
    )

    const normalized = await adapter.handleInbound(dingtalkInbound())
    expect(normalized).not.toBeNull()
    expect(normalized!.text).toBe('Hello from DingTalk')

    const registry = createChannelRegistry()
    const dtDef = makeDefinition('dingtalk')
    const dtInst = makeInstance('dingtalk', 'inst-dingtalk-1')
    const store = createStubConnectorStore([dtDef], [dtInst])

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => adapter,
    })
    bridge.registerActiveProviders()

    const envelope: OutboundEnvelope = {
      envelopeId: 'env-pipe-dt',
      messageType: 'text',
      recipient: {
        userId: normalized!.externalUserId,
        sessionId: 'sess-dt',
        channel: 'inst-dingtalk-1',
      },
      content: { text: 'Agent reply to DingTalk' },
      correlationId: 'corr-pipe-dt',
      timestamp: new Date().toISOString(),
      metadata: { externalConversationId: normalized!.externalConversationId },
    }

    const result = await registry.deliver('inst-dingtalk-1', envelope)
    expect(result.success).toBe(true)

    const calls = transport.getRecordedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].target.provider).toBe('dingtalk')
  })

  it('routes qq c2c inbound through bridge and delivers outbound', async () => {
    const fetchFn = createSuccessfulQQFetch()
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'pipe-qq-1' }),
    })
    const adapter = createQQAdapter(
      { appId: 'qq-app', appSecret: 'qq-secret', sandbox: true },
      transport,
      fetchFn,
    )

    const normalized = await adapter.handleInbound(qqC2cInbound())
    expect(normalized).not.toBeNull()
    expect(normalized!.text).toBe('Hello from QQ')
    expect(normalized!.provider).toBe('qq')

    const registry = createChannelRegistry()
    const qqDef = makeDefinition('qq')
    const qqInst = makeInstance('qq', 'inst-qq-1')
    const store = createStubConnectorStore([qqDef], [qqInst])

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => adapter,
    })
    bridge.registerActiveProviders()

    const envelope: OutboundEnvelope = {
      envelopeId: 'env-pipe-qq',
      messageType: 'text',
      recipient: {
        userId: normalized!.externalUserId,
        sessionId: 'sess-qq',
        channel: 'inst-qq-1',
      },
      content: { text: 'Agent reply to QQ' },
      correlationId: 'corr-pipe-qq',
      timestamp: new Date().toISOString(),
      metadata: { externalConversationId: normalized!.externalConversationId },
    }

    const result = await registry.deliver('inst-qq-1', envelope)
    expect(result.success).toBe(true)

    const calls = transport.getRecordedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].target.provider).toBe('qq')
  })

  it('routes wechat official inbound through bridge and delivers outbound', async () => {
    const transport = createMockTransport({
      sendText: async () => ({ success: true, messageId: 'pipe-wx-1' }),
    })
    const adapter = createWeChatAdapter(
      { botToken: 'wx-token', appSecret: 'wx-secret', mode: 'official' },
      transport,
    )

    const normalized = await adapter.handleInbound(wechatOfficialInbound())
    expect(normalized).not.toBeNull()
    expect(normalized!.text).toBe('Hello from WeChat')
    expect(normalized!.provider).toBe('wechat')

    const registry = createChannelRegistry()
    const wxDef = makeDefinition('wechat')
    const wxInst = makeInstance('wechat', 'inst-wechat-1')
    const store = createStubConnectorStore([wxDef], [wxInst])

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: () => adapter,
    })
    bridge.registerActiveProviders()

    const envelope: OutboundEnvelope = {
      envelopeId: 'env-pipe-wx',
      messageType: 'text',
      recipient: {
        userId: normalized!.externalUserId,
        sessionId: 'sess-wx',
        channel: 'inst-wechat-1',
      },
      content: { text: 'Agent reply to WeChat' },
      correlationId: 'corr-pipe-wx',
      timestamp: new Date().toISOString(),
      metadata: { externalConversationId: normalized!.externalConversationId },
    }

    const result = await registry.deliver('inst-wechat-1', envelope)
    expect(result.success).toBe(true)

    const calls = transport.getRecordedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].target.provider).toBe('wechat')
  })
})

// ---------------------------------------------------------------------------
// Multi-provider channel bridge registration
// ---------------------------------------------------------------------------

describe('Multi-Provider Channel Bridge Registration', () => {
  it('registers all five providers simultaneously and delivers to each', async () => {
    const registry = createChannelRegistry()

    // Register WebUI first (mimics real context.ts pattern)
    registry.register('webui', createWebUIChannelHandler(), {
      type: 'webui',
      status: 'active',
      configured: true,
    })

    const providers = ['feishu', 'telegram', 'dingtalk', 'qq', 'wechat']
    const definitions = providers.map(makeDefinition)
    const instances = providers.map((p) => makeInstance(p, `inst-${p}`))
    const store = createStubConnectorStore(definitions, instances)

    const transports = new Map<string, MockMessagingTransport>()
    const adapters = new Map<string, MessagingAdapter>()

    for (const p of providers) {
      const transport = createMockTransport({
        sendText: async () => ({ success: true, messageId: `msg-${p}` }),
      })
      transports.set(p, transport)

      let adapter: MessagingAdapter
      if (p === 'feishu') {
        adapter = createFeishuAdapter(
          { appId: 'a', appSecret: 's', verificationToken: 'v' },
          transport,
        )
      } else if (p === 'telegram') {
        adapter = createTelegramAdapter(
          { botToken: 'b', webhookSecret: 'w' },
          transport,
        )
      } else if (p === 'dingtalk') {
        adapter = new DingTalkAdapter(
          { appKey: 'k', appSecret: 's', robotCode: 'r' },
          transport,
        )
      } else if (p === 'qq') {
        adapter = createQQAdapter(
          { appId: 'a', appSecret: 's' },
          transport,
          createSuccessfulQQFetch(),
        )
      } else {
        adapter = createWeChatAdapter(
          { botToken: 'b', appSecret: 's', mode: 'official' },
          transport,
        )
      }
      adapters.set(p, adapter)
    }

    const bridge = createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: (id: string) => {
        const provider = id.replace('inst-', '')
        return adapters.get(provider)
      },
    })
    bridge.registerActiveProviders()

    // All 5 + webui = 6 channels
    expect(registry.list()).toHaveLength(6)
    expect(registry.has('webui')).toBe(true)

    // Deliver to each provider channel
    for (const p of providers) {
      const channelId = `inst-${p}`
      expect(registry.has(channelId)).toBe(true)

      const envelope: OutboundEnvelope = {
        envelopeId: `env-multi-${p}`,
        messageType: 'text',
        recipient: { userId: 'u', sessionId: 's', channel: channelId },
        content: { text: `Reply to ${p}` },
        correlationId: `corr-${p}`,
        timestamp: new Date().toISOString(),
        metadata: {},
      }

      const result = await registry.deliver(channelId, envelope)
      expect(result.success).toBe(true)
    }

    // Verify each transport received exactly one call
    for (const p of providers) {
      const transport = transports.get(p)!
      const calls = transport.getRecordedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].message.text).toBe(`Reply to ${p}`)
    }

    // WebUI still works
    const webuiResult = await registry.deliver('webui', {
      envelopeId: 'env-multi-webui',
      messageType: 'text',
      recipient: { userId: 'u', sessionId: 's', channel: 'webui' },
      content: { text: 'WebUI reply' },
      correlationId: 'corr-webui',
      timestamp: new Date().toISOString(),
      metadata: {},
    })
    expect(webuiResult.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Helper to get connectorInstanceId per provider
// ---------------------------------------------------------------------------

function event_connectorInstanceId(provider: { name: string }): string {
  return `inst-${provider.name}-1`
}
