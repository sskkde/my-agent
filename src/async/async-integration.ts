import type {
  AsyncIntegration,
  AsyncIntegrationConfig,
  AsyncOperationEvent,
  AsyncOperationRef,
  CreateResumeActionInput,
  EventSourceAdapter,
  ExecuteAsyncToolRequest,
  ExecuteAsyncToolResult,
  HandleOperationEventResult,
  RegisterWaitForOperationResult,
  ResumeTargetType,
  TrackedAsyncOperationRef,
} from './types.js';
import type { RuntimeTriggerEvent } from '../triggers/types.js';
import type { RuntimeAction, RuntimeActionState } from '../storage/runtime-action-store.js';
import type { WaitCondition } from '../storage/wait-condition-store.js';
import type { TargetRuntime, RuntimeActionType } from '../dispatcher/types.js';
import { generateId } from '../shared/ids.js';

const SOURCE_MODULE = 'async';
const SENSITIVITY = 'low';
const RETENTION_CLASS = 'standard';

const WAIT_CONDITION_STATES = {
  REGISTERED: 'registered',
  ACTIVE: 'active',
  SATISFIED: 'satisfied',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
} as const;

class AsyncIntegrationImpl implements AsyncIntegration {
  private config: AsyncIntegrationConfig;
  private trackedOperations: Map<string, TrackedAsyncOperationRef> = new Map();
  private handledEvents: Set<string> = new Set();

  constructor(
    config: AsyncIntegrationConfig,
    _eventSourceAdapter: EventSourceAdapter
  ) {
    this.config = config;
  }

  async executeAsyncTool(request: ExecuteAsyncToolRequest): Promise<ExecuteAsyncToolResult> {
    const connectorRequest = {
      requestId: request.requestId,
      connectorInstanceId: request.connectorInstanceId,
      capabilityId: request.capabilityId,
      operation: request.operation,
      params: request.params,
      userId: request.userId,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      timeoutMs: request.timeoutMs,
    };

    const result = await this.config.connectorRuntime.executeCall(connectorRequest);

    if (!this.isAsyncOperationRef(result)) {
      throw new Error('Connector did not return async operation reference');
    }

    const operationRef: AsyncOperationRef = {
      operationId: result.operationId,
      connectorInstanceId: result.connectorInstanceId,
      toolName: request.toolName,
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: {
        requestId: request.requestId,
        capabilityId: request.capabilityId,
      },
    };

    const waitConditionResult = this.registerWaitForOperation(
      operationRef,
      'workflow_step_run',
      request.requestId
    );

    return {
      operationRef,
      waitCondition: waitConditionResult.waitCondition,
    };
  }

  registerWaitForOperation(
    operationRef: AsyncOperationRef,
    targetType: ResumeTargetType,
    targetRef: string
  ): RegisterWaitForOperationResult {
    const waitConditionId = generateId('wait_');
    const conditionPattern = operationRef.operationId;

    const waitCondition = this.config.waitConditionStore.create({
      id: waitConditionId,
      waitType: 'operation_completion',
      conditionPattern,
      targetType,
      targetRef,
      status: WAIT_CONDITION_STATES.ACTIVE,
      priority: 0,
      metadata: JSON.stringify({
        operationId: operationRef.operationId,
        connectorInstanceId: operationRef.connectorInstanceId,
        toolName: operationRef.toolName,
      }),
    });

    const trackedRef: TrackedAsyncOperationRef = {
      ...operationRef,
      targetType,
      targetRef,
      waitConditionId,
    };

    this.trackedOperations.set(operationRef.operationId, trackedRef);

    return {
      waitCondition,
      conditionPattern,
    };
  }

