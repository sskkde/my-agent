import { describe, it, expect, vi } from 'vitest'
import { handleCancelPlanner, CANCEL_PLANNER_TOOL_ID } from '../../../../src/foreground/tools/cancel-planner-tool.js'
import type { PlannerRunStore, PlannerRunRecord } from '../../../../src/storage/planner-run-store.js'
import type { PlannerRuntime } from '../../../../src/planner/planner-runtime.js'

function makePlannerRun(overrides: Partial<PlannerRunRecord> = {}): PlannerRunRecord {
  return {
    plannerRunId: 'pl_run_001',
    planId: 'plan_001',
    userId: 'user-1',
    checkpoint: '{}',
    status: 'planning',
    ...overrides,
  } as PlannerRunRecord
}

function makePlannerRunStore(run: PlannerRunRecord | null): PlannerRunStore {
  return { getById: vi.fn().mockReturnValue(run) } as unknown as PlannerRunStore
}

function makePlannerRuntime(): PlannerRuntime {
  return { cancelPlannerRun: vi.fn() } as unknown as PlannerRuntime
}

describe('cancel-planner-tool', () => {
  describe('CANCEL_PLANNER_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(CANCEL_PLANNER_TOOL_ID).toBe('foreground_cancel_planner')
    })
  })

  describe('handleCancelPlanner', () => {
    it('cancels an active planner run successfully', async () => {
      const run = makePlannerRun()
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCancelPlanner(
        {
          plannerRuntime,
          plannerRunStore: makePlannerRunStore(run),
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001', reason: 'No longer needed' },
      )

      expect(result.success).toBe(true)
      expect(result.data?.plannerRunId).toBe('pl_run_001')
      expect(result.data?.status).toBe('cancelled')
      expect(plannerRuntime.cancelPlannerRun).toHaveBeenCalledWith('pl_run_001')
    })

    it('returns error when planner run not found', async () => {
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCancelPlanner(
        {
          plannerRuntime,
          plannerRunStore: makePlannerRunStore(null),
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_nonexistent' },
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PLANNER_NOT_FOUND')
      expect(result.error?.recoverable).toBe(false)
      expect(plannerRuntime.cancelPlannerRun).not.toHaveBeenCalled()
    })

    it('returns error when planner run belongs to another user', async () => {
      const run = makePlannerRun({ userId: 'other-user' })
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCancelPlanner(
        {
          plannerRuntime,
          plannerRunStore: makePlannerRunStore(run),
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001' },
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('UNAUTHORIZED')
      expect(result.error?.recoverable).toBe(false)
      expect(plannerRuntime.cancelPlannerRun).not.toHaveBeenCalled()
    })

    it('returns error when plannerRuntime throws', async () => {
      const run = makePlannerRun()
      const plannerRuntime = {
        cancelPlannerRun: vi.fn().mockImplementation(() => {
          throw new Error('Runtime connection lost')
        }),
      } as unknown as PlannerRuntime

      const result = await handleCancelPlanner(
        {
          plannerRuntime,
          plannerRunStore: makePlannerRunStore(run),
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001' },
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('CANCEL_PLANNER_ERROR')
      expect(result.error?.message).toBe('Runtime connection lost')
      expect(result.error?.recoverable).toBe(false)
    })

    it('works without a reason parameter', async () => {
      const run = makePlannerRun()
      const plannerRuntime = makePlannerRuntime()

      const result = await handleCancelPlanner(
        {
          plannerRuntime,
          plannerRunStore: makePlannerRunStore(run),
          userId: 'user-1',
          sessionId: 'session-1',
        },
        { plannerRunId: 'pl_run_001' },
      )

      expect(result.success).toBe(true)
      expect(plannerRuntime.cancelPlannerRun).toHaveBeenCalledWith('pl_run_001')
    })
  })
})
