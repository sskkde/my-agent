import { describe, it, expect, vi } from 'vitest'
import type { CancellationRequest, RetryPolicy, CancellationCoordinatorConfig } from '../../../src/recovery/types.js'
import { createCancellationCoordinator } from '../../../src/recovery/cancellation-coordinator.js'
import { createRetryExecutor } from '../../../src/recovery/retry-executor.js'
import { CANCELLATION_TARGET_TYPES, CANCELLATION_STATUSES } from '../../../src/shared/cancellation.js'
import { BACKOFF_STRATEGIES } from '../../../src/shared/retry.js'

describe('Cancellation and Recovery', () => {
  describe('Tool Cancellation - Synthetic Terminal Result', () => {
    it('should create synthetic terminal result when tool execution is cancelled', async () => {
      const mockToolExecutionStore = {
        getById: vi.fn().mockReturnValue({
          toolCallId: 'tool_123',
          toolName: 'testTool',
          status: 'executing',
          userId: 'user_1',
          sessionId: 'session_1',
          kernelRunId: 'kernel_1',
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      } as unknown as CancellationCoordinatorConfig['toolExecutionStore']

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: {} as any,
        backgroundRunStore: {} as any,
        kernelRunStore: {} as any,
        eventStore: {
          append: vi.fn(),
        } as any,
      }

      const coordinator = createCancellationCoordinator(config)

      const request: CancellationRequest = {
        targetType: CANCELLATION_TARGET_TYPES.TOOL_EXECUTION,
        targetId: 'tool_123',
        cascade: false,
        reason: 'User requested cancellation',
      }

      const result = await coordinator.cancel(request)

      expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
      expect(result.affectedRefs).toContain('tool_123')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_123', 'cancelled')
      expect(mockToolExecutionStore.saveResult).toHaveBeenCalledWith(
        'tool_123',
        expect.objectContaining({
          synthetic: true,
          status: 'cancelled',
          reason: 'Tool execution cancelled',
        }),
      )
    })

    it('should mark synthetic result with isSynthetic flag', async () => {
      const mockToolExecutionStore = {
        getById: vi.fn().mockReturnValue({
          toolCallId: 'tool_456',
          toolName: 'writeFile',
          status: 'executing',
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      } as unknown as CancellationCoordinatorConfig['toolExecutionStore']

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: {} as any,
        backgroundRunStore: {} as any,
        kernelRunStore: {} as any,
        eventStore: {
          append: vi.fn(),
        } as any,
      }

      const coordinator = createCancellationCoordinator(config)
      const syntheticResult = await coordinator.cancelTool('tool_456')

      expect(syntheticResult.isSynthetic).toBe(true)
      expect(syntheticResult.toolCallId).toBe('tool_456')
      expect(syntheticResult.status).toBe('cancelled')
    })

    it('should include side effect notice for external operations', async () => {
      const mockToolExecutionStore = {
        getById: vi.fn().mockReturnValue({
          toolCallId: 'tool_789',
          toolName: 'sendEmail',
          status: 'executing',
          category: 'write',
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      }

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: {} as any,
        backgroundRunStore: {} as any,
        kernelRunStore: {} as any,
        eventStore: { append: vi.fn() } as any,
      }

      const coordinator = createCancellationCoordinator(config)

      const request: CancellationRequest = {
        targetType: CANCELLATION_TARGET_TYPES.TOOL_EXECUTION,
        targetId: 'tool_789',
        cascade: false,
        reason: 'Timeout exceeded',
      }

      const result = await coordinator.cancel(request)

      expect(result.sideEffectNotice).toBeDefined()
      expect(result.sideEffectNotice?.externalSideEffectsMayHaveOccurred).toBe(true)
    })
  })

  describe('PlannerRun Cancellation - Cascade', () => {
    it('should cascade cancellation to active execution refs', async () => {
      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_1',
          status: 'planning',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_1', refType: 'tool_execution', status: 'running' },
              { refId: 'bg_1', refType: 'background_run', status: 'running' },
              { refId: 'kernel_1', refType: 'kernel_run', status: 'running' },
            ],
          },
        }),
        updateStatus: vi.fn(),
      }

      const mockToolExecutionStore = {
        getById: vi.fn((id: string) => ({ toolCallId: id, toolName: 'testTool', status: 'executing' })),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      } as unknown as CancellationCoordinatorConfig['toolExecutionStore']

      const mockBackgroundRunStore = {
        getById: vi.fn().mockReturnValue({ backgroundRunId: 'bg_1', status: 'running' }),
        updateStatus: vi.fn(),
      }

      const mockKernelRunStore = {
        getById: vi.fn().mockReturnValue({ kernelRunId: 'kernel_1', status: 'running', pendingToolCalls: [] }),
        updateStatus: vi.fn(),
      }

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: mockKernelRunStore,
        eventStore: {
          append: vi.fn(),
        } as any,
      }

      const coordinator = createCancellationCoordinator(config)

      const request: CancellationRequest = {
        targetType: CANCELLATION_TARGET_TYPES.PLANNER_RUN,
        targetId: 'planner_1',
        cascade: true,
        reason: 'User cancelled plan',
      }

      const result = await coordinator.cancel(request)

      expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
      expect(result.affectedRefs).toContain('planner_1')
      expect(result.affectedRefs).toContain('tool_1')
      expect(result.affectedRefs).toContain('bg_1')
      expect(result.affectedRefs).toContain('kernel_1')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledWith('tool_1', 'cancelled')
      expect(mockBackgroundRunStore.updateStatus).toHaveBeenCalledWith('bg_1', 'cancelled')
    })

    it('should mark partial cancellation when some refs fail to cancel', async () => {
      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'planner_2',
          status: 'planning',
          checkpoint: {
            activeExecutionRefs: [
              { refId: 'tool_1', refType: 'tool_execution', status: 'running' },
              { refId: 'tool_2', refType: 'tool_execution', status: 'completed' }, // Already terminal
            ],
          },
        }),
        updateStatus: vi.fn(),
      }

      const mockToolExecutionStore = {
        getById: vi.fn((id: string) => {
          if (id === 'tool_1') return { toolCallId: id, toolName: 'test', status: 'executing' }
          if (id === 'tool_2') return { toolCallId: id, toolName: 'test', status: 'completed' }
          return null
        }),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      } as unknown as CancellationCoordinatorConfig['toolExecutionStore']

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: mockPlannerRunStore,
        backgroundRunStore: {} as any,
        kernelRunStore: {} as any,
        eventStore: { append: vi.fn() } as any,
      }

      const coordinator = createCancellationCoordinator(config)

      const request: CancellationRequest = {
        targetType: CANCELLATION_TARGET_TYPES.PLANNER_RUN,
        targetId: 'planner_2',
        cascade: true,
        reason: 'Cancellation test',
      }

      const result = await coordinator.cancel(request)

      expect(result.status).toBe(CANCELLATION_STATUSES.PARTIAL)
      expect(result.partialRefs).toContain('tool_2')
    })
  })

  describe('Retry Policy Execution', () => {
    it('should retry on retryable errors with exponential backoff', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.EXPONENTIAL,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        retryableErrors: ['connector_rate_limited', 'timeout', 'model_error'],
      }

      let attemptCount = 0
      const mockOperation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          const error = new Error('Rate limited')
          ;(error as any).category = 'connector_rate_limited'
          ;(error as any).recoverability = 'retryable_later'
          throw error
        }
        return { success: true, data: 'result' }
      })

      const retryExecutor = createRetryExecutor({} as any)
      const result = await retryExecutor.executeWithRetry(
        { operation: mockOperation, operationName: 'testOp' },
        retryPolicy,
      )

      expect(result.success).toBe(true)
      expect(attemptCount).toBe(3)
      expect(mockOperation).toHaveBeenCalledTimes(3)
    })

    it('should not retry non-retryable errors', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        retryableErrors: ['timeout'],
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Permission denied')
        ;(error as any).category = 'permission_error'
        ;(error as any).recoverability = 'non_recoverable'
        throw error
      })

      const retryExecutor = createRetryExecutor({} as any)
      const result = await retryExecutor.executeWithRetry(
        { operation: mockOperation, operationName: 'testOp' },
        retryPolicy,
      )

      expect(result.success).toBe(false)
      expect(mockOperation).toHaveBeenCalledTimes(1) // No retries
    })

    it('should fail after max retries exceeded', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 2,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        initialDelayMs: 10,
        retryableErrors: ['timeout'],
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Timeout')
        ;(error as any).category = 'timeout'
        ;(error as any).recoverability = 'retryable_later'
        throw error
      })

      const retryExecutor = createRetryExecutor({} as any)
      const result = await retryExecutor.executeWithRetry(
        { operation: mockOperation, operationName: 'testOp' },
        retryPolicy,
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MAX_RETRIES_EXCEEDED')
      expect(mockOperation).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should use exponential backoff strategy correctly', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.EXPONENTIAL,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        retryableErrors: ['timeout'],
      }

      const delays: number[] = []
      const mockSleep = vi.fn().mockImplementation((ms: number) => {
        delays.push(ms)
        return Promise.resolve()
      })

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Timeout')
        ;(error as any).category = 'timeout'
        ;(error as any).recoverability = 'retryable_later'
        throw error
      })

      const config = {
        sleep: mockSleep,
      }

      const retryExecutor = createRetryExecutor(config)
      await retryExecutor.executeWithRetry({ operation: mockOperation, operationName: 'testOp' }, retryPolicy)

      // Exponential backoff: 100, 200, 400
      expect(delays[0]).toBe(100)
      expect(delays[1]).toBe(200)
      expect(delays[2]).toBe(400)
    })

    it('should use linear backoff strategy correctly', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.LINEAR,
        initialDelayMs: 100,
        retryableErrors: ['timeout'],
      }

      const delays: number[] = []
      const mockSleep = vi.fn().mockImplementation((ms: number) => {
        delays.push(ms)
        return Promise.resolve()
      })

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Timeout')
        ;(error as any).category = 'timeout'
        ;(error as any).recoverability = 'retryable_later'
        throw error
      })

      const config = {
        sleep: mockSleep,
      }

      const retryExecutor = createRetryExecutor(config)
      await retryExecutor.executeWithRetry({ operation: mockOperation, operationName: 'testOp' }, retryPolicy)

      // Linear backoff: 100, 200, 300
      expect(delays[0]).toBe(100)
      expect(delays[1]).toBe(200)
      expect(delays[2]).toBe(300)
    })
  })

  describe('Non-Idempotent Write Retry', () => {
    it('should require approval for non-idempotent write retry', async () => {
      const mockApprovalRequest = vi.fn().mockResolvedValue({ approved: false })

      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        retryableErrors: ['timeout'],
        requireApprovalBeforeRetry: true,
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Timeout during write')
        ;(error as any).category = 'timeout'
        ;(error as any).recoverability = 'retryable_later'
        throw error
      })

      const config = {
        requestApproval: mockApprovalRequest,
        isIdempotent: () => false, // Non-idempotent operation
      }

      const retryExecutor = createRetryExecutor(config)
      const result = await retryExecutor.executeWithRetry(
        {
          operation: mockOperation,
          operationName: 'writeFile',
          isWrite: true,
          isIdempotent: false,
        },
        retryPolicy,
      )

      expect(mockApprovalRequest).toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.requiresUserApproval).toBe(true)
    })

    it('should auto-retry idempotent writes without approval', async () => {
      let attemptCount = 0
      const mockApprovalRequest = vi.fn()

      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        initialDelayMs: 10,
        retryableErrors: ['timeout'],
        requireApprovalBeforeRetry: true,
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 2) {
          const error = new Error('Timeout')
          ;(error as any).category = 'timeout'
          ;(error as any).recoverability = 'retryable_later'
          throw error
        }
        return { success: true }
      })

      const config = {
        requestApproval: mockApprovalRequest,
      }

      const retryExecutor = createRetryExecutor(config)
      const result = await retryExecutor.executeWithRetry(
        {
          operation: mockOperation,
          operationName: 'writeConfig',
          isWrite: true,
          isIdempotent: true, // Idempotent
        },
        retryPolicy,
      )

      expect(mockApprovalRequest).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(attemptCount).toBe(2)
    })

    it('should fail safely when non-idempotent write retry is rejected', async () => {
      const mockApprovalRequest = vi.fn().mockResolvedValue({
        approved: false,
        reason: 'User declined retry of destructive operation',
      })

      const retryPolicy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        retryableErrors: ['timeout'],
        requireApprovalBeforeRetry: true,
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        const error = new Error('Timeout during delete')
        ;(error as any).category = 'timeout'
        ;(error as any).recoverability = 'retryable_later'
        throw error
      })

      const config = {
        requestApproval: mockApprovalRequest,
      }

      const retryExecutor = createRetryExecutor(config)
      const result = await retryExecutor.executeWithRetry(
        {
          operation: mockOperation,
          operationName: 'deleteFile',
          isWrite: true,
          isIdempotent: false,
        },
        retryPolicy,
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('RETRY_REJECTED')
      expect(result.failedDueToApproval).toBe(true)
    })
  })

  describe('Timeout Handling', () => {
    it('should handle operation timeout', async () => {
      const retryPolicy: RetryPolicy = {
        maxRetries: 1,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        initialDelayMs: 10,
        retryableErrors: ['timeout'],
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('Operation timed out')
            ;(error as any).category = 'timeout'
            ;(error as any).recoverability = 'retryable_later'
            reject(error)
          }, 5000) // Long operation
        })
      })

      const config = {
        timeoutMs: 100, // Short timeout
      }

      const retryExecutor = createRetryExecutor(config)
      const result = await retryExecutor.executeWithRetry(
        { operation: mockOperation, operationName: 'slowOp' },
        retryPolicy,
      )

      expect(result.success).toBe(false)
      expect(result.timedOut).toBe(true)
    })

    it('should cancel active operations on timeout', async () => {
      const mockCancelOperation = vi.fn().mockResolvedValue(undefined)

      const config = {
        cancelOperation: mockCancelOperation,
        timeoutMs: 50,
      }

      const mockOperation = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return { success: true }
      })

      const retryExecutor = createRetryExecutor(config)
      await retryExecutor.executeWithRetry(
        { operation: mockOperation, operationName: 'slowOp', cancelToken: 'op_123' },
        { maxRetries: 0, backoffStrategy: BACKOFF_STRATEGIES.NONE },
      )

      // Cancel should be called when timeout occurs
      expect(mockCancelOperation).toHaveBeenCalledWith('op_123')
    })
  })

  describe('KernelRun Cancellation', () => {
    it('should stop kernel and synthesize results for all pending tool calls', async () => {
      const mockKernelRunStore = {
        getById: vi.fn().mockReturnValue({
          kernelRunId: 'kernel_1',
          status: 'running',
          pendingToolCalls: ['tool_1', 'tool_2'],
        }),
        updateStatus: vi.fn(),
      }

      const mockToolExecutionStore = {
        getById: vi.fn((id: string) => ({ toolCallId: id, toolName: 'testTool', status: 'executing' })),
        updateStatus: vi.fn(),
        saveResult: vi.fn(),
      } as unknown as CancellationCoordinatorConfig['toolExecutionStore']

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: mockToolExecutionStore,
        plannerRunStore: {} as any,
        backgroundRunStore: {} as any,
        kernelRunStore: mockKernelRunStore,
        eventStore: { append: vi.fn() } as any,
      }

      const coordinator = createCancellationCoordinator(config)
      const result = await coordinator.cancelKernelRun('kernel_1')

      expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
      expect(mockKernelRunStore.updateStatus).toHaveBeenCalledWith('kernel_1', 'cancelled')
      expect(mockToolExecutionStore.updateStatus).toHaveBeenCalledTimes(2)
    })
  })

  describe('BackgroundRun Cancellation', () => {
    it('should mark background run as cancelled', async () => {
      const mockBackgroundRunStore = {
        getById: vi.fn().mockReturnValue({
          backgroundRunId: 'bg_1',
          status: 'running',
        }),
        updateStatus: vi.fn(),
      }

      const config: CancellationCoordinatorConfig = {
        toolExecutionStore: {} as any,
        plannerRunStore: {} as any,
        backgroundRunStore: mockBackgroundRunStore,
        kernelRunStore: {} as any,
        eventStore: { append: vi.fn() } as any,
      }

      const coordinator = createCancellationCoordinator(config)
      const result = await coordinator.cancelBackgroundRun('bg_1')

      expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
      expect(mockBackgroundRunStore.updateStatus).toHaveBeenCalledWith('bg_1', 'cancelled')
    })
  })

  describe('isRetryable helper', () => {
    it('should correctly identify retryable errors', () => {
      const retryExecutor = createRetryExecutor({} as any)
      const policy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        retryableErrors: ['timeout', 'connector_rate_limited'],
      }

      const timeoutError = { category: 'timeout', recoverability: 'retryable_later' }
      const rateLimitError = { category: 'connector_rate_limited', recoverability: 'retryable_later' }
      const permissionError = { category: 'permission_error', recoverability: 'non_recoverable' }

      expect(retryExecutor.isRetryable(timeoutError as any, policy)).toBe(true)
      expect(retryExecutor.isRetryable(rateLimitError as any, policy)).toBe(true)
      expect(retryExecutor.isRetryable(permissionError as any, policy)).toBe(false)
    })

    it('should respect doNotRetryOn list', () => {
      const retryExecutor = createRetryExecutor({} as any)
      const policy: RetryPolicy = {
        maxRetries: 3,
        backoffStrategy: BACKOFF_STRATEGIES.FIXED,
        retryableErrors: ['timeout', 'model_error'],
        doNotRetryOn: ['model_error'],
      }

      const timeoutError = { category: 'timeout', recoverability: 'retryable_later' }
      const modelError = { category: 'model_error', recoverability: 'retryable_later' }

      expect(retryExecutor.isRetryable(timeoutError as any, policy)).toBe(true)
      expect(retryExecutor.isRetryable(modelError as any, policy)).toBe(false)
    })
  })
})
