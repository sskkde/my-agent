import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToolExecutor } from '../../../src/tools/tool-executor.js';
import type {
  ToolDefinition,
  ToolRegistry,
  ToolExecutorConfig,
  ToolCategory,
  ToolSensitivity,
  PermissionContext,
} from '../../../src/tools/types.js';
import type { PermissionDecision } from '../../../src/permissions/types.js';

describe('ToolExecutor', () => {
  let mockRegistry: ToolRegistry;
  let mockPermissionEngine: ToolExecutorConfig['permissionEngine'];
  let mockToolExecutionStore: ToolExecutorConfig['toolExecutionStore'];
  let mockEventStore: NonNullable<ToolExecutorConfig['eventStore']>;
  let executor: ReturnType<typeof createToolExecutor>;

  beforeEach(() => {
    mockRegistry = {
      register: vi.fn(),
      getTool: vi.fn(),
      listTools: vi.fn(),
      listToolsByCategory: vi.fn(),
      unregister: vi.fn(),
      hasTool: vi.fn(),
    };

    mockPermissionEngine = {
      checkPermission: vi.fn(),
    };

    mockToolExecutionStore = {
      create: vi.fn(),
      updateStatus: vi.fn(),
      saveResult: vi.fn(),
    };

    mockEventStore = {
      append: vi.fn(),
    };

    const config: ToolExecutorConfig = {
      registry: mockRegistry,
      permissionEngine: mockPermissionEngine,
      toolExecutionStore: mockToolExecutionStore,
      eventStore: mockEventStore,
    };

    executor = createToolExecutor(config);
  });

  describe('execute - validation', () => {
    it('should fail when tool not found and persist error', async () => {
      vi.mocked(mockRegistry.getTool).mockReturnValue(null);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'unknown-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
      expect(mockToolExecutionStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'call-1',
          status: 'failed',
          errorMessage: '[TOOL_NOT_FOUND] Tool not found: unknown-tool',
        })
      );
    });

    it('should validate params against schema', async () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['name'],
        },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const validResult = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: { name: 'test', count: 5 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(validResult.success).toBe(true);

      const invalidResult = await executor.execute({
        toolCallId: 'call-2',
        toolName: 'test-tool',
        params: { count: 5 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(invalidResult.success).toBe(false);
      expect(invalidResult.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-2',
        'failed',
        undefined,
        '[SCHEMA_VALIDATION_FAILED] Schema validation failed: Missing required field: name'
      );
    });

    it('should reject wrong parameter types', async () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: { count: 'not-a-number' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        "[SCHEMA_VALIDATION_FAILED] Schema validation failed: Field 'count' must be of type 'number', got 'string'"
      );
    });
  });

  describe('execute - permission checks', () => {
    it('should execute read tool with permission check', async () => {
      const tool: ToolDefinition = {
        name: 'read-tool',
        description: 'A read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          data: 'result',
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Read operations allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'read-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(true);
      expect(mockPermissionEngine.checkPermission).toHaveBeenCalled();
    });

    it('should check permission for write tools', async () => {
      const tool: ToolDefinition = {
        name: 'write-tool',
        description: 'A write tool',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          data: 'written',
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'write-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(mockPermissionEngine.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'tool:write-tool',
          operationType: 'write',
        })
      );
      expect(result.success).toBe(true);
    });

    it('should deny execution when permission denied', async () => {
      const tool: ToolDefinition = {
        name: 'delete-tool',
        description: 'A delete tool',
        category: 'delete' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'denied',
        allowed: false,
        reason: 'Permission denied by policy',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'delete-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(result.error?.message).toBe('Permission denied by policy');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        '[PERMISSION_DENIED] Permission denied by policy'
      );
    });

    it('should handle requires_approval decision', async () => {
      const tool: ToolDefinition = {
        name: 'destructive-tool',
        description: 'A destructive tool',
        category: 'execute' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'requires_approval',
        allowed: false,
        reason: 'Operation requires approval',
        requestId: 'approval-123',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'destructive-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(result.error?.message).toContain('requires approval');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        '[PERMISSION_DENIED] Operation requires approval'
      );
    });

    it('should sanitize permission denied reason containing secrets', async () => {
      const fakeSecret = 'sk-testsecretkey12345678901234567890';
      const tool: ToolDefinition = {
        name: 'sensitive-tool',
        description: 'A sensitive tool',
        category: 'admin' as ToolCategory,
        sensitivity: 'restricted' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'denied',
        allowed: false,
        reason: `Insufficient permissions for key ${fakeSecret}`,
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'sensitive-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(result.error?.message).toContain(fakeSecret);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]')
      );
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        expect.not.stringContaining(fakeSecret)
      );
    });
  });

  describe('execute - tool execution', () => {
    it('should execute tool handler and return result', async () => {
      const handler = vi.fn().mockResolvedValue({
        success: true,
        data: { value: 42 },
        resultPreview: 'Result: 42',
      });

      const tool: ToolDefinition = {
        name: 'calc-tool',
        description: 'A calculator tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
        },
        handler,
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'calc-tool',
        params: { x: 10, y: 32 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(handler).toHaveBeenCalledWith(
        { x: 10, y: 32 },
        expect.objectContaining({
          toolCallId: 'call-1',
          toolName: 'calc-tool',
          userId: 'user-1',
        })
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: 42 });
      expect(result.resultPreview).toBe('Result: 42');
    });

    it('should handle handler errors gracefully', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Tool execution failed'));

      const tool: ToolDefinition = {
        name: 'failing-tool',
        description: 'A tool that fails',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

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
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool execution failed'
      );
    });

    it('should sanitize error messages containing secrets before persistence', async () => {
      const fakeSecret = 'sk-1234567890abcdefghijklmnopqrstuv';
      const handler = vi.fn().mockRejectedValue(new Error(`API key ${fakeSecret} is invalid`));

      const tool: ToolDefinition = {
        name: 'secret-failing-tool',
        description: 'A tool that fails with secret in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'secret-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_FAILED');
      expect(result.error?.message).toContain(fakeSecret);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]')
      );
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeSecret)
      );
    });

    it('should sanitize error messages containing passwords before persistence', async () => {
      const fakePassword = 'super_secret_password_123!';
      const handler = vi.fn().mockRejectedValue(new Error(`Authentication failed: password=${fakePassword}`));

      const tool: ToolDefinition = {
        name: 'auth-failing-tool',
        description: 'A tool that fails with password in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'auth-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(fakePassword);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_PASSWORD]')
      );
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakePassword)
      );
    });

    it('should sanitize error messages containing bearer tokens before persistence', async () => {
      const fakeBearerToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const handler = vi.fn().mockRejectedValue(new Error(`Bearer ${fakeBearerToken} expired`));

      const tool: ToolDefinition = {
        name: 'token-failing-tool',
        description: 'A tool that fails with bearer token in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'token-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(fakeBearerToken);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_TOKEN]')
      );
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeBearerToken)
      );
    });

    it('should save execution result to store', async () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          resultPreview: 'Test result',
          structuredContent: { key: 'value' },
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(mockToolExecutionStore.saveResult).toHaveBeenCalledWith(
        'call-1',
        expect.objectContaining({
          preview: 'Test result',
          structuredContent: { key: 'value' },
        })
      );
    });

    it('should emit context delta when provided', async () => {
      const mockApplyDelta = vi.fn();
      const configWithContextManager: ToolExecutorConfig = {
        registry: mockRegistry,
        permissionEngine: mockPermissionEngine,
        toolExecutionStore: mockToolExecutionStore,
        eventStore: mockEventStore,
        contextManager: {
          applyDelta: mockApplyDelta,
        },
      };

      const executorWithContextManager = createToolExecutor(configWithContextManager);

      const tool: ToolDefinition = {
        name: 'context-tool',
        description: 'A tool that emits context',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: true,
          contextDelta: {
            runId: 'run-1',
            source: 'tool_result',
            items: [
              {
                itemId: 'item-1',
                sourceType: 'tool_result',
                semanticType: 'tool_output',
                content: 'Tool result content',
              },
            ],
          },
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      await executorWithContextManager.execute({
        toolCallId: 'call-1',
        toolName: 'context-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        kernelRunId: 'run-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(mockApplyDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          source: 'tool_result',
          items: expect.any(Array),
        })
      );
    });

    it('should persist FAILED status when handler returns success:false', async () => {
      const tool: ToolDefinition = {
        name: 'failing-result-tool',
        description: 'A tool that returns failure',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: false,
          error: {
            code: 'TOOL_ERROR',
            message: 'Tool returned failure',
            recoverable: true,
          },
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'failing-result-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_ERROR');
      expect(result.error?.message).toBe('Tool returned failure');
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool returned failure'
      );
    });

    it('should sanitize error message when handler returns success:false with secrets', async () => {
      const fakeSecret = 'sk-abcdefghijklmnopqrstuv1234567890';
      const tool: ToolDefinition = {
        name: 'secret-result-tool',
        description: 'A tool that returns failure with secret',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: false,
          error: {
            code: 'AUTH_ERROR',
            message: `Invalid API key: ${fakeSecret}`,
            recoverable: false,
          },
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'secret-result-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(fakeSecret);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]')
      );
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeSecret)
      );
    });

    it('should handle handler returning success:false without error object', async () => {
      const tool: ToolDefinition = {
        name: 'no-error-tool',
        description: 'A tool that returns failure without error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({
          success: false,
        }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'no-error-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(result.success).toBe(false);
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool execution returned failure'
      );
    });
  });

  describe('execution status tracking', () => {
    it('should create execution record on start', async () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool);
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision);

      await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      });

      expect(mockToolExecutionStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'call-1',
          toolName: 'test-tool',
          userId: 'user-1',
          sessionId: 'session-1',
        })
      );
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
