/**
 * Connector Event Bridge
 *
 * Bridges connector async operations and events into EventTriggerRuntime.
 */

import type { AsyncOperationRef, ConnectorResponse } from '../types.js'
import type { WaitCondition, WAIT_CONDITION_STATES } from '../../storage/wait-condition-store.js'
import type { RuntimeAction } from '../../storage/runtime-action-store.js'
import type { EventRecord, SensitivityLevel, RetentionClass } from '../../storage/event-store.js'
import type { TriggerEventType, ResumeTargetType } from '../../triggers/types.js'
import type { AuditRecorder } from '../../observability/audit-types.js'
import { generateId } from '../../shared/ids.js'

export interface AsyncOperationTargetInfo {
  targetType: ResumeTargetType
  targetRef: string
  userId?: string
  sessionId?: string
  correlationId?: string
  timeoutMs?: number
}

export interface ConnectorAsyncEvent {
  eventType:
    | 'connector_async_started'
    | 'connector_async_completed'
    | 'connector_async_failed'
    | 'connector_async_timeout'
    | 'connector_async_cancelled'
  operationId: string
  connectorInstanceId: string
  result?: ConnectorResponse
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
  timestamp: string
}

export interface SyntheticAsyncResult {
  operationId: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  isSynthetic: boolean
  reason: string
  result?: ConnectorResponse
  timestamp: string
}

export interface BridgeEvent extends EventRecord {
  eventType: TriggerEventType
  sourceModule: 'connector'
}

export interface ConnectorEventBridgeConfig {
  waitConditionStore: {
    create(condition: {
      id: string
      waitType: string
      conditionPattern: string
      targetType: string
      targetRef: string
      status: (typeof WAIT_CONDITION_STATES)[keyof typeof WAIT_CONDITION_STATES]
      priority?: number
      timeoutAt?: string
      metadata?: string
    }): WaitCondition
    getById(id: string): WaitCondition | null
    findByTarget(targetType: string, targetRef: string): WaitCondition[]
    findByStatus(status: string): WaitCondition[]
    markSatisfied(id: string, satisfiedBy: string, resultData?: Record<string, unknown>): WaitCondition
    markFailed(id: string, reason?: string): WaitCondition
    markTimeout(id: string): WaitCondition
    markCancelled(id: string, reason?: string): WaitCondition
    findExpired(before: string): WaitCondition[]
  }
  eventStore: {
    append(event: EventRecord | EventRecord[]): void
    query(filters: { eventType?: string; correlationId?: string }): EventRecord[]
  }
  runtimeActionStore: {
    save(action: RuntimeAction): void
    findByIdempotencyKey(key: string): RuntimeAction | null
  }
  auditRecorder?: AuditRecorder
  clock?: () => Date
}

const SENSITIVITY: SensitivityLevel = 'low'
const RETENTION_CLASS: RetentionClass = 'standard'

export class ConnectorEventBridge {
  private config: ConnectorEventBridgeConfig
  private operationIndex: Map<
    string,
    {
      operationRef: AsyncOperationRef
      targetInfo: AsyncOperationTargetInfo
      waitConditionId: string
    }
  > = new Map()

  constructor(config: ConnectorEventBridgeConfig) {
    this.config = config
  }

