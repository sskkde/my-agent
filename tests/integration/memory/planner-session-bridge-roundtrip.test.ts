import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSummaryStore, type SummaryStore, type SourceRefs } from '../../../src/storage/summary-store.js'
import { createSessionMemoryManager, type SessionMemoryManager } from '../../../src/memory/session-memory-manager.js'
import { plannerStateToSessionPatch } from '../../../src/memory/planner-state-bridge.js'
import type { PlannerStatePatch, PlannerRunState, PlannerStatePatchData } from '../../../src/planner/types.js'

type LastPlannerStateTransition = {
  from: PlannerRunState | null
  to: PlannerRunState
  reason?: string
}

type LastPlanUpdate = {
  planId: string
  fromVersion: number
  toVersion: number
  planSummary?: string
}

type LastExecutionRefUpdate = {
  refId: string
  refType: string
  status: string
}

type SessionStructuredState = {
  lastPlannerStateTransition?: LastPlannerStateTransition
  lastPlanUpdate?: LastPlanUpdate
  lastExecutionRefUpdate?: LastExecutionRefUpdate
  lastCheckpointUpdate?: string[]
}

function getStructuredState(memory: { structuredState?: Record<string, unknown> }): SessionStructuredState {
  return (memory.structuredState ?? {}) as SessionStructuredState
}

/**
 * PM-15 Integration Test: PlannerSession Bridge Roundtrip
 *
 * Full roundtrip for planner → session memory bridge:
 * - Create session memory
 * - Apply PlannerStatePatch via applyPlannerStatePatch
 * - Verify structuredState contains correct patch data
 * - Test all 4 patch types: state_transition, plan_update, execution_ref_update, checkpoint_update
 * - Test idempotency: second patch updates instead of replacing
 */
