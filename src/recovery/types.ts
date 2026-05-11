import type { CancellationTargetType, CancellationStatus, SideEffectNotice } from '../shared/cancellation.js';
import type { BackoffStrategy } from '../shared/retry.js';
import type { RuntimeError, RuntimeErrorCategory } from '../shared/errors.js';

export interface CancellationRequest {
  targetType: CancellationTargetType;
  targetId: string;
  cascade: boolean;
  reason: string;
}

export interface CancellationResult {
  status: CancellationStatus;
  affectedRefs: string[];
  failedRefs: string[];
  partialRefs: string[];
  sideEffectNotice?: SideEffectNotice;
  userVisibleSummary?: string;
}

export interface RetryPolicy {
  maxRetries?: number;
  maxAttempts?: number;
  backoffStrategy?: BackoffStrategy;
  backoff?: BackoffStrategy;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  retryableErrors?: RuntimeErrorCategory[];
  retryableErrorCategories?: RuntimeErrorCategory[];
  retryOn?: RuntimeErrorCategory[];
  doNotRetryOn?: RuntimeErrorCategory[];
  requireApprovalBeforeRetry?: boolean;
}

export interface RetryOperation {
  operation: () => Promise<unknown>;
  operationName: string;
  isWrite?: boolean;
  isIdempotent?: boolean;
  cancelToken?: string;
}

export interface RetryResult {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  attempts: number;
  requiresUserApproval?: boolean;
  failedDueToApproval?: boolean;
  timedOut?: boolean;
  auditTrail?: RetryAttemptAudit[];
}

export interface RetryAttemptAudit {
  attempt: number;
  status: 'started' | 'succeeded' | 'failed' | 'retry_scheduled' | 'aborted';
  operationName: string;
  errorCategory?: RuntimeErrorCategory;
  errorCode?: string;
  delayMs?: number;
  timestamp: string;
}

export interface SyntheticResult {
  toolCallId: string;
  status: 'cancelled' | 'timeout' | 'interrupted';
  isSynthetic: true;
  reason: string;
  timestamp: string;
  sideEffectsPossible: boolean;
}

export interface ToolExecutionStore {
  getById: (toolCallId: string) => { toolCallId: string; toolName: string; status: string; category?: string; userId?: string; sessionId?: string; kernelRunId?: string } | null;
  updateStatus: (toolCallId: string, status: string) => void;
  saveResult: (toolCallId: string, result: { synthetic?: boolean; status?: string; reason?: string; error?: { code: string; message: string } }) => void;
}

export interface PlannerRunStore {
  getById: (plannerRunId: string) => { plannerRunId: string; status: string; checkpoint?: { activeExecutionRefs?: Array<{ refId: string; refType: string; status: string }> } } | null;
  updateStatus: (plannerRunId: string, status: string, checkpoint?: unknown) => void;
}

export interface BackgroundRunStore {
  getById: (backgroundRunId: string) => { backgroundRunId: string; status: string } | null;
  updateStatus: (backgroundRunId: string, status: string) => void;
}

export interface KernelRunStore {
  getById: (kernelRunId: string) => { kernelRunId: string; status: string; pendingToolCalls?: string[] } | null;
  updateStatus: (kernelRunId: string, status: string) => void;
}

export interface EventStore {
  append: (event: {
    eventId: string;
    eventType: string;
    sourceModule: string;
    userId?: string;
    sessionId?: string;
    correlationId?: string;
    relatedRefs?: Record<string, string>;
    payload: Record<string, unknown>;
    sensitivity: string;
    retentionClass: string;
    createdAt: string;
  }) => void;
}

