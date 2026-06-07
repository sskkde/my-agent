import { describe, it, expect, beforeEach } from 'vitest'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createWaitConditionStore } from '../../../src/storage/wait-condition-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createRuntimeActionStore } from '../../../src/storage/runtime-action-store.js'
import { createAuditRecorder } from '../../../src/observability/audit-recorder.js'
import { createAuditStore } from '../../../src/observability/audit-store.js'
import {
  createConnectorEventBridge,
  type ConnectorEventBridge,
  type ConnectorAsyncEvent,
  type AsyncOperationTargetInfo,
} from '../../../src/connectors/events/connector-event-bridge.js'
import type { AsyncOperationRef } from '../../../src/connectors/types.js'
import { TestClock } from '../../helpers/clock.js'

describe('ConnectorEventBridge', () => {
  let connection: ReturnType<typeof createConnectionManager>
  let waitConditionStore: ReturnType<typeof createWaitConditionStore>
  let eventStore: ReturnType<typeof createEventStore>
  let runtimeActionStore: ReturnType<typeof createRuntimeActionStore>
  let auditStore: ReturnType<typeof createAuditStore>
  let auditRecorder: ReturnType<typeof createAuditRecorder>
  let bridge: ConnectorEventBridge
  let clock: TestClock

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    waitConditionStore = createWaitConditionStore(connection)
    eventStore = createEventStore(connection)
    runtimeActionStore = createRuntimeActionStore(connection)
    auditStore = createAuditStore(connection)
    auditRecorder = createAuditRecorder({ auditStore })
    clock = new TestClock('2024-01-01T00:00:00.000Z')

    bridge = createConnectorEventBridge({
      waitConditionStore,
      eventStore,
      runtimeActionStore,
      auditRecorder,
      clock: () => new Date(clock.nowISO()),
    })
  })

  describe('trackAsyncOperation', () => {
    it('creates wait condition for async operation', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-test-123',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-456',
        userId: 'user-1',
        sessionId: 'session-1',
        correlationId: 'corr-1',
      }

      const waitCondition = bridge.trackAsyncOperation(operationRef, targetInfo)

      expect(waitCondition).toBeDefined()
      expect(waitCondition.waitType).toBe('operation_completion')
      expect(waitCondition.conditionPattern).toBe('op-test-123')
      expect(waitCondition.targetType).toBe('workflow_step_run')
      expect(waitCondition.targetRef).toBe('wsr-456')
      expect(waitCondition.status).toBe('active')

      const tracked = bridge.getTrackedOperation('op-test-123')
      expect(tracked).toBeDefined()
      expect(tracked?.operationRef.operationId).toBe('op-test-123')
      expect(tracked?.waitConditionId).toBe(waitCondition.id)
    })

    it('sets timeoutAt when timeoutMs is specified', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-timeout-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'background_run',
        targetRef: 'bg-789',
        timeoutMs: 30000,
      }

      const waitCondition = bridge.trackAsyncOperation(operationRef, targetInfo)

      expect(waitCondition.timeoutAt).toBe('2024-01-01T00:00:30.000Z')
    })

    it('writes audit record for async op creation', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-audit-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-audit',
        userId: 'user-audit',
        sessionId: 'session-audit',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const audits = auditStore.findByUser('user-audit')
      expect(audits.length).toBeGreaterThan(0)
      expect(audits[0].auditType).toBe('connector_access')
      expect(audits[0].payload).toMatchObject({
        connectorInstanceId: 'mock_docs',
        operation: 'async_op_created',
      })
    })
  })

  describe('handleConnectorEvent', () => {
    it('resumes workflow when operation completes', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-complete-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-complete',
        userId: 'user-complete',
        sessionId: 'session-complete',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const completionEvent: ConnectorAsyncEvent = {
        eventType: 'connector_async_completed',
        operationId: 'op-complete-test',
        connectorInstanceId: 'mock_docs',
        result: {
          status: 'success',
          requestId: 'req-1',
          connectorInstanceId: 'mock_docs',
          data: { exported: true },
        },
        timestamp: clock.nowISO(),
      }

      const result = bridge.handleConnectorEvent(completionEvent)

      expect(result.waitCondition).toBeDefined()
      expect(result.waitCondition?.status).toBe('satisfied')
      expect(result.action).toBeDefined()
      expect(result.action?.actionType).toBe('resume_workflow_step')
      expect(result.action?.targetRuntime).toBe('workflow_runtime')
      expect(result.syntheticResult?.status).toBe('completed')
      expect(result.syntheticResult?.isSynthetic).toBe(false)

      expect(bridge.getTrackedOperation('op-complete-test')).toBeUndefined()
    })

    it('handles operation failure with synthetic result', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-fail-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'background_run',
        targetRef: 'bg-fail',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const failureEvent: ConnectorAsyncEvent = {
        eventType: 'connector_async_failed',
        operationId: 'op-fail-test',
        connectorInstanceId: 'mock_docs',
        error: {
          code: 'EXPORT_FAILED',
          message: 'Export failed due to quota',
          recoverable: true,
        },
        timestamp: clock.nowISO(),
      }

      const result = bridge.handleConnectorEvent(failureEvent)

      expect(result.waitCondition?.status).toBe('failed')
      expect(result.syntheticResult?.status).toBe('failed')
      expect(result.syntheticResult?.isSynthetic).toBe(true)
      expect(result.syntheticResult?.reason).toBe('Export failed due to quota')
    })

    it('returns null for untracked operation', () => {
      const event: ConnectorAsyncEvent = {
        eventType: 'connector_async_completed',
        operationId: 'op-unknown',
        connectorInstanceId: 'mock_docs',
        timestamp: clock.nowISO(),
      }

      const result = bridge.handleConnectorEvent(event)

      expect(result.waitCondition).toBeNull()
      expect(result.action).toBeNull()
    })

    it('handles already terminal wait condition', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-terminal-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-terminal',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const completionEvent: ConnectorAsyncEvent = {
        eventType: 'connector_async_completed',
        operationId: 'op-terminal-test',
        connectorInstanceId: 'mock_docs',
        result: {
          status: 'success',
          requestId: 'req-1',
          connectorInstanceId: 'mock_docs',
        },
        timestamp: clock.nowISO(),
      }

      bridge.handleConnectorEvent(completionEvent)

      const secondResult = bridge.handleConnectorEvent(completionEvent)

      // After first completion, the operation is removed from tracking index
      // So second call returns null for untracked operation
      expect(secondResult.waitCondition).toBeNull()
      expect(secondResult.action).toBeNull()
      expect(secondResult.syntheticResult).toBeUndefined()
    })

    it('creates exactly one resume action per operation', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-once-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-once',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const completionEvent: ConnectorAsyncEvent = {
        eventType: 'connector_async_completed',
        operationId: 'op-once-test',
        connectorInstanceId: 'mock_docs',
        result: {
          status: 'success',
          requestId: 'req-1',
          connectorInstanceId: 'mock_docs',
        },
        timestamp: clock.nowISO(),
      }

      const result1 = bridge.handleConnectorEvent(completionEvent)
      const actionId = result1.action?.actionId

      clock.advance(1000)

      const result2 = bridge.handleConnectorEvent(completionEvent)

      expect(result2.action).toBeNull()
      expect(actionId).toBeDefined()
    })
  })

  describe('handleTimeout', () => {
    it('generates synthetic timeout result', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-timeout-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-timeout',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const result = bridge.handleTimeout('op-timeout-test')

      expect(result.waitCondition?.status).toBe('timeout')
      expect(result.syntheticResult?.status).toBe('timeout')
      expect(result.syntheticResult?.isSynthetic).toBe(true)
      expect(result.syntheticResult?.reason).toBe('Operation timed out')
      expect(result.action).toBeDefined()
    })
  })

  describe('handleCancellation', () => {
    it('generates synthetic cancelled result', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-cancel-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      const targetInfo: AsyncOperationTargetInfo = {
        targetType: 'background_run',
        targetRef: 'bg-cancel',
      }

      bridge.trackAsyncOperation(operationRef, targetInfo)

      const result = bridge.handleCancellation('op-cancel-test', 'User requested cancellation')

      expect(result.waitCondition?.status).toBe('cancelled')
      expect(result.syntheticResult?.status).toBe('cancelled')
      expect(result.syntheticResult?.isSynthetic).toBe(true)
      expect(result.syntheticResult?.reason).toBe('User requested cancellation')
      expect(result.action).toBeDefined()
    })
  })

  describe('getAllTrackedOperations', () => {
    it('returns all tracked operations', () => {
      bridge.trackAsyncOperation(
        {
          operationId: 'op-1',
          connectorInstanceId: 'mock_docs',
          status: 'pending',
          createdAt: clock.nowISO(),
        },
        { targetType: 'workflow_step_run', targetRef: 'wsr-1' },
      )

      bridge.trackAsyncOperation(
        {
          operationId: 'op-2',
          connectorInstanceId: 'mock_docs',
          status: 'pending',
          createdAt: clock.nowISO(),
        },
        { targetType: 'background_run', targetRef: 'bg-1' },
      )

      const all = bridge.getAllTrackedOperations()

      expect(all.length).toBe(2)
      expect(all.map((o) => o.operationId).sort()).toEqual(['op-1', 'op-2'])
    })
  })

  describe('event emission', () => {
    it('emits events to event store', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-event-test',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-event',
        userId: 'user-event',
        sessionId: 'session-event',
      })

      const events = eventStore.query({ eventType: 'connector_async_op_created' })
      expect(events.length).toBe(1)
      expect(events[0].payload).toMatchObject({
        operationId: 'op-event-test',
        connectorInstanceId: 'mock_docs',
      })
    })

    it('emits wait_condition_satisfied event on completion', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-satisfied-event',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-satisfied',
      })

      bridge.handleConnectorEvent({
        eventType: 'connector_async_completed',
        operationId: 'op-satisfied-event',
        connectorInstanceId: 'mock_docs',
        result: { status: 'success', requestId: 'req-1', connectorInstanceId: 'mock_docs' },
        timestamp: clock.nowISO(),
      })

      const events = eventStore.query({ eventType: 'wait_condition_satisfied' })
      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('resume action creation', () => {
    it('creates resume action with correct target for workflow_step_run', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-workflow-resume',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'workflow_step_run',
        targetRef: 'wsr-resume',
      })

      const result = bridge.handleConnectorEvent({
        eventType: 'connector_async_completed',
        operationId: 'op-workflow-resume',
        connectorInstanceId: 'mock_docs',
        result: { status: 'success', requestId: 'req-1', connectorInstanceId: 'mock_docs' },
        timestamp: clock.nowISO(),
      })

      expect(result.action?.targetRuntime).toBe('workflow_runtime')
      expect(result.action?.targetAction).toBe('resume_workflow_step')
      expect(result.action?.targetRef?.workflowStepRunId).toBe('wsr-resume')
    })

    it('creates resume action with correct target for background_run', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-bg-resume',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'background_run',
        targetRef: 'bg-resume',
      })

      const result = bridge.handleConnectorEvent({
        eventType: 'connector_async_completed',
        operationId: 'op-bg-resume',
        connectorInstanceId: 'mock_docs',
        result: { status: 'success', requestId: 'req-1', connectorInstanceId: 'mock_docs' },
        timestamp: clock.nowISO(),
      })

      expect(result.action?.targetRuntime).toBe('subagent_runtime')
      expect(result.action?.targetAction).toBe('resume_subagent')
      expect(result.action?.targetRef?.backgroundRunId).toBe('bg-resume')
    })

    it('creates resume action with correct target for planner_run', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-planner-resume',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'planner_run',
        targetRef: 'pr-resume',
      })

      const result = bridge.handleConnectorEvent({
        eventType: 'connector_async_completed',
        operationId: 'op-planner-resume',
        connectorInstanceId: 'mock_docs',
        result: { status: 'success', requestId: 'req-1', connectorInstanceId: 'mock_docs' },
        timestamp: clock.nowISO(),
      })

      expect(result.action?.targetRuntime).toBe('planner_runtime')
      expect(result.action?.targetAction).toBe('resume_planner_run')
      expect(result.action?.targetRef?.plannerRunId).toBe('pr-resume')
    })

    it('creates resume action with correct target for kernel_run', () => {
      const operationRef: AsyncOperationRef = {
        operationId: 'op-kernel-resume',
        connectorInstanceId: 'mock_docs',
        status: 'pending',
        createdAt: clock.nowISO(),
      }

      bridge.trackAsyncOperation(operationRef, {
        targetType: 'kernel_run',
        targetRef: 'kr-resume',
      })

      const result = bridge.handleConnectorEvent({
        eventType: 'connector_async_completed',
        operationId: 'op-kernel-resume',
        connectorInstanceId: 'mock_docs',
        result: { status: 'success', requestId: 'req-1', connectorInstanceId: 'mock_docs' },
        timestamp: clock.nowISO(),
      })

      expect(result.action?.targetRuntime).toBe('agent_kernel')
      expect(result.action?.targetAction).toBe('resume_agent_run')
      expect(result.action?.targetRef?.runId).toBe('kr-resume')
    })
  })
})
