import { describe, it, expect, vi } from 'vitest'
import { handleStatusQuery, STATUS_QUERY_TOOL_ID } from '../../../../src/foreground/tools/status-query-tool.js'
import type { PlannerRunStore, PlannerRunRecord } from '../../../../src/storage/planner-run-store.js'
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
        approvalStore: makeApprovalStore([
          { status: 'pending' } as Partial<ApprovalRequest>,
        ]),
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
})
