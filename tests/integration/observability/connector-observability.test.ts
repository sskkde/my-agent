import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import { createConnectorToolBridge, registerConnectorTools } from '../../../src/connectors/connector-tool-bridge.js';
import { registerMockConnectors } from '../../../src/connectors/mocks/index.js';
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js';
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js';
import { createAuditStore } from '../../../src/observability/audit-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createTimelineBuilder } from '../../../src/observability/timeline.js';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createApprovalStore } from '../../../src/storage/approval-store.js';
import { createConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createRuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js';
import { createToolExecutor } from '../../../src/tools/tool-executor.js';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import type { ConnectorAdapter, ConnectorRuntime } from '../../../src/connectors/types.js';
import type { ToolExecutorConfig } from '../../../src/tools/types.js';

describe('connector_observability', () => {
  let connection: ConnectionManager;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
  });

  afterEach(() => {
    connection.close();
  });

  it('records connector trace, audit, and redacted session timeline through Tool Plane', async () => {
    const connectorStore = createConnectorStore(connection);
    const eventStore = createEventStore(connection);
    const auditStore = createAuditStore(connection);
    const traceStore = createTraceStore(connection);
    const auditRecorder = createAuditRecorder({ auditStore });
    const runtime = createConnectorRuntime({
      connectorStore,
      toolBridge: createConnectorToolBridge(),
      eventStore,
      traceStore,
      auditRecorder,
    });
    const mockConnectors = registerMockConnectors(runtime);
    registerRuntimeAdapter(runtime, 'messaging', mockConnectors.gmail);

    const definition = runtime.registerDefinition({
      connectorId: 'mock-email',
      name: 'Mock Email Connector',
      connectorType: 'messaging',
      version: '1.0.0',
      capabilities: ['gmail.search'],
      status: 'active',
    });
    const instance = runtime.createInstance({
      connectorInstanceId: 'mock-email-instance',
      connectorDefinitionId: definition.id,
      userId: 'user-connector-001',
      name: 'Mock Email',
      authStateRef: 'auth-mock-001',
      config: { connectorId: 'mock-email' },
      status: 'active',
    });

    const registry = createToolRegistry();
    registerConnectorTools(
      registry,
      { ...instance, connectorId: 'mock_email' },
      runtime.discoverCapabilities(instance.id),
      { runtime }
    );

    const permissionEngine = createPermissionEngine({
      approvalStore: createApprovalStore(connection),
      grantStore: createPermissionGrantStore(connection),
      eventStore,
      auditRecorder,
      traceStore,
    });
    const executor = createToolExecutor({
      registry,
      permissionEngine,
      toolExecutionStore: createToolExecutionStore(connection) as unknown as ToolExecutorConfig['toolExecutionStore'],
      eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      traceStore,
      auditRecorder,
    });

    const result = await executor.execute({
      toolCallId: 'call-email-search-observable',
      toolName: 'connector.mock_email.search_emails',
      params: { query: 'secret meeting token abc123', maxResults: 5 },
      userId: 'user-connector-001',
      sessionId: 'session-connector-001',
      permissionContext: {
        userId: 'user-connector-001',
        sessionId: 'session-connector-001',
        mode: 'ask_on_write',
        grants: [],
      },
    });

    expect(result.success).toBe(true);

    const connectorSpan = traceStore.findSpans({ spanType: 'connector_call' })[0];
    expect(connectorSpan).toMatchObject({
      spanType: 'connector_call',
      module: 'connector',
      operation: 'search_emails',
      status: 'completed',
    });
    expect(connectorSpan?.metadata).toMatchObject({
      connectorId: 'mock-email-instance',
      operation: 'search_emails',
      status: 'success',
    });
    expect(connectorSpan?.durationMs).toBeGreaterThanOrEqual(0);

    const audit = auditStore.query({ auditType: 'connector_resource_access' })[0];
    expect(audit).toBeDefined();
    expect(audit?.payload).toMatchObject({
      connectorId: 'mock-email-instance',
      operation: 'search_emails',
      resourceRef: 'gmail.search_emails',
      redacted: true,
    });
    expect(JSON.stringify(audit?.payload)).not.toContain('secret meeting token abc123');

    const timeline = createTimelineBuilder({
      eventStore,
      auditStore,
      traceStore,
      actionStore: createRuntimeActionStore(connection),
    }).queryBySessionId('session-connector-001');
    const connectorAudit = timeline.events.find((event) => event.eventType === 'audit' && event.eventId === audit?.auditId);
    expect(connectorAudit).toBeDefined();
    expect(JSON.stringify(connectorAudit?.sourceData)).not.toContain('secret meeting token abc123');
  });
});

function registerRuntimeAdapter(runtime: ConnectorRuntime, connectorType: string, adapter: ConnectorAdapter): void {
  (runtime as unknown as { registerAdapter: (type: string, adapter: ConnectorAdapter) => void }).registerAdapter(
    connectorType,
    adapter
  );
}