  handleOperationEvent(event: AsyncOperationEvent): HandleOperationEventResult {
    const eventIdempotencyKey = `${event.operationId}:${event.eventType}:${event.timestamp}`;

    if (this.handledEvents.has(eventIdempotencyKey)) {
      return {
        matched: true,
        duplicate: true,
      };
    }

    const trackedOp = this.trackedOperations.get(event.operationId);

    if (!trackedOp) {
      const waitConditions = this.config.waitConditionStore.findByStatus(WAIT_CONDITION_STATES.ACTIVE);
      const matchingCondition = waitConditions.find(
        condition => condition.conditionPattern === event.operationId
      );

      if (!matchingCondition) {
        return { matched: false };
      }

      return this.processOperationEvent(event, matchingCondition);
    }

    const waitCondition = this.config.waitConditionStore.getById(trackedOp.waitConditionId);

    if (!waitCondition) {
      return { matched: false };
    }

    return this.processOperationEvent(event, waitCondition);
  }

  private processOperationEvent(
    event: AsyncOperationEvent,
    waitCondition: WaitCondition
  ): HandleOperationEventResult {
    let updatedCondition: WaitCondition;

    switch (event.status) {
      case 'completed':
        updatedCondition = this.config.waitConditionStore.markSatisfied(
          waitCondition.id,
          'async_integration',
          event.result
        );
        break;
      case 'failed':
        updatedCondition = this.config.waitConditionStore.markFailed(
          waitCondition.id,
          event.error?.message || 'Operation failed'
        );
        break;
      case 'timeout':
        updatedCondition = this.config.waitConditionStore.markTimeout(waitCondition.id);
        break;
      default:
        return { matched: false };
    }

    this.handledEvents.add(`${event.operationId}:${event.eventType}:${event.timestamp}`);

    const triggerEvent = this.createTriggerEvent(event, waitCondition);
    this.config.eventStore.append(triggerEvent);

    const action = this.createResumeAction({
      targetType: waitCondition.targetType as ResumeTargetType,
      targetRef: waitCondition.targetRef,
      event,
      waitConditionId: waitCondition.id,
      correlationId: event.correlationId,
    });

    return {
      matched: true,
      waitCondition: updatedCondition,
      event: triggerEvent,
      action,
    };
  }

  private createTriggerEvent(
    event: AsyncOperationEvent,
    waitCondition: WaitCondition
  ): RuntimeTriggerEvent {
    const now = new Date().toISOString();
    const eventId = generateId('evt_');

    const eventTypeMap: Record<string, string> = {
      completed: 'wait_condition_satisfied',
      failed: 'wait_condition_failed',
      timeout: 'wait_condition_timeout',
    };

    return {
      eventId,
      eventType: eventTypeMap[event.status] as RuntimeTriggerEvent['eventType'],
      sourceModule: 'trigger',
      correlationId: event.correlationId || eventId,
      relatedRefs: {
        waitConditionId: waitCondition.id,
        targetRef: waitCondition.targetRef,
      },
      payload: {
        waitConditionId: waitCondition.id,
        operationId: event.operationId,
        toolName: event.toolName,
        status: event.status,
        result: event.result,
        error: event.error,
        timestamp: event.timestamp,
      },
      sensitivity: SENSITIVITY,
      retentionClass: RETENTION_CLASS,
      createdAt: now,
    };
  }

  createResumeAction(input: CreateResumeActionInput): RuntimeAction {
    const actionId = generateId('act_');
    const now = new Date().toISOString();
    const idempotencyKey = `async:${input.event.operationId}:${input.event.eventType}`;

    const existing = this.config.runtimeActionStore.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    const targetRuntime = this.getTargetRuntime(input.targetType);
    const targetAction = this.getTargetAction(input.targetType, input.event.status);
    const actionType = this.getActionType(input.targetType);

    const conditionResultMap: Record<string, 'success' | 'failure' | 'timeout'> = {
      completed: 'success',
      failed: 'failure',
      timeout: 'timeout',
    };

    const action: RuntimeAction = {
      actionId,
      actionType,
      idempotencyKey,
      source: {
        sourceModule: SOURCE_MODULE,
        sourceAction: 'handle_operation_event',
      },
      targetRuntime,
      targetAction,
      payload: {
        targetRef: input.targetRef,
        eventType: input.event.eventType,
        operationId: input.event.operationId,
        toolName: input.event.toolName,
        status: input.event.status,
        result: input.event.result,
        error: input.event.error,
        conditionResult: conditionResultMap[input.event.status],
        waitConditionId: input.waitConditionId,
      },
      correlationId: input.correlationId,
      userId: input.userId,
      sessionId: input.sessionId,
      targetRef: { [this.getTargetRefKey(input.targetType)]: input.targetRef },
      status: 'created' as RuntimeActionState,
      createdAt: now,
      updatedAt: now,
    };

    this.config.runtimeActionStore.save(action);
    return action;
  }

