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
    it('Planner spawn succeeds — returns queued background run with plan context', async () => {
      const templateSteps = [
        {
          stepId: 'step_001',
          description: 'Analyze objective: Create a backup plan',
          status: 'pending',
          dependencies: [],
        },
        {
          stepId: 'step_002',
          description: 'Execute required tool or agent action',
          status: 'pending',
          dependencies: ['step_001'],
        },
        {
          stepId: 'step_003',
          description: 'Summarize result and update session',
          status: 'pending',
          dependencies: ['step_002'],
        },
      ]

      const mockPlannerRuntime = {
        createPlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: templateSteps,
        }),
      } as unknown as PlannerRuntime

      const mockBackgroundRuntime = {
        enqueueBackgroundRun: vi.fn().mockReturnValue('bg-123'),
      }

      const mockPlannerRunStore = {
        updateBackgroundRunId: vi.fn(),
      }

      const deps: SpawnPlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore as never,
        backgroundRuntime: mockBackgroundRuntime as never,
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
        steps: templateSteps,
        backgroundRunId: 'bg-123',
        status: 'queued',
      })
      expect(result.data?.steps).toHaveLength(3)
      expect(
        result.data?.steps?.every(
          (step) =>
            typeof step.stepId === 'string' && typeof step.description === 'string' && typeof step.status === 'string',
        ),
      ).toBe(true)
      expect(result.userVisibleSummary).toContain('plan_456')
      expect(result.userVisibleSummary).toContain('background execution')
      expect(result.userVisibleSummary).not.toContain('foreground_mark_planner_step')
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
      expect(mockBackgroundRuntime.enqueueBackgroundRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'planner',
          agentProfile: 'planner',
          taskSpec: expect.objectContaining({
            profileId: 'planner',
            plannerRunId: 'pl_run_123',
            planId: 'plan_456',
            launchMode: 'background',
            parentSessionId: 'session-1',
          }),
          launchSource: 'main_agent_delegation',
        }),
      )
      expect(mockPlannerRunStore.updateBackgroundRunId).toHaveBeenCalledWith('pl_run_123', 'bg-123')
    })

    it('spawn succeeds without background runtime — falls back to planning status', async () => {
      const mockPlannerRuntime = {
        createPlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: [],
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

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('planning')
      expect(result.data?.backgroundRunId).toBeUndefined()
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
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalled()
    })

    it('resume re-enqueues a background planner child after resumePlannerRun succeeds', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: [],
        }),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'waiting_for_user',
          checkpoint: { step: 'execution', objective: 'Create a backup plan' },
        }),
      } as unknown as PlannerRunStore

      const mockBackgroundRuntime = {
        enqueueBackgroundRun: vi.fn().mockReturnValue('bg-resume-1'),
      }

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        backgroundRuntime: mockBackgroundRuntime as never,
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
        backgroundRunId: 'bg-resume-1',
      })
      expect(result.userVisibleSummary).toContain('re-queued')
      expect(mockPlannerRuntime.resumePlannerRun).toHaveBeenCalledWith('pl_run_123', {
        eventType: 'user_resume',
        payload: {
          userMessage: 'Please continue',
          timestamp: '2024-01-01T00:00:00Z',
        },
      })
      expect(mockBackgroundRuntime.enqueueBackgroundRun).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          sessionId: 'session-1',
          agentType: 'planner',
          agentProfile: 'planner',
          taskSpec: expect.objectContaining({
            objective: 'Create a backup plan',
            profileId: 'planner',
            plannerRunId: 'pl_run_123',
            planId: 'plan_456',
            parentSessionId: 'session-1',
            launchMode: 'background',
            maxIterations: 12,
            timeoutMs: 180_000,
          }),
          launchSource: 'main_agent_delegation',
        }),
      )
    })

    it('resume reuses the prior child session taskId when the linked background run is resumable', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: [],
        }),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'waiting_for_user',
          checkpoint: { step: 'execution', objective: 'Create a backup plan' },
          backgroundRunId: 'bg-123',
        }),
      } as unknown as PlannerRunStore

      const mockBackgroundRuntime = {
        enqueueBackgroundRun: vi.fn().mockReturnValue('bg-resume-2'),
      }
      const mockBackgroundRunStore = {
        getById: vi.fn().mockReturnValue({ backgroundRunId: 'bg-123', taskId: 'sess_child_1' }),
      }
      const mockSessionStore = {
        getChildSessionById: vi.fn().mockReturnValue({ sessionId: 'sess_child_1', status: 'active' }),
      }

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        backgroundRuntime: mockBackgroundRuntime as never,
        backgroundRunStore: mockBackgroundRunStore as never,
        sessionStore: mockSessionStore as never,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const result = await handleResumePlanner(deps, {
        plannerRunId: 'pl_run_123',
        userMessage: 'continue',
        timestamp: '2024-01-01T00:00:00Z',
      })

      expect(result.success).toBe(true)
      expect(mockBackgroundRunStore.getById).toHaveBeenCalledWith('bg-123')
      expect(mockSessionStore.getChildSessionById).toHaveBeenCalledWith('sess_child_1')
      expect(mockBackgroundRuntime.enqueueBackgroundRun).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'sess_child_1' }),
      )
    })

    it('resume falls back to a fresh child session when the prior child session is archived', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: [],
        }),
      } as unknown as PlannerRuntime

      const mockPlannerRunStore = {
        getById: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          userId: 'user-1',
          status: 'waiting_for_user',
          checkpoint: { step: 'execution', objective: 'Create a backup plan' },
          backgroundRunId: 'bg-123',
        }),
      } as unknown as PlannerRunStore

      const mockBackgroundRuntime = {
        enqueueBackgroundRun: vi.fn().mockReturnValue('bg-resume-3'),
      }
      const mockBackgroundRunStore = {
        getById: vi.fn().mockReturnValue({ backgroundRunId: 'bg-123', taskId: 'sess_child_1' }),
      }
      const mockSessionStore = {
        getChildSessionById: vi.fn().mockReturnValue({ sessionId: 'sess_child_1', status: 'archived' }),
      }

      const deps: ResumePlannerDeps = {
        plannerRuntime: mockPlannerRuntime,
        plannerRunStore: mockPlannerRunStore,
        backgroundRuntime: mockBackgroundRuntime as never,
        backgroundRunStore: mockBackgroundRunStore as never,
        sessionStore: mockSessionStore as never,
        userId: 'user-1',
        sessionId: 'session-1',
      }

      const result = await handleResumePlanner(deps, {
        plannerRunId: 'pl_run_123',
        userMessage: 'continue',
        timestamp: '2024-01-01T00:00:00Z',
      })

      expect(result.success).toBe(true)
      expect(mockBackgroundRuntime.enqueueBackgroundRun).toHaveBeenCalledWith(
        expect.not.objectContaining({ taskId: expect.any(String) }),
      )
    })

    it('resume without a background runtime skips re-enqueue and still succeeds', async () => {
      const mockPlannerRuntime = {
        resumePlannerRun: vi.fn().mockReturnValue({
          plannerRunId: 'pl_run_123',
          planId: 'plan_456',
          status: 'planning',
          actions: [],
          steps: [],
        }),
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

      const result = await handleResumePlanner(deps, {
        plannerRunId: 'pl_run_123',
        userMessage: 'continue',
        timestamp: '2024-01-01T00:00:00Z',
      })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        plannerRunId: 'pl_run_123',
        status: 'resumed',
      })
      expect(result.data?.backgroundRunId).toBeUndefined()
    })
  })
})
