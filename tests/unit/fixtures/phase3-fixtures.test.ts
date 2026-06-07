/**
 * Phase 3 Fixtures Smoke Tests
 *
 * Verifies that all Phase 3 fixtures work without real external API keys.
 * These tests ensure the mock connectors, MCP mocks, and fake clock
 * can be used for deterministic testing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TestClock } from '../../helpers/clock.js'
import { IdGenerator } from '../../helpers/ids.js'
import {
  createMockEmailConnector,
  createMockCalendarConnector,
  createMockDocsConnector,
  createMockSearchConnector,
  createAllMockConnectors,
  createMockConnectorInstance,
  type MockConnectorAdapter,
} from '../../fixtures/phase3-mock-connectors.js'
import {
  MockMcpTransport,
  createMockMcpSetup,
  createFileSystemMcpSetup,
  createFullMcpSetup,
} from '../../fixtures/phase3-mock-mcp.js'
import type { ConnectorInstance } from '../../../src/storage/connector-store.js'

describe('Phase 3 Fixtures', () => {
  describe('Phase 3 fixtures run without provider keys', () => {
    it('initializes all mock connectors without environment variables', async () => {
      const originalOpenRouter = process.env.OPENROUTER_API_KEY
      const originalTavily = process.env.TAVILY_API_KEY

      delete process.env.OPENROUTER_API_KEY
      delete process.env.TAVILY_API_KEY

      try {
        const connectors = createAllMockConnectors({ userId: 'test_user' })

        expect(connectors.email).toBeDefined()
        expect(connectors.calendar).toBeDefined()
        expect(connectors.contacts).toBeDefined()
        expect(connectors.docs).toBeDefined()
        expect(connectors.search).toBeDefined()

        const emailCapabilities = connectors.email.getCapabilities()
        expect(emailCapabilities.length).toBeGreaterThan(0)
        expect(emailCapabilities.find((c) => c.capabilityId === 'search_emails')).toBeDefined()

        const calendarCapabilities = connectors.calendar.getCapabilities()
        expect(calendarCapabilities.find((c) => c.capabilityId === 'create_event')).toBeDefined()

        const docsCapabilities = connectors.docs.getCapabilities()
        expect(docsCapabilities.find((c) => c.capabilityId === 'export_doc')).toBeDefined()
      } finally {
        if (originalOpenRouter !== undefined) {
          process.env.OPENROUTER_API_KEY = originalOpenRouter
        }
        if (originalTavily !== undefined) {
          process.env.TAVILY_API_KEY = originalTavily
        }
      }
    })

    it('initializes mock MCP setup without network access', async () => {
      const setup = createMockMcpSetup()

      expect(setup.server).toBeDefined()
      expect(setup.session).toBeDefined()
      expect(setup.transport).toBeDefined()
      expect(setup.tools.length).toBeGreaterThan(0)

      await setup.transport.connect()
      expect(setup.transport.isConnected()).toBe(true)

      const tools = await setup.transport.listTools()
      expect(tools.length).toBeGreaterThan(0)

      await setup.transport.disconnect()
      expect(setup.transport.isConnected()).toBe(false)
    })

    it('creates mock connector instances with deterministic IDs', () => {
      const instance = createMockConnectorInstance({
        userId: 'user_001',
        instanceId: 'inst_test',
        definitionId: 'def_test',
      })

      expect(instance.connectorInstanceId).toBe('inst_test')
      expect(instance.connectorDefinitionId).toBe('def_test')
      expect(instance.userId).toBe('user_001')
      expect(instance.status).toBe('active')
    })
  })

  describe('Mock Email Connector', () => {
    let connector: MockConnectorAdapter
    let instance: ConnectorInstance

    beforeEach(() => {
      connector = createMockEmailConnector({ userId: 'user_001' })
      instance = createMockConnectorInstance({ userId: 'user_001' })
    })

    it('searches emails deterministically', async () => {
      const response = await connector.execute(instance, {
        requestId: 'req_001',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'search_emails',
        operation: 'search_emails',
        params: { query: 'test' },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          emails: expect.any(Array),
          total: expect.any(Number),
        }),
      })
    })

    it('sends email and returns deterministic response', async () => {
      const response = await connector.execute(instance, {
        requestId: 'req_002',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'send_email',
        operation: 'send_email',
        params: {
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Test Body',
        },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          emailId: expect.stringMatching(/^email_\d+$/),
          status: 'sent',
        }),
      })
    })

    it('returns auth_required when unauthenticated', async () => {
      connector.setAuthState('unauthenticated')

      const response = await connector.execute(instance, {
        requestId: 'req_003',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'search_emails',
        operation: 'search_emails',
        params: {},
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'auth_required',
        error: expect.objectContaining({
          code: 'AUTH_REQUIRED',
        }),
      })
    })

    it('returns rate_limited when exhausted', async () => {
      connector.setRateLimitMode('exhausted')

      const response = await connector.execute(instance, {
        requestId: 'req_004',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'search_emails',
        operation: 'search_emails',
        params: {},
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'rate_limited',
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
        }),
      })
    })
  })

  describe('Mock Calendar Connector', () => {
    let connector: MockConnectorAdapter
    let instance: ConnectorInstance

    beforeEach(() => {
      connector = createMockCalendarConnector({ userId: 'user_001' })
      instance = createMockConnectorInstance({ userId: 'user_001' })
    })

    it('creates events deterministically', async () => {
      const response = await connector.execute(instance, {
        requestId: 'req_001',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'create_event',
        operation: 'create_event',
        params: {
          title: 'Test Meeting',
          start: '2024-01-20T10:00:00Z',
          end: '2024-01-20T11:00:00Z',
          attendees: ['user_001'],
        },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          eventId: expect.stringMatching(/^event_\d+$/),
          status: 'created',
        }),
      })
    })

    it('searches events by date range', async () => {
      const response = await connector.execute(instance, {
        requestId: 'req_002',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'search_events',
        operation: 'search_events',
        params: {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
        },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          events: expect.any(Array),
        }),
      })
    })
  })

  describe('Mock Docs Connector (Async)', () => {
    it('returns async_started for export operation', async () => {
      const connector = createMockDocsConnector({ userId: 'user_001' })
      const instance = createMockConnectorInstance({ userId: 'user_001' })

      const response = await connector.execute(instance, {
        requestId: 'req_001',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'export_doc',
        operation: 'export_doc',
        params: { docId: 'doc_001', format: 'pdf' },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'async_started',
        metadata: expect.objectContaining({
          operationId: expect.any(String),
        }),
      })
    })
  })

  describe('Mock Search Connector', () => {
    let connector: MockConnectorAdapter
    let instance: ConnectorInstance

    beforeEach(() => {
      connector = createMockSearchConnector({ userId: 'user_001' })
      instance = createMockConnectorInstance({ userId: 'user_001' })
    })

    it('performs web search deterministically', async () => {
      const response = await connector.execute(instance, {
        requestId: 'req_001',
        connectorInstanceId: instance.connectorInstanceId,
        capabilityId: 'web_search',
        operation: 'web_search',
        params: { query: 'test query', limit: 5 },
        userId: 'user_001',
      })

      expect(response).toMatchObject({
        status: 'success',
        data: expect.objectContaining({
          results: expect.any(Array),
          query: 'test query',
        }),
      })
    })
  })

  describe('Mock MCP Transport', () => {
    it('lists available tools', async () => {
      const transport = new MockMcpTransport()
      await transport.connect()

      const tools = await transport.listTools()

      expect(tools.length).toBeGreaterThan(0)
      expect(tools.find((t) => t.name === 'read_file')).toBeDefined()
      expect(tools.find((t) => t.name === 'write_file')).toBeDefined()
    })

    it('calls tools and returns deterministic responses', async () => {
      const transport = new MockMcpTransport()
      await transport.connect()

      const result = await transport.callTool('read_file', { path: '/test/file.txt' })

      expect(result).toMatchObject({
        content: expect.stringContaining('/test/file.txt'),
        encoding: 'utf-8',
      })
    })

    it('tracks call history', async () => {
      const transport = new MockMcpTransport()
      await transport.connect()

      await transport.callTool('read_file', { path: '/test1.txt' })
      await transport.callTool('write_file', { path: '/test2.txt', content: 'data' })

      const history = transport.getCallHistory()

      expect(history.length).toBe(2)
      expect(history[0].toolName).toBe('read_file')
      expect(history[1].toolName).toBe('write_file')
    })

    it('throws when not connected', async () => {
      const transport = new MockMcpTransport()

      await expect(transport.listTools()).rejects.toThrow('Transport not connected')
    })

    it('returns error for unknown tool', async () => {
      const transport = new MockMcpTransport()
      await transport.connect()

      const result = await transport.callTool('unknown_tool', {})

      expect(result).toMatchObject({
        isError: true,
        error: expect.objectContaining({
          code: 'TOOL_NOT_FOUND',
        }),
      })
    })
  })

  describe('Fake clock drives schedule deterministically', () => {
    it('advances time and returns deterministic timestamps', () => {
      const clock = new TestClock('2024-01-01T00:00:00.000Z')

      expect(clock.nowISO()).toBe('2024-01-01T00:00:00.000Z')

      clock.advance(1000)
      expect(clock.nowISO()).toBe('2024-01-01T00:00:01.000Z')

      clock.advance(60000)
      expect(clock.nowISO()).toBe('2024-01-01T00:01:01.000Z')
    })

    it('can be set to specific times', () => {
      const clock = new TestClock()

      clock.setTime('2024-06-15T12:30:00.000Z')
      expect(clock.nowISO()).toBe('2024-06-15T12:30:00.000Z')

      clock.setTime(1704067200000)
      expect(clock.nowISO()).toBe('2024-01-01T00:00:00.000Z')
    })

    it('works with IdGenerator for deterministic IDs', () => {
      const idGen = new IdGenerator()

      const userId1 = idGen.user()
      const userId2 = idGen.user()
      const sessionId = idGen.session()

      expect(userId1).toBe('user_001')
      expect(userId2).toBe('user_002')
      expect(sessionId).toBe('sess_001')

      idGen.reset()
      expect(idGen.user()).toBe('user_001')
    })

    it('simulates trigger firing at exact time', () => {
      const clock = new TestClock('2024-01-01T08:00:00.000Z')
      const triggerTime = '2024-01-01T09:00:00.000Z'
      const firedAt: string[] = []

      const checkTrigger = () => {
        if (clock.nowISO() >= triggerTime) {
          firedAt.push(clock.nowISO())
        }
      }

      checkTrigger()
      expect(firedAt.length).toBe(0)

      clock.advance(30 * 60 * 1000)
      checkTrigger()
      expect(firedAt.length).toBe(0)

      clock.advance(30 * 60 * 1000)
      checkTrigger()
      expect(firedAt.length).toBe(1)
      expect(firedAt[0]).toBe('2024-01-01T09:00:00.000Z')
    })
  })

  describe('Pre-configured MCP setups', () => {
    it('creates filesystem MCP setup with correct tools', () => {
      const setup = createFileSystemMcpSetup()

      expect(setup.tools.length).toBe(3)
      expect(setup.tools.find((t) => t.name === 'read_file')).toBeDefined()
      expect(setup.tools.find((t) => t.name === 'write_file')).toBeDefined()
      expect(setup.tools.find((t) => t.name === 'list_directory')).toBeDefined()
      expect(setup.tools.find((t) => t.name === 'execute_command')).toBeUndefined()
    })

    it('creates full MCP setup with all tools', () => {
      const setup = createFullMcpSetup()

      expect(setup.tools.length).toBe(4)
      expect(setup.tools.find((t) => t.name === 'execute_command')).toBeDefined()
    })
  })
})
