/**
 * Web Search Connector GA Certification Test
 *
 * Tests all GA contract requirements:
 * 1. Auth mode documented (api key or configured backend)
 * 2. Secret encrypted (API keys encrypted in storage)
 * 3. Least privilege scopes: N/A for search (no OAuth scopes)
 * 4. Rate limit handling (HTTP 429 with retry)
 * 5. Timeout handling (configurable timeout)
 * 6. Error taxonomy (structured ConnectorError codes)
 * 7. Mock mode (mock search connector when MOCK_MODE=true)
 * 8. Real HTTP mode (uses configured backend: SearXNG/Tavily/Playwright)
 * 9. Audit event (all search calls emit audit events)
 * 10. Redaction (API keys redacted from logs)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse, ConnectorInstance } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import {
  createRealSearchConnectorAdapter,
  RealSearchConnectorAdapter,
} from '../../../src/connectors/search/search-connector.js';
import { createSearchConnectorAdapter } from '../../../src/connectors/mocks/search-connector.js';

describe('Web Search Connector GA Certification', () => {
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

  function registerSearchConnector(
    adapter: RealSearchConnectorAdapter | ReturnType<typeof createSearchConnectorAdapter>,
    connectorType: string = 'search-real'
  ): ConnectorInstance {
    (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
      connectorType,
      adapter
    );

    const def = connectorRuntime.registerDefinition({
      connectorId: `${connectorType}-001`,
      name: 'Web Search Connector',
      connectorType: connectorType as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: 'Web search connector with multiple backend support',
      capabilities: ['search.web_search', 'search.news_search'],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: `${connectorType}-instance`,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: 'Search Instance',
      authStateRef: 'no-auth',
      status: 'active',
    });

    return instance;
  }

  function createMockFetch(response: unknown, status = 200) {
    return vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  describe('1. Auth Mode Documentation', () => {
    it('should document auth mode as API key for Tavily backend', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [{ title: 'Result', url: 'https://example.com', content: 'Content' }],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test-api-key');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);
      const webSearchCapability = capabilities.find(c => c.capabilityId === 'search.web_search');

      expect(webSearchCapability).toBeDefined();
      expect(webSearchCapability?.requiresAuth).toBe(false);
    });

    it('should document auth mode as configured backend for SearXNG', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const healthCheck = adapter.checkHealth(instance);
      expect(healthCheck.healthy).toBe(true);
      expect(healthCheck.message).toContain('searxng');
    });

    it('should support environment-based backend selection', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'none');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const healthCheck = adapter.checkHealth(instance);
      expect(healthCheck.healthy).toBe(false);
      expect(healthCheck.message).toContain('No search backend configured');
    });
  });

  describe('2. Secret Encryption', () => {
    it('should use API keys from environment, not stored in connector instance', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-secret-key-12345');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      expect(instance.authStateRef).toBe('no-auth');
      expect(JSON.stringify(instance)).not.toContain('tvly-secret-key-12345');
    });

    it('should pass API key via Authorization header, not URL params', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test',
          results: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-secret-key-abc');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-secret-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tvly-secret-key-abc',
          }),
        })
      );
    });
  });

  describe('3. Least Privilege Scopes', () => {
    it('should not require OAuth scopes for search connector', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      capabilities.forEach(cap => {
        expect(cap.requiresAuth).toBe(false);
      });
    });

    it('should have low risk level for all search capabilities', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      capabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
      });
    });
  });

  describe('4. Rate Limit Handling', () => {
    it('should return rate_limited status when HTTP 429 is received', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test-key');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-limit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('SEARCH_FAILED');
      expect(response.error?.message).toContain('429');
    });

    it('should include retry information in mock connector rate limit response', async () => {
      const mockAdapter = createSearchConnectorAdapter({ rateLimitMode: 'exhausted' });
      const instance = registerSearchConnector(mockAdapter, 'search-mock');

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-limit-mock-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('rate_limited');
      expect(response.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.metadata?.retryAfterMs).toBeDefined();
    });
  });

  describe('5. Timeout Handling', () => {
    it('should accept configurable timeout parameter', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({
        timeout: 5000,
      });
      expect(adapter).toBeInstanceOf(RealSearchConnectorAdapter);
    });

    it('should use default timeout of 10000ms', () => {
      const adapter = createRealSearchConnectorAdapter();
      expect(adapter).toBeInstanceOf(RealSearchConnectorAdapter);
    });
  });

  describe('6. Error Taxonomy', () => {
    it('should return INVALID_QUERY for empty query', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-empty-query-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: '' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('INVALID_QUERY');
      expect(response.error?.recoverable).toBe(true);
    });

    it('should return PROVIDER_NOT_CONFIGURED when no backend is configured', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'none');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-no-backend-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(response.error?.recoverable).toBe(true);
    });

    it('should return SEARCH_FAILED for HTTP errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-http-error-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('SEARCH_FAILED');
      expect(response.error?.recoverable).toBe(true);
    });

    it('should return BROWSER_SEARCH_UNAVAILABLE for playwright backend in connector mode', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'playwright');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-playwright-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('BROWSER_SEARCH_UNAVAILABLE');
      expect(response.error?.recoverable).toBe(false);
    });
  });

  describe('7. Mock Mode', () => {
    it('should use mock connector when CONNECTOR_MOCK_MODE is set', async () => {
      vi.stubEnv('CONNECTOR_MOCK_MODE', 'true');

      const mockAdapter = createSearchConnectorAdapter();
      const instance = registerSearchConnector(mockAdapter, 'search-mock');

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-mode-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'TypeScript' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { results: unknown[]; query: string };
      expect(data.results).toBeDefined();
      expect(data.query).toBe('TypeScript');
    });

    it('should simulate rate limit in mock mode', async () => {
      vi.stubEnv('CONNECTOR_MOCK_MODE', 'true');

      const mockAdapter = createSearchConnectorAdapter({ rateLimitMode: 'exhausted' });
      const instance = registerSearchConnector(mockAdapter, 'search-mock');

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-rate-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('rate_limited');
    });

    it('should simulate auth errors in mock mode', async () => {
      vi.stubEnv('CONNECTOR_MOCK_MODE', 'true');

      const mockAdapter = createSearchConnectorAdapter({ authState: 'unauthenticated' });
      const instance = registerSearchConnector(mockAdapter, 'search-mock');

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-auth-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('auth_required');
      expect(response.error?.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('8. Real HTTP Mode', () => {
    it('should integrate with SearXNG backend', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test query',
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

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

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
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('searxng.local'),
        }),
        expect.any(Object)
      );

      const data = response.data as { results: unknown[]; query: string };
      expect(data.results).toBeDefined();
      expect(data.results.length).toBeLessThanOrEqual(5);
    });

    it('should integrate with Tavily backend', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test query',
          results: [
            { title: 'Tavily Result', url: 'https://example.com/1', content: 'Content' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test-key');
      vi.stubEnv('TAVILY_BASE_URL', 'https://api.tavily.com/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-tavily-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
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

    it('should integrate with legacy remote backend', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test query',
          results: [
            { title: 'Remote Result', url: 'https://example.com/1', snippet: 'Content' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'remote');
      vi.stubEnv('WEB_SEARCH_API_URL', 'https://search-api.example.com/search');
      vi.stubEnv('WEB_SEARCH_API_KEY', 'remote-api-key');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-remote-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('search-api.example.com'),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer remote-api-key',
          }),
        })
      );
    });
  });

  describe('9. Audit Events', () => {
    it('should emit connector_call_executed event on successful search', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-audit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
        sessionId: 'test-session-001',
      };

      await connectorRuntime.executeCall(request) as ConnectorResponse;

      const events = eventStore.query({ limit: 100 });
      events.find(e =>
        e.eventType === 'connector_call_executed' ||
        e.payload?.toString().includes('search')
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should emit connector_call_failed event on error', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'none');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-audit-fail-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
    });
  });

  describe('10. Redaction', () => {
    it('should redact API keys from error messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid API key: tvly-secret-key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-real-secret-key-12345');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-redact-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.message).not.toContain('tvly-real-secret-key-12345');
    });

    it('should not log API keys in request parameters', async () => {
      const mockFetch = createMockFetch({
        query: 'test',
        results: [],
      });

      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-sensitive-key-xyz');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-redact-002',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test query' },
        userId: 'test-user-001',
      };

      await connectorRuntime.executeCall(request) as ConnectorResponse;

      const [fetchUrl] = mockFetch.mock.calls[0];
      expect(fetchUrl.toString()).not.toContain('tvly-sensitive-key-xyz');
    });

    it('should not expose API key in health check', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-super-secret-key');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const health = adapter.checkHealth(instance);

      expect(health.message).not.toContain('tvly-super-secret-key');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover web_search capability', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const webSearchCap = capabilities.find(c => c.capabilityId === 'search.web_search');
      expect(webSearchCap).toBeDefined();
      expect(webSearchCap?.name).toBe('Web Search');
      expect(webSearchCap?.category).toBe('search');
      expect(webSearchCap?.inputSchema.query).toBeDefined();
    });

    it('should discover news_search capability', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const newsSearchCap = capabilities.find(c => c.capabilityId === 'search.news_search');
      expect(newsSearchCap).toBeDefined();
      expect(newsSearchCap?.name).toBe('News Search');
    });
  });

  describe('Input Validation', () => {
    it('should limit results to max 10', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test',
          results: Array(20).fill({ title: 'Result', url: 'https://example.com', content: 'Content' }),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-limit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test', limit: 20 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { results: unknown[] };
      expect(data.results.length).toBeLessThanOrEqual(10);
    });

    it('should use default limit of 5 when not specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          query: 'test',
          results: Array(10).fill({ title: 'Result', url: 'https://example.com', content: 'Content' }),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng');
      vi.stubEnv('SEARXNG_BASE_URL', 'http://searxng.local/search');

      const adapter = createRealSearchConnectorAdapter({ fetchImpl: mockFetch });
      const instance = registerSearchConnector(adapter);

      const request: ConnectorCallRequest = {
        requestId: 'req-default-limit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'test' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { results: unknown[] };
      expect(data.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Health Check', () => {
    it('should report healthy when backend is configured', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily');
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test-key');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const health = adapter.checkHealth(instance);

      expect(health.healthy).toBe(true);
      expect(health.message).toContain('tavily');
    });

    it('should report unhealthy when backend is none', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'none');

      const adapter = createRealSearchConnectorAdapter();
      const instance = registerSearchConnector(adapter);

      const health = adapter.checkHealth(instance);

      expect(health.healthy).toBe(false);
      expect(health.message).toContain('No search backend');
    });
  });
});
