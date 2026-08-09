import { describe, it, expect, vi } from 'vitest'
import { handleStatusQuery, STATUS_QUERY_TOOL_ID } from '../../../../src/foreground/tools/status-query-tool.js'
import { createStatusQueryTool, type StatusQueryResult } from '../../../../src/tools/builtins/status-query.js'
import type { ToolExecutionContext } from '../../../../src/tools/types.js'
import type { PlannerRunStore, PlannerRunRecord } from '../../../../src/storage/planner-run-store.js'
import type { PlanStore, ExecutionPlanRecord, PlanStep } from '../../../../src/storage/plan-store.js'
import type { SubagentRunStore, SubagentRunRecord } from '../../../../src/storage/subagent-run-store.js'
import type { ApprovalStore, ApprovalRequest } from '../../../../src/storage/approval-store.js'

function makePlannerStore(records: Partial<PlannerRunRecord>[]): PlannerRunStore {
  return { findByUser: vi.fn().mockReturnValue(records) } as unknown as PlannerRunStore
}

function makeSubagentStore(records: Partial<SubagentRunRecord>[]): SubagentRunStore {
  return { query: vi.fn().mockReturnValue(records) } as unknown as SubagentRunStore
}

function makeApprovalStore(records: Partial<ApprovalRequest>[]): ApprovalStore {
  return { findByUser: vi.fn().mockReturnValue(records) } as unknown as ApprovalStore
}

