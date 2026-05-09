import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import { createPermissionEngine, type PermissionEngine } from '../../../src/permissions/permission-engine.js';
import { createPermissionContext } from '../../../src/permissions/types.js';
import { registerMockConnectors, MOCK_CONNECTOR_TYPES } from '../../../src/connectors/mocks/index.js';
import type { ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';

describe('Mock Connectors Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let approvalStore: ApprovalStore;
  let grantStore: PermissionGrantStore;
  let connectorRuntime: ConnectorRuntime;
  let permissionEngine: PermissionEngine;

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
      {
        version: 5,
        name: 'create_approval_requests_table',
        up: `
          CREATE TABLE approval_requests (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            risk_level TEXT,
            scope TEXT,
            scope_type TEXT,
            scope_ref TEXT,
            approval_code TEXT,
            action_type TEXT NOT NULL,
            resource TEXT,
            justification TEXT,
            requested_by TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            expires_at TEXT,
            responded_at TEXT,
            response_by TEXT,
            response_reason TEXT,
            idempotency_key TEXT UNIQUE,
            metadata TEXT,
            source_context TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS approval_requests;`,
      },
      {
        version: 6,
        name: 'create_permission_grants_table',
        up: `
          CREATE TABLE permission_grants (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            action TEXT NOT NULL,
            resource_pattern TEXT,
            conditions TEXT,
            risk_level_max TEXT,
            expires_at TEXT,
            source_context TEXT,
            revoked_at TEXT,
            revoked_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS permission_grants;`,
      },
    ];

    migrations.apply(storeMigrations);

    connectorStore = createConnectorStore(connection);
    eventStore = createEventStore(connection);
    approvalStore = createApprovalStore(connection);
    grantStore = createPermissionGrantStore(connection);

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    permissionEngine = createPermissionEngine({
      approvalStore,
      grantStore,
      eventStore,
    });

    registerMockConnectors(connectorRuntime);
  });

  afterEach(() => {
    connection?.close();
  });

  function createMockConnectorInstance(type: string, instanceId: string) {
    const def = connectorRuntime.registerDefinition({
      connectorId: `mock-${type}-001`,
      name: `Mock ${type.charAt(0).toUpperCase() + type.slice(1)} Connector`,
      connectorType: type as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: `Mock ${type} connector for testing`,
      capabilities: [`${type}.search`, `${type}.read`, `${type}.write`],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: instanceId,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: `Test ${type} Instance`,
      authStateRef: 'auth-mock-001',
      status: 'active',
    });

    return instance;
  }

  describe('Gmail Mock Connector', () => {
    it('should search emails without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'gmail-instance-001');

      const request: ConnectorCallRequest = {
        requestId: 'req-gmail-001',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.search_emails',
        operation: 'search_emails',
        params: { query: 'meeting', maxResults: 5 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { emails: unknown[] }).emails).toBeDefined();
      expect((response.data as { emails: unknown[] }).emails.length).toBeGreaterThan(0);
    });

    it('should read email without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'gmail-instance-002');

      const request: ConnectorCallRequest = {
        requestId: 'req-gmail-002',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.read_email',
        operation: 'read_email',
        params: { emailId: 'email-001' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBe('email-001');
    });

    it('should create draft with write capability', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'gmail-instance-003');

      const request: ConnectorCallRequest = {
        requestId: 'req-gmail-003',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.create_draft',
        operation: 'create_draft',
        params: { to: 'recipient@example.com', subject: 'Test Draft', body: 'Draft body' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { draftId: string }).draftId).toBeDefined();
    });

    it('should send draft with write capability', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'gmail-instance-004');

      const createRequest: ConnectorCallRequest = {
        requestId: 'req-gmail-004a',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.create_draft',
        operation: 'create_draft',
        params: { to: 'recipient@example.com', subject: 'Test', body: 'Body' },
        userId: 'test-user-001',
      };

      const createResponse = await connectorRuntime.executeCall(createRequest) as ConnectorResponse;
      const draftId = (createResponse.data as { draftId: string }).draftId;

      const sendRequest: ConnectorCallRequest = {
        requestId: 'req-gmail-004b',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.send_draft',
        operation: 'send_draft',
        params: { draftId },
        userId: 'test-user-001',
      };

      const sendResponse = await connectorRuntime.executeCall(sendRequest) as ConnectorResponse;

      expect(sendResponse.status).toBe('success');
      expect(sendResponse.data).toBeDefined();
      expect((sendResponse.data as { success: boolean }).success).toBe(true);
    });

    it('should gate gmail write operations through permission engine', () => {
      const context = createPermissionContext('test-user-001', 'test-session-001', 'ask_on_write');
      const writePermissionRequest = {
        context,
        actionType: 'gmail.send_draft',
        operationType: 'write' as const,
        resource: 'email/draft',
        justification: 'Sending email to team',
      };

      const decision = permissionEngine.checkPermission(writePermissionRequest);

      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.requestId).toBeDefined();
    });
  });

  describe('Calendar Mock Connector', () => {
    it('should search events without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'calendar-instance-001');

      const request: ConnectorCallRequest = {
        requestId: 'req-cal-001',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.search_events',
        operation: 'search_events',
        params: { start: '2024-01-01T00:00:00Z', end: '2024-01-31T23:59:59Z' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { events: unknown[] }).events).toBeDefined();
      expect((response.data as { events: unknown[] }).events.length).toBeGreaterThan(0);
    });

    it('should find availability without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'calendar-instance-002');

      const request: ConnectorCallRequest = {
        requestId: 'req-cal-002',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.find_availability',
        operation: 'find_availability',
        params: {
          start: '2024-01-15T00:00:00Z',
          end: '2024-01-16T23:59:59Z',
          attendees: ['user1@example.com', 'user2@example.com'],
          durationMinutes: 60,
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { availableSlots: unknown[] }).availableSlots).toBeDefined();
    });

    it('should create event with write capability', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'calendar-instance-003');

      const request: ConnectorCallRequest = {
        requestId: 'req-cal-003',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.create_event',
        operation: 'create_event',
        params: {
          title: 'New Meeting',
          start: '2024-01-20T10:00:00Z',
          end: '2024-01-20T11:00:00Z',
          attendees: ['attendee@example.com'],
        },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBeDefined();
      expect((response.data as { title: string }).title).toBe('New Meeting');
    });

    it('should gate calendar write operations through permission engine', () => {
      const context = createPermissionContext('test-user-001', 'test-session-001', 'ask_on_write');
      const writePermissionRequest = {
        context,
        actionType: 'calendar.create_event',
        operationType: 'write' as const,
        resource: 'calendar/event',
        justification: 'Creating team meeting',
      };

      const decision = permissionEngine.checkPermission(writePermissionRequest);

      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.requestId).toBeDefined();
    });
  });

  describe('Contacts Mock Connector', () => {
    it('should search contacts without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CONTACTS, 'contacts-instance-001');

      const request: ConnectorCallRequest = {
        requestId: 'req-contacts-001',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.search_contacts',
        operation: 'search_contacts',
        params: { query: 'John' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { contacts: unknown[] }).contacts).toBeDefined();
      expect((response.data as { contacts: unknown[] }).contacts.length).toBeGreaterThan(0);
    });

    it('should return all contacts when no query provided', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CONTACTS, 'contacts-instance-002');

      const request: ConnectorCallRequest = {
        requestId: 'req-contacts-002',
        connectorInstanceId: instance.id,
        capabilityId: 'contacts.search_contacts',
        operation: 'search_contacts',
        params: {},
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect((response.data as { totalResults: number }).totalResults).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Docs Mock Connector', () => {
    it('should search docs without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-instance-001');

      const request: ConnectorCallRequest = {
        requestId: 'req-docs-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.search_docs',
        operation: 'search_docs',
        params: { query: 'Project', maxResults: 5 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { docs: unknown[] }).docs).toBeDefined();
      expect((response.data as { docs: unknown[] }).docs.length).toBeGreaterThan(0);
    });

    it('should read doc without approval', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-instance-002');

      const request: ConnectorCallRequest = {
        requestId: 'req-docs-002',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.read_doc',
        operation: 'read_doc',
        params: { docId: 'doc-001' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBe('doc-001');
      expect((response.data as { title: string }).title).toBe('Project Proposal');
    });

    it('should create doc with write capability', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-instance-003');

      const request: ConnectorCallRequest = {
        requestId: 'req-docs-003',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.create_doc',
        operation: 'create_doc',
        params: { title: 'New Document', content: 'Initial content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBeDefined();
      expect((response.data as { title: string }).title).toBe('New Document');
    });

    it('should update doc with write capability', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-instance-004');

      const updateRequest: ConnectorCallRequest = {
        requestId: 'req-docs-004',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.update_doc',
        operation: 'update_doc',
        params: { docId: 'doc-001', content: 'Updated content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(updateRequest) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { success: boolean }).success).toBe(true);
    });

    it('should gate docs write operations through permission engine', () => {
      const context = createPermissionContext('test-user-001', 'test-session-001', 'ask_on_write');
      const writePermissionRequest = {
        context,
        actionType: 'docs.create_doc',
        operationType: 'write' as const,
        resource: 'docs/document',
        justification: 'Creating new document',
      };

      const decision = permissionEngine.checkPermission(writePermissionRequest);

      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.requestId).toBeDefined();
    });
  });

  describe('Connector Event Normalization', () => {
    it('should normalize connector events into ConnectorEvent format', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'event-instance-001');

      const request: ConnectorCallRequest = {
        requestId: 'req-event-001',
        connectorInstanceId: instance.id,
        capabilityId: 'gmail.search_emails',
        operation: 'search_emails',
        params: { query: 'test' },
        userId: 'test-user-001',
        sessionId: 'test-session-001',
      };

      await connectorRuntime.executeCall(request);

      const events = eventStore.query({ eventType: 'connector_call_executed' });
      expect(events.length).toBeGreaterThan(0);

      const event = events[0];
      expect(event.payload).toMatchObject({
        connectorInstanceId: 'event-instance-001',
        userId: 'test-user-001',
        sessionId: 'test-session-001',
        capabilityId: 'gmail.search_emails',
        operation: 'search_emails',
      });
    });

    it('should emit events for write operations', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'event-instance-002');

      const request: ConnectorCallRequest = {
        requestId: 'req-event-002',
        connectorInstanceId: instance.id,
        capabilityId: 'calendar.create_event',
        operation: 'create_event',
        params: { title: 'Test Event', start: '2024-01-20T10:00:00Z', end: '2024-01-20T11:00:00Z' },
        userId: 'test-user-001',
        sessionId: 'test-session-002',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');

      const events = eventStore.query({ eventType: 'connector_call_executed' });
      const writeEvents = events.filter(
        (e) => e.payload?.operation === 'create_event'
      );
      expect(writeEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Tool Bridge Integration', () => {
    it('should bridge gmail capabilities to tool definitions with correct risk levels', () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'bridge-instance-001');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const searchCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'gmail.search_emails');
      expect(searchCapability).toBeDefined();
      expect(searchCapability?.riskLevel).toBe('low');
      expect(searchCapability?.category).toBe('search');

      const writeCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'gmail.create_draft');
      expect(writeCapability).toBeDefined();
      expect(writeCapability?.riskLevel).toBe('medium');
      expect(writeCapability?.category).toBe('write');

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(writeCapability!);
      expect(toolDef.sensitivity).toBe('medium');
    });

    it('should bridge calendar capabilities to tool definitions with correct risk levels', () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'bridge-instance-002');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const readCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'calendar.find_availability');
      expect(readCapability).toBeDefined();
      expect(readCapability?.riskLevel).toBe('low');

      const writeCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'calendar.create_event');
      expect(writeCapability).toBeDefined();
      expect(writeCapability?.riskLevel).toBe('medium');

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(readCapability!);
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
    });

    it('should bridge docs capabilities to tool definitions with correct risk levels', () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'bridge-instance-003');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const readCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'docs.read_doc');
      expect(readCapability).toBeDefined();
      expect(readCapability?.riskLevel).toBe('low');

      const writeCapability = capabilities.find((c: { capabilityId: string }) => c.capabilityId === 'docs.update_doc');
      expect(writeCapability).toBeDefined();
      expect(writeCapability?.riskLevel).toBe('medium');

      const readToolDef = toolBridge.bridgeCapabilityToToolDefinition(readCapability!);
      const writeToolDef = toolBridge.bridgeCapabilityToToolDefinition(writeCapability!);

      expect(readToolDef.category).toBe('read');
      expect(readToolDef.sensitivity).toBe('low');
      expect(writeToolDef.category).toBe('write');
      expect(writeToolDef.sensitivity).toBe('medium');
    });
  });

  describe('Documented Suite Registration', () => {
    it('should register all 6 documented connector types', () => {
      const connectorTypes = [
        MOCK_CONNECTOR_TYPES.GMAIL,
        MOCK_CONNECTOR_TYPES.CALENDAR,
        MOCK_CONNECTOR_TYPES.CONTACTS,
        MOCK_CONNECTOR_TYPES.DOCS,
        MOCK_CONNECTOR_TYPES.WEB,
        MOCK_CONNECTOR_TYPES.SEARCH,
      ];

      for (const type of connectorTypes) {
        const instance = createMockConnectorInstance(type, `suite-instance-${type}`);
        expect(instance).toBeDefined();
        expect(instance.connectorDefinitionId).toBeDefined();

        const capabilities = connectorRuntime.discoverCapabilities(instance.id);
        expect(capabilities.length).toBeGreaterThan(0);
      }
    });

    it('should expose capabilities through ConnectorRuntime for each connector', () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.WEB, 'web-cap-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities).toBeDefined();
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.capabilityId.includes('web'))).toBe(true);
    });

    it('should expose search capabilities through ConnectorRuntime', () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.SEARCH, 'search-cap-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities).toBeDefined();
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.capabilityId.includes('search'))).toBe(true);
    });
  });

  describe('Mock Email Failures', () => {
    it('should return auth_required status when authentication is required', async () => {
      const { createWebConnectorAdapter } = await import('../../../src/connectors/mocks/web-connector.js');
      const authRequiredAdapter = createWebConnectorAdapter({ authState: 'unauthenticated' });

      const testRuntime = createConnectorRuntime({
        connectorStore,
        toolBridge: createConnectorToolBridge(),
        eventStore,
      });

      (testRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'custom',
        authRequiredAdapter
      );

      const def = testRuntime.registerDefinition({
        connectorId: 'web-auth-test-001',
        name: 'Web Auth Test Connector',
        connectorType: 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = testRuntime.createInstance({
        connectorInstanceId: 'web-auth-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Web Auth Test Instance',
        authStateRef: 'auth-test',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://example.com' },
        userId: 'test-user-001',
      };

      const response = await testRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('auth_required');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('AUTH_REQUIRED');
      expect(response.error?.recoverable).toBe(true);
    });

    it('should return rate_limited status with retryAfterMs', async () => {
      const { createWebConnectorAdapter } = await import('../../../src/connectors/mocks/web-connector.js');
      const rateLimitedAdapter = createWebConnectorAdapter({ rateLimitMode: 'exhausted' });

      const testRuntime = createConnectorRuntime({
        connectorStore,
        toolBridge: createConnectorToolBridge(),
        eventStore,
      });

      (testRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
        'custom',
        rateLimitedAdapter
      );

      const def = testRuntime.registerDefinition({
        connectorId: 'web-rate-test-001',
        name: 'Web Rate Test Connector',
        connectorType: 'custom',
        version: '1.0.0',
        capabilities: ['web.web_fetch'],
        status: 'active',
      });

      const instance = testRuntime.createInstance({
        connectorInstanceId: 'web-rate-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Web Rate Test Instance',
        authStateRef: 'rate-test',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_fetch',
        operation: 'web_fetch',
        params: { url: 'https://example.com' },
        userId: 'test-user-001',
      };

      const response = await testRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('rate_limited');
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.error?.recoverable).toBe(true);
      expect(response.metadata?.retryAfterMs).toBe(30000);
    });

    it('should return auth_challenge metadata for auth_required responses', async () => {
      const { normalizeConnectorResponse } = await import('../../../src/connectors/runtime/connector-response-normalizer.js');
      
      const authResponse: ConnectorResponse = {
        status: 'auth_required',
        requestId: 'req-auth-meta',
        connectorInstanceId: 'auth-instance',
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
          recoverable: true,
        },
      };

      const normalized = normalizeConnectorResponse(authResponse);

      expect(normalized.status).toBe('failed');
      expect(normalized.recoverability).toBe('recoverable_with_user');
      expect(normalized.metadata?.authChallenge).toBeDefined();
      expect(normalized.metadata?.authChallenge?.message).toBe('Authentication required');
    });
  });

  describe('Mock Docs Async Operations', () => {
    it('should support async operations through docs connector', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-async-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-docs-async-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.create_doc',
        operation: 'create_doc',
        params: { title: 'Async Test Doc', content: 'Test content' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBeDefined();
    });

    it('should handle docs read operations', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'docs-read-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-docs-read-001',
        connectorInstanceId: instance.id,
        capabilityId: 'docs.read_doc',
        operation: 'read_doc',
        params: { docId: 'doc-001' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { id: string }).id).toBe('doc-001');
    });
  });

  describe('Web and Search Connector Operations', () => {
    it('should execute web_fetch through web connector', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.WEB, 'web-fetch-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-web-001',
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

    it('should execute web_search through web connector', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.WEB, 'web-search-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-web-search-001',
        connectorInstanceId: instance.id,
        capabilityId: 'web.web_search',
        operation: 'web_search',
        params: { query: 'test query', limit: 5 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { results: unknown[] }).results).toBeDefined();
      expect((response.data as { query: string }).query).toBe('test query');
    });

    it('should execute search through search connector', async () => {
      const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.SEARCH, 'search-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-search-001',
        connectorInstanceId: instance.id,
        capabilityId: 'search.web_search',
        operation: 'web_search',
        params: { query: 'TypeScript', limit: 10 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      expect((response.data as { results: unknown[] }).results).toBeDefined();
      expect((response.data as { totalResults: number }).totalResults).toBeGreaterThanOrEqual(0);
    });
  });
});
