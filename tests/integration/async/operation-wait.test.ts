import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner, type Migration } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createWaitConditionStore, type WaitConditionStore, WAIT_CONDITION_STATES } from '../../../src/storage/wait-condition-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import { createAsyncIntegration, createFakeEventSourceAdapter, FakeEventSourceAdapter } from '../../../src/async/async-integration.js';
import type { AsyncIntegration } from '../../../src/async/types.js';
import type { ExecuteAsyncToolRequest, AsyncOperationEvent } from '../../../src/async/types.js';

const asyncIntegrationMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_connector_definitions_table',
    up: `
      CREATE TABLE connector_definitions (
        id TEXT PRIMARY KEY,
        connector_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        connector_type TEXT NOT NULL CHECK(connector_type IN ('api', 'messaging', 'storage', 'database', 'custom')),
        version TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        config_schema TEXT,
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_connector_defs_type ON connector_definitions(connector_type);
      CREATE INDEX idx_connector_defs_status ON connector_definitions(status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_connector_defs_status;
      DROP INDEX IF EXISTS idx_connector_defs_type;
      DROP TABLE IF EXISTS connector_definitions;
    `
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
        status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_connector_instances_user_def ON connector_instances(user_id, connector_definition_id);
      CREATE INDEX idx_connector_instances_status ON connector_instances(status);
      CREATE INDEX idx_connector_instances_def_id ON connector_instances(connector_definition_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_connector_instances_def_id;
      DROP INDEX IF EXISTS idx_connector_instances_status;
      DROP INDEX IF EXISTS idx_connector_instances_user_def;
      DROP TABLE IF EXISTS connector_instances;
    `
  },
  {
    version: 3,
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
        sensitivity TEXT NOT NULL DEFAULT 'low',
        retention_class TEXT NOT NULL DEFAULT 'standard',
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
      CREATE INDEX idx_events_event_type ON events(event_type, created_at);
      CREATE INDEX idx_events_source_module ON events(source_module, created_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_event_type;
      DROP INDEX IF EXISTS idx_events_source_module;
      DROP TABLE IF EXISTS events;
    `
  },
  {
    version: 4,
    name: 'create_runtime_actions_table',
    up: `
      CREATE TABLE runtime_actions (
        action_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        idempotency_key TEXT UNIQUE,
        source_module TEXT NOT NULL,
        source_action TEXT,
        target_runtime TEXT NOT NULL,
        target_action TEXT NOT NULL,
        payload TEXT NOT NULL,
        correlation_id TEXT,
        causation_id TEXT,
        session_id TEXT,
        user_id TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        status TEXT NOT NULL DEFAULT 'created',
        status_message TEXT,
        result TEXT,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_runtime_actions_idempotency ON runtime_actions(idempotency_key);
      CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
      CREATE INDEX idx_runtime_actions_correlation ON runtime_actions(correlation_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_runtime_actions_idempotency;
      DROP INDEX IF EXISTS idx_runtime_actions_status;
      DROP INDEX IF EXISTS idx_runtime_actions_correlation;
      DROP TABLE IF EXISTS runtime_actions;
    `
  },
  {
    version: 5,
    name: 'create_wait_conditions_table',
    up: `
      CREATE TABLE wait_conditions (
        id TEXT PRIMARY KEY,
        wait_type TEXT NOT NULL,
        condition_pattern TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        timeout_at TEXT,
        satisfied_at TEXT,
        satisfied_by TEXT,
        result_data TEXT,
        metadata TEXT,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_wait_conditions_target ON wait_conditions(target_type, target_ref);
      CREATE INDEX idx_wait_conditions_status ON wait_conditions(status);
      CREATE INDEX idx_wait_conditions_timeout ON wait_conditions(timeout_at) WHERE timeout_at IS NOT NULL;
    `,
    down: `
      DROP INDEX IF EXISTS idx_wait_conditions_target;
      DROP INDEX IF EXISTS idx_wait_conditions_status;
      DROP INDEX IF EXISTS idx_wait_conditions_timeout;
      DROP TABLE IF EXISTS wait_conditions;
    `
  },
];

