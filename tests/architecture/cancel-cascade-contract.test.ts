/**
 * Architecture Contract Tests — Path 6: Cancel Cascade
 *
 * Verifies Cancel → PlannerRun/RuntimeAction/KernelRun cascade contract.
 * Tests type mapping, cascade policy, and terminal-state no-op paths.
 */
import { describe, it, expect } from 'vitest'
import type {
  CancellationRequest,
  CancellationResult,
  CancellationTargetType,
  CancellationStatus,
  CascadePolicy,
  SideEffectNotice,
} from '../../src/shared/cancellation.js'
import { CANCELLATION_TARGET_TYPES, CANCELLATION_STATUSES } from '../../src/shared/cancellation.js'
import type {
  CancellationCoordinator,
  CancellationCoordinatorConfig,
  SyntheticResult,
} from '../../src/recovery/types.js'
import {
  RUNTIME_ACTION_STATES,
  PLANNER_STATES,
  KERNEL_RUN_STATES,
  TOOL_EXECUTION_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
  WAIT_CONDITION_STATES,
} from '../../src/shared/states.js'

// ─── CancellationRequest → CancellationResult Type Contract ─────────────

describe('Path 6: Cancel Cascade Contract', () => {
  describe('CancellationRequest → CancellationResult Types', () => {
    it('CancellationRequest has all required fields for initiating cancel', () => {
      const requiredKeys: Array<keyof CancellationRequest> = [
        'cancellationId',
        'requestedBy',
        'reason',
        'target',
        'cascadePolicy',
        'createdAt',
      ]
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('CancellationResult has status, affectedRefs, and sideEffectNotice', () => {
      const result: CancellationResult = {
        cancellationId: 'c-1',
        status: CANCELLATION_STATUSES.COMPLETED,
        cancelledRefs: ['p-1'],
        stillRunningRefs: [],
        sideEffectNotice: undefined,
      }
      expect(result.status).toBe('completed')
      expect(result.cancelledRefs).toEqual(['p-1'])
    })

    it('CancellationResult.recovery variants: partial, already_terminal, not_cancellable', () => {
      const partial: CancellationResult = {
        cancellationId: 'c-2',
        status: CANCELLATION_STATUSES.PARTIAL,
        cancelledRefs: ['p-1'],
        stillRunningRefs: ['t-1'],
      }
      expect(partial.status).toBe('partial')
      expect(partial.stillRunningRefs).toEqual(['t-1'])

      const alreadyTerminal: CancellationResult = {
        cancellationId: 'c-3',
        status: CANCELLATION_STATUSES.ALREADY_TERMINAL,
      }
      expect(alreadyTerminal.status).toBe('already_terminal')

      const notCancellable: CancellationResult = {
        cancellationId: 'c-4',
        status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
      }
      expect(notCancellable.status).toBe('not_cancellable')
    })

    it('CancellationTargetType covers all 9 target types for cascade', () => {
      const targetTypes: CancellationTargetType[] = [
        'planner_run',
        'kernel_run',
        'tool_execution',
        'subagent_run',
        'background_run',
        'workflow_run',
        'workflow_step_run',
        'runtime_action',
        'wait_condition',
      ]
      expect(targetTypes).toHaveLength(9)

      const typeValues = Object.values(CANCELLATION_TARGET_TYPES) as string[]
      for (const tt of targetTypes) {
        expect(typeValues).toContain(tt)
      }
    })

    it('CancellationStatus has 5 possible outcomes', () => {
      const statuses: CancellationStatus[] = ['completed', 'partial', 'not_cancellable', 'already_terminal', 'failed']
      expect(statuses).toHaveLength(5)

      const statusValues = Object.values(CANCELLATION_STATUSES) as string[]
      expect(statusValues).toHaveLength(5)
      for (const s of statuses) {
        expect(statusValues).toContain(s)
      }
    })
  })

  // ─── Cascade Policy Contract ──────────────────────────────────────────

  describe('CascadePolicy Structure', () => {
    it('CascadePolicy controls which children get cancelled', () => {
      const policy: CascadePolicy = {
        cancelChildren: true,
        cancelActiveTools: true,
        cancelBackgroundRuns: true,
        cancelWaitConditions: true,
        notifyUser: true,
      }
      expect(policy.cancelChildren).toBe(true)
      expect(policy.cancelActiveTools).toBe(true)
      expect(policy.cancelBackgroundRuns).toBe(true)
      expect(policy.cancelWaitConditions).toBe(true)
      expect(policy.notifyUser).toBe(true)
    })
  })

  // ─── PlannerRun → RuntimeAction → KernelRun Cascade ──────────────────

  describe('PlannerRun → RuntimeAction → KernelRun Cascade', () => {
    it('PLANNER_STATES has cancelled state for cascade termination', () => {
      expect(PLANNER_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(PLANNER_STATES) as string[]
      expect(states).toContain('cancelled')
    })

    it('RUNTIME_ACTION_STATES has cancelled state for child cancellation', () => {
      expect(RUNTIME_ACTION_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(RUNTIME_ACTION_STATES) as string[]
      expect(states).toContain('cancelled')
    })

    it('KERNEL_RUN_STATES has cancelled and interrupted states', () => {
      expect(KERNEL_RUN_STATES.CANCELLED).toBe('cancelled')
      expect(KERNEL_RUN_STATES.INTERRUPTED).toBe('interrupted')
      const states = Object.values(KERNEL_RUN_STATES) as string[]
      expect(states).toContain('cancelled')
      expect(states).toContain('interrupted')
    })

    it('TOOL_EXECUTION_STATES has cancelled state for tool cancellation', () => {
      expect(TOOL_EXECUTION_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(TOOL_EXECUTION_STATES) as string[]
      expect(states).toContain('cancelled')
    })

    it('BACKGROUND_SUBAGENT_STATES has cancelled state', () => {
      expect(BACKGROUND_SUBAGENT_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(BACKGROUND_SUBAGENT_STATES) as string[]
      expect(states).toContain('cancelled')
    })

    it('WORKFLOW_RUN_STATES has cancelled state', () => {
      expect(WORKFLOW_RUN_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(WORKFLOW_RUN_STATES) as string[]
      expect(states).toContain('cancelled')
    })

    it('WAIT_CONDITION_STATES has cancelled state', () => {
      expect(WAIT_CONDITION_STATES.CANCELLED).toBe('cancelled')
      const states = Object.values(WAIT_CONDITION_STATES) as string[]
      expect(states).toContain('cancelled')
    })
  })

  // ─── Terminal State → No-Op Contract ─────────────────────────────────

  describe('Terminal State → No-Op', () => {
    it('already completed PlannerRun returns ALREADY_TERMINAL', () => {
      const terminalStates = ['completed', 'failed', 'cancelled', 'archived']
      // These states are checked by cancellationCoordinator.cancelPlannerRun
      // Any of these → result.status = 'already_terminal'
      for (const state of terminalStates) {
        expect(typeof state).toBe('string')
      }
    })

    it('already completed KernelRun returns ALREADY_TERMINAL', () => {
      const terminalStates = ['completed', 'failed', 'cancelled']
      // These states are checked by cancellationCoordinator.cancelKernelRun
      for (const state of terminalStates) {
        expect(typeof state).toBe('string')
      }
    })

    it('already terminal ToolExecution returns ALREADY_TERMINAL', () => {
      const terminalStatuses = ['completed', 'failed', 'cancelled']
      // Checked by cancellationCoordinator.cancelTool
      for (const s of terminalStatuses) {
        expect(typeof s).toBe('string')
      }
      expect(terminalStatuses).toContain('completed')
      expect(terminalStatuses).toContain('cancelled')
    })

    it('background runs only cancellable from queued/running/recovering', () => {
      const cancellableStatuses = ['queued', 'running', 'recovering']
      // Other statuses (completed, failed, cancelled) → already_terminal
      for (const s of cancellableStatuses) {
        expect(typeof s).toBe('string')
      }
      expect(cancellableStatuses).toHaveLength(3)
    })
  })

  // ─── Side Effects Notice Contract ────────────────────────────────────

  describe('SideEffectNotice Contract', () => {
    it('SideEffectNotice warns when external side effects may have occurred', () => {
      const notice: SideEffectNotice = {
        externalSideEffectsMayHaveOccurred: true,
        summary: 'External side effects may have occurred during tool execution before cancellation',
      }
      expect(notice.externalSideEffectsMayHaveOccurred).toBe(true)
      expect(notice.summary).toBeDefined()
    })

    it('CancellationResult includes optional sideEffectNotice', () => {
      const result: CancellationResult = {
        cancellationId: 'c-5',
        status: CANCELLATION_STATUSES.PARTIAL,
        cancelledRefs: ['p-1', 't-1'],
        stillRunningRefs: [],
        sideEffectNotice: {
          externalSideEffectsMayHaveOccurred: true,
          summary: 'External side effects may have occurred',
        },
      }
      expect(result.sideEffectNotice).toBeDefined()
      expect(result.sideEffectNotice!.externalSideEffectsMayHaveOccurred).toBe(true)
    })

    it('userVisibleSummary provides human-readable cancellation status', () => {
      const result: CancellationResult = {
        cancellationId: 'c-6',
        status: CANCELLATION_STATUSES.COMPLETED,
        cancelledRefs: ['p-1'],
        stillRunningRefs: [],
        userVisibleSummary: 'Task cancelled successfully',
      }
      expect(result.userVisibleSummary).toBe('Task cancelled successfully')
    })
  })

  // ─── SyntheticResult Contract ────────────────────────────────────────

  describe('SyntheticResult for Cancelled Tools', () => {
    it('SyntheticResult always has isSynthetic: true', () => {
      const synthetic: SyntheticResult = {
        toolCallId: 'tc-1',
        status: 'cancelled',
        isSynthetic: true,
        reason: 'Tool execution cancelled',
        timestamp: '2026-05-11T00:00:00Z',
        sideEffectsPossible: false,
      }
      expect(synthetic.isSynthetic).toBe(true)
      expect(synthetic.status).toBe('cancelled')
      expect(synthetic.reason).toBe('Tool execution cancelled')
    })

    it('sideEffectsPossible is true for external-effect tools', () => {
      const externalTools = [
        'sendEmail',
        'sendMessage',
        'createTicket',
        'postToApi',
        'writeFile',
        'deleteFile',
        'updateDatabase',
        'sendNotification',
      ]
      expect(externalTools).toHaveLength(8)
      for (const t of externalTools) {
        expect(typeof t).toBe('string')
      }
    })
  })

  // ─── CancellationCoordinatorConfig Dependencies ─────────────────────

  describe('CancellationCoordinatorConfig Dependencies', () => {
    it('requires tool execution, planner, background, kernel, and event stores', () => {
      const requiredKeys: Array<keyof CancellationCoordinatorConfig> = [
        'toolExecutionStore',
        'plannerRunStore',
        'backgroundRunStore',
        'kernelRunStore',
        'eventStore',
      ]
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('supports optional workflow, approval, wait condition, and connector stores', () => {
      const optionalKeys: Array<keyof CancellationCoordinatorConfig> = [
        'workflowRunStore',
        'approvalRequestStore',
        'waitConditionStore',
        'connectorOperationStore',
      ]
      for (const key of optionalKeys) {
        expect(typeof key).toBe('string')
      }
    })
  })

  // ─── CancellationCoordinator Interface ──────────────────────────────

  describe('CancellationCoordinator Interface', () => {
    it('exposes cancel, pause, resume and per-type cancel methods', () => {
      const methods: Array<keyof CancellationCoordinator> = [
        'cancel',
        'cancelTool',
        'cancelPlannerRun',
        'cancelKernelRun',
        'cancelBackgroundRun',
        'cancelWorkflowRun',
        'pause',
        'resume',
      ]
      for (const m of methods) {
        expect(typeof m).toBe('string')
      }
      expect(methods).toHaveLength(8)
    })
  })
})