describe('status-query-tool', () => {
  describe('STATUS_QUERY_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(STATUS_QUERY_TOOL_ID).toBe('foreground_status_query')
    })
  })

  describe('handleStatusQuery', () => {
    it('returns active work counts when planner, subagent, and approval are active', async () => {
      const deps = {
        plannerRunStore: makePlannerStore([
          { status: 'planning' } as Partial<PlannerRunRecord>,
          { status: 'replanning' } as Partial<PlannerRunRecord>,
          { status: 'completed' } as Partial<PlannerRunRecord>,
        ]),
        subagentRunStore: makeSubagentStore([
          { status: 'running' } as Partial<SubagentRunRecord>,
          { status: 'queued' } as Partial<SubagentRunRecord>,
        ]),
        approvalStore: makeApprovalStore([{ status: 'pending' } as Partial<ApprovalRequest>]),
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const result = await handleStatusQuery(deps)

      expect(result.success).toBe(true)
      expect(result.data?.activePlannerRuns).toBe(2)
      expect(result.data?.activeSubagentRuns).toBe(2)
      expect(result.data?.pendingApprovals).toBe(1)
      expect(result.data?.statusText).toContain('2 active planner run(s)')
      expect(result.data?.statusText).toContain('2 active subagent run(s)')
      expect(result.data?.statusText).toContain('1 pending approval(s)')
    })

    it('returns "no active work" when nothing is active', async () => {
      const deps = {
        plannerRunStore: makePlannerStore([{ status: 'completed' } as Partial<PlannerRunRecord>]),
        subagentRunStore: makeSubagentStore([{ status: 'completed' } as Partial<SubagentRunRecord>]),
        approvalStore: makeApprovalStore([{ status: 'approved' } as Partial<ApprovalRequest>]),
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const result = await handleStatusQuery(deps)

      expect(result.success).toBe(true)
      expect(result.data?.activePlannerRuns).toBe(0)
      expect(result.data?.activeSubagentRuns).toBe(0)
      expect(result.data?.pendingApprovals).toBe(0)
      expect(result.data?.statusText).toBe('No active work. All clear.')
    })

    it('uses custom user message when provided', async () => {
      const deps = {
        plannerRunStore: makePlannerStore([]),
        subagentRunStore: makeSubagentStore([]),
        approvalStore: makeApprovalStore([]),
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const customMessage = 'Checking your current work status...'
      const result = await handleStatusQuery(deps, customMessage)

      expect(result.success).toBe(true)
      expect(result.userVisibleSummary).toBe(customMessage)
    })

    it('returns recoverable error on store exception', async () => {
      const deps = {
        plannerRunStore: {
          findByUser: vi.fn().mockImplementation(() => {
            throw new Error('DB connection lost')
          }),
        } as unknown as PlannerRunStore,
        subagentRunStore: makeSubagentStore([]),
        approvalStore: makeApprovalStore([]),
        userId: 'user-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }

      const result = await handleStatusQuery(deps)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('STATUS_QUERY_FAILED')
      expect(result.error?.message).toBe('DB connection lost')
      expect(result.error?.recoverable).toBe(true)
      expect(result.userVisibleSummary).toBe('Status check failed due to an error.')
    })
  })

  describe('createStatusQueryTool (builtin status_query)', () => {
    function makeRun(plannerRunId: string, planId: string, status: PlannerRunRecord['status']): PlannerRunRecord {
      return {
        plannerRunId,
        planId,
        userId: 'user-1',
        status,
        checkpoint: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    }

    function makePlan(planId: string, objective: string, steps: PlanStep[]): ExecutionPlanRecord {
      return {
        planId,
        userId: 'user-1',
        objective,
        status: 'in_execution',
        currentVersion: 1,
        steps,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    }

    function makePlannerStore(runs: PlannerRunRecord[]): PlannerRunStore {
      return {
        getById: (plannerRunId: string) => runs.find((r) => r.plannerRunId === plannerRunId) ?? null,
        findActive: (userId: string) => runs.filter((r) => r.userId === userId),
      } as unknown as PlannerRunStore
    }

    function makePlanStore(plans: Record<string, ExecutionPlanRecord>): PlanStore {
      return { getPlan: (planId: string) => plans[planId] ?? null } as unknown as PlanStore
    }

    function mockContext(userId = 'user-1'): ToolExecutionContext {
      return {
        toolCallId: 'tc-status-builtin',
        toolName: 'status_query',
        userId,
        permissionContext: { userId, sessionId: 'session-1', mode: 'ask_on_write', grants: [] },
        executionStartTime: new Date().toISOString(),
        stores: {
          toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} },
        },
      }
    }

    it('targetId hit returns real status, objective and computed progress', async () => {
      const run = makeRun('pl_run_1', 'plan_1', 'planning')
      const plan = makePlan('plan_1', '生成工作区报告', [
        { stepId: 's1', description: 'first', status: 'completed' },
        { stepId: 's2', description: 'second', status: 'pending' },
      ])
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([run]),
        planStore: makePlanStore({ plan_1: plan }),
      })

      const result = await tool.handler({ targetId: 'pl_run_1' }, mockContext())

      expect(result.success).toBe(true)
      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns).toEqual([
        { plannerRunId: 'pl_run_1', status: 'planning', objective: '生成工作区报告', progress: '50%' },
      ])
    })

    it('targetId hit reports 0% when no step is completed', async () => {
      const run = makeRun('pl_run_1', 'plan_1', 'planning')
      const plan = makePlan('plan_1', 'objective', [
        { stepId: 's1', description: 'first', status: 'pending' },
        { stepId: 's2', description: 'second', status: 'in_progress' },
        { stepId: 's3', description: 'third', status: 'failed' },
      ])
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([run]),
        planStore: makePlanStore({ plan_1: plan }),
      })

      const result = await tool.handler({ targetId: 'pl_run_1' }, mockContext())

      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns[0]!.progress).toBe('0%')
    })

    it('targetId hit reports 100% when all steps are completed', async () => {
      const run = makeRun('pl_run_1', 'plan_1', 'completed')
      const plan = makePlan('plan_1', 'objective', [
        { stepId: 's1', description: 'first', status: 'completed' },
        { stepId: 's2', description: 'second', status: 'completed' },
      ])
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([run]),
        planStore: makePlanStore({ plan_1: plan }),
      })

      const result = await tool.handler({ targetId: 'pl_run_1' }, mockContext())

      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns[0]).toEqual({
        plannerRunId: 'pl_run_1',
        status: 'completed',
        objective: 'objective',
        progress: '100%',
      })
    })

    it('targetId hit reports 0% for a plan with zero steps (divide-by-zero guard)', async () => {
      const run = makeRun('pl_run_1', 'plan_1', 'planning')
      const plan = makePlan('plan_1', 'objective', [])
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([run]),
        planStore: makePlanStore({ plan_1: plan }),
      })

      const result = await tool.handler({ targetId: 'pl_run_1' }, mockContext())

      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns[0]!.progress).toBe('0%')
    })

    it('targetId hit keeps real status but reports 0% and no objective when the plan is missing', async () => {
      const run = makeRun('pl_run_1', 'missing_plan', 'planning')
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([run]),
        planStore: makePlanStore({}),
      })

      const result = await tool.handler({ targetId: 'pl_run_1' }, mockContext())

      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns).toEqual([{ plannerRunId: 'pl_run_1', status: 'planning', progress: '0%' }])
    })

    it('targetId miss returns an empty plannerRuns list with a stable envelope', async () => {
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([]),
        planStore: makePlanStore({}),
      })

      const result = await tool.handler({ targetId: 'pl_unknown' }, mockContext())

      expect(result.success).toBe(true)
      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns).toEqual([])
      expect(data.activeWork.backgroundRuns).toEqual([])
      expect(data.activeWork.pendingApprovals).toEqual([])
    })

    it('no targetId returns the active planner runs list excluding terminal states', async () => {
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([
          makeRun('pl_act_1', 'plan_a', 'planning'),
          makeRun('pl_act_2', 'plan_b', 'replanning'),
          makeRun('pl_done', 'plan_c', 'completed'),
          makeRun('pl_failed', 'plan_d', 'failed'),
          makeRun('pl_cancelled', 'plan_e', 'cancelled'),
        ]),
      })

      const result = await tool.handler({}, mockContext())

      expect(result.success).toBe(true)
      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns).toEqual([
        { plannerRunId: 'pl_act_1', status: 'planning' },
        { plannerRunId: 'pl_act_2', status: 'replanning' },
      ])
    })

    it('no targetId returns an empty list when the execution context has no userId', async () => {
      const tool = createStatusQueryTool({
        plannerRunStore: makePlannerStore([makeRun('pl_act_1', 'plan_a', 'planning')]),
      })

      const result = await tool.handler({}, {} as unknown as ToolExecutionContext)

      const data = result.data as StatusQueryResult
      expect(data.activeWork.plannerRuns).toEqual([])
    })

    it('stub mode without deps preserves the legacy placeholder behavior', async () => {
      const tool = createStatusQueryTool()

      const hit = await tool.handler({ targetId: 'run_123' }, mockContext())
      const hitData = hit.data as StatusQueryResult
      expect(hitData.activeWork.plannerRuns).toEqual([
        { plannerRunId: 'run_123', status: 'active', objective: 'Task in progress', progress: '50%' },
      ])

      const list = await tool.handler({}, mockContext())
      const listData = list.data as StatusQueryResult
      expect(listData.activeWork.plannerRuns).toEqual([])
      expect(list.resultPreview).toContain('Active work status')
    })
  })
})
