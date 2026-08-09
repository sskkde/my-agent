import { describe, it, expect, vi } from 'vitest'
import {
  handleCompletePlanner,
  COMPLETE_PLANNER_TOOL_ID,
} from '../../../../src/foreground/tools/planner-complete-tool.js'
import type { PlannerRuntime } from '../../../../src/planner/planner-runtime.js'

function makePlannerRuntime(
  result: { plannerRunId: string; planId: string; status: string; actions: unknown[]; steps: unknown[] } = {
    plannerRunId: 'pl_run_001',
    planId: 'plan_001',
    status: 'completed',
    actions: [],
    steps: [],
  },
): PlannerRuntime {
  return { completePlannerRun: vi.fn().mockReturnValue(result) } as unknown as PlannerRuntime
}

describe('planner-complete-tool', () => {
  describe('COMPLETE_PLANNER_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(COMPLETE_PLANNER_TOOL_ID).toBe('foreground_complete_planner')
    })
  })

  describe('handleCompletePlanner', () => {
    it('completes a planner run successfully and returns status completed', async () => {
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCompletePlanner(
        {
          plannerRuntime,
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001', summary: 'All steps done' },
      )

      expect(result.success).toBe(true)
      expect(result.data?.plannerRunId).toBe('pl_run_001')
      expect(result.data?.planId).toBe('plan_001')
      expect(result.data?.status).toBe('completed')
      expect(result.userVisibleSummary).toBe('计划已标记完成')
      expect(result.runtimeSummary?.plannerRunIds).toEqual(['pl_run_001'])
      expect(plannerRuntime.completePlannerRun).toHaveBeenCalledWith('pl_run_001', 'All steps done')
    })

    it('works without a summary and calls completePlannerRun with undefined', async () => {
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCompletePlanner(
        {
          plannerRuntime,
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001' },
      )

      expect(result.success).toBe(true)
      expect(result.data?.status).toBe('completed')
      expect(plannerRuntime.completePlannerRun).toHaveBeenCalledWith('pl_run_001', undefined)
    })

    it('returns COMPLETE_PLANNER_ERROR with recoverable=true when runtime throws', async () => {
      const plannerRuntime = {
        completePlannerRun: vi.fn().mockImplementation(() => {
          throw new Error('Cannot complete run in state: failed')
        }),
      } as unknown as PlannerRuntime

      const result = await handleCompletePlanner(
        {
          plannerRuntime,
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001', summary: 'done' },
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('COMPLETE_PLANNER_ERROR')
      expect(result.error?.message).toBe('Cannot complete run in state: failed')
      expect(result.error?.recoverable).toBe(true)
      expect(result.userVisibleSummary).toBe('标记计划完成失败')
    })

    it('uses fallback message for non-Error throws', async () => {
      const plannerRuntime = {
        completePlannerRun: vi.fn().mockImplementation(() => {
          throw 'unexpected failure'
        }),
      } as unknown as PlannerRuntime

      const result = await handleCompletePlanner(
        {
          plannerRuntime,
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001' },
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('COMPLETE_PLANNER_ERROR')
      expect(result.error?.message).toBe('Failed to complete planner run')
      expect(result.error?.recoverable).toBe(true)
      expect(result.userVisibleSummary).toBe('标记计划完成失败')
    })
  })
})
