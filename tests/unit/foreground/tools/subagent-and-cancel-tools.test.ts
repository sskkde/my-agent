import { describe, it, expect, vi } from 'vitest'
import {
  handleLaunchSubagent,
  LAUNCH_SUBAGENT_TOOL_ID,
  type LaunchSubagentDeps,
  type LaunchSubagentInput,
} from '../../../../src/foreground/tools/subagent-launch-tool.js'
import {
  handleCancelOrModifyTask,
  CANCEL_MODIFY_TOOL_ID,
  type CancelModifyDeps,
  type CancelModifyInput,
} from '../../../../src/foreground/tools/cancel-modify-task-tool.js'
import type { RuntimeDispatcher, DispatchResult } from '../../../../src/dispatcher/types.js'
import type { PlannerRunStore } from '../../../../src/storage/planner-run-store.js'
import type { SubagentRunStore } from '../../../../src/storage/subagent-run-store.js'

describe('Subagent Launch Tool', () => {
  describe('LAUNCH_SUBAGENT_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(LAUNCH_SUBAGENT_TOOL_ID).toBe('foreground_launch_subagent')
    })
  })

  describe('handleLaunchSubagent', () => {
    it('Subagent launch returns runtime action — server-created, dispatched', async () => {
      const mockDispatchResult: DispatchResult = {
        requestId: 'turn-1',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'subagent_runtime',
        createdAt: '2024-01-01T00:00:00Z',
      }

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: LaunchSubagentInput = {
        objective: 'Process the PDF document',
        agentType: 'document_processor',
        suggestedTools: ['pdf_reader', 'summarizer'],
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.agentType).toBe('document_processor')
      expect(result.data?.runtimeActionId).toBeDefined()
      expect(result.data?.dispatchResult).toEqual(mockDispatchResult)
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1)
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled()
    })

    it('Subagent launch failure returns error', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockRejectedValue(new Error('Subagent runtime unavailable')),
      } as unknown as RuntimeDispatcher

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: LaunchSubagentInput = {
        objective: 'Process the document',
        agentType: 'document_processor',
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('DISPATCH_SUBAGENT_ERROR')
      expect(result.error?.message).toBe('Subagent runtime unavailable')
      expect(result.error?.recoverable).toBe(false)
    })

    it('Infers agent type when not provided', async () => {
      const mockDispatchResult: DispatchResult = {
        requestId: 'turn-1',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'subagent_runtime',
        createdAt: '2024-01-01T00:00:00Z',
      }

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher

      const deps: LaunchSubagentDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: LaunchSubagentInput = {
        objective: 'Analyze this pdf document',
        agentType: '',
      }

      const result = await handleLaunchSubagent(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.agentType).toBe('document_processor')
    })
  })
})

describe('Cancel/Modify Task Tool', () => {
  describe('CANCEL_MODIFY_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(CANCEL_MODIFY_TOOL_ID).toBe('foreground_cancel_or_modify_task')
    })
  })

  describe('handleCancelOrModifyTask', () => {
    it('Cross-user cancellation rejected — no task state mutation', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn(),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-2',
          status: 'running',
        }),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        plannerRunId: 'pl_run_123',
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('UNAUTHORIZED_CANCEL')
      expect(result.error?.recoverable).toBe(false)
      expect(mockRuntimeDispatcher.dispatch).not.toHaveBeenCalled()
    })

    it('Invalid state modification rejected', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn(),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue(null),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        plannerRunId: 'pl_run_nonexistent',
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TASK_NOT_FOUND')
      expect(result.error?.recoverable).toBe(true)
      expect(mockRuntimeDispatcher.dispatch).not.toHaveBeenCalled()
    })

    it('Authorized planner cancellation succeeds', async () => {
      const mockDispatchResult: DispatchResult = {
        requestId: 'turn-1',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'planner_runtime',
        createdAt: '2024-01-01T00:00:00Z',
      }

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'running',
        }),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        plannerRunId: 'pl_run_123',
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.actionType).toBe('cancel_planner_run')
      expect(result.data?.targetRef.runId).toBe('pl_run_123')
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1)
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled()
    })

    it('Authorized subagent cancellation succeeds', async () => {
      const mockDispatchResult: DispatchResult = {
        requestId: 'turn-1',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'subagent_runtime',
        createdAt: '2024-01-01T00:00:00Z',
      }

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn(),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn().mockReturnValue({
          subagentRunId: 'sub_run_123',
          userId: 'user-1',
          status: 'running',
          agentType: 'document_processor',
          taskSpecJson: '{}',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        }),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        runtimeActionId: 'sub_run_123',
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.actionType).toBe('cancel_background_subagent')
      expect(result.data?.targetRef.runId).toBe('sub_run_123')
      expect(mockRuntimeDispatcher.dispatch).toHaveBeenCalled()
    })

    it('Pause operation succeeds for authorized user', async () => {
      const mockDispatchResult: DispatchResult = {
        requestId: 'turn-1',
        actionId: 'action-123',
        status: 'completed',
        targetRuntime: 'planner_runtime',
        createdAt: '2024-01-01T00:00:00Z',
      }

      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockResolvedValue(mockDispatchResult),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'running',
        }),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        plannerRunId: 'pl_run_123',
        reason: 'User requested pause',
        interruptType: 'pause',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(true)
      expect(result.data?.actionType).toBe('pause_planner_run')
    })

    it('Missing target ID returns error', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn(),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn(),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TASK_NOT_FOUND')
      expect(result.error?.recoverable).toBe(true)
      expect(mockRuntimeDispatcher.dispatch).not.toHaveBeenCalled()
    })

    it('Dispatch failure returns error', async () => {
      const mockRuntimeDispatcher = {
        dispatch: vi.fn().mockRejectedValue(new Error('Dispatcher unavailable')),
      } as unknown as RuntimeDispatcher

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'running',
        }),
      } as unknown as PlannerRunStore

      const mockSubagentRunStore = {
        getById: vi.fn(),
      } as unknown as SubagentRunStore

      const deps: CancelModifyDeps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        plannerRunStore: mockPlannerRunStore,
        subagentRunStore: mockSubagentRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const input: CancelModifyInput = {
        plannerRunId: 'pl_run_123',
        reason: 'User requested cancellation',
        interruptType: 'cancel',
      }

      const result = await handleCancelOrModifyTask(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('CANCEL_MODIFY_ERROR')
      expect(result.error?.message).toBe('Dispatcher unavailable')
      expect(result.error?.recoverable).toBe(false)
    })
  })
})