  getOperation(operationId: string): TrackedAsyncOperationRef | null {
    return this.trackedOperations.get(operationId) || null;
  }

  getPendingOperations(targetType: ResumeTargetType, targetRef: string): TrackedAsyncOperationRef[] {
    const operations: TrackedAsyncOperationRef[] = [];

    for (const op of this.trackedOperations.values()) {
      if (op.targetType === targetType && op.targetRef === targetRef && op.status === 'pending') {
        operations.push(op);
      }
    }

    return operations;
  }

  private isAsyncOperationRef(result: unknown): result is { operationId: string; connectorInstanceId: string } {
    return (
      typeof result === 'object' &&
      result !== null &&
      'operationId' in result &&
      'connectorInstanceId' in result
    );
  }

  private getTargetRuntime(targetType: ResumeTargetType): TargetRuntime {
    const runtimeMap: Record<ResumeTargetType, TargetRuntime> = {
      workflow_step_run: 'workflow_runtime',
      background_run: 'subagent_runtime',
      planner_run: 'planner_runtime',
      kernel_run: 'agent_kernel',
    };

    return runtimeMap[targetType];
  }

  private getTargetAction(targetType: ResumeTargetType, _eventStatus: string): string {
    const actionMap: Record<ResumeTargetType, string> = {
      workflow_step_run: 'resume_workflow_step',
      background_run: 'resume_subagent',
      planner_run: 'resume_planner_run',
      kernel_run: 'resume_agent_run',
    };

    return actionMap[targetType];
  }

  private getActionType(targetType: ResumeTargetType): RuntimeActionType {
    const typeMap: Record<ResumeTargetType, RuntimeActionType> = {
      workflow_step_run: 'resume_workflow_step',
      background_run: 'resume_subagent',
      planner_run: 'resume_planner_run',
      kernel_run: 'resume_agent_run',
    };

    return typeMap[targetType];
  }

  private getTargetRefKey(targetType: ResumeTargetType): string {
    const keyMap: Record<ResumeTargetType, string> = {
      workflow_step_run: 'workflowStepRunId',
      background_run: 'backgroundRunId',
      planner_run: 'plannerRunId',
      kernel_run: 'runId',
    };

    return keyMap[targetType];
  }
}

class FakeEventSourceAdapter implements EventSourceAdapter {
  private subscribers: Map<string, Array<(event: AsyncOperationEvent) => void>> = new Map();

  subscribe(operationId: string, callback: (event: AsyncOperationEvent) => void): () => void {
    if (!this.subscribers.has(operationId)) {
      this.subscribers.set(operationId, []);
    }

    this.subscribers.get(operationId)!.push(callback);

    return () => {
      const callbacks = this.subscribers.get(operationId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  emit(event: AsyncOperationEvent): void {
    const callbacks = this.subscribers.get(event.operationId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }
  }
}

export function createAsyncIntegration(
  config: AsyncIntegrationConfig,
  eventSourceAdapter?: EventSourceAdapter
): AsyncIntegration {
  const adapter = eventSourceAdapter || new FakeEventSourceAdapter();
  return new AsyncIntegrationImpl(config, adapter);
}

export function createFakeEventSourceAdapter(): EventSourceAdapter {
  return new FakeEventSourceAdapter();
}

export { FakeEventSourceAdapter };