  trackAsyncOperation(operationRef: AsyncOperationRef, targetInfo: AsyncOperationTargetInfo): WaitCondition {
    const waitConditionId = generateId('wait_')
    const now = this.now()

    const timeoutAt = targetInfo.timeoutMs ? new Date(now.getTime() + targetInfo.timeoutMs).toISOString() : undefined

    const waitCondition = this.config.waitConditionStore.create({
      id: waitConditionId,
      waitType: 'operation_completion',
      conditionPattern: operationRef.operationId,
      targetType: targetInfo.targetType,
      targetRef: targetInfo.targetRef,
      status: 'active',
      priority: 0,
      timeoutAt,
      metadata: JSON.stringify({
        operationId: operationRef.operationId,
        connectorInstanceId: operationRef.connectorInstanceId,
        userId: targetInfo.userId,
        sessionId: targetInfo.sessionId,
        correlationId: targetInfo.correlationId,
      }),
    })

    this.operationIndex.set(operationRef.operationId, {
      operationRef,
      targetInfo,
      waitConditionId,
    })

    this.emitEvent({
      eventType: 'wait_condition_satisfied',
      customEventType: 'connector_async_op_created',
      relatedRefs: {
        waitConditionId,
        targetRef: targetInfo.targetRef,
      },
      payload: {
        operationId: operationRef.operationId,
        connectorInstanceId: operationRef.connectorInstanceId,
        targetType: targetInfo.targetType,
        targetRef: targetInfo.targetRef,
        timeoutAt,
      },
      correlationId: targetInfo.correlationId,
      userId: targetInfo.userId,
      sessionId: targetInfo.sessionId,
    })

    this.writeAuditRecord('connector_access', {
      userId: targetInfo.userId ?? 'system',
      sessionId: targetInfo.sessionId,
      connectorInstanceId: operationRef.connectorInstanceId,
      operation: 'async_op_created',
      status: 'success',
      correlationId: targetInfo.correlationId,
    })

    return waitCondition
  }

  handleConnectorEvent(event: ConnectorAsyncEvent): {
    waitCondition: WaitCondition | null
    action: RuntimeAction | null
    syntheticResult?: SyntheticAsyncResult
  } {
    const tracked = this.operationIndex.get(event.operationId)

    if (!tracked) {
      return { waitCondition: null, action: null }
    }

    const { operationRef, targetInfo, waitConditionId } = tracked
    const now = this.now()

    const waitCondition = this.config.waitConditionStore.getById(waitConditionId)
    if (!waitCondition) {
      return { waitCondition: null, action: null }
    }

    const terminalStates = ['satisfied', 'failed', 'timeout', 'cancelled']
    if (terminalStates.includes(waitCondition.status)) {
      return {
        waitCondition,
        action: null,
        syntheticResult: {
          operationId: event.operationId,
          status: 'failed',
          isSynthetic: true,
          reason: 'Operation already in terminal state',
          timestamp: now.toISOString(),
        },
      }
    }

    let syntheticResult: SyntheticAsyncResult | undefined
    let newStatus: (typeof WAIT_CONDITION_STATES)[keyof typeof WAIT_CONDITION_STATES] = 'satisfied'
    let satisfiedBy = 'connector_event'
    let resultData: Record<string, unknown> | undefined

    switch (event.eventType) {
      case 'connector_async_completed':
        newStatus = 'satisfied'
        resultData = {
          result: event.result,
          completedAt: event.timestamp,
        }
        syntheticResult = {
          operationId: event.operationId,
          status: 'completed',
          isSynthetic: false,
          reason: 'Operation completed successfully',
          result: event.result,
          timestamp: event.timestamp,
        }
        break

      case 'connector_async_failed':
        newStatus = 'failed'
        satisfiedBy = 'connector_failure'
        resultData = {
          error: event.error,
          failedAt: event.timestamp,
        }
        syntheticResult = {
          operationId: event.operationId,
          status: 'failed',
          isSynthetic: true,
          reason: event.error?.message ?? 'Operation failed',
          result: event.result,
          timestamp: event.timestamp,
        }
        break

      case 'connector_async_timeout':
        newStatus = 'timeout'
        satisfiedBy = 'timeout'
        resultData = {
          timedOutAt: event.timestamp,
        }
        syntheticResult = {
          operationId: event.operationId,
          status: 'timeout',
          isSynthetic: true,
          reason: 'Operation timed out',
          timestamp: event.timestamp,
        }
        break

      case 'connector_async_cancelled':
        newStatus = 'cancelled'
        satisfiedBy = 'cancellation'
        resultData = {
          cancelledAt: event.timestamp,
        }
        syntheticResult = {
          operationId: event.operationId,
          status: 'cancelled',
          isSynthetic: true,
          reason: 'Operation cancelled',
          timestamp: event.timestamp,
        }
        break

      default:
        return { waitCondition, action: null }
    }

    let updatedCondition: WaitCondition
    if (newStatus === 'satisfied') {
      updatedCondition = this.config.waitConditionStore.markSatisfied(waitConditionId, satisfiedBy, resultData)
    } else if (newStatus === 'failed') {
      updatedCondition = this.config.waitConditionStore.markFailed(waitConditionId, event.error?.message)
    } else if (newStatus === 'timeout') {
      updatedCondition = this.config.waitConditionStore.markTimeout(waitConditionId)
    } else {
      updatedCondition = this.config.waitConditionStore.markCancelled(waitConditionId, 'Connector operation cancelled')
    }

    const triggerEvent = this.emitEvent({
      eventType: newStatus === 'satisfied' ? 'wait_condition_satisfied' : 'wait_condition_timeout',
      relatedRefs: {
        waitConditionId,
        targetRef: targetInfo.targetRef,
      },
      payload: {
        operationId: event.operationId,
        connectorInstanceId: event.connectorInstanceId,
        waitConditionId,
        status: newStatus,
        resultData,
      },
      correlationId: targetInfo.correlationId,
      userId: targetInfo.userId,
      sessionId: targetInfo.sessionId,
    })

    const action = this.createResumeAction({
      targetType: targetInfo.targetType,
      targetRef: targetInfo.targetRef,
      eventType: newStatus === 'satisfied' ? 'wait_condition_satisfied' : 'wait_condition_timeout',
      triggerEventId: triggerEvent.eventId,
      correlationId: targetInfo.correlationId,
      userId: targetInfo.userId,
      sessionId: targetInfo.sessionId,
      payload: {
        operationId: event.operationId,
        waitConditionId,
        status: newStatus,
        result: syntheticResult,
      },
    })

    this.writeAuditRecord('connector_access', {
      userId: targetInfo.userId ?? 'system',
      sessionId: targetInfo.sessionId,
      connectorInstanceId: operationRef.connectorInstanceId,
      operation: `async_op_${event.eventType.replace('connector_async_', '')}`,
      status: newStatus === 'satisfied' ? 'success' : 'failure',
      correlationId: targetInfo.correlationId,
    })

    this.operationIndex.delete(event.operationId)

    return {
      waitCondition: updatedCondition,
      action,
      syntheticResult,
    }
  }

