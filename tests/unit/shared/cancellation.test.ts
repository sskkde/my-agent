import { describe, it, expect } from 'vitest'
import type {
  CancellationRequest,
  CancellationResult,
  CancellationTargetType,
  CascadePolicy,
  CancellationStatus,
  SideEffectNotice,
} from '../../../src/shared/cancellation'
import { CANCELLATION_TARGET_TYPES, CANCELLATION_STATUSES } from '../../../src/shared/cancellation'

describe('Cancellation Contracts', () => {
  describe('CancellationTargetType', () => {
    it('should accept all documented target types', () => {
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

      targetTypes.forEach((type) => {
        expect(typeof type).toBe('string')
      })
    })

    it('should export CANCELLATION_TARGET_TYPES constant', () => {
      expect(CANCELLATION_TARGET_TYPES).toEqual({
        PLANNER_RUN: 'planner_run',
        KERNEL_RUN: 'kernel_run',
        TOOL_EXECUTION: 'tool_execution',
        SUBAGENT_RUN: 'subagent_run',
        BACKGROUND_RUN: 'background_run',
        WORKFLOW_RUN: 'workflow_run',
        WORKFLOW_STEP_RUN: 'workflow_step_run',
        RUNTIME_ACTION: 'runtime_action',
        WAIT_CONDITION: 'wait_condition',
      })
    })
  })

  describe('CascadePolicy', () => {
    it('should create a CascadePolicy with all fields', () => {
      const policy: CascadePolicy = {
        cancelChildren: true,
        cancelActiveTools: true,
        cancelBackgroundRuns: true,
        cancelWaitConditions: true,
        notifyUser: false,
      }

      expect(policy.cancelChildren).toBe(true)
      expect(policy.cancelActiveTools).toBe(true)
      expect(policy.cancelBackgroundRuns).toBe(true)
      expect(policy.cancelWaitConditions).toBe(true)
      expect(policy.notifyUser).toBe(false)
    })
  })

  describe('CancellationRequest', () => {
    it('should create a complete CancellationRequest', () => {
      const cascadePolicy: CascadePolicy = {
        cancelChildren: true,
        cancelActiveTools: true,
        cancelBackgroundRuns: true,
        cancelWaitConditions: true,
        notifyUser: true,
      }

      const request: CancellationRequest = {
        cancellationId: 'cancel_001',
        requestedBy: 'user',
        reason: 'User requested cancellation',
        target: {
          targetType: 'kernel_run',
          targetId: 'krun_001',
        },
        cascadePolicy,
        createdAt: new Date().toISOString(),
      }

      expect(request.cancellationId).toBe('cancel_001')
      expect(request.requestedBy).toBe('user')
      expect(request.reason).toBe('User requested cancellation')
      expect(request.target.targetType).toBe('kernel_run')
      expect(request.target.targetId).toBe('krun_001')
      expect(request.cascadePolicy).toEqual(cascadePolicy)
      expect(request.createdAt).toBeDefined()
    })

    it('should support system as requestedBy', () => {
      const request: CancellationRequest = {
        cancellationId: 'cancel_002',
        requestedBy: 'system',
        reason: 'System triggered cancellation',
        target: {
          targetType: 'planner_run',
          targetId: 'pl_run_001',
        },
        cascadePolicy: {
          cancelChildren: true,
          cancelActiveTools: false,
          cancelBackgroundRuns: false,
          cancelWaitConditions: true,
          notifyUser: false,
        },
        createdAt: new Date().toISOString(),
      }

      expect(request.requestedBy).toBe('system')
    })

    it('should support timeout as requestedBy', () => {
      const request: CancellationRequest = {
        cancellationId: 'cancel_003',
        requestedBy: 'timeout',
        reason: 'Operation timed out',
        target: {
          targetType: 'wait_condition',
          targetId: 'wait_001',
        },
        cascadePolicy: {
          cancelChildren: false,
          cancelActiveTools: false,
          cancelBackgroundRuns: false,
          cancelWaitConditions: true,
          notifyUser: true,
        },
        createdAt: new Date().toISOString(),
      }

      expect(request.requestedBy).toBe('timeout')
    })

    it('should support policy as requestedBy', () => {
      const request: CancellationRequest = {
        cancellationId: 'cancel_004',
        requestedBy: 'policy',
        reason: 'Policy violation detected',
        target: {
          targetType: 'background_run',
          targetId: 'bg_run_001',
        },
        cascadePolicy: {
          cancelChildren: true,
          cancelActiveTools: true,
          cancelBackgroundRuns: true,
          cancelWaitConditions: false,
          notifyUser: true,
        },
        createdAt: new Date().toISOString(),
      }

      expect(request.requestedBy).toBe('policy')
    })
  })

  describe('CancellationStatus', () => {
    it('should accept all documented status values', () => {
      const statuses: CancellationStatus[] = ['completed', 'partial', 'not_cancellable', 'already_terminal', 'failed']

      expect(statuses).toHaveLength(5)

      statuses.forEach((status) => {
        expect(typeof status).toBe('string')
      })
    })

    it('should export CANCELLATION_STATUSES constant', () => {
      expect(CANCELLATION_STATUSES).toEqual({
        COMPLETED: 'completed',
        PARTIAL: 'partial',
        NOT_CANCELLABLE: 'not_cancellable',
        ALREADY_TERMINAL: 'already_terminal',
        FAILED: 'failed',
      })
    })
  })

  describe('SideEffectNotice', () => {
    it('should create a SideEffectNotice', () => {
      const notice: SideEffectNotice = {
        externalSideEffectsMayHaveOccurred: true,
        summary: 'Some external operations may have been partially executed',
      }

      expect(notice.externalSideEffectsMayHaveOccurred).toBe(true)
      expect(notice.summary).toBe('Some external operations may have been partially executed')
    })

    it('should support notice without summary', () => {
      const notice: SideEffectNotice = {
        externalSideEffectsMayHaveOccurred: false,
      }

      expect(notice.externalSideEffectsMayHaveOccurred).toBe(false)
      expect(notice.summary).toBeUndefined()
    })
  })

  describe('CancellationResult', () => {
    it('should create a successful CancellationResult', () => {
      const result: CancellationResult = {
        cancellationId: 'cancel_001',
        status: 'completed',
        cancelledRefs: ['krun_001', 'tool_call_001'],
        userVisibleSummary: 'Operation successfully cancelled',
      }

      expect(result.cancellationId).toBe('cancel_001')
      expect(result.status).toBe('completed')
      expect(result.cancelledRefs).toEqual(['krun_001', 'tool_call_001'])
      expect(result.userVisibleSummary).toBe('Operation successfully cancelled')
    })

    it('should create a partial cancellation result', () => {
      const sideEffectNotice: SideEffectNotice = {
        externalSideEffectsMayHaveOccurred: true,
        summary: 'Database write may have completed',
      }

      const result: CancellationResult = {
        cancellationId: 'cancel_002',
        status: 'partial',
        cancelledRefs: ['krun_001'],
        stillRunningRefs: ['bg_run_001'],
        sideEffectNotice,
        userVisibleSummary: 'Partially cancelled - some operations still running',
      }

      expect(result.status).toBe('partial')
      expect(result.cancelledRefs).toEqual(['krun_001'])
      expect(result.stillRunningRefs).toEqual(['bg_run_001'])
      expect(result.sideEffectNotice).toEqual(sideEffectNotice)
    })

    it('should create a not_cancellable result', () => {
      const result: CancellationResult = {
        cancellationId: 'cancel_003',
        status: 'not_cancellable',
        userVisibleSummary: 'Operation cannot be cancelled at this time',
      }

      expect(result.status).toBe('not_cancellable')
      expect(result.cancelledRefs).toBeUndefined()
      expect(result.stillRunningRefs).toBeUndefined()
    })

    it('should create an already_terminal result', () => {
      const result: CancellationResult = {
        cancellationId: 'cancel_004',
        status: 'already_terminal',
        userVisibleSummary: 'Operation already completed',
      }

      expect(result.status).toBe('already_terminal')
    })

    it('should create a failed result', () => {
      const result: CancellationResult = {
        cancellationId: 'cancel_005',
        status: 'failed',
        userVisibleSummary: 'Cancellation failed due to error',
      }

      expect(result.status).toBe('failed')
    })
  })
})