describe('Async OperationRef + WaitCondition Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let waitConditionStore: WaitConditionStore;
  let eventStore: EventStore;
  let runtimeActionStore: RuntimeActionStore;
  let connectorRuntime: ConnectorRuntime;
  let asyncIntegration: AsyncIntegration;
  let fakeEventSource: FakeEventSourceAdapter;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(asyncIntegrationMigrations);

    connectorStore = createConnectorStore(connection);
    waitConditionStore = createWaitConditionStore(connection);
    eventStore = createEventStore(connection);
    runtimeActionStore = createRuntimeActionStore(connection);

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    fakeEventSource = createFakeEventSourceAdapter() as FakeEventSourceAdapter;

    asyncIntegration = createAsyncIntegration(
      {
        connectorRuntime,
        waitConditionStore,
        eventStore,
        runtimeActionStore,
      },
      fakeEventSource
    );
  });

  afterEach(() => {
    connection?.close();
  });

  describe('Async operation execution', () => {
    it('should return status pending and OperationRef when async tool is started', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-async-001',
        name: 'Async Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-async-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Async Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, operationId: 'async-op-123', data: { started: true } }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-001',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: { input: 'test' },
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      expect(result.operationRef).toBeDefined();
      expect(result.operationRef.status).toBe('pending');
      expect(result.operationRef.operationId).toBeDefined();
      expect(result.operationRef.toolName).toBe('async_tool');
      expect(result.operationRef.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include operationId, connectorInstanceId, and toolName in OperationRef', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-async-002',
        name: 'Async Test Connector 2',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-async-002',
        connectorDefinitionId: def.id,
        userId: 'user-002',
        name: 'Async Instance 2',
        authStateRef: 'auth-002',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, operationId: 'op-custom-456' }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-002',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'my_async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-002',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      expect(result.operationRef.operationId).toBe('op-custom-456');
      expect(result.operationRef.connectorInstanceId).toBe(instance.connectorInstanceId);
      expect(result.operationRef.toolName).toBe('my_async_tool');
    });
  });

  describe('WaitCondition registration and persistence', () => {
    it('should register WaitCondition when async operation is started', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-wait-001',
        name: 'Wait Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-wait-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Wait Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-003',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      expect(result.waitCondition).toBeDefined();
      expect(result.waitCondition.waitType).toBe('operation_completion');
      expect(result.waitCondition.targetType).toBe('workflow_step_run');
      expect(result.waitCondition.conditionPattern).toBe(result.operationRef.operationId);
      expect(result.waitCondition.status).toBe(WAIT_CONDITION_STATES.ACTIVE);
    });

    it('should persist WaitCondition to store', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-wait-002',
        name: 'Wait Test Connector 2',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-wait-002',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Wait Instance 2',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-004',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const persisted = waitConditionStore.getById(result.waitCondition.id);
      expect(persisted).not.toBeNull();
      expect(persisted?.waitType).toBe('operation_completion');
      expect(persisted?.conditionPattern).toBe(result.operationRef.operationId);
    });

    it('should store operation metadata in WaitCondition', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-wait-003',
        name: 'Wait Test Connector 3',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-wait-003',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Wait Instance 3',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-005',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'special_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const persisted = waitConditionStore.getById(result.waitCondition.id);
      expect(persisted?.metadata).toContain('special_tool');
      expect(persisted?.metadata).toContain(result.operationRef.operationId);
    });
  });

  describe('Success event handling', () => {
    it('should resume target once when operation_completed event is received', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-resume-001',
        name: 'Resume Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-resume-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Resume Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, operationId: 'resume-op-001' }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-006',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { data: 'success' },
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.matched).toBe(true);
      expect(handleResult.waitCondition?.status).toBe(WAIT_CONDITION_STATES.SATISFIED);
      expect(handleResult.event).toBeDefined();
      expect(handleResult.action).toBeDefined();
    });

    it('should mark wait condition as satisfied on success', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-sat-001',
        name: 'Satisfied Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-sat-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Satisfied Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-007',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { output: 'done' },
        timestamp: new Date().toISOString(),
      };

      asyncIntegration.handleOperationEvent(event);

      const updated = waitConditionStore.getById(result.waitCondition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.SATISFIED);
      expect(updated?.satisfiedAt).toBeDefined();
      expect(updated?.satisfiedBy).toBe('async_integration');
    });

    it('should create RuntimeTriggerEvent for operation completion', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-evt-001',
        name: 'Event Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-evt-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Event Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-008',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { data: 'test' },
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.event?.eventType).toBe('wait_condition_satisfied');
      expect(handleResult.event?.sourceModule).toBe('trigger');
      expect(handleResult.event?.payload.operationId).toBe(result.operationRef.operationId);
      expect(handleResult.event?.payload.status).toBe('completed');
    });

    it('should create RuntimeAction to resume workflow_step_run', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-act-001',
        name: 'Action Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-act-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Action Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-009',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { success: true },
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.action?.targetRuntime).toBe('workflow_runtime');
      expect(handleResult.action?.targetAction).toBe('resume_workflow_step');
      expect(handleResult.action?.actionType).toBe('resume_workflow_step');
      expect(handleResult.action?.payload.conditionResult).toBe('success');
    });

    it('should persist RuntimeTriggerEvent to event store', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-persist-001',
        name: 'Persist Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-persist-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Persist Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-010',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { data: 'persisted' },
        timestamp: new Date().toISOString(),
      };

      asyncIntegration.handleOperationEvent(event);

      const events = eventStore.query({ eventType: 'wait_condition_satisfied' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload.operationId).toBe(result.operationRef.operationId);
    });

    it('should persist RuntimeAction to action store', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-act-persist-001',
        name: 'Action Persist Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-act-persist-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Action Persist Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-011',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      const persisted = runtimeActionStore.findById(handleResult.action!.actionId);
      expect(persisted).not.toBeNull();
      expect(persisted?.targetRuntime).toBe('workflow_runtime');
      expect(persisted?.status).toBe('created');
    });
  });

  describe('Duplicate event idempotency', () => {
    it('should ignore duplicate operation event', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-dup-001',
        name: 'Duplicate Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-dup-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Duplicate Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-012',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const firstResult = asyncIntegration.handleOperationEvent(event);
      const secondResult = asyncIntegration.handleOperationEvent(event);

      expect(firstResult.matched).toBe(true);
      expect(firstResult.duplicate).toBeUndefined();
      expect(secondResult.matched).toBe(true);
      expect(secondResult.duplicate).toBe(true);
      expect(secondResult.action).toBeUndefined();
      expect(secondResult.event).toBeUndefined();
    });

    it('should use idempotency key to prevent duplicate RuntimeActions', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-idemp-001',
        name: 'Idempotency Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-idemp-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Idempotency Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-013',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event1: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const event2: AsyncOperationEvent = {
        ...event1,
        timestamp: new Date().toISOString(),
      };

      const firstResult = asyncIntegration.handleOperationEvent(event1);

      const newAsyncIntegration = createAsyncIntegration(
        {
          connectorRuntime,
          waitConditionStore,
          eventStore,
          runtimeActionStore,
        },
        fakeEventSource
      );

      const secondResult = newAsyncIntegration.handleOperationEvent(event2);

      expect(firstResult.action).toBeDefined();
      if (secondResult.action && firstResult.action) {
        expect(secondResult.action.actionId).toBe(firstResult.action.actionId);
      }
    });
  });

  describe('Timeout handling', () => {
    it('should resume target with condition_timeout when timeout event is received', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-tout-001',
        name: 'Timeout Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-tout-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Timeout Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-014',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_timeout',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'timeout',
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.matched).toBe(true);
      expect(handleResult.waitCondition?.status).toBe(WAIT_CONDITION_STATES.TIMEOUT);
      expect(handleResult.action?.payload.conditionResult).toBe('timeout');
      expect(handleResult.event?.eventType).toBe('wait_condition_timeout');
    });

    it('should mark wait condition as timeout', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-tout-002',
        name: 'Timeout Test Connector 2',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-tout-002',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Timeout Instance 2',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-015',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_timeout',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'timeout',
        timestamp: new Date().toISOString(),
      };

      asyncIntegration.handleOperationEvent(event);

      const updated = waitConditionStore.getById(result.waitCondition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.TIMEOUT);
    });

    it('should create proper event and action for timeout', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-tout-003',
        name: 'Timeout Test Connector 3',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-tout-003',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Timeout Instance 3',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-016',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_timeout',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'timeout',
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.event?.payload.status).toBe('timeout');
      expect(handleResult.action?.payload.status).toBe('timeout');
      expect(handleResult.action?.targetRuntime).toBe('workflow_runtime');
    });
  });

  describe('Failure handling', () => {
    it('should handle operation_failed event', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-fail-001',
        name: 'Failure Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-fail-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Failure Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-017',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_failed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'failed',
        error: {
          code: 'EXECUTION_ERROR',
          message: 'Tool execution failed',
        },
        timestamp: new Date().toISOString(),
      };

      const handleResult = asyncIntegration.handleOperationEvent(event);

      expect(handleResult.matched).toBe(true);
      expect(handleResult.waitCondition?.status).toBe(WAIT_CONDITION_STATES.FAILED);
      expect(handleResult.action?.payload.conditionResult).toBe('failure');
      expect(handleResult.event?.eventType).toBe('wait_condition_failed');
      expect((handleResult.action?.payload.error as { code: string } | undefined)?.code).toBe('EXECUTION_ERROR');
    });

    it('should mark wait condition as failed', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-fail-002',
        name: 'Failure Test Connector 2',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-fail-002',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Failure Instance 2',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-018',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const event: AsyncOperationEvent = {
        eventType: 'operation_failed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'failed',
        error: {
          code: 'TIMEOUT',
          message: 'Operation timed out',
        },
        timestamp: new Date().toISOString(),
      };

      asyncIntegration.handleOperationEvent(event);

      const updated = waitConditionStore.getById(result.waitCondition.id);
      expect(updated?.status).toBe(WAIT_CONDITION_STATES.FAILED);
    });
  });

  describe('Target type variations', () => {
    it('should create resume action for background_run target', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-bg-001',
        name: 'Background Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-bg-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Background Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const operationRef = {
        operationId: 'op-bg-001',
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      asyncIntegration.registerWaitForOperation(operationRef, 'background_run', 'bg_run_123');

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const action = asyncIntegration.createResumeAction({
        targetType: 'background_run',
        targetRef: 'bg_run_123',
        event,
        waitConditionId: 'wait_001',
      });

      expect(action.targetRuntime).toBe('subagent_runtime');
      expect(action.targetAction).toBe('resume_subagent');
      expect(action.actionType).toBe('resume_subagent');
      expect(action.targetRef?.backgroundRunId).toBe('bg_run_123');
    });

    it('should create resume action for planner_run target', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-planner-001',
        name: 'Planner Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-planner-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Planner Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const operationRef = {
        operationId: 'op-planner-001',
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      asyncIntegration.registerWaitForOperation(operationRef, 'planner_run', 'planner_run_123');

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const action = asyncIntegration.createResumeAction({
        targetType: 'planner_run',
        targetRef: 'planner_run_123',
        event,
        waitConditionId: 'wait_002',
      });

      expect(action.targetRuntime).toBe('planner_runtime');
      expect(action.targetAction).toBe('resume_planner_run');
      expect(action.targetRef?.plannerRunId).toBe('planner_run_123');
    });

    it('should create resume action for kernel_run target', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-kernel-001',
        name: 'Kernel Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-kernel-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Kernel Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const operationRef = {
        operationId: 'op-kernel-001',
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      asyncIntegration.registerWaitForOperation(operationRef, 'kernel_run', 'run_123');

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: {},
        timestamp: new Date().toISOString(),
      };

      const action = asyncIntegration.createResumeAction({
        targetType: 'kernel_run',
        targetRef: 'run_123',
        event,
        waitConditionId: 'wait_003',
      });

      expect(action.targetRuntime).toBe('agent_kernel');
      expect(action.targetAction).toBe('resume_agent_run');
      expect(action.targetRef?.runId).toBe('run_123');
    });
  });

  describe('EventSourceAdapter', () => {
    it('should subscribe to operation events', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-evt-src-001',
        name: 'Event Source Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-evt-src-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Event Source Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, operationId: 'op-evt-001' }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-019',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const receivedEvents: AsyncOperationEvent[] = [];
      const unsubscribe = fakeEventSource.subscribe(result.operationRef.operationId, (event) => {
        receivedEvents.push(event);
      });

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId: result.operationRef.operationId,
        connectorInstanceId: instance.id,
        toolName: 'async_tool',
        status: 'completed',
        result: { success: true },
        timestamp: new Date().toISOString(),
      };

      fakeEventSource.emit(event);

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]?.operationId).toBe(result.operationRef.operationId);

      unsubscribe();
    });

    it('should emit events to multiple subscribers', async () => {
      const operationId = 'op-multi-001';

      const events1: AsyncOperationEvent[] = [];
      const events2: AsyncOperationEvent[] = [];

      const unsubscribe1 = fakeEventSource.subscribe(operationId, (event) => {
        events1.push(event);
      });

      const unsubscribe2 = fakeEventSource.subscribe(operationId, (event) => {
        events2.push(event);
      });

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId,
        connectorInstanceId: 'inst-001',
        toolName: 'async_tool',
        status: 'completed',
        timestamp: new Date().toISOString(),
      };

      fakeEventSource.emit(event);

      expect(events1.length).toBe(1);
      expect(events2.length).toBe(1);

      unsubscribe1();
      unsubscribe2();
    });

    it('should unsubscribe correctly', async () => {
      const operationId = 'op-unsub-001';

      const events: AsyncOperationEvent[] = [];
      const unsubscribe = fakeEventSource.subscribe(operationId, (event) => {
        events.push(event);
      });

      unsubscribe();

      const event: AsyncOperationEvent = {
        eventType: 'operation_completed',
        operationId,
        connectorInstanceId: 'inst-001',
        toolName: 'async_tool',
        status: 'completed',
        timestamp: new Date().toISOString(),
      };

      fakeEventSource.emit(event);

      expect(events.length).toBe(0);
    });
  });

  describe('Operation tracking', () => {
    it('should get operation by ID', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-track-001',
        name: 'Tracking Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-track-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Tracking Instance',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request: ExecuteAsyncToolRequest = {
        requestId: 'req-020',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const result = await asyncIntegration.executeAsyncTool(request);

      const trackedOp = asyncIntegration.getOperation(result.operationRef.operationId);

      expect(trackedOp).not.toBeNull();
      expect(trackedOp?.operationId).toBe(result.operationRef.operationId);
      expect(trackedOp?.toolName).toBe('async_tool');
      expect(trackedOp?.waitConditionId).toBe(result.waitCondition.id);
    });

    it('should get pending operations for target', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-track-002',
        name: 'Tracking Test Connector 2',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-track-002',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'Tracking Instance 2',
        authStateRef: 'auth-001',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      const request1: ExecuteAsyncToolRequest = {
        requestId: 'req-021',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool_1',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const request2: ExecuteAsyncToolRequest = {
        requestId: 'req-022',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        toolName: 'async_tool_2',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      await asyncIntegration.executeAsyncTool(request1);
      await asyncIntegration.executeAsyncTool(request2);

      const pendingOps = asyncIntegration.getPendingOperations('workflow_step_run', 'req-021');

      expect(pendingOps.length).toBeGreaterThan(0);
    });
  });
});