  handleTimeout(operationId: string): {
    waitCondition: WaitCondition | null
    action: RuntimeAction | null
    syntheticResult?: SyntheticAsyncResult
  } {
    const now = this.now()

    return this.handleConnectorEvent({
      eventType: 'connector_async_timeout',
      operationId,
      connectorInstanceId: this.operationIndex.get(operationId)?.operationRef.connectorInstanceId ?? 'unknown',
      timestamp: now.toISOString(),
    })
  }

  handleCancellation(
    operationId: string,
    reason?: string,
  ): {
    waitCondition: WaitCondition | null
    action: RuntimeAction | null
    syntheticResult?: SyntheticAsyncResult
  } {
    const now = this.now()

    const syntheticResult: SyntheticAsyncResult = {
      operationId,
      status: 'cancelled',
      isSynthetic: true,
      reason: reason ?? 'Operation cancelled',
      timestamp: now.toISOString(),
    }

    const event: ConnectorAsyncEvent = {
      eventType: 'connector_async_cancelled',
      operationId,
      connectorInstanceId: this.operationIndex.get(operationId)?.operationRef.connectorInstanceId ?? 'unknown',
      timestamp: now.toISOString(),
    }

    const result = this.handleConnectorEvent(event)

    return {
      ...result,
      syntheticResult,
    }
  }

  getTrackedOperation(operationId: string):
    | {
        operationRef: AsyncOperationRef
        targetInfo: AsyncOperationTargetInfo
        waitConditionId: string
      }
    | undefined {
    return this.operationIndex.get(operationId)
  }

  getAllTrackedOperations(): Array<{
    operationId: string
    operationRef: AsyncOperationRef
    targetInfo: AsyncOperationTargetInfo
    waitConditionId: string
  }> {
    const result: Array<{
      operationId: string
      operationRef: AsyncOperationRef
      targetInfo: AsyncOperationTargetInfo
      waitConditionId: string
    }> = []

    for (const [operationId, data] of this.operationIndex) {
      result.push({
        operationId,
        ...data,
      })
    }

    return result
  }

  private now(): Date {
    return this.config.clock ? this.config.clock() : new Date()
  }

