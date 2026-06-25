/**
 * Integration tests for the messaging webhook ingress route.
 *
 * Tests the full request → verify → normalize → session-map → process flow
 * using mocked adapters, stores, and message processor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  registerMessagingWebhookRoutes,
  type MessagingWebhookRouteDeps,
} from '../../../../src/api/routes/messaging-webhooks.js'
import type { ApiContext } from '../../../../src/api/context.js'
import type {
  ConnectorStore,
  ConnectorInstance,
  ConnectorDefinition,
  ConnectorStatus,
} from '../../../../src/storage/connector-store.js'
import type {
  SessionChannelMapStore,
  SessionChannelMapping,
} from '../../../../src/storage/session-channel-map-store.js'
import type { SessionStore, Session } from '../../../../src/storage/session-store.js'
import type {
  MessagingAdapter,
  InboundRawEvent,
  NormalizedInboundMessage,
  MessagingCapabilities,
  MessagingTransportResult,
} from '../../../../src/connectors/messaging/types.js'
import type { Gateway } from '../../../../src/gateway/gateway.js'
import type { InboundEnvelope, OutboundEnvelope } from '../../../../src/gateway/types.js'
import type { ChannelRegistry, DeliveryResult } from '../../../../src/gateway/channel-registry.js'
import type { MessageProcessor, MessageProcessorOutput } from '../../../../src/processing/types.js'
import type { EventStore } from '../../../../src/storage/event-store.js'
import type { TranscriptStore } from '../../../../src/storage/transcript-store.js'

// ---------------------------------------------------------------------------
// Fixtures
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

const ACTIVE_TELEGRAM_INSTANCE: ConnectorInstance = {
  id: 'row-tg-1',
  connectorInstanceId: 'inst-tg-1',
  connectorDefinitionId: 'def-telegram',
  userId: 'owner-1',
  name: 'My Telegram Bot',
  authStateRef: 'auth-tg',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const INACTIVE_TELEGRAM_INSTANCE: ConnectorInstance = {
  id: 'row-tg-2',
  connectorInstanceId: 'inst-tg-inactive',
  connectorDefinitionId: 'def-telegram',
  userId: 'owner-1',
  name: 'Disabled Telegram Bot',
  authStateRef: 'auth-tg-2',
  status: 'inactive',
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

const ACTIVE_GITHUB_INSTANCE: ConnectorInstance = {
  id: 'row-gh-1',
  connectorInstanceId: 'inst-gh-1',
  connectorDefinitionId: 'def-github',
  userId: 'owner-1',
  name: 'My GitHub',
  authStateRef: 'auth-gh',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const VALID_NORMALIZED_MESSAGE: NormalizedInboundMessage = {
  provider: 'telegram',
  connectorInstanceId: 'inst-tg-1',
  externalConversationId: 'tg-chat-42',
  externalUserId: 'tg-user-7',
  externalUserName: 'Alice',
  text: 'Hello bot!',
  messageId: 'tg-msg-100',
  timestamp: '2026-06-25T12:00:00Z',
}

const VALID_WEBHOOK_PAYLOAD = {
  update_id: 42,
  message: {
    message_id: 100,
    from: { id: 7, first_name: 'Alice' },
    chat: { id: 42, type: 'private' },
    text: 'Hello bot!',
    date: 1750852800,
  },
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockConnectorStore(overrides?: {
  definitions?: Map<string, ConnectorDefinition>
  instances?: Map<ConnectorStatus, ConnectorInstance[]>
}): ConnectorStore {
  const definitions = overrides?.definitions ??
    new Map([
      ['def-telegram', TELEGRAM_DEFINITION],
      ['def-github', GITHUB_DEFINITION],
    ])

  const instances = overrides?.instances ??
    new Map<ConnectorStatus, ConnectorInstance[]>([
      ['active', [ACTIVE_TELEGRAM_INSTANCE, ACTIVE_GITHUB_INSTANCE]],
      ['inactive', [INACTIVE_TELEGRAM_INSTANCE]],
      ['draft', []],
      ['deprecated', []],
    ])

  return {
    findInstancesByStatus(status: ConnectorStatus): ConnectorInstance[] {
      return instances.get(status) ?? []
    },
    findDefinitionById(id: string): ConnectorDefinition | undefined {
      return definitions.get(id)
    },
    // Stubs
    applyMigrations: () => undefined,
    createDefinition: () => TELEGRAM_DEFINITION,
    findDefinitionByConnectorId: () => undefined,
    findDefinitionsByType: () => [],
    updateDefinition: () => undefined,
    createInstance: () => ACTIVE_TELEGRAM_INSTANCE,
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

function createMockAdapter(options?: {
  verifyResult?: boolean
  handleResult?: NormalizedInboundMessage | null
}): MessagingAdapter {
  return {
    verifyInbound: async (): Promise<boolean> => options?.verifyResult ?? true,
    handleInbound: async (_event: InboundRawEvent): Promise<NormalizedInboundMessage | null> =>
      options && 'handleResult' in options ? (options.handleResult ?? null) : VALID_NORMALIZED_MESSAGE,
    sendOutbound: async (): Promise<MessagingTransportResult> => ({ success: true }),
    getCapabilities: (): MessagingCapabilities => ({
      supportsText: true,
      supportsRichCards: false,
      supportsMedia: false,
      supportedMessageTypes: ['text'],
    }),
  }
}

interface MockSessionChannelMapData {
  mappings: SessionChannelMapping[]
  createdMappings: Array<Omit<SessionChannelMapping, 'id' | 'tenantId' | 'createdAt' | 'lastSeenAt'>>
  updatedLastSeenIds: string[]
}

function createMockSessionChannelMapStore(data?: MockSessionChannelMapData): SessionChannelMapStore {
  const storeData: MockSessionChannelMapData = data ?? {
    mappings: [],
    createdMappings: [],
    updatedLastSeenIds: [],
  }

  return {
    findByExternalIds(
      provider: string,
      externalConversationId: string,
      externalUserId: string,
      connectorInstanceId: string,
    ): SessionChannelMapping | undefined {
      return storeData.mappings.find(
        (m) =>
          m.provider === provider &&
          m.externalConversationId === externalConversationId &&
          m.externalUserId === externalUserId &&
          m.connectorInstanceId === connectorInstanceId,
      )
    },
    createMapping(
      input: Omit<SessionChannelMapping, 'id' | 'tenantId' | 'createdAt' | 'lastSeenAt'>,
    ): SessionChannelMapping {
      storeData.createdMappings.push(input)
      const now = new Date().toISOString()
      return {
        id: `map-${storeData.createdMappings.length}`,
        tenantId: 'org_default',
        ...input,
        createdAt: now,
        lastSeenAt: now,
      }
    },
    updateLastSeen(id: string): SessionChannelMapping | undefined {
      storeData.updatedLastSeenIds.push(id)
      return storeData.mappings.find((m) => m.id === id)
    },
    deleteMapping(): boolean {
      return false
    },
  }
}

function createMockGateway(): Gateway {
  return {
    receiveUserMessage(
      userId: string,
      sessionId: string,
      text: string,
      channel = 'default',
      attachmentIds?: string[],
    ): InboundEnvelope {
      return {
        envelopeId: `env-${Date.now()}`,
        eventType: 'human_message',
        sourceChannel: channel,
        payload: { text, attachmentIds },
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        metadata: {},
      }
    },
    normalizeInbound(raw: Parameters<Gateway['normalizeInbound']>[0]): InboundEnvelope {
      return {
        envelopeId: `env-${Date.now()}`,
        eventType: raw.eventType,
        sourceChannel: raw.sourceChannel,
        payload: raw.payload,
        userId: raw.userId,
        sessionId: raw.sessionId,
        timestamp: new Date().toISOString(),
        metadata: raw.metadata ?? {},
      }
    },
    assembleHydratedState() {
      return {
        userContext: { userId: 'u', sessionId: 's' },
        sessionContext: {
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
        activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
      }
    },
    formatOutbound(
      _responseType: string,
      content: Record<string, unknown>,
      recipient: { userId: string; sessionId: string; channel?: string },
      correlationId: string,
    ): OutboundEnvelope {
      return {
        envelopeId: `out-${Date.now()}`,
        messageType: 'text',
        recipient,
        content: content as OutboundEnvelope['content'],
        correlationId,
        timestamp: new Date().toISOString(),
        metadata: {},
      }
    },
    getApprovalRoutingHint() {
      return { preferredPath: '', priority: 'normal' as const }
    },
  }
}

function createMockMessageProcessor(options?: {
  result?: MessageProcessorOutput
}): MessageProcessor {
  return {
    process: async (): Promise<MessageProcessorOutput> =>
      options?.result ?? {
        correlationId: 'corr-1',
        success: true,
        result: { text: 'Agent response' },
        timestamp: new Date().toISOString(),
      },
  }
}

function createMockChannelRegistry(): ChannelRegistry & { delivered: OutboundEnvelope[] } {
  const delivered: OutboundEnvelope[] = []

  return {
    delivered,
    register(): void {},
    unregister(): boolean {
      return false
    },
    get() {
      return undefined
    },
    list() {
      return []
    },
    has(): boolean {
      return false
    },
    async deliver(_channelId: string, envelope: OutboundEnvelope): Promise<DeliveryResult> {
      delivered.push(envelope)
      return { success: true }
    },
  }
}

function createMockSessionStore(): SessionStore & { sessions: Session[] } {
  const sessions: Session[] = []

  return {
    sessions,
    create(input: { sessionId: string; userId: string; title: string; status?: string }): Session {
      const session: Session = {
        sessionId: input.sessionId,
        userId: input.userId,
        title: input.title,
        status: (input.status as Session['status']) ?? 'active',
        messageCount: 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      sessions.push(session)
      return session
    },
    getById(): Session | null {
      return null
    },
    list(): Session[] {
      return []
    },
    updateActivity(): boolean {
      return true
    },
    updateMetadata(): boolean {
      return true
    },
    updateStatus(): boolean {
      return true
    },
    updateTitle(): boolean {
      return true
    },
    updateUserId(): boolean {
      return true
    },
    setModel(): boolean {
      return true
    },
    getCount(): number {
      return 0
    },
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ApiContext-shaped object with only the fields the webhook
 * route actually touches. Tests can override individual stores.
 */
