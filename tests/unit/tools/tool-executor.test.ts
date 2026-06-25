import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createToolExecutor, _categoryToOperationTypeForTesting } from '../../../src/tools/tool-executor.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import type {
  ToolDefinition,
  ToolRegistry,
  ToolExecutorConfig,
  ToolCategory,
  ToolSensitivity,
  PermissionContext,
} from '../../../src/tools/types.js'
import type { PermissionDecision } from '../../../src/permissions/types.js'

describe('ToolExecutor', () => {
  let mockRegistry: ToolRegistry
  let mockPermissionEngine: ToolExecutorConfig['permissionEngine']
  let mockToolExecutionStore: ToolExecutorConfig['toolExecutionStore']
  let mockEventStore: NonNullable<ToolExecutorConfig['eventStore']>
  let executor: ReturnType<typeof createToolExecutor>

  beforeEach(() => {
    mockRegistry = {
      register: vi.fn(),
      getTool: vi.fn(),
      listTools: vi.fn(),
      listToolsByCategory: vi.fn(),
      unregister: vi.fn(),
      hasTool: vi.fn(),
    }

    mockPermissionEngine = {
      checkPermission: vi.fn(),
    }

    mockToolExecutionStore = {
      create: vi.fn(),
      updateStatus: vi.fn(),
      saveResult: vi.fn(),
    }

    mockEventStore = {
      append: vi.fn(),
    }

    const config: ToolExecutorConfig = {
      registry: mockRegistry,
      permissionEngine: mockPermissionEngine,
      toolExecutionStore: mockToolExecutionStore,
      eventStore: mockEventStore,
    }

    executor = createToolExecutor(config)
  })

  describe('execute - validation', () => {
    it('should fail when tool not found and persist error', async () => {
      vi.mocked(mockRegistry.getTool).mockReturnValue(null)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'unknown-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TOOL_NOT_FOUND')
      expect(mockToolExecutionStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'call-1',
          status: 'failed',
          errorMessage: '[TOOL_NOT_FOUND] Tool not found: unknown-tool',
        }),
      )
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const validResult = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: { name: 'test', count: 5 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(validResult.success).toBe(true)

      const invalidResult = await executor.execute({
        toolCallId: 'call-2',
        toolName: 'test-tool',
        params: { count: 5 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(invalidResult.success).toBe(false)
      expect(invalidResult.error?.code).toBe('SCHEMA_VALIDATION_FAILED')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-2',
        'failed',
        undefined,
        '[SCHEMA_VALIDATION_FAILED] Schema validation failed: Missing required field: name',
      )
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: { count: 'not-a-number' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        "[SCHEMA_VALIDATION_FAILED] Schema validation failed: Field 'count' must be of type 'number', got 'string'",
      )
    })
  })

  describe('execute - envelope enforcement', () => {
    it('should fail closed when envelope registry is configured but agentType is missing', async () => {
      const tool: ToolDefinition = {
        name: 'read-tool',
        description: 'A read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true, data: 'result' }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      executor = createToolExecutor({
        registry: mockRegistry,
        permissionEngine: mockPermissionEngine,
        toolExecutionStore: mockToolExecutionStore,
        eventStore: mockEventStore,
        envelopeRegistry: createAgentTypeToolEnvelopeRegistry(),
      })

      const result = await executor.execute({
        toolCallId: 'call-envelope-missing-agent-type',
        toolName: 'read-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('ENVELOPE_DENIED')
      expect(mockPermissionEngine.checkPermission).not.toHaveBeenCalled()
      expect(mockToolExecutionStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'call-envelope-missing-agent-type',
          status: 'denied',
          errorMessage: '[ENVELOPE_DENIED] Missing agentType for envelope enforcement',
        }),
      )
    })
  })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Read operations allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'read-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(true)
      expect(mockPermissionEngine.checkPermission).toHaveBeenCalled()
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'write-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(mockPermissionEngine.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'tool:write-tool',
          operationType: 'write',
        }),
      )
      expect(result.success).toBe(true)
    })

    it('should deny execution when permission denied', async () => {
      const tool: ToolDefinition = {
        name: 'delete-tool',
        description: 'A delete tool',
        category: 'delete' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'denied',
        allowed: false,
        reason: 'Permission denied by policy',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'delete-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
      expect(result.error?.message).toBe('Permission denied by policy')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        '[PERMISSION_DENIED] Permission denied by policy',
      )
    })

    it('should handle requires_approval decision', async () => {
      const tool: ToolDefinition = {
        name: 'destructive-tool',
        description: 'A destructive tool',
        category: 'execute' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'requires_approval',
        allowed: false,
        reason: 'Operation requires approval',
        requestId: 'approval-123',
        approvalRequest: {
          id: 'approval-123',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending',
          actionType: 'tool:destructive-tool',
          operationType: 'execute',
          requestedBy: 'user-1',
          requestedAt: new Date().toISOString(),
        },
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'destructive-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(result.error?.message).toContain('requires approval')
      expect(result.structuredContent?.status).toBe('requires_approval')
      expect(result.structuredContent?.requestId).toBe('approval-123')
      expect(result.structuredContent?.approvalRequest).toBeDefined()
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'waiting_for_approval',
        undefined,
        '[APPROVAL_REQUIRED] Operation requires approval',
      )
    })

    it('should return recoverable APPROVAL_REQUIRED error for approval-required operations', async () => {
      const tool: ToolDefinition = {
        name: 'approval-tool',
        description: 'Tool requiring approval',
        category: 'write' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'requires_approval',
        allowed: false,
        reason: 'High-risk operation requires approval',
        requestId: 'approval-456',
        approvalRequest: {
          id: 'approval-456',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending',
          actionType: 'tool:approval-tool',
          operationType: 'write',
          requestedBy: 'user-1',
          requestedAt: new Date().toISOString(),
        },
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-approval',
        toolName: 'approval-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      // Verify error structure
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(result.error?.recoverable).toBe(true)

      // Verify WAITING_FOR_APPROVAL state is persisted
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-approval',
        'waiting_for_approval',
        undefined,
        expect.stringContaining('APPROVAL_REQUIRED'),
      )
    })

    it('should NOT invoke tool handler when approval is required', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, data: 'should-not-be-called' })

      const tool: ToolDefinition = {
        name: 'protected-tool',
        description: 'Protected tool',
        category: 'delete' as ToolCategory,
        sensitivity: 'restricted' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'requires_approval',
        allowed: false,
        reason: 'Destructive operation requires approval',
        requestId: 'approval-789',
        approvalRequest: {
          id: 'approval-789',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending',
          actionType: 'tool:protected-tool',
          operationType: 'delete',
          requestedBy: 'user-1',
          requestedAt: new Date().toISOString(),
        },
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-protected',
        toolName: 'protected-tool',
        params: { target: 'critical-file' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      // Verify handler was NEVER called
      expect(handler).not.toHaveBeenCalled()

      // Verify we still get proper error response
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
    })

    it('should sanitize permission denied reason containing secrets', async () => {
      const fakeSecret = 'sk-testsecretkey12345678901234567890'
      const tool: ToolDefinition = {
        name: 'sensitive-tool',
        description: 'A sensitive tool',
        category: 'admin' as ToolCategory,
        sensitivity: 'restricted' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'denied',
        allowed: false,
        reason: `Insufficient permissions for key ${fakeSecret}`,
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'sensitive-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
      expect(result.error?.message).toContain(fakeSecret)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]'),
      )
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'denied',
        undefined,
        expect.not.stringContaining(fakeSecret),
      )
    })
  })

  describe('execute - tool execution', () => {
    it('should execute tool handler and return result', async () => {
      const handler = vi.fn().mockResolvedValue({
        success: true,
        data: { value: 42 },
        resultPreview: 'Result: 42',
      })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'calc-tool',
        params: { x: 10, y: 32 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(handler).toHaveBeenCalledWith(
        { x: 10, y: 32 },
        expect.objectContaining({
          toolCallId: 'call-1',
          toolName: 'calc-tool',
          userId: 'user-1',
        }),
      )
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ value: 42 })
      expect(result.resultPreview).toBe('Result: 42')
    })

    it('should handle handler errors gracefully', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Tool execution failed'))

      const tool: ToolDefinition = {
        name: 'failing-tool',
        description: 'A tool that fails',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EXECUTION_FAILED')
      expect(result.error?.message).toBe('Tool execution failed')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool execution failed',
      )
    })

    it('should sanitize error messages containing secrets before persistence', async () => {
      const fakeSecret = 'sk-1234567890abcdefghijklmnopqrstuv'
      const handler = vi.fn().mockRejectedValue(new Error(`API key ${fakeSecret} is invalid`))

      const tool: ToolDefinition = {
        name: 'secret-failing-tool',
        description: 'A tool that fails with secret in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'secret-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('EXECUTION_FAILED')
      expect(result.error?.message).toContain(fakeSecret)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]'),
      )
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeSecret),
      )
    })

    it('should sanitize error messages containing passwords before persistence', async () => {
      const fakePassword = 'super_secret_password_123!'
      const handler = vi.fn().mockRejectedValue(new Error(`Authentication failed: password=${fakePassword}`))

      const tool: ToolDefinition = {
        name: 'auth-failing-tool',
        description: 'A tool that fails with password in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'auth-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain(fakePassword)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_PASSWORD]'),
      )
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakePassword),
      )
    })

    it('should sanitize error messages containing bearer tokens before persistence', async () => {
      const fakeBearerToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const handler = vi.fn().mockRejectedValue(new Error(`Bearer ${fakeBearerToken} expired`))

      const tool: ToolDefinition = {
        name: 'token-failing-tool',
        description: 'A tool that fails with bearer token in error',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'token-failing-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain(fakeBearerToken)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_TOKEN]'),
      )
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeBearerToken),
      )
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(mockToolExecutionStore.saveResult).toHaveBeenCalledWith(
        'call-1',
        expect.objectContaining({
          preview: 'Test result',
          structuredContent: { key: 'value' },
        }),
      )
    })

    it('should emit context delta when provided', async () => {
      const mockApplyDelta = vi.fn()
      const configWithContextManager: ToolExecutorConfig = {
        registry: mockRegistry,
        permissionEngine: mockPermissionEngine,
        toolExecutionStore: mockToolExecutionStore,
        eventStore: mockEventStore,
        contextManager: {
          applyDelta: mockApplyDelta,
        },
      }

      const executorWithContextManager = createToolExecutor(configWithContextManager)

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executorWithContextManager.execute({
        toolCallId: 'call-1',
        toolName: 'context-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        kernelRunId: 'run-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(mockApplyDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          source: 'tool_result',
          items: expect.any(Array),
        }),
      )
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'failing-result-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TOOL_ERROR')
      expect(result.error?.message).toBe('Tool returned failure')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool returned failure',
      )
    })

    it('should sanitize error message when handler returns success:false with secrets', async () => {
      const fakeSecret = 'sk-abcdefghijklmnopqrstuv1234567890'
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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'secret-result-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain(fakeSecret)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.stringContaining('[REDACTED_API_KEY]'),
      )
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        expect.not.stringContaining(fakeSecret),
      )
    })

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
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'no-error-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith(
        'call-1',
        'failed',
        undefined,
        '[EXECUTION_FAILED] Tool execution returned failure',
      )
    })
  })

  describe('execution status tracking', () => {
    it('should create execution record on start', async () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-1',
        toolName: 'test-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(mockToolExecutionStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'call-1',
          toolName: 'test-tool',
          userId: 'user-1',
          sessionId: 'session-1',
        }),
      )
    })
  })

  describe('agent identity transport', () => {
    it('should pass agentType, agentId, agentProfile, launchSource from request to handler context', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'identity-tool',
        description: 'Receives agent identity',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-identity-1',
        toolName: 'identity-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
        agentType: 'background.worker',
        agentId: 'agent-uuid-123',
        agentProfile: 'todo-isolation',
        launchSource: 'subagent-dispatcher',
      })

      expect(handler).toHaveBeenCalledTimes(1)
      const receivedContext = handler.mock.calls[0][1]
      expect(receivedContext.agentType).toBe('background.worker')
      expect(receivedContext.agentId).toBe('agent-uuid-123')
      expect(receivedContext.agentProfile).toBe('todo-isolation')
      expect(receivedContext.launchSource).toBe('subagent-dispatcher')
    })

    it('should leave agent identity fields undefined when request omits them (no fabrication)', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'no-identity-tool',
        description: 'No agent identity provided',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-identity-2',
        toolName: 'no-identity-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      const receivedContext = handler.mock.calls[0][1]
      expect(receivedContext.agentType).toBeUndefined()
      expect(receivedContext.agentId).toBeUndefined()
      expect(receivedContext.agentProfile).toBeUndefined()
      expect(receivedContext.launchSource).toBeUndefined()
    })
  })

  describe('workdir context transport', () => {
    it('should pass workDirRoot and workDirId from request to handler context unchanged', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'workdir-tool',
        description: 'Receives workdir context',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-workdir-1',
        toolName: 'workdir-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
      })

      expect(handler).toHaveBeenCalledTimes(1)
      const receivedContext = handler.mock.calls[0][1]
      expect(receivedContext.workDirRoot).toBe('/data/workdirs/user-1/abc-123')
      expect(receivedContext.workDirId).toBe('abc-123')
    })

    it('should leave workDirRoot and workDirId undefined when request omits them (legacy behavior)', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'legacy-tool',
        description: 'No workdir context provided',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-legacy-1',
        toolName: 'legacy-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      const receivedContext = handler.mock.calls[0][1]
      expect(receivedContext.workDirRoot).toBeUndefined()
      expect(receivedContext.workDirId).toBeUndefined()
    })

    it('should not mutate global cwd when workdir fields are undefined', async () => {
      const originalCwd = process.cwd()
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'no-cwd-mutation-tool',
        description: 'Should not change cwd',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Test allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-no-cwd-1',
        toolName: 'no-cwd-mutation-tool',
        params: {},
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(process.cwd()).toBe(originalCwd)
    })

    it('should use active workDirRoot as permission resource when every patch operation stays inside workdir', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'file_apply_patch',
        description: 'Apply patch',
        category: 'write' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'allowed',
        allowed: true,
        reason: 'Workdir auto allowed',
      } as PermissionDecision)

      await executor.execute({
        toolCallId: 'call-patch-workdir-only',
        toolName: 'file_apply_patch',
        params: {
          operations: [
            { type: 'add', filePath: 'a.txt', content: 'a' },
            { type: 'update', filePath: 'nested/b.txt', oldString: 'b', newString: 'bb' },
          ],
        },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
      })

      expect(mockPermissionEngine.checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ resource: '/data/workdirs/user-1/abc-123' }),
      )
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should use the first outside path as permission resource when a patch mixes workdir and non-workdir targets', async () => {
      const outsidePath = '/tmp/outside-workdir.txt'
      const handler = vi.fn().mockResolvedValue({ success: true })
      const tool: ToolDefinition = {
        name: 'file_apply_patch',
        description: 'Apply patch',
        category: 'write' as ToolCategory,
        sensitivity: 'high' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler,
      }

      vi.mocked(mockRegistry.getTool).mockReturnValue(tool)
      vi.mocked(mockPermissionEngine.checkPermission).mockReturnValue({
        status: 'requires_approval',
        allowed: false,
        reason: 'Outside workdir requires approval',
      } as PermissionDecision)

      const result = await executor.execute({
        toolCallId: 'call-patch-mixed-targets',
        toolName: 'file_apply_patch',
        params: {
          operations: [
            { type: 'add', filePath: 'inside.txt', content: 'inside' },
            { type: 'add', filePath: outsidePath, content: 'outside' },
          ],
        },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
        workDirRoot: '/data/workdirs/user-1/abc-123',
        workDirId: 'abc-123',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(mockPermissionEngine.checkPermission).toHaveBeenCalledWith(expect.objectContaining({ resource: outsidePath }))
      expect(handler).not.toHaveBeenCalled()
    })
  })
})

