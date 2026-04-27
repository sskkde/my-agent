import type { ConnectorResponse } from '../connectors/types.js';
import type { RuntimeTriggerEvent } from '../triggers/types.js';
import type { RuntimeAction } from '../storage/runtime-action-store.js';
import type { WaitCondition } from '../storage/wait-condition-store.js';

export type AsyncOperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export interface AsyncOperationRef {
  operationId: string;
  connectorInstanceId: string;
  toolName: string;
  status: AsyncOperationStatus;
  createdAt: string;
  completedAt?: string;
  result?: ConnectorResponse;
  metadata?: Record<string, unknown>;
}

export interface TrackedAsyncOperationRef extends AsyncOperationRef {
  targetType: ResumeTargetType;
  targetRef: string;
  waitConditionId: string;
}

export type AsyncOperationEventType =
  | 'operation_started'
  | 'operation_completed'
  | 'operation_failed'
  | 'operation_timeout'
  | 'operation_cancelled';

export interface AsyncOperationEvent {
  eventType: AsyncOperationEventType;
  operationId: string;
  connectorInstanceId: string;
  toolName: string;
  status: 'completed' | 'failed' | 'timeout';
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
  correlationId?: string;
}

export type ResumeTargetType =
  | 'workflow_step_run'
  | 'background_run'
  | 'planner_run'
  | 'kernel_run';

export interface ResumeTargetRef {
  targetType: ResumeTargetType;
  targetRef: string;
}

export interface ExecuteAsyncToolRequest {
  requestId: string;
  connectorInstanceId: string;
  capabilityId: string;
  toolName: string;
  operation: string;
  params: Record<string, unknown>;
  userId: string;
  sessionId?: string;
  correlationId?: string;
  timeoutMs?: number;
}

export interface ExecuteAsyncToolResult {
  operationRef: AsyncOperationRef;
  waitCondition: WaitCondition;
}

export interface RegisterWaitForOperationInput {
  operationRef: AsyncOperationRef;
  targetType: ResumeTargetType;
  targetRef: string;
  timeoutAt?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface RegisterWaitForOperationResult {
  waitCondition: WaitCondition;
  conditionPattern: string;
}

export interface HandleOperationEventResult {
  matched: boolean;
  waitCondition?: WaitCondition;
  event?: RuntimeTriggerEvent;
  action?: RuntimeAction;
  duplicate?: boolean;
}

export interface CreateResumeActionInput {
  targetType: ResumeTargetType;
  targetRef: string;
  event: AsyncOperationEvent;
  waitConditionId: string;
  userId?: string;
  sessionId?: string;
  correlationId?: string;
}

export interface ResumeActionPayload {
  targetRef: string;
  eventType: AsyncOperationEventType;
  triggerEventId: string;
  operationId: string;
  toolName: string;
  status: AsyncOperationStatus;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  conditionResult?: 'success' | 'failure' | 'timeout';
}

export interface AsyncIntegrationConfig {
  connectorRuntime: {
    executeCall(request: unknown): Promise<unknown>;
  };
  waitConditionStore: {
    create(condition: unknown): WaitCondition;
    getById(id: string): WaitCondition | null;
    findByTarget(targetType: string, targetRef: string): WaitCondition[];
    findByStatus(status: string): WaitCondition[];
    markSatisfied(id: string, satisfiedBy: string, resultData?: Record<string, unknown>): WaitCondition;
    markFailed(id: string, reason?: string): WaitCondition;
    markTimeout(id: string): WaitCondition;
  };
  eventStore: {
    append(event: RuntimeTriggerEvent | RuntimeTriggerEvent[]): void;
    query(filters: { eventType?: string; correlationId?: string }): unknown[];
  };
  runtimeActionStore: {
    save(action: RuntimeAction): void;
    findByIdempotencyKey(key: string): RuntimeAction | null;
  };
}

export interface AsyncIntegration {
  executeAsyncTool(request: ExecuteAsyncToolRequest): Promise<ExecuteAsyncToolResult>;
  registerWaitForOperation(
    operationRef: AsyncOperationRef,
    targetType: ResumeTargetType,
    targetRef: string
  ): RegisterWaitForOperationResult;
  handleOperationEvent(event: AsyncOperationEvent): HandleOperationEventResult;
  createResumeAction(input: CreateResumeActionInput): RuntimeAction;
  getOperation(operationId: string): TrackedAsyncOperationRef | null;
  getPendingOperations(targetType: ResumeTargetType, targetRef: string): TrackedAsyncOperationRef[];
}

export interface EventSourceAdapter {
  subscribe(operationId: string, callback: (event: AsyncOperationEvent) => void): () => void;
  emit(event: AsyncOperationEvent): void;
}
