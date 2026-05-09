import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import {
  createConnectorToolBridge,
  registerConnectorTools,
  unregisterConnectorTools,
} from '../../../src/connectors/connector-tool-bridge.js';
import { registerMockConnectors, MOCK_CONNECTOR_TYPES } from '../../../src/connectors/mocks/index.js';
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createApprovalStore } from '../../../src/storage/approval-store.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js';
import { createToolExecutor } from '../../../src/tools/tool-executor.js';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import type { ConnectorAdapter, ConnectorRuntime } from '../../../src/connectors/types.js';
import type { ToolExecutorConfig, ToolRegistry } from '../../../src/tools/types.js';

describe('ConnectorToolBridge Tool Plane integration', () => {
  let connection: ConnectionManager;
  let connectorStore: ConnectorStore;
  let runtime: ConnectorRuntime;
  let registry: ToolRegistry;
  let toolExecutionStore: ReturnType<typeof createToolExecutionStore>;
  let executor: ReturnType<typeof createToolExecutor>;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    connectorStore = createConnectorStore(connection);
    const eventStore = createEventStore(connection);
    const approvalStore = createApprovalStore(connection);
    const grantStore = createPermissionGrantStore(connection);
    toolExecutionStore = createToolExecutionStore(connection);

    runtime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
    });
    activeRuntime = runtime;
    const mockConnectors = registerMockConnectors(runtime);
    registerRuntimeAdapter('messaging', mockConnectors.gmail);
    registerRuntimeAdapter('api', mockConnectors.calendar);
    registerRuntimeAdapter('storage', mockConnectors.docs);

    registry = createToolRegistry();
    const permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore });
    executor = createToolExecutor({
      registry,
      permissionEngine,
      toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
      eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
    });
  });

  afterEach(() => {
    activeRuntime = undefined;
    connection.close();
  });

  it('registers mock_email connector capabilities and executes search through Tool Plane', async () => {
    const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.GMAIL, 'messaging', 'mock-email', 'mock-email-instance', 'active');
    const capabilities = runtime.discoverCapabilities(instance.id);

    registerConnectorTools(registry, { ...instance, connectorId: 'mock_email' }, capabilities, { runtime });

    const tool = registry.getTool('connector.mock_email.search_emails');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('search');
    expect(tool?.sensitivity).toBe('low');
    expect(tool?.metadata).toMatchObject({
      connectorId: 'mock_email',
      instanceId: 'mock-email-instance',
      approvalDefault: 'permission_mode',
      resultSensitivity: 'low',
      schemaExposureMode: 'full',
      supportsAsync: false,
    });

    const result = await executor.execute({
      toolCallId: 'call-email-search',
      toolName: 'connector.mock_email.search_emails',
      params: { query: 'meeting', maxResults: 5 },
      userId: 'test-user-001',
      sessionId: 'test-session-001',
      permissionContext: createPermissionContext(),
    });

    expect(result.success).toBe(true);
    expect((result.data as { emails: unknown[] }).emails.length).toBeGreaterThan(0);
    expect(toolExecutionStore.getById('call-email-search')).toMatchObject({
      toolName: 'connector.mock_email.search_emails',
      status: 'completed',
      resultPreview: 'Connector mock_email returned success',
    });
  });

  it('registers mock_calendar search_events and returns event data through Tool Plane', async () => {
    const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.CALENDAR, 'api', 'mock-calendar', 'mock-calendar-instance', 'active');
    const capabilities = runtime.discoverCapabilities(instance.id);

    registerConnectorTools(registry, { ...instance, connectorId: 'mock_calendar' }, capabilities, { runtime });

    const tool = registry.getTool('connector.mock_calendar.search_events');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('search');
    expect(tool?.metadata?.requiredAuthScopes).toEqual(['connector:mock_calendar']);

    const result = await executor.execute({
      toolCallId: 'call-calendar-search',
      toolName: 'connector.mock_calendar.search_events',
      params: { start: '2024-01-01T00:00:00Z', end: '2024-01-31T23:59:59Z' },
      userId: 'test-user-001',
      sessionId: 'test-session-001',
      permissionContext: createPermissionContext(),
    });

    expect(result.success).toBe(true);
    expect((result.data as { events: unknown[] }).events.length).toBeGreaterThan(0);
    expect(toolExecutionStore.getById('call-calendar-search')?.structuredContent).toMatchObject({
      status: 'success',
      connectorId: 'mock_calendar',
      capabilityId: 'calendar.search_events',
    });
  });

  it('hides disconnected mock_docs capabilities and execution fails as unavailable when deferred', async () => {
    const instance = createMockConnectorInstance(MOCK_CONNECTOR_TYPES.DOCS, 'storage', 'mock-docs', 'mock-docs-instance', 'inactive');
    const capabilities = runtime.discoverCapabilities(instance.id);

    registerConnectorTools(registry, { ...instance, connectorId: 'mock_docs' }, capabilities, { runtime });

    const tool = registry.getTool('connector.mock_docs.search_docs');
    expect(tool).toBeDefined();
    expect(tool?.metadata).toMatchObject({
      availability: 'deferred',
      schemaExposureMode: 'hidden',
    });

    const result = await executor.execute({
      toolCallId: 'call-docs-disconnected',
      toolName: 'connector.mock_docs.search_docs',
      params: { query: 'Project' },
      userId: 'test-user-001',
      sessionId: 'test-session-001',
      permissionContext: createPermissionContext(),
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONNECTOR_UNAVAILABLE');
    expect(toolExecutionStore.getById('call-docs-disconnected')).toMatchObject({
      toolName: 'connector.mock_docs.search_docs',
      status: 'completed',
      resultPreview: 'Connector unavailable: mock_docs',
    });

    unregisterConnectorTools(registry, { ...instance, connectorId: 'mock_docs' });
    expect(registry.hasTool('connector.mock_docs.search_docs')).toBe(false);
  });
});

function createMockConnectorInstance(
  type: string,
  connectorType: 'api' | 'messaging' | 'storage' | 'database' | 'custom',
  connectorId: string,
  instanceId: string,
  status: 'active' | 'inactive'
) {
  const definition = runtimeRef().registerDefinition({
    connectorId,
    name: `Mock ${type} Connector`,
    connectorType,
    version: '1.0.0',
    capabilities: [`${type}.search`, `${type}.read`, `${type}.write`],
    status: 'active',
  });

  return runtimeRef().createInstance({
    connectorInstanceId: instanceId,
    connectorDefinitionId: definition.id,
    userId: 'test-user-001',
    name: `Test ${type} Instance`,
    authStateRef: 'auth-mock-001',
    config: { connectorId },
    status,
  });
}

let activeRuntime: ConnectorRuntime | undefined;

function runtimeRef(): ConnectorRuntime {
  if (!activeRuntime) {
    throw new Error('Runtime not initialized');
  }
  return activeRuntime;
}

function registerRuntimeAdapter(connectorType: string, adapter: ConnectorAdapter): void {
  (runtimeRef() as unknown as { registerAdapter: (type: string, adapter: ConnectorAdapter) => void }).registerAdapter(
    connectorType,
    adapter
  );
}

function createPermissionContext() {
  return {
    userId: 'test-user-001',
    sessionId: 'test-session-001',
    mode: 'ask_on_write' as const,
    grants: [],
  };
}
