import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';

describe('Web and Search Connector Real HTTP Transport', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let connectorRuntime: ConnectorRuntime;

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
            updated_at TEXT NOT NULL
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
            updated_at TEXT NOT NULL
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
            created_at TEXT NOT NULL
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
            created_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
    ];

    migrations.apply(storeMigrations);

    connectorStore = createConnectorStore(connection);
    eventStore = createEventStore(connection);

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });
  });

  afterEach(() => {
    connection?.close();
    vi.unstubAllEnvs();
  });

  describe('Web Connector - URL Validation', () => {
    it('should block private IP addresses (192.168.x.x)', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-001',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-private-ip-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'http://192.168.1.1/admin' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BLOCKED_PRIVATE_IP');
      expect(response.error?.message).toContain('Private/internal IP addresses are not allowed');
    });

    it('should block localhost (127.0.0.1)', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-localhost',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-localhost-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-localhost-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'http://127.0.0.1:3000/api' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BLOCKED_PRIVATE_IP');
    });

    it('should block 10.x.x.x private range', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-10range',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-10range-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-10range-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'http://10.0.0.1/internal' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BLOCKED_PRIVATE_IP');
    });

    it('should block 172.16-31.x.x private range', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-172range',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-172range-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-172range-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'http://172.16.0.1/admin' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BLOCKED_PRIVATE_IP');
    });

    it('should block 0.0.0.0', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-0000',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-0000-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-0000-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'http://0.0.0.0:8080/' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BLOCKED_PRIVATE_IP');
    });

    it('should allow public URLs', async () => {
      const { isPrivateIp } = await import('../../../src/connectors/web/url-validator.js');
      
      expect(isPrivateIp('https://example.com')).toBe(false);
      expect(isPrivateIp('https://api.github.com/users')).toBe(false);
      expect(isPrivateIp('https://www.google.com/search')).toBe(false);
    });
  });

  describe('Web Connector - HTTP Methods', () => {
    it('should support GET requests', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      // Create mock fetch for testing
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: 'test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const webAdapter = createRealWebConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-get',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-get-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-get-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://api.example.com/data', method: 'GET' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should support POST requests with body', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const webAdapter = createRealWebConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-post',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-post-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-post-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: {
          url: 'https://api.example.com/submit',
          method: 'POST',
          body: { name: 'test', value: 123 },
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/submit',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test', value: 123 }),
        })
      );
    });

    it('should parse JSON response', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [1, 2, 3], total: 3 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const webAdapter = createRealWebConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-json',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-json-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-json-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://api.example.com/data' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { items: number[]; total: number };
      expect(data.items).toEqual([1, 2, 3]);
      expect(data.total).toBe(3);
    });

    it('should parse text response', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Plain text response', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const webAdapter = createRealWebConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-text',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-text-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-text-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://example.com/page.txt' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBe('Plain text response');
    });
  });

  describe('Search Connector - Backend Integration', () => {
    it('should integrate with SearXNG backend', async () => {
      const { createRealSearchConnectorAdapter } = await import('../../../src/connectors/search/search-connector.js');
      
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test',
          results: [
            { title: 'Result 1', url: 'https://example.com/1', content: 'Content 1' },
            { title: 'Result 2', url: 'https://example.com/2', content: 'Content 2' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const searchAdapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'search-real',
        searchAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'search-real-searxng',
        name: 'Real Search Connector',
        connectorType: 'search-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['search.web_search'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'search-real-searxng-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Search Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-searxng-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query', limit: 5 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { results: unknown[]; query: string };
      expect(data.results).toBeDefined();
      expect(data.query).toBe('test');
    });

    it('should integrate with Tavily backend', async () => {
      const { createRealSearchConnectorAdapter } = await import('../../../src/connectors/search/search-connector.js');
      
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test',
          results: [
            { title: 'Tavily Result 1', url: 'https://example.com/1', content: 'Content 1' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test-key');

      const searchAdapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'search-real',
        searchAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'search-real-tavily',
        name: 'Real Search Connector',
        connectorType: 'search-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['search.web_search'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'search-real-tavily-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Search Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-tavily-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query', limit: 5 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer tvly-test-key',
          }),
        })
      );
    });

    it('should return error when no search backend is configured', async () => {
      const { createRealSearchConnectorAdapter } = await import('../../../src/connectors/search/search-connector.js');
      
      vi.stubEnv('WEB_SEARCH_BACKEND', 'none');

      const searchAdapter = createRealSearchConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'search-real',
        searchAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'search-real-none',
        name: 'Real Search Connector',
        connectorType: 'search-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['search.web_search'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'search-real-none-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Search Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-none-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  describe('Mock Mode Fallback', () => {
    it('should use mock adapter when CONNECTOR_MOCK_MODE is set', async () => {
      vi.stubEnv('CONNECTOR_MOCK_MODE', 'true');
      
      const { createWebConnectorAdapter } = await import('../../../src/connectors/mocks/web-connector.js');
      
      const mockAdapter = createWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-mock',
        mockAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-mock-001',
        name: 'Mock Web Connector',
        connectorType: 'web-mock' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-mock-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Mock Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://example.com/page1' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { url: string }).url).toBe('https://example.com/page1');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover web connector capabilities', async () => {
      const { createRealWebConnectorAdapter } = await import('../../../src/connectors/web/web-connector.js');
      
      const webAdapter = createRealWebConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'web-real',
        webAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'web-real-cap',
        name: 'Real Web Connector',
        connectorType: 'web-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch', 'web.web_post'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'web-real-cap-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Web Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.capabilityId === 'web.web_fetch')).toBe(true);
    });

    it('should discover search connector capabilities', async () => {
      const { createRealSearchConnectorAdapter } = await import('../../../src/connectors/search/search-connector.js');
      
      const searchAdapter = createRealSearchConnectorAdapter();
      
      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'search-real',
        searchAdapter
      );

      const def = connectorRuntime.registerDefinition({
        connectorId: 'search-real-cap',
        name: 'Real Search Connector',
        connectorType: 'search-real' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        capabilities: ['search.web_search', 'search.news_search'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'search-real-cap-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Real Search Instance',
        authStateRef: 'no-auth',
        status: 'active',
      });

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.capabilityId === 'search.web_search')).toBe(true);
    });
  });
});