describe('categoryToOperationType mapping', () => {
  it('should map read category to read operation', () => {
    expect(_categoryToOperationTypeForTesting('read')).toBe('read')
  })

  it('should map search category to read operation', () => {
    expect(_categoryToOperationTypeForTesting('search')).toBe('read')
  })

  it('should map internal category to read operation', () => {
    expect(_categoryToOperationTypeForTesting('internal')).toBe('read')
  })

  it('should map write category to write operation', () => {
    expect(_categoryToOperationTypeForTesting('write')).toBe('write')
  })

  it('should map send category to write operation', () => {
    expect(_categoryToOperationTypeForTesting('send')).toBe('write')
  })

  it('should map delete category to delete operation', () => {
    expect(_categoryToOperationTypeForTesting('delete')).toBe('delete')
  })

  it('should map execute category to execute operation', () => {
    expect(_categoryToOperationTypeForTesting('execute')).toBe('execute')
  })

  it('should map automation category to execute operation', () => {
    expect(_categoryToOperationTypeForTesting('automation')).toBe('execute')
  })

  it('should map admin category to admin operation', () => {
    expect(_categoryToOperationTypeForTesting('admin')).toBe('admin')
  })

  it('should map connector category to admin operation', () => {
    expect(_categoryToOperationTypeForTesting('connector')).toBe('admin')
  })
})

function createTestPermissionContext(): PermissionContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    mode: 'ask_on_write',
    grants: [],
  }
}
