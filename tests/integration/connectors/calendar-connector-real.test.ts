import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import {
  CalendarConnectorAdapter,
  CalendarRealTransport,
  createCalendarConnectorAdapter,
} from '../../../src/connectors/calendar/calendar-connector.js';
import { CalendarMockTransport } from '../../../src/connectors/calendar/calendar-mock-transport.js';

const MOCK_TOKEN = 'ya29.test-oauth2-token-1234567890';

describe('Calendar Connector Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let connectorRuntime: ConnectorRuntime;
  let calendarAdapter: CalendarConnectorAdapter;
  let mockTransport: CalendarMockTransport;

  beforeEach(() => {
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

    mockTransport = new CalendarMockTransport();
    mockTransport.setValidToken(MOCK_TOKEN);

    calendarAdapter = createCalendarConnectorAdapter({
      transport: mockTransport,
    });

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
      'calendar',
      calendarAdapter
    );
  });

  afterEach(() => {
    connection?.close();
  });

  function createCalendarConnectorInstance(instanceId: string) {
    const def = connectorRuntime.registerDefinition({
      connectorId: 'calendar-connector-001',
      name: 'Calendar Connector',
      connectorType: 'calendar' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: 'Google Calendar API connector',
      capabilities: [
        'calendar.list_events',
        'calendar.get_event',
        'calendar.create_event',
        'calendar.update_event',
        'calendar.delete_event',
      ],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: instanceId,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: 'Test Calendar Instance',
      authStateRef: MOCK_TOKEN,
      status: 'active',
    });

    return instance;
  }

  describe('list_events', () => {
    it('should list events within a date range', async () => {
      const instance = createCalendarConnectorInstance('list-events-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.list_events',
        operation: 'list_events',
        params: {
          timeMin: '2024-01-15T00:00:00Z',
          timeMax: '2024-01-15T23:59:59Z',
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { items: unknown[]; kind: string };
      expect(data.kind).toBe('calendar#events');
      expect(data.items.length).toBeGreaterThan(0);
    });

    it('should filter events by search query', async () => {
      const instance = createCalendarConnectorInstance('search-events-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-search-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.list_events',
        operation: 'list_events',
        params: {
          timeMin: '2024-01-01T00:00:00Z',
          timeMax: '2024-01-31T23:59:59Z',
          q: 'Standup',
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { items: Array<{ summary: string }> };
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0].summary).toContain('Standup');
    });

    it('should limit results with maxResults', async () => {
      const instance = createCalendarConnectorInstance('limit-events-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-limit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.list_events',
        operation: 'list_events',
        params: {
          timeMin: '2024-01-01T00:00:00Z',
          timeMax: '2024-01-31T23:59:59Z',
          maxResults: 1,
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { items: unknown[] };
      expect(data.items.length).toBeLessThanOrEqual(1);
    });
  });

  describe('get_event', () => {
    it('should get a specific event by ID', async () => {
      const instance = createCalendarConnectorInstance('get-event-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.get_event',
        operation: 'get_event',
        params: { eventId: 'event-001' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const event = response.data as { id: string; summary: string };
      expect(event.id).toBe('event-001');
      expect(event.summary).toBe('Team Standup');
    });

    it('should return null for non-existent event', async () => {
      const instance = createCalendarConnectorInstance('get-event-null-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-null-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.get_event',
        operation: 'get_event',
        params: { eventId: 'nonexistent-event' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeNull();
    });
  });

  describe('create_event', () => {
    it('should create a new calendar event', async () => {
      const instance = createCalendarConnectorInstance('create-event-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-create-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.create_event',
        operation: 'create_event',
        params: {
          summary: 'New Meeting',
          description: 'Important meeting',
          location: 'Room 101',
          start: { dateTime: '2024-02-01T10:00:00Z' },
          end: { dateTime: '2024-02-01T11:00:00Z' },
          attendees: [{ email: 'colleague@company.com' }],
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const event = response.data as { id: string; summary: string; status: string };
      expect(event.id).toBeDefined();
      expect(event.summary).toBe('New Meeting');
      expect(event.status).toBe('confirmed');
    });
  });

  describe('update_event', () => {
    it('should update an existing event', async () => {
      const instance = createCalendarConnectorInstance('update-event-instance');

      const createRequest: ConnectorCallRequest = {
        requestId: 'req-update-prep-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.create_event',
        operation: 'create_event',
        params: {
          summary: 'Original Title',
          start: { dateTime: '2024-02-01T10:00:00Z' },
          end: { dateTime: '2024-02-01T11:00:00Z' },
        },
        userId: 'test-user-001',
      };

      const createResponse = await connectorRuntime.executeCall(createRequest) as ConnectorResponse;
      const createdEvent = createResponse.data as { id: string };

      const updateRequest: ConnectorCallRequest = {
        requestId: 'req-update-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.update_event',
        operation: 'update_event',
        params: {
          eventId: createdEvent.id,
          summary: 'Updated Title',
          location: 'New Location',
        },
        userId: 'test-user-001',
      };

      const updateResponse = await connectorRuntime.executeCall(updateRequest) as ConnectorResponse;

      expect(updateResponse.status).toBe('success');
      const updatedEvent = updateResponse.data as { summary: string; location: string };
      expect(updatedEvent.summary).toBe('Updated Title');
      expect(updatedEvent.location).toBe('New Location');
    });
  });

  describe('delete_event', () => {
    it('should delete an event', async () => {
      const instance = createCalendarConnectorInstance('delete-event-instance');

      const createRequest: ConnectorCallRequest = {
        requestId: 'req-delete-prep-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.create_event',
        operation: 'create_event',
        params: {
          summary: 'To Be Deleted',
          start: { dateTime: '2024-02-01T10:00:00Z' },
          end: { dateTime: '2024-02-01T11:00:00Z' },
        },
        userId: 'test-user-001',
      };

      const createResponse = await connectorRuntime.executeCall(createRequest) as ConnectorResponse;
      const createdEvent = createResponse.data as { id: string };

      const deleteRequest: ConnectorCallRequest = {
        requestId: 'req-delete-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.delete_event',
        operation: 'delete_event',
        params: { eventId: createdEvent.id },
        userId: 'test-user-001',
      };

      const deleteResponse = await connectorRuntime.executeCall(deleteRequest) as ConnectorResponse;

      expect(deleteResponse.status).toBe('success');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover all calendar connector capabilities', () => {
      const instance = createCalendarConnectorInstance('capability-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBe(5);

      const capabilityIds = capabilities.map(c => c.capabilityId);
      expect(capabilityIds).toContain('calendar.list_events');
      expect(capabilityIds).toContain('calendar.get_event');
      expect(capabilityIds).toContain('calendar.create_event');
      expect(capabilityIds).toContain('calendar.update_event');
      expect(capabilityIds).toContain('calendar.delete_event');
    });

    it('should classify read operations as low risk', () => {
      const instance = createCalendarConnectorInstance('risk-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const readCapabilities = capabilities.filter(c =>
        c.capabilityId.includes('list') || c.capabilityId.includes('get')
      );

      readCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
        expect(cap.category).toBe('read');
      });
    });

    it('should classify write operations as medium risk', () => {
      const instance = createCalendarConnectorInstance('risk-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const writeCapabilities = capabilities.filter(c =>
        c.capabilityId === 'calendar.create_event' || c.capabilityId === 'calendar.update_event'
      );

      writeCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('medium');
        expect(cap.category).toBe('write');
      });
    });

    it('should classify delete as high risk', () => {
      const instance = createCalendarConnectorInstance('risk-delete-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const deleteCapability = capabilities.find(c =>
        c.capabilityId === 'calendar.delete_event'
      );

      expect(deleteCapability?.riskLevel).toBe('high');
      expect(deleteCapability?.category).toBe('delete');
    });
  });

  describe('Tool Bridge Integration', () => {
    it('should bridge calendar capabilities to tool definitions', () => {
      const instance = createCalendarConnectorInstance('bridge-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const listEventsCapability = capabilities.find(c => c.capabilityId === 'calendar.list_events');
      expect(listEventsCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(listEventsCapability!);
      expect(toolDef.name).toBe('connector_calendar_list_events');
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
    });

    it('should mark write capability tool as requiring permission', () => {
      const instance = createCalendarConnectorInstance('bridge-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const createCapability = capabilities.find(c => c.capabilityId === 'calendar.create_event');
      expect(createCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(createCapability!);
      expect(toolDef.sensitivity).toBe('medium');
    });
  });

  describe('Mock Mode', () => {
    it('should use mock transport when CALENDAR_MOCK_MODE=true', () => {
      vi.stubEnv('CALENDAR_MOCK_MODE', 'true');

      const adapter = createCalendarConnectorAdapter();
      expect(adapter).toBeDefined();

      vi.unstubAllEnvs();
    });

    it('should use mock transport when useMock is set', () => {
      const adapter = createCalendarConnectorAdapter({ useMock: true });
      expect(adapter).toBeDefined();
    });

    it('should use provided transport when explicitly passed', () => {
      const transport = new CalendarMockTransport();
      const adapter = createCalendarConnectorAdapter({ transport });
      expect(adapter).toBeDefined();
    });
  });

  describe('Real Transport', () => {
    it('should create CalendarRealTransport with OAuth2 auth', () => {
      const transport = new CalendarRealTransport('ya29.test-token');
      expect(transport).toBeDefined();
    });

    it('should create CalendarRealTransport without token', () => {
      const transport = new CalendarRealTransport();
      expect(transport).toBeDefined();
    });

    it('should classify auth errors correctly', async () => {
      const transport = new CalendarRealTransport('invalid-token');
      const isValid = await transport.validateAuth();
      expect(isValid).toBe(false);
    });
  });

  describe('Unknown Operation', () => {
    it('should throw error for unknown operation', async () => {
      const instance = createCalendarConnectorInstance('unknown-op-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-unknown-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.unknown',
        operation: 'unknown_operation',
        params: {},
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.message).toContain('Unknown operation');
    });
  });

  describe('Health Check', () => {
    it('should report healthy status', () => {
      const instance = createCalendarConnectorInstance('health-instance');
      const health = calendarAdapter.checkHealth(instance);

      expect(health.healthy).toBe(true);
      expect(health.message).toContain('healthy');
    });
  });
});
