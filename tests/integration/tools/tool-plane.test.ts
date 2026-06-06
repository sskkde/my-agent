import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createToolRegistry, createToolExecutor, assembleToolPool } from '../../../src/tools/index.js';
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js';
import type {
  ToolDefinition,
  ToolExecutorConfig,
  PermissionContext,
  ToolCategory,
  ToolSensitivity,
} from '../../../src/tools/types.js';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { generateId, GRANT_ID_PREFIX } from '../../../src/shared/ids.js';

describe('Tool Plane Integration', () => {
  let connection: ConnectionManager;
  let toolExecutionStore: ReturnType<typeof createToolExecutionStore>;
  let eventStore: ReturnType<typeof createEventStore>;
  let approvalStore: ReturnType<typeof createApprovalStore>;
  let grantStore: ReturnType<typeof createPermissionGrantStore>;
  let permissionEngine: ReturnType<typeof createPermissionEngine>;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    toolExecutionStore = createToolExecutionStore(connection);
    eventStore = createEventStore(connection);
    approvalStore = createApprovalStore(connection);
    grantStore = createPermissionGrantStore(connection);

    permissionEngine = createPermissionEngine(
      {
        approvalStore,
        grantStore,
        eventStore,
      },
      {
        auditAllDecisions: false,
      }
    );
  });

  afterAll(() => {
    connection.close();
  });

  describe('Tool Registry', () => {
    it('should register and retrieve tools', () => {
      const registry = createToolRegistry();

      const tool: ToolDefinition = {
        name: 'file-read',
        description: 'Read file contents',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
        handler: async (params) => ({
          success: true,
          data: `Contents of ${(params as { path: string }).path}`,
        }),
      };

      registry.register(tool);

      const retrieved = registry.getTool('file-read');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('file-read');
      expect(retrieved?.category).toBe('read');
    });

    it('should list tools by category', () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'read-tool',
        description: 'Read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      registry.register({
        name: 'write-tool',
        description: 'Write tool',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      const readTools = registry.listToolsByCategory('read');
      expect(readTools).toHaveLength(1);
      expect(readTools[0].name).toBe('read-tool');
    });

    it('should assemble tool pool for kernel context', () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'tool-1',
        description: 'Tool 1',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      registry.register({
        name: 'tool-2',
        description: 'Tool 2',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      const pool = assembleToolPool(registry, 'run-123');

      expect(pool.tools).toHaveLength(2);
      expect(pool.metadata.runId).toBe('run-123');
      expect(pool.metadata.categoryCounts.read).toBe(1);
      expect(pool.metadata.categoryCounts.write).toBe(1);
    });

    it('should filter tools by category when assembling pool', () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'read-tool',
        description: 'Read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      registry.register({
        name: 'write-tool',
        description: 'Write tool',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      });

      const pool = assembleToolPool(registry, 'run-123', {
        includeCategories: ['read'],
      });

      expect(pool.tools).toHaveLength(1);
      expect(pool.tools[0].name).toBe('read-tool');
    });
  });

  describe('Tool Executor - Schema Validation', () => {
    it('should reject invalid schema parameters', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'calculator',
        description: 'A calculator tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
            operation: { type: 'string' },
          },
          required: ['a', 'b', 'operation'],
        },
        handler: async (params) => {
          const { a, b, operation } = params as { a: number; b: number; operation: string };
          let result = 0;
          switch (operation) {
            case 'add':
              result = a + b;
              break;
            case 'subtract':
              result = a - b;
              break;
            default:
              throw new Error('Unknown operation');
          }
          return {
            success: true,
            data: result,
            resultPreview: `${a} ${operation} ${b} = ${result}`,
          };
        },
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'calculator',
        params: { a: 10 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(result.error?.message).toContain('Missing required field');
    });

    it('should reject wrong parameter types', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'calculator',
        description: 'A calculator tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        handler: async () => ({ success: true }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'calculator',
        params: { a: 'ten', b: 5 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
    });
  });

  describe('Tool Executor - Permission Coordination', () => {
    it('should execute read tool without approval', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'file-reader',
        description: 'Read a file',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
        handler: async () => ({
          success: true,
          data: 'file contents',
        }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'file-reader',
        params: { path: '/test.txt' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('file contents');
    });

    it('should require approval for write tools in ask_on_write mode', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'file-writer',
        description: 'Write to a file',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
        handler: async () => ({
          success: true,
          data: 'written',
        }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'file-writer',
        params: { path: '/test.txt', content: 'hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_REQUIRED');
      expect(result.error?.recoverable).toBe(true);
      expect(result.structuredContent?.status).toBe('requires_approval');
    });

    it('should execute write tool with permission grant', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'file-writer',
        description: 'Write to a file',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
        handler: async () => ({
          success: true,
          data: 'written',
        }),
      });

      grantStore.create({
        id: generateId(GRANT_ID_PREFIX),
        userId: 'user-1',
        scope: 'session-1',
        action: 'tool:file-writer',
        resourcePattern: undefined,
        expiresAt: undefined,
      });

      const grants = grantStore.findActiveByUserAndScope('user-1', 'session-1');

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'file-writer',
        params: { path: '/test.txt', content: 'hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'ask_on_write',
          grants,
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe('written');
    });

    it('should require approval for delete tools without permission', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'file-deleter',
        description: 'Delete a file',
        category: 'delete' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
        handler: async () => ({
          success: true,
          data: 'deleted',
        }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'file-deleter',
        params: { path: '/test.txt' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_REQUIRED');
      expect(result.error?.recoverable).toBe(true);
      expect(result.structuredContent?.status).toBe('requires_approval');
    });

    it('should respect hard_deny mode', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'read-tool',
        description: 'Read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          data: 'read',
        }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'read-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'hard_deny',
          grants: [],
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('Tool Executor - Result Normalization', () => {
    it('should emit RuntimeContextDelta for context updates', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'search-tool',
        description: 'Search for data',
        category: 'search' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async (_params, context) => ({
          success: true,
          data: { results: ['item1', 'item2'] },
          contextDelta: {
            runId: context.kernelRunId || 'test-run',
            source: 'tool_result',
            items: [
              {
                itemId: 'search-result-1',
                sourceType: 'tool_result',
                semanticType: 'tool_output',
                content: 'Found 2 items',
              },
            ],
          },
        }),
      });

      const mockApplyDelta = vi.fn();

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
        contextManager: {
          applyDelta: mockApplyDelta,
        },
      };

      const executor = createToolExecutor(config);

      await executor.execute({
        toolCallId: 'call-1',
        toolName: 'search-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        kernelRunId: 'run-123',
        permissionContext: createTestPermissionContext(),
      });

      expect(mockApplyDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-123',
          source: 'tool_result',
          items: expect.any(Array),
        })
      );
    });

    it('should persist execution to ToolExecutionStore', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'test-tool',
        description: 'Test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          resultPreview: 'Test completed',
          structuredContent: { key: 'value' },
        }),
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      await executor.execute({
        toolCallId: 'call-123',
        toolName: 'test-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      const execution = toolExecutionStore.getById('call-123');
      expect(execution).toBeDefined();
      expect(execution?.toolName).toBe('test-tool');
      expect(execution?.resultPreview).toBe('Test completed');
    });
  });

  describe('Tool Executor - Error Handling', () => {
    it('should handle tool not found', async () => {
      const registry = createToolRegistry();

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'nonexistent-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
    });

    it('should handle handler errors gracefully', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'failing-tool',
        description: 'Tool that fails',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Tool execution failed');
        },
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_FAILED');
      expect(result.error?.message).toBe('Tool execution failed');
    });

    it('should persist failed execution status', async () => {
      const registry = createToolRegistry();

      registry.register({
        name: 'failing-tool',
        description: 'Tool that fails',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('Tool execution failed');
        },
      });

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      };

      const executor = createToolExecutor(config);

      await executor.execute({
        toolCallId: 'call-fail-1',
        toolName: 'failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      const execution = toolExecutionStore.getById('call-fail-1');
      expect(execution).toBeDefined();
      expect(execution?.status).toBe('failed');
    });
  });
});

function createTestPermissionContext(): PermissionContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    mode: 'ask_on_write',
    grants: [],
  };
}