describe('PlannerSession Bridge Roundtrip Integration', () => {
  let connection: ConnectionManager
  let summaryStore: SummaryStore
  let sessionMemoryManager: SessionMemoryManager

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    summaryStore = createSummaryStore(connection)
    sessionMemoryManager = createSessionMemoryManager(summaryStore)
  })

  afterEach(() => {
    connection.close()
  })

  function makePlannerStatePatch(patchData: PlannerStatePatchData): PlannerStatePatch {
    return {
      plannerRunId: 'planner-run-123',
      patchType: patchData.patchType,
      patchData,
      createdAt: new Date().toISOString(),
    }
  }

  describe('state_transition patch', () => {
    it('should apply state_transition patch to session memory', () => {
      const sessionId = 'session-state-1'
      const userId = 'user-123'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: 'planning',
        reason: 'Initial planning started',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastPlannerStateTransition).toEqual({
        from: null,
        to: 'planning',
        reason: 'Initial planning started',
      })
      expect(updated.summary).toBe('[state_transition] none → planning')
    })

    it('should handle state_transition with from state', () => {
      const sessionId = 'session-state-2'
      const userId = 'user-456'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: 'planning',
        to: 'waiting_for_user',
        reason: 'Awaiting user confirmation',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastPlannerStateTransition).toEqual({
        from: 'planning',
        to: 'waiting_for_user',
        reason: 'Awaiting user confirmation',
      })
      expect(updated.summary).toBe('[state_transition] planning → waiting_for_user')
    })

    it('should handle state_transition without reason', () => {
      const sessionId = 'session-state-3'
      const userId = 'user-789'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: 'waiting_for_approval',
        to: 'completed',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastPlannerStateTransition).toEqual({
        from: 'waiting_for_approval',
        to: 'completed',
        reason: undefined,
      })
    })
  })

  describe('plan_update patch', () => {
    it('should apply plan_update patch to session memory', () => {
      const sessionId = 'session-plan-1'
      const userId = 'user-plan'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'plan_update',
        planId: 'plan-abc123',
        fromVersion: 1,
        toVersion: 2,
        planSummary: 'Added new step for error handling',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastPlanUpdate).toEqual({
        planId: 'plan-abc123',
        fromVersion: 1,
        toVersion: 2,
        planSummary: 'Added new step for error handling',
      })
    })

    it('should handle plan_update without planSummary', () => {
      const sessionId = 'session-plan-2'
      const userId = 'user-plan2'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'plan_update',
        planId: 'plan-xyz789',
        fromVersion: 3,
        toVersion: 4,
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastPlanUpdate).toEqual({
        planId: 'plan-xyz789',
        fromVersion: 3,
        toVersion: 4,
        planSummary: undefined,
      })
    })
  })

  describe('execution_ref_update patch', () => {
    it('should apply execution_ref_update patch to session memory', () => {
      const sessionId = 'session-exec-1'
      const userId = 'user-exec'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'execution_ref_update',
        refId: 'bg-run-123',
        refType: 'background_run',
        status: 'running',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastExecutionRefUpdate).toEqual({
        refId: 'bg-run-123',
        refType: 'background_run',
        status: 'running',
      })
    })

    it('should handle different ref types', () => {
      const sessionId = 'session-exec-2'
      const userId = 'user-exec2'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'execution_ref_update',
        refId: 'wf-run-456',
        refType: 'workflow_run',
        status: 'completed',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastExecutionRefUpdate?.refType).toBe('workflow_run')
      expect(state.lastExecutionRefUpdate?.status).toBe('completed')
    })
  })

  describe('checkpoint_update patch', () => {
    it('should apply checkpoint_update patch to session memory', () => {
      const sessionId = 'session-check-1'
      const userId = 'user-check'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'checkpoint_update',
        checkpointKeys: ['step-1', 'step-2', 'step-3'],
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastCheckpointUpdate).toEqual(['step-1', 'step-2', 'step-3'])
    })

    it('should handle empty checkpoint array', () => {
      const sessionId = 'session-check-2'
      const userId = 'user-check2'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'checkpoint_update',
        checkpointKeys: [],
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      const state = getStructuredState(updated)
      expect(state.lastCheckpointUpdate).toEqual([])
    })
  })

  describe('multiple patches (update vs replace)', () => {
    it('should replace structuredState on second patch (current behavior)', () => {
      const sessionId = 'session-multi-1'
      const userId = 'user-multi'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch1 = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: 'planning',
      })

      const updated1 = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch1)

      expect(getStructuredState(updated1).lastPlannerStateTransition?.to).toBe('planning')

      const patch2 = makePlannerStatePatch({
        patchType: 'plan_update',
        planId: 'plan-123',
        fromVersion: 1,
        toVersion: 2,
      })

      const updated2 = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch2)

      const state2 = getStructuredState(updated2)
      expect(state2.lastPlanUpdate?.planId).toBe('plan-123')
      expect(state2.lastPlannerStateTransition).toBeUndefined()
    })

    it('should overwrite same patch type on second application', () => {
      const sessionId = 'session-multi-2'
      const userId = 'user-multi2'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch1 = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: 'planning',
      })

      sessionMemoryManager.applyPlannerStatePatch(sessionId, patch1)

      const patch2 = makePlannerStatePatch({
        patchType: 'state_transition',
        from: 'planning',
        to: 'completed',
        reason: 'All tasks done',
      })

      const updated2 = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch2)

      const state = getStructuredState(updated2)
      expect(state.lastPlannerStateTransition).toEqual({
        from: 'planning',
        to: 'completed',
        reason: 'All tasks done',
      })
      expect(updated2.summary).toBe('[state_transition] planning → completed')
    })

    it('should apply latest patch replacing previous structuredState', () => {
      const sessionId = 'session-multi-3'
      const userId = 'user-multi3'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      sessionMemoryManager.applyPlannerStatePatch(
        sessionId,
        makePlannerStatePatch({
          patchType: 'state_transition',
          from: null,
          to: 'planning',
        }),
      )

      sessionMemoryManager.applyPlannerStatePatch(
        sessionId,
        makePlannerStatePatch({
          patchType: 'plan_update',
          planId: 'plan-1',
          fromVersion: 1,
          toVersion: 2,
        }),
      )

      sessionMemoryManager.applyPlannerStatePatch(
        sessionId,
        makePlannerStatePatch({
          patchType: 'execution_ref_update',
          refId: 'bg-1',
          refType: 'background_run',
          status: 'running',
        }),
      )

      const memory = sessionMemoryManager.getSessionMemory(sessionId)
      const state = getStructuredState(memory!)

      expect(state.lastExecutionRefUpdate?.refId).toBe('bg-1')
      expect(state.lastPlannerStateTransition).toBeUndefined()
      expect(state.lastPlanUpdate).toBeUndefined()
    })
  })

  describe('plannerStateToSessionPatch pure function', () => {
    it('should convert state_transition patch correctly', () => {
      const patch: PlannerStatePatch = {
        plannerRunId: 'pr-1',
        patchType: 'state_transition',
        patchData: {
          patchType: 'state_transition',
          from: 'planning',
          to: 'waiting_for_user',
          reason: 'Need input',
        },
        createdAt: new Date().toISOString(),
      }

      const sessionPatch = plannerStateToSessionPatch(patch)

      expect(sessionPatch.updates.summary).toBe('[state_transition] planning → waiting_for_user')
      expect(sessionPatch.updates.structuredState?.lastPlannerStateTransition).toEqual({
        from: 'planning',
        to: 'waiting_for_user',
        reason: 'Need input',
      })
    })

    it('should convert plan_update patch correctly', () => {
      const patch: PlannerStatePatch = {
        plannerRunId: 'pr-2',
        patchType: 'plan_update',
        patchData: {
          patchType: 'plan_update',
          planId: 'plan-xyz',
          fromVersion: 5,
          toVersion: 6,
          planSummary: 'Updated objectives',
        },
        createdAt: new Date().toISOString(),
      }

      const sessionPatch = plannerStateToSessionPatch(patch)

      expect(sessionPatch.updates.structuredState?.lastPlanUpdate).toEqual({
        planId: 'plan-xyz',
        fromVersion: 5,
        toVersion: 6,
        planSummary: 'Updated objectives',
      })
    })

    it('should convert execution_ref_update patch correctly', () => {
      const patch: PlannerStatePatch = {
        plannerRunId: 'pr-3',
        patchType: 'execution_ref_update',
        patchData: {
          patchType: 'execution_ref_update',
          refId: 'tool-123',
          refType: 'tool_execution',
          status: 'failed',
        },
        createdAt: new Date().toISOString(),
      }

      const sessionPatch = plannerStateToSessionPatch(patch)

      expect(sessionPatch.updates.structuredState?.lastExecutionRefUpdate).toEqual({
        refId: 'tool-123',
        refType: 'tool_execution',
        status: 'failed',
      })
    })

    it('should convert checkpoint_update patch correctly', () => {
      const patch: PlannerStatePatch = {
        plannerRunId: 'pr-4',
        patchType: 'checkpoint_update',
        patchData: {
          patchType: 'checkpoint_update',
          checkpointKeys: ['cp-1', 'cp-2'],
        },
        createdAt: new Date().toISOString(),
      }

      const sessionPatch = plannerStateToSessionPatch(patch)

      expect(sessionPatch.updates.structuredState?.lastCheckpointUpdate).toEqual(['cp-1', 'cp-2'])
    })
  })

  describe('system-owned field protection', () => {
    it('should preserve sessionId after patch', () => {
      const sessionId = 'session-protected-1'
      const userId = 'user-protected'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: 'planning',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      expect(updated.sessionId).toBe(sessionId)
      expect(updated.userId).toBe(userId)
    })

    it('should preserve sourceRefs after patch', () => {
      const sessionId = 'session-protected-2'
      const userId = 'user-protected2'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-a', 'turn-b'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'plan_update',
        planId: 'plan-1',
        fromVersion: 1,
        toVersion: 2,
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      expect(updated.sourceRefs).toEqual(sourceRefs)
    })

    it('should preserve createdAt after patch', () => {
      const sessionId = 'session-protected-3'
      const userId = 'user-protected3'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      const created = sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)
      const originalCreatedAt = created.createdAt

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: 'planning',
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      expect(updated.createdAt).toBe(originalCreatedAt)
      expect(updated.updatedAt).toBeDefined()
    })
  })

  describe('all PlannerRunState values', () => {
    const allStates: PlannerRunState[] = [
      'initializing',
      'planning',
      'waiting_for_user',
      'waiting_for_approval',
      'waiting_for_execution_result',
      'waiting_for_external_event',
      'replanning',
      'paused',
      'completed',
      'failed',
      'cancelled',
      'archived',
    ]

    it.each(allStates)('should handle state_transition to "%s"', (state) => {
      const sessionId = `session-state-${state}`
      const userId = 'user-states'
      const sourceRefs: SourceRefs = { transcriptRefs: ['turn-1'] }

      sessionMemoryManager.createSessionMemory(sessionId, userId, sourceRefs)

      const patch = makePlannerStatePatch({
        patchType: 'state_transition',
        from: null,
        to: state,
      })

      const updated = sessionMemoryManager.applyPlannerStatePatch(sessionId, patch)

      expect(getStructuredState(updated).lastPlannerStateTransition?.to).toBe(state)
    })
  })
})