function buildContext(overrides?: {
  connectorStore?: ConnectorStore
  sessionStore?: SessionStore
  gateway?: Gateway
  messageProcessor?: MessageProcessor
  channelRegistry?: ChannelRegistry
}): ApiContext {
  const sessionStore = overrides?.sessionStore ?? createMockSessionStore()
  const transcriptStore = {
    findBySession: () => [],
  } as unknown as TranscriptStore
  const eventStore = {
    append: () => {},
    query: () => [],
  } as unknown as EventStore

  return {
    gateway: overrides?.gateway ?? createMockGateway(),
    channelRegistry: overrides?.channelRegistry ?? createMockChannelRegistry(),
    messageProcessor: overrides?.messageProcessor ?? createMockMessageProcessor(),
    stores: {
      connectorStore: overrides?.connectorStore ?? createMockConnectorStore(),
      sessionStore,
      transcriptStore,
      eventStore,
    } as ApiContext['stores'],
  } as unknown as ApiContext
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/messaging/:provider/:connectorInstanceId/webhook', () => {
  let server: FastifyInstance
  let connectorStore: ConnectorStore
  let sessionMapStore: ReturnType<typeof createMockSessionChannelMapStore> & SessionChannelMapStore
  let sessionStore: ReturnType<typeof createMockSessionStore>
  let gateway: ReturnType<typeof createMockGateway>
  let messageProcessor: ReturnType<typeof createMockMessageProcessor>
  let channelRegistry: ReturnType<typeof createMockChannelRegistry>
  let adapterMap: Map<string, MessagingAdapter>
  let mapStoreData: MockSessionChannelMapData

  beforeEach(async () => {
    server = Fastify({ logger: false })

    connectorStore = createMockConnectorStore()
    sessionStore = createMockSessionStore()
    gateway = createMockGateway()
    messageProcessor = createMockMessageProcessor()
    channelRegistry = createMockChannelRegistry()
    adapterMap = new Map()
    mapStoreData = { mappings: [], createdMappings: [], updatedLastSeenIds: [] }
    sessionMapStore = createMockSessionChannelMapStore(mapStoreData)

    const context = buildContext({
      connectorStore,
      sessionStore,
      gateway,
      messageProcessor,
      channelRegistry,
    })

    const deps: MessagingWebhookRouteDeps = {
      adapterResolver: (id: string) => adapterMap.get(id),
      sessionChannelMapStore: sessionMapStore,
    }

    registerMessagingWebhookRoutes(server, context, deps)

    await server.ready()
  })

  afterEach(async () => {
    await server.close()
  })

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  describe('valid inbound message', () => {
    it('returns 202 and creates session mapping for a new conversation', async () => {
      adapterMap.set('inst-tg-1', createMockAdapter())

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(202)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        data: { status: string; sessionId: string; messageId: string }
      }
      expect(body.ok).toBe(true)
      expect(body.data.status).toBe('accepted')
      expect(body.data.sessionId).toMatch(/^sess_/)
      expect(body.data.messageId).toBe('tg-msg-100')

      // Session mapping was created
      expect(mapStoreData.createdMappings).toHaveLength(1)
      expect(mapStoreData.createdMappings[0].provider).toBe('telegram')
      expect(mapStoreData.createdMappings[0].externalConversationId).toBe('tg-chat-42')
      expect(mapStoreData.createdMappings[0].externalUserId).toBe('tg-user-7')
      expect(mapStoreData.createdMappings[0].connectorInstanceId).toBe('inst-tg-1')

      // New session was created
      expect(sessionStore.sessions).toHaveLength(1)
      expect(sessionStore.sessions[0].userId).toBe('owner-1')
      expect(sessionStore.sessions[0].status).toBe('active')
    })

    it('reuses existing session mapping and updates lastSeen', async () => {
      const existingMapping: SessionChannelMapping = {
        id: 'map-existing',
        tenantId: 'org_default',
        provider: 'telegram',
        externalConversationId: 'tg-chat-42',
        externalUserId: 'tg-user-7',
        connectorInstanceId: 'inst-tg-1',
        internalUserId: 'internal-user-1',
        internalSessionId: 'sess_existing',
        createdAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
      }
      mapStoreData.mappings.push(existingMapping)

      adapterMap.set('inst-tg-1', createMockAdapter())

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(202)

      const body = JSON.parse(response.payload) as { ok: boolean; data: { sessionId: string } }
      expect(body.data.sessionId).toBe('sess_existing')

      // No new mapping created
      expect(mapStoreData.createdMappings).toHaveLength(0)

      // lastSeen was updated
      expect(mapStoreData.updatedLastSeenIds).toContain('map-existing')

      // No new session created
      expect(sessionStore.sessions).toHaveLength(0)
    })

    it('invokes message processor asynchronously', async () => {
      let processorCalled = false
      const processor: MessageProcessor = {
        process: async (): Promise<MessageProcessorOutput> => {
          processorCalled = true
          return {
            correlationId: 'corr-1',
            success: true,
            result: { text: 'Reply' },
            timestamp: new Date().toISOString(),
          }
        },
      }

      const context = buildContext({
        connectorStore,
        sessionStore,
        gateway,
        messageProcessor: processor,
        channelRegistry,
      })

      const freshServer = Fastify({ logger: false })
      registerMessagingWebhookRoutes(freshServer, context, {
        adapterResolver: (id: string) => adapterMap.get(id),
        sessionChannelMapStore: sessionMapStore,
      })
      await freshServer.ready()

      adapterMap.set('inst-tg-1', createMockAdapter())

      const response = await freshServer.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(202)

      // Give the async processing a tick to run
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(processorCalled).toBe(true)
      await freshServer.close()
    })

    it('delivers outbound response through channel registry', async () => {
      const context = buildContext({
        connectorStore,
        sessionStore,
        gateway,
        messageProcessor: createMockMessageProcessor(),
        channelRegistry,
      })

      const freshServer = Fastify({ logger: false })
      registerMessagingWebhookRoutes(freshServer, context, {
        adapterResolver: (id: string) => adapterMap.get(id),
        sessionChannelMapStore: sessionMapStore,
      })
      await freshServer.ready()

      adapterMap.set('inst-tg-1', createMockAdapter())

      await freshServer.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(channelRegistry.delivered.length).toBeGreaterThanOrEqual(1)
      const lastDelivered = channelRegistry.delivered[channelRegistry.delivered.length - 1]
      expect(lastDelivered.content.text).toBe('Agent response')
      expect(lastDelivered.recipient.channel).toBe('inst-tg-1')

      await freshServer.close()
    })
  })

  // -----------------------------------------------------------------------
  // Non-text messages
  // -----------------------------------------------------------------------

  describe('non-text inbound message', () => {
    it('returns 200 acknowledged when adapter returns null', async () => {
      adapterMap.set(
        'inst-tg-1',
        createMockAdapter({ handleResult: null }),
      )

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        data: { status: string; message: string }
      }
      expect(body.ok).toBe(true)
      expect(body.data.status).toBe('acknowledged')
      expect(body.data.message).toBe('Non-text message ignored')

      // No session mapping created
      expect(mapStoreData.createdMappings).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Signature verification
  // -----------------------------------------------------------------------

  describe('invalid signature', () => {
    it('returns 401 when verifyInbound returns false', async () => {
      adapterMap.set(
        'inst-tg-1',
        createMockAdapter({ verifyResult: false }),
      )

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(401)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        error: { code: string; message: string }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toBe('Invalid webhook signature')

      // No session mapping or transcript created
      expect(mapStoreData.createdMappings).toHaveLength(0)
      expect(mapStoreData.mappings).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Instance not found
  // -----------------------------------------------------------------------

  describe('non-existent instance', () => {
    it('returns 404 when connectorInstanceId does not match any instance', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/nonexistent-instance/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        error: { code: string }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })

  // -----------------------------------------------------------------------
  // Inactive instance
  // -----------------------------------------------------------------------

  describe('inactive instance', () => {
    it('returns 403 when connector instance is not active', async () => {
      adapterMap.set('inst-tg-inactive', createMockAdapter())

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-inactive/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(403)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        error: { code: string; message: string }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toBe('Connector instance is not active')

      // No mapping created
      expect(mapStoreData.createdMappings).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Non-messaging type
  // -----------------------------------------------------------------------

  describe('non-messaging connector type', () => {
    it('returns 404 when connector is not a messaging type', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/github/inst-gh-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        error: { code: string; message: string }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toContain('not a messaging type')
    })
  })

  // -----------------------------------------------------------------------
  // No adapter available
  // -----------------------------------------------------------------------

  describe('no adapter registered', () => {
    it('returns 404 when adapterResolver returns undefined', async () => {
      // No adapter registered for inst-tg-1
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(response.statusCode).toBe(404)

      const body = JSON.parse(response.payload) as {
        ok: boolean
        error: { code: string; message: string }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toContain('No messaging adapter')
    })
  })

  // -----------------------------------------------------------------------
  // Channel leakage prevention
  // -----------------------------------------------------------------------

  describe('channel isolation', () => {
    it('uses connectorInstanceId as sourceChannel — not provider name', async () => {
      let capturedEnvelope: InboundEnvelope | undefined
      const spyGateway: Gateway = {
        ...gateway,
        receiveUserMessage(
          userId: string,
          sessionId: string,
          text: string,
          channel = 'default',
          attachmentIds?: string[],
        ): InboundEnvelope {
          const envelope = gateway.receiveUserMessage(userId, sessionId, text, channel, attachmentIds)
          capturedEnvelope = envelope
          return envelope
        },
      }

      const context = buildContext({
        connectorStore,
        sessionStore,
        gateway: spyGateway,
        messageProcessor,
        channelRegistry,
      })

      const freshServer = Fastify({ logger: false })
      registerMessagingWebhookRoutes(freshServer, context, {
        adapterResolver: (id: string) => adapterMap.get(id),
        sessionChannelMapStore: sessionMapStore,
      })
      await freshServer.ready()

      adapterMap.set('inst-tg-1', createMockAdapter())

      await freshServer.inject({
        method: 'POST',
        url: '/api/v1/messaging/telegram/inst-tg-1/webhook',
        payload: VALID_WEBHOOK_PAYLOAD,
        headers: { 'content-type': 'application/json' },
      })

      expect(capturedEnvelope).toBeDefined()
      // sourceChannel is the connectorInstanceId, NOT 'telegram' or 'webui'
      expect(capturedEnvelope!.sourceChannel).toBe('inst-tg-1')

      await freshServer.close()
    })
  })
})
