import { describe, it, expect, vi } from 'vitest'
import {
  handleSpawnPlanner,
  SPAWN_PLANNER_TOOL_ID,
  type SpawnPlannerDeps,
  type SpawnPlannerInput,
} from '../../../../src/foreground/tools/planner-spawn-tool.js'
import {
  handleResumePlanner,
  RESUME_PLANNER_TOOL_ID,
  type ResumePlannerDeps,
  type ResumePlannerInput,
} from '../../../../src/foreground/tools/planner-resume-tool.js'
import type { PlannerRuntime } from '../../../../src/planner/planner-runtime.js'
import type { PlannerRunStore } from '../../../../src/storage/planner-run-store.js'

describe('Planner Tools', () => {
  describe('SPAWN_PLANNER_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(SPAWN_PLANNER_TOOL_ID).toBe('foreground_spawn_planner')
    })
  })

  describe('handleSpawnPlanner', () => {
    it('Planner spawn succeeds — returns plannerRunId', async () => {
      const mockPlannerRuntime = {
        createPlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'initializing',
          actions: [],
        }),
      } as unknown as PlannerRuntime

      const deps: SpawnPlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: SpawnPlannerInput = {
        objective: 'Create a backup plan',
        estimatedSteps: 5,
        complexity: 'medium',
        reason: 'User requested backup',
      }

      const result = await handleSpawnPlanner(deps, input)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        plannerRunId: 'pl_run_123',
        planId: 'plan_456',
        estimatedSteps: 5,
      })
      expect(result.userVisibleSummary).toContain('plan_456')
      expect(result.runtimeSummary?.plannerRunIds).toEqual(['pl_run_123'])
      expect(mockPlannerRuntime.createPlannerRun).toHaveBeenCalledWith({
        objective: 'Create a backup plan',
        userId: 'user-1',
        sessionId: 'session-1',
        contextBundle: {
          estimatedSteps: 5,
          complexity: 'medium',
          reason: 'User requested backup',
        },
      })
    })

    it('returns error when createPlannerRun throws', async () => {
      const mockPlannerRuntime = {
        createPlannerRun: vi.fn().mockImplementation(() => {
          throw new Error('Failed to create planner run')
        }),
      } as unknown as PlannerRuntime

      const deps: SpawnPlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: SpawnPlannerInput = {
        objective: 'Test objective',
      }

      const result = await handleSpawnPlanner(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SPAWN_PLANNER_ERROR')
      expect(result.error?.message).toBe('Failed to create planner run')
      expect(result.error?.recoverable).toBe(true)
    })
  })

  describe('RESUME_PLANNER_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(RESUME_PLANNER_TOOL_ID).toBe('foreground_resume_planner')
    })
  })

  describe('handleResumePlanner', () => {
    it('Planner resume succeeds for authorized planner', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'waiting_for_user',
        }),
      } as unknown as PlannerRunStore

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: ResumePlannerInput = {
        plannerRunId: 'pl_run_123',
        userMessage: 'Please continue',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const result = await handleResumePlanner(deps, input)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        plannerRunId: 'pl_run_123',
        status: 'resumed',
      })
      expect(result.userVisibleSummary).toContain('resumed')
      expect(result.runtimeSummary?.plannerRunIds).toEqual(['pl_run_123'])
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledWith('pl_run_123', {
        eventType: 'user_resume',
        payload: {
          userMessage: 'Please continue',
          timestamp: '2024-01-01T00:00:00Z',
        },
      })
    })

    it('Unauthorized resume is rejected — no runtime action', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-2',
          status: 'waiting_for_user',
        }),
      } as unknown as PlannerRunStore

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: ResumePlannerInput = {
        plannerRunId: 'pl_run_123',
        userMessage: 'Please continue',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const result = await handleResumePlanner(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('UNAUTHORIZED_PLANNER_ACCESS')
      expect(result.error?.recoverable).toBe(false)
      expect(mockPlannerRuntime.resumePlannerRun).not.toHaveBeenCalled()
    })

    it('Resume with non-existent planner returns PLANNER_NOT_FOUND', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue(null),
      } as unknown as PlannerRunStore

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: ResumePlannerInput = {
        plannerRunId: 'pl_run_nonexistent',
        userMessage: 'Please continue',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const result = await handleResumePlanner(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PLANNER_NOT_FOUND')
      expect(result.error?.recoverable).toBe(false)
      expect(mockPlannerRuntime.resumePlannerRun).not.toHaveBeenCalled()
    })

    it('Resume with missing plannerRunId returns error', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn(),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue(null),
      } as unknown as PlannerRunStore

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: ResumePlannerInput = {
        plannerRunId: '',
        userMessage: 'Please continue',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const result = await handleResumePlanner(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PLANNER_NOT_FOUND')
      expect(mockPlannerRuntime.resumePlannerRun).not.toHaveBeenCalled()
    })

    it('returns error when resumePlannerRun throws', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn().mockImplementation(() => {
          throw new Error('Cannot resume from state: completed')
        }),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'completed',
        }),
      } as unknown as PlannerRunStore

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const input: ResumePlannerInput = {
        plannerRunId: 'pl_run_123',
        userMessage: 'Please continue',
        timestamp: '2024-01-01T00:00:00Z',
      }

      const result = await handleResumePlanner(deps, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('RESUME_PLANNER_ERROR')
      expect(result.error?.message).toContain('Cannot resume from state')
      expect(result.error?.recoverable).toBe(true)
    })
  })
})
