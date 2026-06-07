import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import {
  createArtifactStore,
  type ArtifactStore,
  type Artifact,
  type ArtifactType,
} from '../../../src/storage/artifact-store.js'
import {
  createToolResultStore,
  type ToolResultStore,
  type ToolResultBlob,
  type SensitivityLevel,
} from '../../../src/storage/tool-result-store.js'
import {
  createConnectorStore,
  type ConnectorStore,
  type ConnectorDefinition,
  type ConnectorInstance,
  type ConnectorEvent,
} from '../../../src/storage/connector-store.js'

describe('Artifact, ToolResult, and Connector Stores', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let artifactStore: ArtifactStore
  let toolResultStore: ToolResultStore
  let connectorStore: ConnectorStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()

    artifactStore = createArtifactStore(connection)
    toolResultStore = createToolResultStore(connection)
    connectorStore = createConnectorStore(connection)

    toolResultStore.applyMigrations(migrations)
    artifactStore.applyMigrations(migrations)
    connectorStore.applyMigrations(migrations)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('ToolResultStore', () => {
    describe('CRUD operations', () => {
      it('should create a tool result with all fields', () => {
        const result: Omit<ToolResultBlob, 'id' | 'createdAt'> = {
          resultRef: 'ref-123',
          toolCallId: 'call-456',
          toolName: 'test-tool',
          userId: 'user-789',
          sessionId: 'session-abc',
          preview: 'This is a preview of the result',
          rawBlobRef: 'blob://storage/result-123',
          structuredContent: { key: 'value', nested: { data: true } },
          sensitivity: 'medium',
        }

        const created = toolResultStore.create(result)

        expect(created.id).toBeDefined()
        expect(created.resultRef).toBe(result.resultRef)
        expect(created.toolCallId).toBe(result.toolCallId)
        expect(created.toolName).toBe(result.toolName)
        expect(created.userId).toBe(result.userId)
        expect(created.sessionId).toBe(result.sessionId)
        expect(created.preview).toBe(result.preview)
        expect(created.rawBlobRef).toBe(result.rawBlobRef)
        expect(created.structuredContent).toEqual(result.structuredContent)
        expect(created.sensitivity).toBe(result.sensitivity)
        expect(created.createdAt).toBeDefined()
      })

      it('should find tool result by id', () => {
        const result = toolResultStore.create({
          resultRef: 'ref-123',
          toolCallId: 'call-456',
          toolName: 'test-tool',
          userId: 'user-789',
          sensitivity: 'low',
        })

        const found = toolResultStore.findById(result.id)

        expect(found).toBeDefined()
        expect(found?.id).toBe(result.id)
      })

      it('should return undefined when finding non-existent tool result', () => {
        const found = toolResultStore.findById('non-existent-id')
        expect(found).toBeUndefined()
      })

      it('should find tool results by toolCallId', () => {
        toolResultStore.create({
          resultRef: 'ref-1',
          toolCallId: 'call-shared',
          toolName: 'tool-a',
          userId: 'user-1',
          sensitivity: 'low',
        })
        toolResultStore.create({
          resultRef: 'ref-2',
          toolCallId: 'call-shared',
          toolName: 'tool-a',
          userId: 'user-1',
          sensitivity: 'low',
        })
        toolResultStore.create({
          resultRef: 'ref-3',
          toolCallId: 'call-different',
          toolName: 'tool-b',
          userId: 'user-1',
          sensitivity: 'low',
        })

        const found = toolResultStore.findByToolCallId('call-shared')

        expect(found).toHaveLength(2)
        expect(found.map((r) => r.resultRef)).toContain('ref-1')
        expect(found.map((r) => r.resultRef)).toContain('ref-2')
      })

      it('should find tool results by sessionId', () => {
        toolResultStore.create({
          resultRef: 'ref-1',
          toolCallId: 'call-1',
          toolName: 'tool-a',
          userId: 'user-1',
          sessionId: 'session-shared',
          sensitivity: 'low',
        })
        toolResultStore.create({
          resultRef: 'ref-2',
          toolCallId: 'call-2',
          toolName: 'tool-b',
          userId: 'user-1',
          sessionId: 'session-shared',
          sensitivity: 'low',
        })

        const found = toolResultStore.findBySessionId('session-shared')

        expect(found).toHaveLength(2)
      })

      it('should find tool results by toolName ordered by createdAt', () => {
        toolResultStore.create({
          resultRef: 'ref-1',
          toolCallId: 'call-1',
          toolName: 'search-tool',
          userId: 'user-1',
          sensitivity: 'low',
        })
        toolResultStore.create({
          resultRef: 'ref-2',
          toolCallId: 'call-2',
          toolName: 'search-tool',
          userId: 'user-1',
          sensitivity: 'low',
        })

        const found = toolResultStore.findByToolName('search-tool')

        expect(found).toHaveLength(2)
        expect(found[0]?.createdAt <= (found[1]?.createdAt ?? '')).toBe(true)
      })

      it('should find tool results by sensitivity level', () => {
        const sensitivities: SensitivityLevel[] = ['low', 'medium', 'high', 'restricted']
        for (const sensitivity of sensitivities) {
          toolResultStore.create({
            resultRef: `ref-${sensitivity}`,
            toolCallId: `call-${sensitivity}`,
            toolName: 'test-tool',
            userId: 'user-1',
            sensitivity,
          })
        }

        const highResults = toolResultStore.findBySensitivity('high')
        expect(highResults).toHaveLength(1)
        expect(highResults[0]?.sensitivity).toBe('high')
      })

      it('should delete tool result by id', () => {
        const result = toolResultStore.create({
          resultRef: 'ref-123',
          toolCallId: 'call-456',
          toolName: 'test-tool',
          userId: 'user-789',
          sensitivity: 'low',
        })

        const deleted = toolResultStore.delete(result.id)

        expect(deleted).toBe(true)
        expect(toolResultStore.findById(result.id)).toBeUndefined()
      })

      it('should return false when deleting non-existent tool result', () => {
        const deleted = toolResultStore.delete('non-existent')
        expect(deleted).toBe(false)
      })
    })

    describe('Large result storage', () => {
      it('should store large result by ref with preview', () => {
        const largeContentRef = 'blob://storage/large-result-raw-123456789'
        const previewText = 'Preview: This is a summary of the large result content...'

        const result = toolResultStore.create({
          resultRef: 'result-abc',
          toolCallId: 'call-xyz',
          toolName: 'data-processor',
          userId: 'user-123',
          preview: previewText,
          rawBlobRef: largeContentRef,
          sensitivity: 'medium',
        })

        const found = toolResultStore.findById(result.id)
        expect(found?.preview).toBe(previewText)
        expect(found?.rawBlobRef).toBe(largeContentRef)
      })

      it('should handle tool results without sessionId', () => {
        const result = toolResultStore.create({
          resultRef: 'ref-123',
          toolCallId: 'call-456',
          toolName: 'background-tool',
          userId: 'user-789',
          sensitivity: 'low',
        })

        expect(result.sessionId).toBeUndefined()
        const found = toolResultStore.findById(result.id)
        expect(found?.sessionId).toBeUndefined()
      })

      it('should store structured content as JSON', () => {
        const structured = {
          status: 'success',
          data: { items: [1, 2, 3], total: 3 },
          metadata: { timestamp: new Date().toISOString() },
        }

        const result = toolResultStore.create({
          resultRef: 'ref-123',
          toolCallId: 'call-456',
          toolName: 'api-tool',
          userId: 'user-789',
          structuredContent: structured,
          sensitivity: 'low',
        })

        const found = toolResultStore.findById(result.id)
        expect(found?.structuredContent).toEqual(structured)
      })
    })
  })

  describe('ArtifactStore', () => {
    describe('CRUD operations', () => {
      it('should create an artifact with all fields', () => {
        const artifact: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'> = {
          artifactId: 'art-123',
          artifactType: 'document',
          name: 'Test Document',
          contentRef: 'content://docs/doc-123',
          contentSummary: 'This is a summary of the document content',
          userId: 'user-789',
          sessionId: 'session-abc',
          status: 'active',
          metadata: { format: 'markdown', size: 1024 },
        }

        const created = artifactStore.create(artifact)

        expect(created.id).toBeDefined()
        expect(created.artifactId).toBe(artifact.artifactId)
        expect(created.artifactType).toBe(artifact.artifactType)
        expect(created.name).toBe(artifact.name)
        expect(created.contentRef).toBe(artifact.contentRef)
        expect(created.contentSummary).toBe(artifact.contentSummary)
        expect(created.userId).toBe(artifact.userId)
        expect(created.sessionId).toBe(artifact.sessionId)
        expect(created.status).toBe(artifact.status)
        expect(created.metadata).toEqual(artifact.metadata)
        expect(created.createdAt).toBeDefined()
        expect(created.updatedAt).toBeDefined()
      })

      it('should find artifact by id', () => {
        const artifact = artifactStore.create({
          artifactId: 'art-123',
          artifactType: 'document',
          name: 'Test Doc',
          contentRef: 'content://docs/doc-123',
          userId: 'user-789',
          status: 'active',
        })

        const found = artifactStore.findById(artifact.id)

        expect(found).toBeDefined()
        expect(found?.id).toBe(artifact.id)
      })

      it('should find artifact by artifactId', () => {
        artifactStore.create({
          artifactId: 'unique-art-123',
          artifactType: 'document',
          name: 'Test Doc',
          contentRef: 'content://docs/doc-123',
          userId: 'user-789',
          status: 'active',
        })

        const found = artifactStore.findByArtifactId('unique-art-123')

        expect(found).toBeDefined()
        expect(found?.artifactId).toBe('unique-art-123')
      })

      it('should find artifacts by userId ordered by updatedAt', () => {
        artifactStore.create({
          artifactId: 'art-1',
          artifactType: 'document',
          name: 'Doc 1',
          contentRef: 'content://docs/1',
          userId: 'user-shared',
          status: 'active',
        })
        artifactStore.create({
          artifactId: 'art-2',
          artifactType: 'image',
          name: 'Image 1',
          contentRef: 'content://images/1',
          userId: 'user-shared',
          status: 'active',
        })

        const found = artifactStore.findByUserId('user-shared')

        expect(found).toHaveLength(2)
        expect(found[0]?.updatedAt >= (found[1]?.updatedAt ?? '')).toBe(true)
      })

      it('should find artifacts by sessionId', () => {
        artifactStore.create({
          artifactId: 'art-1',
          artifactType: 'document',
          name: 'Doc 1',
          contentRef: 'content://docs/1',
          userId: 'user-1',
          sessionId: 'session-shared',
          status: 'active',
        })

        const found = artifactStore.findBySessionId('session-shared')

        expect(found).toHaveLength(1)
        expect(found[0]?.sessionId).toBe('session-shared')
      })

      it('should find artifacts by artifactType', () => {
        const types: ArtifactType[] = ['document', 'draft', 'image', 'report', 'spreadsheet', 'code', 'workflow']
        for (const type of types) {
          artifactStore.create({
            artifactId: `art-${type}`,
            artifactType: type,
            name: `Artifact ${type}`,
            contentRef: `content://${type}/1`,
            userId: 'user-1',
            status: 'active',
          })
        }

        const images = artifactStore.findByType('image')
        expect(images).toHaveLength(1)
        expect(images[0]?.artifactType).toBe('image')
      })

      it('should find artifacts by status', () => {
        artifactStore.create({
          artifactId: 'art-1',
          artifactType: 'document',
          name: 'Active Doc',
          contentRef: 'content://docs/1',
          userId: 'user-1',
          status: 'active',
        })
        artifactStore.create({
          artifactId: 'art-2',
          artifactType: 'document',
          name: 'Archived Doc',
          contentRef: 'content://docs/2',
          userId: 'user-1',
          status: 'archived',
        })

        const active = artifactStore.findByStatus('active')
        expect(active).toHaveLength(1)
        expect(active[0]?.status).toBe('active')
      })

      it('should update artifact fields', () => {
        const artifact = artifactStore.create({
          artifactId: 'art-123',
          artifactType: 'document',
          name: 'Original Name',
          contentRef: 'content://docs/original',
          userId: 'user-789',
          status: 'draft',
        })

        const updated = artifactStore.update(artifact.id, {
          name: 'Updated Name',
          status: 'active',
          contentSummary: 'Updated summary',
        })

        expect(updated).toBeDefined()
        expect(updated?.name).toBe('Updated Name')
        expect(updated?.status).toBe('active')
        expect(updated?.contentSummary).toBe('Updated summary')
        expect(updated?.artifactId).toBe(artifact.artifactId)
      })

      it('should return undefined when updating non-existent artifact', () => {
        const updated = artifactStore.update('non-existent', { name: 'New Name' })
        expect(updated).toBeUndefined()
      })

      it('should delete artifact by id', () => {
        const artifact = artifactStore.create({
          artifactId: 'art-123',
          artifactType: 'document',
          name: 'To Delete',
          contentRef: 'content://docs/1',
          userId: 'user-789',
          status: 'active',
        })

        const deleted = artifactStore.delete(artifact.id)

        expect(deleted).toBe(true)
        expect(artifactStore.findById(artifact.id)).toBeUndefined()
      })

      it('should return false when deleting non-existent artifact', () => {
        const deleted = artifactStore.delete('non-existent')
        expect(deleted).toBe(false)
      })
    })

    describe('Content reference storage', () => {
      it('should store content reference instead of actual content', () => {
        const artifact = artifactStore.create({
          artifactId: 'art-large',
          artifactType: 'document',
          name: 'Large Document',
          contentRef: 'blob://storage/large-doc-ref-12345',
          contentSummary: 'Summary of the large document for search/display',
          userId: 'user-789',
          status: 'active',
        })

        const found = artifactStore.findById(artifact.id)
        expect(found?.contentRef).toBe('blob://storage/large-doc-ref-12345')
        expect(found?.contentSummary).toBe('Summary of the large document for search/display')
      })
    })
  })

  describe('ConnectorStore', () => {
    describe('ConnectorDefinition CRUD', () => {
      it('should create a connector definition', () => {
        const def: Omit<ConnectorDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
          connectorId: 'slack-connector-v1',
          name: 'Slack Connector',
          connectorType: 'messaging',
          version: '1.0.0',
          description: 'Connects to Slack workspaces',
          capabilities: ['read_messages', 'send_messages', 'list_channels'],
          configSchema: { type: 'object', properties: { token: { type: 'string' } } },
          status: 'active',
        }

        const created = connectorStore.createDefinition(def)

        expect(created.id).toBeDefined()
        expect(created.connectorId).toBe(def.connectorId)
        expect(created.name).toBe(def.name)
        expect(created.connectorType).toBe(def.connectorType)
        expect(created.version).toBe(def.version)
        expect(created.capabilities).toEqual(def.capabilities)
        expect(created.configSchema).toEqual(def.configSchema)
      })

      it('should find connector definition by id', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-conn',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const found = connectorStore.findDefinitionById(def.id)
        expect(found?.connectorId).toBe('test-conn')
      })

      it('should find connector definition by connectorId', () => {
        connectorStore.createDefinition({
          connectorId: 'unique-connector',
          name: 'Unique Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const found = connectorStore.findDefinitionByConnectorId('unique-connector')
        expect(found?.connectorId).toBe('unique-connector')
      })

      it('should update connector definition', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-conn',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'draft',
          capabilities: [],
        })

        const updated = connectorStore.updateDefinition(def.id, {
          status: 'active',
          description: 'Updated description',
        })

        expect(updated?.status).toBe('active')
        expect(updated?.description).toBe('Updated description')
      })

      it('should find definitions by connectorType', () => {
        connectorStore.createDefinition({
          connectorId: 'conn-1',
          name: 'API Connector 1',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })
        connectorStore.createDefinition({
          connectorId: 'conn-2',
          name: 'API Connector 2',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const apiDefs = connectorStore.findDefinitionsByType('api')
        expect(apiDefs).toHaveLength(2)
      })
    })

    describe('ConnectorInstance CRUD', () => {
      it('should create connector instance with authStateRef but NOT token material', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance: Omit<ConnectorInstance, 'id' | 'createdAt' | 'updatedAt'> = {
          connectorInstanceId: 'instance-123',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'My Test Connection',
          authStateRef: 'credential://vault/oauth-token-ref-abc123',
          config: { endpoint: 'https://api.example.com' },
          status: 'active',
        }

        const created = connectorStore.createInstance(instance)

        expect(created.id).toBeDefined()
        expect(created.authStateRef).toBe('credential://vault/oauth-token-ref-abc123')
        expect(created.config).toEqual({ endpoint: 'https://api.example.com' })
        expect(created).not.toHaveProperty('accessToken')
        expect(created).not.toHaveProperty('refreshToken')
        expect(created).not.toHaveProperty('tokenMaterial')
      })

      it('should find connector instance by id', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-123',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Test Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const found = connectorStore.findInstanceById(instance.id)
        expect(found?.connectorInstanceId).toBe('instance-123')
      })

      it('should find instances by userId and connectorId', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'shared-connector',
          name: 'Shared Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        connectorStore.createInstance({
          connectorInstanceId: 'instance-1',
          connectorDefinitionId: def.connectorId,
          userId: 'user-shared',
          name: 'Instance 1',
          authStateRef: 'credential://vault/token1',
          status: 'active',
        })
        connectorStore.createInstance({
          connectorInstanceId: 'instance-2',
          connectorDefinitionId: def.connectorId,
          userId: 'user-shared',
          name: 'Instance 2',
          authStateRef: 'credential://vault/token2',
          status: 'active',
        })

        const found = connectorStore.findInstancesByUserAndConnector('user-shared', def.connectorId)
        expect(found).toHaveLength(2)
      })

      it('should find instances by status', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        connectorStore.createInstance({
          connectorInstanceId: 'instance-active',
          connectorDefinitionId: def.connectorId,
          userId: 'user-1',
          name: 'Active Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })
        connectorStore.createInstance({
          connectorInstanceId: 'instance-inactive',
          connectorDefinitionId: def.connectorId,
          userId: 'user-1',
          name: 'Inactive Instance',
          authStateRef: 'credential://vault/token',
          status: 'inactive',
        })

        const active = connectorStore.findInstancesByStatus('active')
        expect(active).toHaveLength(1)
        expect(active[0]?.status).toBe('active')
      })

      it('should update connector instance', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-123',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Original Name',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const updated = connectorStore.updateInstance(instance.id, {
          name: 'Updated Name',
          status: 'inactive',
        })

        expect(updated?.name).toBe('Updated Name')
        expect(updated?.status).toBe('inactive')
      })

      it('should delete connector instance', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-123',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'To Delete',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const deleted = connectorStore.deleteInstance(instance.id)
        expect(deleted).toBe(true)
        expect(connectorStore.findInstanceById(instance.id)).toBeUndefined()
      })
    })

    describe('ConnectorEvent CRUD', () => {
      it('should create connector event', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-123',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Test Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const event: Omit<ConnectorEvent, 'id' | 'createdAt'> = {
          eventId: 'event-456',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: { action: 'message_received', data: { text: 'Hello' } },
          processed: false,
        }

        const created = connectorStore.createEvent(event)

        expect(created.id).toBeDefined()
        expect(created.eventId).toBe(event.eventId)
        expect(created.eventType).toBe(event.eventType)
        expect(created.processed).toBe(false)
      })

      it('should find events by connectorInstanceId', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-events',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Event Test Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        connectorStore.createEvent({
          eventId: 'event-1',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: {},
          processed: false,
        })
        connectorStore.createEvent({
          eventId: 'event-2',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: {},
          processed: false,
        })

        const events = connectorStore.findEventsByInstanceId(instance.connectorInstanceId)
        expect(events).toHaveLength(2)
      })

      it('should find events by processed status', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-events',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Event Test Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        connectorStore.createEvent({
          eventId: 'event-1',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: {},
          processed: true,
        })
        connectorStore.createEvent({
          eventId: 'event-2',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: {},
          processed: false,
        })

        const unprocessed = connectorStore.findEventsByProcessedStatus(false)
        expect(unprocessed).toHaveLength(1)
        expect(unprocessed[0]?.eventId).toBe('event-2')
      })

      it('should mark event as processed', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-events',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Event Test Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const event = connectorStore.createEvent({
          eventId: 'event-123',
          connectorInstanceId: instance.connectorInstanceId,
          eventType: 'webhook.received',
          payload: {},
          processed: false,
        })

        const updated = connectorStore.markEventProcessed(event.id)

        expect(updated?.processed).toBe(true)
      })
    })

    describe('OperationRef indexes', () => {
      it('should store operation reference with connector instance', () => {
        const def = connectorStore.createDefinition({
          connectorId: 'test-connector',
          name: 'Test Connector',
          connectorType: 'api',
          version: '1.0.0',
          status: 'active',
          capabilities: [],
        })

        const instance = connectorStore.createInstance({
          connectorInstanceId: 'instance-ops',
          connectorDefinitionId: def.connectorId,
          userId: 'user-789',
          name: 'Operations Instance',
          authStateRef: 'credential://vault/token',
          status: 'active',
        })

        const byId = connectorStore.findInstanceById(instance.id)
        expect(byId).toBeDefined()

        const byUserAndConnector = connectorStore.findInstancesByUserAndConnector('user-789', def.connectorId)
        expect(byUserAndConnector).toHaveLength(1)
      })
    })
  })
})
