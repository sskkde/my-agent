import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ConnectionManager } from '../../../src/storage/connection.js';
import { createConnectionManager } from '../../../src/storage/connection.js';
import type { MigrationRunner, Migration } from '../../../src/storage/migrations.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import type { ConnectorStore } from '../../../src/storage/connector-store.js';
import { createConnectorStore } from '../../../src/storage/connector-store.js';
import type { EventStore } from '../../../src/storage/event-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import type {
  ConnectorRuntime,
  ConnectorCapability,
  ConnectorCallRequest,
  ConnectorResponse,
  MCPToolDescriptor,
} from '../../../src/connectors/types.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import {
  createConnectorToolBridge,
  mapMCPDescriptorToToolDefinition,
} from '../../../src/connectors/connector-tool-bridge.js';

// Migrations for connector runtime tables
const connectorRuntimeMigrations: Migration[] = [
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
        updated_at TEXT NOT NULL
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
        updated_at TEXT NOT NULL
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
      CREATE INDEX idx_connector_events_instance ON connector_events(connector_instance_id);
      CREATE INDEX idx_connector_events_processed ON connector_events(processed);
      CREATE INDEX idx_connector_events_type ON connector_events(event_type);
    `,
    down: `
      DROP INDEX IF EXISTS idx_connector_events_type;
      DROP INDEX IF EXISTS idx_connector_events_processed;
      DROP INDEX IF EXISTS idx_connector_events_instance;
      DROP TABLE IF EXISTS connector_events;
    `
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
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_user ON events(user_id);
      CREATE INDEX idx_events_type ON events(event_type);
      CREATE INDEX idx_events_correlation ON events(correlation_id);
      CREATE INDEX idx_events_causation ON events(causation_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_causation;
      DROP INDEX IF EXISTS idx_events_correlation;
      DROP INDEX IF EXISTS idx_events_type;
      DROP INDEX IF EXISTS idx_events_user;
      DROP INDEX IF EXISTS idx_events_session;
      DROP TABLE IF EXISTS events;
    `
  },
];

