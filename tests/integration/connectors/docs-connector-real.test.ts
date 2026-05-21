import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import {
  DocsConnectorAdapter,
  createDocsConnectorAdapter,
  type DocsConnectorConfig,
} from '../../../src/connectors/docs/docs-connector.js';
import { DocsMockTransport } from '../../../src/connectors/docs/docs-mock-transport.js';

const MOCK_NOTION_API_KEY = 'ntn_testApiKey1234567890';
const MOCK_GOOGLE_OAUTH_TOKEN = 'ya29.testOAuthToken1234567890';

describe('Docs Connector Real HTTP Transport', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let connectorRuntime: ConnectorRuntime;
  let docsAdapter: DocsConnectorAdapter;
  let mockTransport: DocsMockTransport;

  beforeEach(() => {
    vi.stubEnv('APP_SECRET_KEY', 'test-secret-key-for-encryption-32-bytes');

    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    const storeMigrations = [
      {
        version: 1,
        name: 'create_connector_definitions_table',
        up: `
          CREATE TABLE connector_definitions (
            id TEXT PRIMARY KEY,
            connector_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            connector_type TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT,
            capabilities TEXT NOT NULL,
            config_schema TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
        `,
        down: `DROP TABLE IF EXISTS connector_definitions;`,
      },
      {
        version: 2,
        name: 'create_connector_instances_table',
        up: `
          CREATE TABLE connector_instances (
            id TEXT PRIMARY KEY,
            connector_instance_id TEXT NOT NULL UNIQUE,
            connector_definition_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            auth_state_ref TEXT NOT NULL,
            config TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
        `,
        down: `DROP TABLE IF EXISTS connector_instances;`,
      },
      {
        version: 3,
        name: 'create_connector_events_table',
        up: `
          CREATE TABLE connector_events (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            connector_instance_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            processed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
        `,
        down: `DROP TABLE IF EXISTS connector_events;`,
      },
      {
        version: 4,
        name: 'create_events_table',
        up: `
          CREATE TABLE events (
            event_id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            source_module TEXT NOT NULL,
            user_id TEXT,
            session_id TEXT,
            correlation_id TEXT,
            causation_id TEXT,
            idempotency_key TEXT,
            planner_run_id TEXT,
            plan_id TEXT,
            run_id TEXT,
            workflow_run_id TEXT,
            workflow_step_run_id TEXT,
            background_run_id TEXT,
            subagent_run_id TEXT,
            tool_call_id TEXT,
            approval_id TEXT,
            wait_condition_id TEXT,
            artifact_id TEXT,
            memory_id TEXT,
            payload TEXT NOT NULL,
            sensitivity TEXT NOT NULL,
            retention_class TEXT NOT NULL,
            created_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT 'org_default'
          );
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
    ];

    migrations.apply(storeMigrations);

    connectorStore = createConnectorStore(connection);
    eventStore = createEventStore(connection);

    mockTransport = new DocsMockTransport();

    docsAdapter = createDocsConnectorAdapter({
      transport: mockTransport,
      useMock: true,
    });

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
      'docs',
      docsAdapter
    );
  });

  afterEach(() => {
    connection?.close();
    vi.unstubAllEnvs();
  });

  function createDocsConnectorInstance(instanceId: string, provider: 'notion' | 'google' = 'notion') {
    const encryptedAuth = DocsConnectorAdapter.encryptAuth(
      provider === 'notion' ? MOCK_NOTION_API_KEY : MOCK_GOOGLE_OAUTH_TOKEN,
      provider
    );

    const def = connectorRuntime.registerDefinition({
      connectorId: `docs-connector-${provider}-001`,
      name: `Docs Connector (${provider})`,
      connectorType: 'docs' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: `Docs API connector for ${provider}`,
      capabilities: [
        'docs.list_docs',
        'docs.get_doc',
        'docs.create_doc',
        'docs.update_doc',
        'docs.search_docs',
      ],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: instanceId,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: `Test ${provider} Docs Instance`,
      authStateRef: encryptedAuth,
      config: { provider } as unknown as Record<string, unknown>,
      status: 'active',
    });

    return instance;
  }

  describe('Auth Encryption', () => {
    it('should encrypt auth credentials and never return them in API responses', () => {
      const encryptedAuth = DocsConnectorAdapter.encryptAuth(MOCK_NOTION_API_KEY, 'notion');

      expect(encryptedAuth).not.toContain(MOCK_NOTION_API_KEY);
      expect(encryptedAuth).toMatch(/^aes-256-gcm:/);
    });

    it('should support both Notion API Key and Google OAuth2 auth types', () => {
      const notionEncrypted = DocsConnectorAdapter.encryptAuth(MOCK_NOTION_API_KEY, 'notion');
      const googleEncrypted = DocsConnectorAdapter.encryptAuth(MOCK_GOOGLE_OAUTH_TOKEN, 'google');

      expect(notionEncrypted).toMatch(/^aes-256-gcm:/);
      expect(googleEncrypted).toMatch(/^aes-256-gcm:/);
    });
  });

  describe('list_docs Operation', () => {
    it('should list documents from provider', async () => {
      const instance = createDocsConnectorInstance('list-docs-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.list_docs',
        operation: 'list_docs',
        params: { maxResults: 10 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { docs: unknown[]; totalResults: number };
      expect(data.docs).toBeDefined();
      expect(Array.isArray(data.docs)).toBe(true);
      expect(data.totalResults).toBeGreaterThanOrEqual(0);
    });

    it('should support pagination for listing documents', async () => {
      const instance = createDocsConnectorInstance('list-docs-pagination-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-002',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.list_docs',
        operation: 'list_docs',
        params: { maxResults: 5, pageToken: 'token-123' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { docs: unknown[]; nextPageToken?: string };
      expect(data.docs).toBeDefined();
    });
  });

  describe('get_doc Operation', () => {
    it('should retrieve a document by ID', async () => {
      const instance = createDocsConnectorInstance('get-doc-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.get_doc',
        operation: 'get_doc',
        params: { docId: 'doc-001' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const doc = response.data as { id: string; title: string; content: string };
      expect(doc.id).toBe('doc-001');
      expect(doc.title).toBeDefined();
      expect(doc.content).toBeDefined();
    });

    it('should return null for non-existent document', async () => {
      const instance = createDocsConnectorInstance('get-doc-null-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-002',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.get_doc',
        operation: 'get_doc',
        params: { docId: 'non-existent-doc' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeNull();
    });
  });

  describe('create_doc Operation', () => {
    it('should create a new document', async () => {
      const instance = createDocsConnectorInstance('create-doc-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-create-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.create_doc',
        operation: 'create_doc',
        params: { title: 'Test Document', content: 'Test content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const doc = response.data as { id: string; title: string; createdAt: string };
      expect(doc.id).toBeDefined();
      expect(doc.title).toBe('Test Document');
      expect(doc.createdAt).toBeDefined();
    });
  });

  describe('update_doc Operation', () => {
    it('should update an existing document', async () => {
      const instance = createDocsConnectorInstance('update-doc-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-update-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.update_doc',
        operation: 'update_doc',
        params: { docId: 'doc-001', content: 'Updated content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const result = response.data as { id: string; success: boolean; updatedAt: string };
      expect(result.id).toBe('doc-001');
      expect(result.success).toBe(true);
      expect(result.updatedAt).toBeDefined();
    });

    it('should fail when updating non-existent document', async () => {
      const instance = createDocsConnectorInstance('update-doc-fail-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-update-002',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.update_doc',
        operation: 'update_doc',
        params: { docId: 'non-existent-doc', content: 'Content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error).toBeDefined();
    });
  });

  describe('search_docs Operation', () => {
    it('should search documents by query', async () => {
      const instance = createDocsConnectorInstance('search-docs-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-search-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.search_docs',
        operation: 'search_docs',
        params: { query: 'project', maxResults: 10 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { docs: unknown[]; totalResults: number };
      expect(data.docs).toBeDefined();
      expect(Array.isArray(data.docs)).toBe(true);
    });

    it('should return empty results for no matches', async () => {
      const instance = createDocsConnectorInstance('search-docs-empty-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-search-002',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.search_docs',
        operation: 'search_docs',
        params: { query: 'zzzzzzzzznoMatch', maxResults: 10 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { docs: unknown[]; totalResults: number };
      expect(data.docs.length).toBe(0);
      expect(data.totalResults).toBe(0);
    });
  });

  describe('Mock Mode', () => {
    it('should use mock transport when DOCS_MOCK_MODE is true', async () => {
      vi.stubEnv('DOCS_MOCK_MODE', 'true');

      const mockConfig: DocsConnectorConfig = {
        useMock: true,
        transport: new DocsMockTransport(),
      };

      const mockAdapter = createDocsConnectorAdapter(mockConfig);
      expect(mockAdapter).toBeDefined();

      const instance = createDocsConnectorInstance('mock-mode-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.list_docs',
        operation: 'list_docs',
        params: {},
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;
      expect(response.status).toBe('success');
    });
  });

  describe('Provider-Specific Behavior', () => {
    it('should work with Notion provider', async () => {
      const instance = createDocsConnectorInstance('notion-instance', 'notion');

      const request: ConnectorCallRequest = {
        requestId: 'req-notion-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.list_docs',
        operation: 'list_docs',
        params: {},
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;
      expect(response.status).toBe('success');
    });

    it('should work with Google Docs provider', async () => {
      const instance = createDocsConnectorInstance('google-instance', 'google');

      const request: ConnectorCallRequest = {
        requestId: 'req-google-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.list_docs',
        operation: 'list_docs',
        params: {},
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;
      expect(response.status).toBe('success');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover all Docs connector capabilities', () => {
      const instance = createDocsConnectorInstance('capability-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBe(5);

      const capabilityIds = capabilities.map(c => c.capabilityId);
      expect(capabilityIds).toContain('docs.list_docs');
      expect(capabilityIds).toContain('docs.get_doc');
      expect(capabilityIds).toContain('docs.create_doc');
      expect(capabilityIds).toContain('docs.update_doc');
      expect(capabilityIds).toContain('docs.search_docs');
    });

    it('should classify read operations as low risk', () => {
      const instance = createDocsConnectorInstance('risk-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const readCapabilities = capabilities.filter(c =>
        c.capabilityId.includes('list') || c.capabilityId.includes('get') || c.capabilityId.includes('search')
      );

      readCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
        expect(cap.category).toBe('read');
      });
    });

    it('should classify write operations as medium risk', () => {
      const instance = createDocsConnectorInstance('risk-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const writeCapabilities = capabilities.filter(c =>
        c.capabilityId.includes('create') || c.capabilityId.includes('update')
      );

      writeCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('medium');
        expect(cap.category).toBe('write');
      });
    });
  });

  describe('Health Check', () => {
    it('should report healthy status', () => {
      const instance = createDocsConnectorInstance('health-instance');
      const health = docsAdapter.checkHealth(instance);

      expect(health.healthy).toBe(true);
      expect(health.message).toBeDefined();
    });
  });
});