export interface WorkflowRunStore {
  getWorkflowRunById: (workflowRunId: string) => { workflowRunId: string; status: string; ownerUserId?: string } | null;
  updateWorkflowStatus: (workflowRunId: string, status: string) => void;
  getStepRunById?: (stepRunId: string) => {
    stepRunId: string;
    workflowRunId: string;
    status: string;
    kernelRunId?: string;
    subagentRunId?: string;
    toolCallId?: string;
    approvalId?: string;
  } | null;
  getStepsByWorkflowRunId: (workflowRunId: string) => Array<{
    stepRunId: string;
    workflowRunId: string;
    status: string;
    kernelRunId?: string;
    subagentRunId?: string;
    toolCallId?: string;
    approvalId?: string;
  }>;
  updateStepStatus: (stepRunId: string, status: string) => void;
}

export interface TerminalStateStore {
  getById: (id: string) => { status: string } | null;
  updateStatus: (id: string, status: string) => void;
}

export interface CancellationCoordinatorConfig {
  toolExecutionStore: ToolExecutionStore;
  plannerRunStore: PlannerRunStore;
  backgroundRunStore: BackgroundRunStore;
  kernelRunStore: KernelRunStore;
  eventStore: EventStore;
  workflowRunStore?: WorkflowRunStore;
  approvalRequestStore?: TerminalStateStore;
  waitConditionStore?: TerminalStateStore;
  connectorOperationStore?: TerminalStateStore;
}

export interface RetryExecutorConfig {
  requestApproval?: (operationName: string, error: RuntimeError) => Promise<{ approved: boolean; reason?: string }>;
  isIdempotent?: (operationName: string) => boolean;
  timeoutMs?: number;
  cancelOperation?: (cancelToken: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export interface CancellationCoordinator {
  cancel: (request: CancellationRequest) => Promise<CancellationResult>;
  cancelTool: (toolCallId: string) => Promise<SyntheticResult>;
  cancelPlannerRun: (plannerRunId: string) => Promise<CancellationResult>;
  cancelKernelRun: (kernelRunId: string) => Promise<CancellationResult>;
  cancelBackgroundRun: (bgRunId: string) => Promise<CancellationResult>;
  cancelWorkflowRun: (workflowRunId: string) => Promise<CancellationResult>;
  pause: (request: CancellationRequest) => Promise<CancellationResult>;
  resume: (request: CancellationRequest) => Promise<CancellationResult>;
}

export type RecoverableRunType = 'planner_run' | 'kernel_run' | 'workflow_run' | 'workflow_step_run' | 'background_run' | 'tool_execution';

export interface RecoveryCheckpointRecord {
  runType: RecoverableRunType;
  runId: string;
  data: Record<string, unknown>;
  savedAt: string;
  eventCursor?: string;
  allowExternalWrites: boolean;
}

export interface RecoveryResult {
  canRecover: boolean;
  checkpoint: RecoveryCheckpointRecord | null;
  events: Array<{ eventId: string; eventType: string; createdAt: string; payload: Record<string, unknown> }>;
  blockedReason?: string;
}

export interface RecoveryCheckpointStore {
  save: (checkpoint: RecoveryCheckpointRecord) => void;
  load: (runType: RecoverableRunType, runId: string) => RecoveryCheckpointRecord | null;
}

export interface RecoveryEventStore {
  findByCorrelationId: (correlationId: string) => Array<{ eventId: string; eventType: string; createdAt: string; payload: Record<string, unknown> }>;
}

export interface RecoveryManagerConfig {
  checkpointStore?: RecoveryCheckpointStore;
  eventStore: RecoveryEventStore;
}

export interface RecoveryManager {
  saveCheckpoint: (runType: RecoverableRunType, runId: string, data: Record<string, unknown>, options?: { eventCursor?: string; allowExternalWrites?: boolean }) => RecoveryCheckpointRecord;
  recoverFromCheckpoint: (runType: RecoverableRunType, runId: string, options?: { allowExternalWrites?: boolean }) => RecoveryResult;
}

export interface RetryExecutor {
  executeWithRetry: (operation: RetryOperation, policy: RetryPolicy) => Promise<RetryResult>;
  isRetryable: (error: RuntimeError, policy: RetryPolicy) => boolean;
}