describe('Connector Runtime Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let connectorRuntime: ConnectorRuntime;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();
    migrations.apply(connectorRuntimeMigrations);

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
  });

  describe('ConnectorDefinition/Instance Management', () => {
    it('should register a connector definition', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-001',
        name: 'Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        description: 'A test connector',
        capabilities: ['read_data', 'write_data'],
        configSchema: { endpoint: { type: 'string' } },
        status: 'active',
      });

      expect(def.id).toBeDefined();
      expect(def.connectorId).toBe('test-connector-001');
      expect(def.name).toBe('Test Connector');
      expect(def.connectorType).toBe('api');
      expect(def.version).toBe('1.0.0');
      expect(def.capabilities).toEqual(['read_data', 'write_data']);
      expect(def.status).toBe('active');
      expect(def.createdAt).toBeDefined();
      expect(def.updatedAt).toBeDefined();
    });

    it('should persist definition to store', () => {
      connectorRuntime.registerDefinition({
        connectorId: 'test-connector-002',
        name: 'Persisted Connector',
        connectorType: 'database',
        version: '2.0.0',
        capabilities: ['query', 'insert'],
        status: 'draft',
      });

      const retrieved = connectorStore.findDefinitionByConnectorId('test-connector-002');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Persisted Connector');
    });

    it('should create a connector instance', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-003',
        name: 'Instance Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-001',
        connectorDefinitionId: def.id,
        userId: 'user-001',
        name: 'My Instance',
        authStateRef: 'auth-ref-001',
        config: { endpoint: 'https://api.example.com' },
        status: 'active',
      });

      expect(instance.id).toBeDefined();
      expect(instance.connectorInstanceId).toBe('instance-001');
      expect(instance.connectorDefinitionId).toBe(def.id);
      expect(instance.userId).toBe('user-001');
      expect(instance.name).toBe('My Instance');
      expect(instance.authStateRef).toBe('auth-ref-001');
      expect(instance.status).toBe('active');
    });

    it('should persist instance to store', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-004',
        name: 'Persisted Instance Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['fetch'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-002',
        connectorDefinitionId: def.id,
        userId: 'user-002',
        name: 'Persisted Instance',
        authStateRef: 'auth-ref-002',
        status: 'active',
      });

      const retrieved = connectorStore.findInstanceById(instance.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.connectorInstanceId).toBe('instance-002');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover capabilities from definition', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-005',
        name: 'Capability Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['read_data', 'write_data', 'delete_data'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-003',
        connectorDefinitionId: def.id,
        userId: 'user-003',
        name: 'Capability Instance',
        authStateRef: 'auth-ref-003',
        status: 'active',
      });

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities).toHaveLength(3);
      expect(capabilities[0].capabilityId).toBe('read_data');
      expect(capabilities[1].capabilityId).toBe('write_data');
      expect(capabilities[2].capabilityId).toBe('delete_data');
    });

    it('should return capabilities with proper structure', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-006',
        name: 'Structured Capability Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['fetch_users'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-004',
        connectorDefinitionId: def.id,
        userId: 'user-004',
        name: 'Structured Instance',
        authStateRef: 'auth-ref-004',
        status: 'active',
      });

      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities[0]).toMatchObject({
        capabilityId: 'fetch_users',
        name: 'fetch_users',
        description: expect.any(String),
        category: 'connector',
        riskLevel: 'medium',
        requiresAuth: true,
        supportedOperations: ['execute'],
      });
    });

    it('should throw error for non-existent instance', () => {
      expect(() => {
        connectorRuntime.discoverCapabilities('nonexistent-instance');
      }).toThrow('Connector instance not found');
    });
  });

  describe('ConnectorToolBridge Output', () => {
    it('should bridge capability to ToolDefinition', () => {
      const capability: ConnectorCapability = {
        capabilityId: 'test.read_data',
        name: 'Read Data',
        description: 'Read data from external source',
        category: 'read',
        riskLevel: 'low',
        inputSchema: { id: { type: 'string' } },
        requiresAuth: true,
        supportedOperations: ['execute'],
      };

      const toolBridge = createConnectorToolBridge();
      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(capability);

      expect(toolDef.name).toBe('connector.test.execute');
      expect(toolDef.description).toBe('Read data from external source');
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
      expect(toolDef.schema.type).toBe('object');
      expect(toolDef.metadata?.connectorCapabilityId).toBe('test.read_data');
    });

    it('should determine tool category from capability', () => {
      const toolBridge = createConnectorToolBridge();

      const readCapability: ConnectorCapability = {
        capabilityId: 'fetch',
        name: 'Fetch Data',
        description: 'Fetch data',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const writeCapability: ConnectorCapability = {
        capabilityId: 'create',
        name: 'Create Record',
        description: 'Create record',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: true,
        supportedOperations: ['execute'],
      };

      const searchCapability: ConnectorCapability = {
        capabilityId: 'search',
        name: 'Search Items',
        description: 'Search items',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const deleteCapability: ConnectorCapability = {
        capabilityId: 'delete',
        name: 'Delete Item',
        description: 'Delete item',
        category: 'delete',
        riskLevel: 'high',
        inputSchema: {},
        requiresAuth: true,
        supportedOperations: ['execute'],
      };

      const executeCapability: ConnectorCapability = {
        capabilityId: 'execute',
        name: 'Execute Command',
        description: 'Execute command',
        category: 'execute',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: true,
        supportedOperations: ['execute'],
      };

      expect(toolBridge.determineToolCategory(readCapability)).toBe('read');
      expect(toolBridge.determineToolCategory(writeCapability)).toBe('write');
      expect(toolBridge.determineToolCategory(searchCapability)).toBe('search');
      expect(toolBridge.determineToolCategory(deleteCapability)).toBe('delete');
      expect(toolBridge.determineToolCategory(executeCapability)).toBe('execute');
    });

    it('should infer category from capability name', () => {
      const toolBridge = createConnectorToolBridge();

      const fetchCapability: ConnectorCapability = {
        capabilityId: 'get_user',
        name: 'Get User',
        description: 'Get user',
        category: 'connector',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const searchCapability: ConnectorCapability = {
        capabilityId: 'query_items',
        name: 'Query Items',
        description: 'Query items',
        category: 'connector',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const createCapability: ConnectorCapability = {
        capabilityId: 'add_record',
        name: 'Add Record',
        description: 'Add record',
        category: 'connector',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      expect(toolBridge.determineToolCategory(fetchCapability)).toBe('read');
      expect(toolBridge.determineToolCategory(searchCapability)).toBe('search');
      expect(toolBridge.determineToolCategory(createCapability)).toBe('write');
    });

    it('should determine risk level from capability', () => {
      const toolBridge = createConnectorToolBridge();

      const lowRiskCapability: ConnectorCapability = {
        capabilityId: 'read',
        name: 'Read',
        description: 'Read',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const mediumRiskCapability: ConnectorCapability = {
        capabilityId: 'write',
        name: 'Write',
        description: 'Write',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const highRiskCapability: ConnectorCapability = {
        capabilityId: 'delete',
        name: 'Delete',
        description: 'Delete',
        category: 'delete',
        riskLevel: 'high',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      expect(toolBridge.determineRiskLevel(lowRiskCapability)).toBe('low');
      expect(toolBridge.determineRiskLevel(mediumRiskCapability)).toBe('medium');
      expect(toolBridge.determineRiskLevel(highRiskCapability)).toBe('high');
    });

    it('should infer risk level from category when not specified', () => {
      const toolBridge = createConnectorToolBridge();

      const readCapability: ConnectorCapability = {
        capabilityId: 'read',
        name: 'Read',
        description: 'Read',
        category: 'read',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      const deleteCapability: ConnectorCapability = {
        capabilityId: 'delete',
        name: 'Delete',
        description: 'Delete',
        category: 'delete',
        riskLevel: 'medium',
        inputSchema: {},
        requiresAuth: false,
        supportedOperations: ['execute'],
      };

      expect(toolBridge.determineRiskLevel(readCapability)).toBe('low');
      expect(toolBridge.determineRiskLevel(deleteCapability)).toBe('high');
    });
  });

  describe('ConnectorCallRequest Routing', () => {
    it('should return error response for non-existent instance', async () => {
      const request: ConnectorCallRequest = {
        requestId: 'req-001',
        connectorInstanceId: 'nonexistent',
        capabilityId: 'read',
        operation: 'execute',
        params: {},
        userId: 'user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('INSTANCE_NOT_FOUND');
      expect(response.error?.recoverable).toBe(false);
    });

    it('should return error response when adapter not found', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-007',
        name: 'No Adapter Connector',
        connectorType: 'custom',
        version: '1.0.0',
        capabilities: ['test'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-005',
        connectorDefinitionId: def.id,
        userId: 'user-005',
        name: 'No Adapter Instance',
        authStateRef: 'auth-ref-005',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-002',
        connectorInstanceId: instance.id,
        capabilityId: 'test',
        operation: 'execute',
        params: {},
        userId: 'user-005',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('ADAPTER_NOT_FOUND');
    });
  });

  describe('ConnectorResponse Normalization', () => {
    it('should normalize success response', () => {
      const raw = { data: { id: '123', name: 'Test' } };
      const response = connectorRuntime.normalizeResponse(raw, 'req-003', 'inst-001');

      expect(response.status).toBe('success');
      expect(response.requestId).toBe('req-003');
      expect(response.connectorInstanceId).toBe('inst-001');
      expect(response.data).toEqual({ data: { id: '123', name: 'Test' } });
    });

    it('should normalize auth_required response', () => {
      const raw = {
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication required',
          recoverable: true,
        },
      };
      const response = connectorRuntime.normalizeResponse(raw, 'req-004', 'inst-002');

      expect(response.status).toBe('auth_required');
      expect(response.requestId).toBe('req-004');
      expect(response.connectorInstanceId).toBe('inst-002');
      expect(response.error?.code).toBe('AUTH_ERROR');
    });

    it('should normalize rate_limited response', () => {
      const raw = {
        error: {
          code: 'RATE_LIMIT_ERROR',
          message: 'Rate limit exceeded',
          recoverable: true,
        },
        metadata: {
          retryAfterMs: 60000,
        },
      };
      const response = connectorRuntime.normalizeResponse(raw, 'req-005', 'inst-003');

      expect(response.status).toBe('rate_limited');
      expect(response.requestId).toBe('req-005');
      expect(response.error?.code).toBe('RATE_LIMIT_ERROR');
    });

    it('should normalize failed response', () => {
      const raw = {
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Execution failed',
          recoverable: false,
        },
      };
      const response = connectorRuntime.normalizeResponse(raw, 'req-006', 'inst-004');

      expect(response.status).toBe('failed');
      expect(response.requestId).toBe('req-006');
      expect(response.error?.code).toBe('EXECUTION_FAILED');
    });

    it('should detect already normalized response', () => {
      const normalized: ConnectorResponse = {
        status: 'success',
        requestId: 'req-007',
        connectorInstanceId: 'inst-005',
        data: { result: 'ok' },
      };

      const response = connectorRuntime.normalizeResponse(normalized, 'other', 'other');

      expect(response.status).toBe('success');
      expect(response.requestId).toBe('req-007');
      expect(response.connectorInstanceId).toBe('inst-005');
    });

    it('should handle primitive data', () => {
      const response = connectorRuntime.normalizeResponse('simple string', 'req-008', 'inst-006');

      expect(response.status).toBe('success');
      expect(response.data).toBe('simple string');
    });
  });

  describe('MCP Tool Descriptor Mapping', () => {
    it('should map MCP descriptor to ToolDefinition', () => {
      const descriptor: MCPToolDescriptor = {
        toolId: 'mcp-tool-001',
        name: 'get_user',
        description: 'Get user by ID',
        inputSchema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
          required: ['userId'],
        },
      };

      const toolDef = mapMCPDescriptorToToolDefinition(descriptor);

      expect(toolDef.name).toBe('mcp.get_user');
      expect(toolDef.description).toBe('Get user by ID');
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
      expect(toolDef.schema.type).toBe('object');
      expect(toolDef.schema.required).toContain('userId');
      expect(toolDef.metadata?.mcpToolId).toBe('mcp-tool-001');
    });

    it('should infer category from MCP descriptor name', () => {
      const readDescriptor: MCPToolDescriptor = {
        toolId: 'read-001',
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: {} },
      };

      const writeDescriptor: MCPToolDescriptor = {
        toolId: 'write-001',
        name: 'write_file',
        description: 'Write file',
        inputSchema: { type: 'object', properties: {} },
      };

      const deleteDescriptor: MCPToolDescriptor = {
        toolId: 'delete-001',
        name: 'delete_record',
        description: 'Delete record',
        inputSchema: { type: 'object', properties: {} },
      };

      const readTool = mapMCPDescriptorToToolDefinition(readDescriptor);
      const writeTool = mapMCPDescriptorToToolDefinition(writeDescriptor);
      const deleteTool = mapMCPDescriptorToToolDefinition(deleteDescriptor);

      expect(readTool.category).toBe('read');
      expect(readTool.sensitivity).toBe('low');
      expect(writeTool.category).toBe('write');
      expect(writeTool.sensitivity).toBe('medium');
      expect(deleteTool.category).toBe('delete');
      expect(deleteTool.sensitivity).toBe('high');
    });

    it('should respect MCP annotations', () => {
      const readOnlyDescriptor: MCPToolDescriptor = {
        toolId: 'readonly-001',
        name: 'fetch',
        description: 'Fetch data',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      };

      const destructiveDescriptor: MCPToolDescriptor = {
        toolId: 'destructive-001',
        name: 'remove',
        description: 'Remove item',
        inputSchema: { type: 'object', properties: {} },
        annotations: {
          destructiveHint: true,
        },
      };

      const readOnlyTool = mapMCPDescriptorToToolDefinition(readOnlyDescriptor);
      const destructiveTool = mapMCPDescriptorToToolDefinition(destructiveDescriptor);

      expect(readOnlyTool.category).toBe('read');
      expect(readOnlyTool.sensitivity).toBe('low');
      expect(readOnlyTool.idempotent).toBe(true);
      expect(destructiveTool.category).toBe('delete');
      expect(destructiveTool.sensitivity).toBe('high');
    });
  });

  describe('Async OperationRef Return', () => {
    it('should return AsyncOperationRef for async_started status', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-008',
        name: 'Async Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-006',
        connectorDefinitionId: def.id,
        userId: 'user-006',
        name: 'Async Instance',
        authStateRef: 'auth-ref-006',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, operationId: 'async-op-001', data: { started: true } }),
        discoverCapabilities: () => [],
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-009',
        connectorInstanceId: instance.id,
        capabilityId: 'async_task',
        operation: 'execute',
        params: {},
        userId: 'user-006',
      };

      const result = await connectorRuntime.executeCall(request);

      expect(result).toHaveProperty('operationId');
      expect(result).toHaveProperty('connectorInstanceId');
      expect(result).toHaveProperty('status', 'pending');
      expect(result).toHaveProperty('createdAt');
    });

    it('should include operationId in AsyncOperationRef', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'test-connector-009',
        name: 'Async OpId Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['long_task'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'instance-007',
        connectorDefinitionId: def.id,
        userId: 'user-007',
        name: 'Async OpId Instance',
        authStateRef: 'auth-ref-007',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true, data: null }),
        discoverCapabilities: () => [],
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-010',
        connectorInstanceId: instance.id,
        capabilityId: 'long_task',
        operation: 'execute',
        params: {},
        userId: 'user-007',
      };

      const result = await connectorRuntime.executeCall(request) as { operationId: string; status: string; createdAt: string };

      expect(result.operationId).toMatch(/^op-/);
      expect(result.status).toBe('pending');
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('Event Bridge Normalization', () => {
    it('should emit connector_definition_registered event', () => {
      connectorRuntime.registerDefinition({
        connectorId: 'event-test-001',
        name: 'Event Test Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['test'],
        status: 'active',
      });

      const events = eventStore.query({ eventType: 'connector_definition_registered' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-test-001',
        metadata: expect.objectContaining({
          connectorType: 'api',
        }),
      });
    });

    it('should emit connector_instance_created event', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'event-test-002',
        name: 'Event Instance Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['test'],
        status: 'active',
      });

      connectorRuntime.createInstance({
        connectorInstanceId: 'event-instance-001',
        connectorDefinitionId: def.id,
        userId: 'user-event-001',
        name: 'Event Instance',
        authStateRef: 'auth-event-001',
        status: 'active',
      });

      const events = eventStore.query({ eventType: 'connector_instance_created' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-instance-001',
        userId: 'user-event-001',
      });
    });

    it('should emit connector_call_executed event on success', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'event-test-003',
        name: 'Event Call Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['test'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'event-instance-002',
        connectorDefinitionId: def.id,
        userId: 'user-event-002',
        name: 'Event Call Instance',
        authStateRef: 'auth-event-002',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ success: true, data: 'result' }),
        discoverCapabilities: () => [],
      });

      await connectorRuntime.executeCall({
        requestId: 'event-req-001',
        connectorInstanceId: instance.id,
        capabilityId: 'test',
        operation: 'execute',
        params: {},
        userId: 'user-event-002',
        sessionId: 'session-event-001',
      });

      const events = eventStore.query({ eventType: 'connector_call_executed' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-instance-002',
        userId: 'user-event-002',
        sessionId: 'session-event-001',
        status: 'success',
      });
    });

    it('should emit connector_call_failed event on failure', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'event-test-004',
        name: 'Event Fail Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['test'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'event-instance-003',
        connectorDefinitionId: def.id,
        userId: 'user-event-003',
        name: 'Event Fail Instance',
        authStateRef: 'auth-event-003',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => { throw new Error('Test error'); },
        discoverCapabilities: () => [],
      });

      await connectorRuntime.executeCall({
        requestId: 'event-req-002',
        connectorInstanceId: instance.id,
        capabilityId: 'test',
        operation: 'execute',
        params: {},
        userId: 'user-event-003',
      });

      const events = eventStore.query({ eventType: 'connector_call_failed' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-instance-003',
        userId: 'user-event-003',
        errorCode: 'EXECUTION_ERROR',
      });
    });

    it('should emit connector_async_started event', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'event-test-005',
        name: 'Event Async Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['async'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'event-instance-004',
        connectorDefinitionId: def.id,
        userId: 'user-event-004',
        name: 'Event Async Instance',
        authStateRef: 'auth-event-004',
        status: 'active',
      });

      (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter('api', {
        execute: async () => ({ async: true }),
        discoverCapabilities: () => [],
      });

      await connectorRuntime.executeCall({
        requestId: 'event-req-003',
        connectorInstanceId: instance.id,
        capabilityId: 'async',
        operation: 'execute',
        params: {},
        userId: 'user-event-004',
      });

      const events = eventStore.query({ eventType: 'connector_async_started' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-instance-004',
        userId: 'user-event-004',
        metadata: expect.objectContaining({
          operationId: expect.any(String),
        }),
      });
    });

    it('should emit connector_capability_discovered event', () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'event-test-006',
        name: 'Event Discovery Connector',
        connectorType: 'api',
        version: '1.0.0',
        capabilities: ['cap1', 'cap2'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'event-instance-005',
        connectorDefinitionId: def.id,
        userId: 'user-event-005',
        name: 'Event Discovery Instance',
        authStateRef: 'auth-event-005',
        status: 'active',
      });

      connectorRuntime.discoverCapabilities(instance.id);

      const events = eventStore.query({ eventType: 'connector_capability_discovered' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.payload).toMatchObject({
        connectorInstanceId: 'event-instance-005',
        metadata: {
          capabilityCount: 2,
        },
      });
    });
  });
});
