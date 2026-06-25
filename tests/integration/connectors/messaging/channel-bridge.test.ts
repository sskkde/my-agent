import { describe, it, expect, beforeEach } from 'vitest'
import {
  createChannelRegistry,
  createWebUIChannelHandler,
  type ChannelRegistry,
} from '../../../../src/gateway/channel-registry.js'
import type { OutboundEnvelope } from '../../../../src/gateway/types.js'
import type {
  ConnectorStore,
  ConnectorInstance,
  ConnectorDefinition,
  ConnectorStatus,
} from '../../../../src/storage/connector-store.js'
import type {
  MessagingAdapter,
  MessagingTransportResult,
  DeliveryTarget,
  OutboundTextMessage,
  InboundRawEvent,
  NormalizedInboundMessage,
  MessagingCapabilities,
} from '../../../../src/connectors/messaging/types.js'
import {
  MessagingChannelBridge,
  createMessagingChannelBridge,
} from '../../../../src/connectors/messaging/channel-bridge.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TELEGRAM_DEFINITION: ConnectorDefinition = {
  id: 'def-telegram',
  connectorId: 'telegram',
  name: 'Telegram Bot',
  connectorType: 'messaging',
  version: '1.0.0',
  capabilities: ['send_text'],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const FEISHU_DEFINITION: ConnectorDefinition = {
  id: 'def-feishu',
  connectorId: 'feishu',
  name: 'Feishu Bot',
  connectorType: 'messaging',
  version: '1.0.0',
  capabilities: ['send_text'],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const GITHUB_DEFINITION: ConnectorDefinition = {
  id: 'def-github',
  connectorId: 'github',
  name: 'GitHub',
  connectorType: 'api',
  version: '1.0.0',
  capabilities: ['list_repos'],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const ACTIVE_TELEGRAM_INSTANCE: ConnectorInstance = {
  id: 'row-tg-active',
  connectorInstanceId: 'inst-tg-active',
  connectorDefinitionId: 'def-telegram',
  userId: 'user-1',
  name: 'My Telegram Bot',
  authStateRef: 'auth-tg',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const INACTIVE_TELEGRAM_INSTANCE: ConnectorInstance = {
  id: 'row-tg-inactive',
  connectorInstanceId: 'inst-tg-inactive',
  connectorDefinitionId: 'def-telegram',
  userId: 'user-1',
  name: 'Old Telegram Bot',
  authStateRef: 'auth-tg-old',
  status: 'inactive',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const DRAFT_FEISHU_INSTANCE: ConnectorInstance = {
  id: 'row-fs-draft',
  connectorInstanceId: 'inst-fs-draft',
  connectorDefinitionId: 'def-feishu',
  userId: 'user-2',
  name: 'Draft Feishu',
  authStateRef: 'auth-fs',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const ACTIVE_GITHUB_INSTANCE: ConnectorInstance = {
  id: 'row-gh-active',
  connectorInstanceId: 'inst-gh-active',
  connectorDefinitionId: 'def-github',
  userId: 'user-1',
  name: 'My GitHub',
  authStateRef: 'auth-gh',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function makeEnvelope(overrides?: Partial<OutboundEnvelope>): OutboundEnvelope {
  return {
    envelopeId: 'env-1',
    messageType: 'text',
    recipient: {
      userId: 'user-1',
      sessionId: 'sess-1',
      channel: 'inst-tg-active',
    },
    content: {
      text: 'Hello from the agent',
    },
    correlationId: 'corr-1',
    timestamp: '2026-06-25T12:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock ConnectorStore — only the methods the bridge calls
// ---------------------------------------------------------------------------

interface MockStoreData {
  definitions: Map<string, ConnectorDefinition>
  activeInstances: ConnectorInstance[]
  inactiveInstances: ConnectorInstance[]
  draftInstances: ConnectorInstance[]
}

function createMockConnectorStore(data: MockStoreData): ConnectorStore {
  const allInstances = [
    ...data.activeInstances,
    ...data.inactiveInstances,
    ...data.draftInstances,
  ]

  return {
    findInstancesByStatus(status: ConnectorStatus): ConnectorInstance[] {
      if (status === 'active') return [...data.activeInstances]
      if (status === 'inactive') return [...data.inactiveInstances]
      if (status === 'draft') return [...data.draftInstances]
      return []
    },
    findDefinitionById(id: string): ConnectorDefinition | undefined {
      return data.definitions.get(id)
    },
    // Stubs for other interface methods the bridge doesn't call
    applyMigrations: () => undefined,
    createDefinition: () => TELEGRAM_DEFINITION,
    findDefinitionByConnectorId: () => undefined,
    findDefinitionsByType: () => [],
    updateDefinition: () => undefined,
    createInstance: () => ACTIVE_TELEGRAM_INSTANCE,
    findInstanceById: (id: string) => allInstances.find((i) => i.id === id),
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
// Mock MessagingAdapter — records sendOutbound calls
// ---------------------------------------------------------------------------

interface RecordedOutboundCall {
  target: DeliveryTarget
  message: OutboundTextMessage
}

function createMockAdapter(overrides?: {
  sendOutbound?: (
    target: DeliveryTarget,
    message: OutboundTextMessage,
  ) => Promise<MessagingTransportResult>
}): MessagingAdapter & { getCalls(): RecordedOutboundCall[] } {
  const calls: RecordedOutboundCall[] = []

  const sendOutboundFn =
    overrides?.sendOutbound ??
    (async (): Promise<MessagingTransportResult> => ({
      success: true,
      messageId: 'msg-ext-1',
    }))

  return {
    handleInbound: async (_event: InboundRawEvent): Promise<NormalizedInboundMessage | null> => null,
    sendOutbound: async (
      target: DeliveryTarget,
      message: OutboundTextMessage,
    ): Promise<MessagingTransportResult> => {
      calls.push({ target: structuredClone(target), message: structuredClone(message) })
      return sendOutboundFn(target, message)
    },
    verifyInbound: async (): Promise<boolean> => true,
    getCapabilities: (): MessagingCapabilities => ({
      supportsText: true,
      supportsRichCards: false,
      supportsMedia: false,
      supportedMessageTypes: ['text'],
    }),
    getCalls: () => [...calls],
  }
}

// Helper to access recorded calls on the mock adapter
function getCalls(adapter: MessagingAdapter): RecordedOutboundCall[] {
  return (adapter as MessagingAdapter & { getCalls: () => RecordedOutboundCall[] }).getCalls()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessagingChannelBridge', () => {
  let registry: ChannelRegistry
  let definitions: Map<string, ConnectorDefinition>
  let adapters: Map<string, MessagingAdapter>
  let store: ConnectorStore

  beforeEach(() => {
    registry = createChannelRegistry()

    definitions = new Map([
      ['def-telegram', TELEGRAM_DEFINITION],
      ['def-feishu', FEISHU_DEFINITION],
      ['def-github', GITHUB_DEFINITION],
    ])

    adapters = new Map()

    store = createMockConnectorStore({
      definitions,
      activeInstances: [ACTIVE_TELEGRAM_INSTANCE, ACTIVE_GITHUB_INSTANCE],
      inactiveInstances: [INACTIVE_TELEGRAM_INSTANCE],
      draftInstances: [DRAFT_FEISHU_INSTANCE],
    })
  })

  function createBridge(): MessagingChannelBridge {
    return createMessagingChannelBridge({
      channelRegistry: registry,
      connectorStore: store,
      adapterResolver: (id: string) => adapters.get(id),
    })
  }

  describe('registerActiveProviders()', () => {
    it('registers active messaging instances as channels', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      expect(registry.has('inst-tg-active')).toBe(true)
    })

    it('does NOT register inactive instances', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)
      // No adapter for inactive — but even if one existed, inactive should be skipped

      const bridge = createBridge()
      bridge.registerActiveProviders()

      expect(registry.has('inst-tg-inactive')).toBe(false)
    })

    it('does NOT register draft instances', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-fs-draft', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      expect(registry.has('inst-fs-draft')).toBe(false)
    })

    it('skips active instances whose definition is not messaging type', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-gh-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      // GitHub instance is active but connectorType is 'api', not 'messaging'
      expect(registry.has('inst-gh-active')).toBe(false)
    })

    it('skips active messaging instances without a resolvable adapter', () => {
      // No adapter registered for inst-tg-active
      const bridge = createBridge()
      bridge.registerActiveProviders()

      expect(registry.has('inst-tg-active')).toBe(false)
    })

    it('registers channel metadata as messaging type', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const entry = registry.get('inst-tg-active')
      expect(entry).toBeDefined()
      expect(entry?.metadata.type).toBe('messaging')
      expect(entry?.metadata.status).toBe('active')
      expect(entry?.metadata.configured).toBe(true)
    })
  })

  describe('deliver()', () => {
    it('routes an OutboundEnvelope to the MessagingAdapter', async () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const envelope = makeEnvelope()
      const result = await registry.deliver('inst-tg-active', envelope)

      expect(result.success).toBe(true)

      const calls = getCalls(mockAdapter)
      expect(calls).toHaveLength(1)
      expect(calls[0].target.provider).toBe('telegram')
      expect(calls[0].target.connectorInstanceId).toBe('inst-tg-active')
      expect(calls[0].target.conversationId).toBe('sess-1')
      expect(calls[0].message.text).toBe('Hello from the agent')
    })

    it('uses externalConversationId from metadata when present', async () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const envelope = makeEnvelope({
        metadata: { externalConversationId: 'tg-chat-42' },
      })
      await registry.deliver('inst-tg-active', envelope)

      const calls = getCalls(mockAdapter)
      expect(calls[0].target.conversationId).toBe('tg-chat-42')
      expect(calls[0].message.targetConversationId).toBe('tg-chat-42')
    })

    it('maps adapter transport error to DeliveryResult error', async () => {
      const mockAdapter = createMockAdapter({
        sendOutbound: async () => ({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            recoverable: true,
          },
        }),
      })
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const result = await registry.deliver('inst-tg-active', makeEnvelope())

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('RATE_LIMITED')
      expect(result.error?.message).toBe('Too many requests')
    })

    it('returns CHANNEL_NOT_FOUND for unknown channels', async () => {
      const result = await registry.deliver('nonexistent-channel', makeEnvelope())

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('CHANNEL_NOT_FOUND')
    })
  })

  describe('preserves existing channels', () => {
    it('webui channel remains registered after bridge registration', () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      // Register webui first (mimics context.ts pattern)
      registry.register('webui', createWebUIChannelHandler(), {
        type: 'webui',
        status: 'active',
        configured: true,
      })

      const bridge = createBridge()
      bridge.registerActiveProviders()

      expect(registry.has('webui')).toBe(true)
      expect(registry.has('inst-tg-active')).toBe(true)

      const channels = registry.list()
      const ids = channels.map((c) => c.connectorId)
      expect(ids).toContain('webui')
      expect(ids).toContain('inst-tg-active')
    })

    it('webui channel still delivers after bridge registration', async () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      registry.register('webui', createWebUIChannelHandler(), {
        type: 'webui',
        status: 'active',
        configured: true,
      })

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const webuiResult = await registry.deliver('webui', makeEnvelope())
      expect(webuiResult.success).toBe(true)

      const tgResult = await registry.deliver('inst-tg-active', makeEnvelope())
      expect(tgResult.success).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles empty active instances gracefully', () => {
      const emptyStore = createMockConnectorStore({
        definitions,
        activeInstances: [],
        inactiveInstances: [],
        draftInstances: [],
      })

      const bridge = createMessagingChannelBridge({
        channelRegistry: registry,
        connectorStore: emptyStore,
        adapterResolver: (id: string) => adapters.get(id),
      })

      bridge.registerActiveProviders()

      expect(registry.list()).toHaveLength(0)
    })

    it('envelope with empty text sends empty string', async () => {
      const mockAdapter = createMockAdapter()
      adapters.set('inst-tg-active', mockAdapter)

      const bridge = createBridge()
      bridge.registerActiveProviders()

      const envelope = makeEnvelope({ content: {} })
      await registry.deliver('inst-tg-active', envelope)

      const calls = getCalls(mockAdapter)
      expect(calls[0].message.text).toBe('')
    })
  })
})