  private emitEvent(params: {
    eventType: TriggerEventType
    customEventType?: string
    relatedRefs: {
      waitConditionId?: string
      targetRef?: string
    }
    payload: Record<string, unknown>
    correlationId?: string
    userId?: string
    sessionId?: string
  }): EventRecord {
    const now = this.now().toISOString()
    const eventId = generateId('evt_')

    const event: EventRecord = {
      eventId,
      eventType: params.customEventType ?? params.eventType,
      sourceModule: 'connector',
      userId: params.userId,
      sessionId: params.sessionId,
      correlationId: params.correlationId ?? eventId,
      relatedRefs: {
        waitConditionId: params.relatedRefs.waitConditionId,
      },
      payload: params.payload,
      sensitivity: SENSITIVITY,
      retentionClass: RETENTION_CLASS,
      createdAt: now,
    }

    this.config.eventStore.append(event)
    return event
  }

  private createResumeAction(params: {
    targetType: ResumeTargetType
    targetRef: string
    eventType: TriggerEventType
    triggerEventId: string
    correlationId?: string
    userId?: string
    sessionId?: string
    payload?: Record<string, unknown>
  }): RuntimeAction {
    const actionId = generateId('act_')
    const now = this.now().toISOString()
    const idempotencyKey = `${params.triggerEventId}:${params.targetRef}`

    const existing = this.config.runtimeActionStore.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      return existing
    }

    const action: RuntimeAction = {
      actionId,
      actionType: this.getActionType(params.targetType),
      idempotencyKey,
      source: {
        sourceModule: 'connector',
        sourceAction: 'async_op_completed',
      },
      targetRuntime: this.getTargetRuntime(params.targetType),
      targetAction: this.getTargetAction(params.targetType),
      payload: {
        ...params.payload,
        targetRef: params.targetRef,
        eventType: params.eventType,
        triggerEventId: params.triggerEventId,
      },
      correlationId: params.correlationId,
      userId: params.userId,
      sessionId: params.sessionId,
      targetRef: { [this.getTargetRefKey(params.targetType)]: params.targetRef },
      status: 'created',
      createdAt: now,
      updatedAt: now,
    }

    this.config.runtimeActionStore.save(action)
    return action
  }

  private getTargetRuntime(targetType: ResumeTargetType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'workflow_runtime'
      case 'background_run':
        return 'subagent_runtime'
      case 'planner_run':
        return 'planner_runtime'
      case 'kernel_run':
        return 'agent_kernel'
      default:
        return 'workflow_runtime'
    }
  }

  private getTargetAction(targetType: ResumeTargetType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'resume_workflow_step'
      case 'background_run':
        return 'resume_subagent'
      case 'planner_run':
        return 'resume_planner_run'
      case 'kernel_run':
        return 'resume_agent_run'
      default:
        return 'resume_workflow_step'
    }
  }

  private getActionType(targetType: ResumeTargetType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'resume_workflow_step'
      case 'background_run':
        return 'resume_subagent'
      case 'planner_run':
        return 'resume_planner_run'
      case 'kernel_run':
        return 'resume_agent_run'
      default:
        return 'resume_workflow_step'
    }
  }

  private getTargetRefKey(targetType: ResumeTargetType): string {
    switch (targetType) {
      case 'workflow_step_run':
        return 'workflowStepRunId'
      case 'background_run':
        return 'backgroundRunId'
      case 'planner_run':
        return 'plannerRunId'
      case 'kernel_run':
        return 'runId'
      default:
        return 'targetRef'
    }
  }

  private writeAuditRecord(
    _auditType: 'connector_access',
    params: {
      userId: string
      sessionId?: string
      connectorInstanceId: string
      operation: string
      status: 'success' | 'failure'
      correlationId?: string
    },
  ): void {
    if (!this.config.auditRecorder) {
      return
    }

    this.config.auditRecorder.recordConnectorAccess({
      userId: params.userId,
      sessionId: params.sessionId,
      connectorInstanceId: params.connectorInstanceId,
      operation: params.operation,
      status: params.status,
      correlationId: params.correlationId,
    })
  }
}

export function createConnectorEventBridge(config: ConnectorEventBridgeConfig): ConnectorEventBridge {
  return new ConnectorEventBridge(config)
}
