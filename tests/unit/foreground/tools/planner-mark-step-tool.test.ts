import { describe, it, expect, vi } from 'vitest'
import {
  handleMarkPlannerStep,
  MARK_PLANNER_STEP_TOOL_ID,
  type MarkPlannerStepDeps,
  type MarkPlannerStepInput,
} from '../../../../src/foreground/tools/planner-mark-step-tool.js'
import type { PlannerRuntime } from '../../../../src/planner/planner-runtime.js'

function makePlannerRuntime(): PlannerRuntime {
  return { markStep: vi.fn() } as unknown as PlannerRuntime
}

function makeThrowingPlannerRuntime(message: string): PlannerRuntime {
  return {
    markStep: vi.fn().mockImplementation(() => {
      throw new Error(message)
    }),
  } as unknown as PlannerRuntime
}

describe('planner-mark-step-tool', () => {
  describe('MARK_PLANNER_STEP_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(MARK_PLANNER_STEP_TOOL_ID).toBe('foreground_mark_planner_step')
    })
  })

  describe('handleMarkPlannerStep', () => {
    const deps: MarkPlannerStepDeps = {
      plannerRuntime: makePlannerRuntime(),
      userId: 'user-1',
      sessionId: 'session-1',
    }

    it('marks a step completed and returns updated status', async () => {
      const plannerRuntime = makePlannerRuntime()

      const input: MarkPlannerStepInput = {
        plannerRunId: 'pl_run_001',
        stepId: 'step_001',
        status: 'completed',
        result: 'done',
      }

      const result = await handleMarkPlannerStep({ ...deps, plannerRuntime }, input)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        plannerRunId: 'pl_run_001',
        stepId: 'step_001',
        status: 'completed',
      })
      expect(result.userVisibleSummary).toBe('步骤状态已更新')
      expect(result.runtimeSummary?.plannerRunIds).toEqual(['pl_run_001'])
      expect(plannerRuntime.markStep).toHaveBeenCalledWith('pl_run_001', 'step_001', 'completed', 'done')
    })

    it('marks a step in_progress without a result argument', async () => {
      const plannerRuntime = makePlannerRuntime()

      const input: MarkPlannerStepInput = {
        plannerRunId: 'pl_run_001',
        stepId: 'step_002',
        status: 'in_progress',
      }

      const result = await handleMarkPlannerStep({ ...deps, plannerRuntime }, input)

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('in_progress')
      expect(plannerRuntime.markStep).toHaveBeenCalledWith('pl_run_001', 'step_002', 'in_progress', undefined)
    })

    it('returns recoverable MARK_STEP_ERROR when run is in a terminal state', async () => {
      const plannerRuntime = makeThrowingPlannerRuntime('Cannot mark step on run in terminal state: completed')

      const input: MarkPlannerStepInput = {
        plannerRunId: 'pl_run_001',
        stepId: 'step_001',
        status: 'completed',
      }

      const result = await handleMarkPlannerStep({ ...deps, plannerRuntime }, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MARK_STEP_ERROR')
      expect(result.error?.message).toBe('Cannot mark step on run in terminal state: completed')
      expect(result.error?.recoverable).toBe(true)
      expect(result.userVisibleSummary).toBe('更新步骤状态失败')
    })

    it('returns recoverable MARK_STEP_ERROR for an unknown stepId', async () => {
      const plannerRuntime = makeThrowingPlannerRuntime('Step not found: step_unknown')

      const input: MarkPlannerStepInput = {
        plannerRunId: 'pl_run_001',
        stepId: 'step_unknown',
        status: 'completed',
      }

      const result = await handleMarkPlannerStep({ ...deps, plannerRuntime }, input)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('MARK_STEP_ERROR')
      expect(result.error?.recoverable).toBe(true)
      expect(plannerRuntime.markStep).toHaveBeenCalledWith('pl_run_001', 'step_unknown', 'completed', undefined)
    })
  })
})
