import type {
  CancellationCoordinator,
  CancellationCoordinatorConfig,
  CancellationRequest,
  CancellationResult,
  SyntheticResult,
} from './types.js';
import { CANCELLATION_TARGET_TYPES, CANCELLATION_STATUSES } from '../shared/cancellation.js';

class CancellationCoordinatorImpl implements CancellationCoordinator {
  private config: CancellationCoordinatorConfig;

  constructor(config: CancellationCoordinatorConfig) {
    this.config = config;
  }

  async cancel(request: CancellationRequest): Promise<CancellationResult> {
    switch (request.targetType) {
      case CANCELLATION_TARGET_TYPES.TOOL_EXECUTION: {
        const toolResult = await this.cancelTool(request.targetId);
        return {
          status: CANCELLATION_STATUSES.COMPLETED,
          affectedRefs: [request.targetId],
          failedRefs: [],
          partialRefs: [],
          sideEffectNotice: toolResult.sideEffectsPossible
            ? {
                externalSideEffectsMayHaveOccurred: true,
                summary: 'External side effects may have occurred during tool execution before cancellation',
              }
            : undefined,
        };
      }

      case CANCELLATION_TARGET_TYPES.PLANNER_RUN:
        return this.cancelPlannerRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.KERNEL_RUN:
        return this.cancelKernelRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.BACKGROUND_RUN:
        return this.cancelBackgroundRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.SUBAGENT_RUN:
        return this.cancelBackgroundRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.WORKFLOW_RUN:
        return this.cancelWorkflowRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.WORKFLOW_STEP_RUN:
        return this.cancelWorkflowStepRun(request.targetId);

      case CANCELLATION_TARGET_TYPES.WAIT_CONDITION:
        return this.cancelTerminalStoreRef(request.targetId, 'wait_condition_cancelled', this.config.waitConditionStore);

      default:
        return {
          status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
          affectedRefs: [],
          failedRefs: [request.targetId],
          partialRefs: [],
        };
    }
  }

  async cancelTool(toolCallId: string): Promise<SyntheticResult> {
    const toolExecution = this.config.toolExecutionStore.getById(toolCallId);

    if (!toolExecution) {
      return {
        toolCallId,
        status: 'cancelled',
        isSynthetic: true,
        reason: 'Tool execution not found',
        timestamp: new Date().toISOString(),
        sideEffectsPossible: false,
      };
    }

    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    if (terminalStatuses.includes(toolExecution.status)) {
      return {
        toolCallId,
        status: 'cancelled',
        isSynthetic: true,
        reason: 'Tool already in terminal state',
        timestamp: new Date().toISOString(),
        sideEffectsPossible: false,
      };
    }

    const hasExternalSideEffects = this.hasExternalSideEffects(toolExecution.toolName);

    this.config.toolExecutionStore.updateStatus(toolCallId, 'cancelled');
    this.config.toolExecutionStore.saveResult(toolCallId, {
      synthetic: true,
      status: 'cancelled',
      reason: 'Tool execution cancelled',
    });

    this.emitCancellationEvent('tool_execution_cancelled', toolCallId, toolExecution.userId, toolExecution.sessionId);

    return {
      toolCallId,
      status: 'cancelled',
      isSynthetic: true,
      reason: 'Tool execution cancelled',
      timestamp: new Date().toISOString(),
      sideEffectsPossible: hasExternalSideEffects,
    };
  }

  async cancelPlannerRun(plannerRunId: string): Promise<CancellationResult> {
    const plannerRun = this.config.plannerRunStore.getById(plannerRunId);

    if (!plannerRun) {
      return {
        status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
        affectedRefs: [],
        failedRefs: [plannerRunId],
        partialRefs: [],
      };
    }

    const terminalStatuses = ['completed', 'failed', 'cancelled', 'archived'];
    if (terminalStatuses.includes(plannerRun.status)) {
      return {
        status: CANCELLATION_STATUSES.ALREADY_TERMINAL,
        affectedRefs: [],
        failedRefs: [],
        partialRefs: [plannerRunId],
      };
    }

    const affectedRefs: string[] = [plannerRunId];
    const failedRefs: string[] = [];
    const partialRefs: string[] = [];
    let hasExternalSideEffects = false;

    const activeRefs = plannerRun.checkpoint?.activeExecutionRefs || [];

    for (const ref of activeRefs) {
      try {
        const refResult = await this.cancelRef(ref);
        if (refResult.cancelled) {
          affectedRefs.push(ref.refId);
        } else if (refResult.alreadyTerminal) {
          partialRefs.push(ref.refId);
        }
        if (refResult.hasExternalSideEffects) {
          hasExternalSideEffects = true;
        }
      } catch {
        failedRefs.push(ref.refId);
      }
    }

    this.config.plannerRunStore.updateStatus(plannerRunId, 'cancelled', {
      ...plannerRun.checkpoint,
      cancelledAt: new Date().toISOString(),
    });

    this.emitCancellationEvent('planner_run_cancelled', plannerRunId, undefined, undefined);

    return {
      status: failedRefs.length > 0
        ? CANCELLATION_STATUSES.PARTIAL
        : partialRefs.length > 0
          ? CANCELLATION_STATUSES.PARTIAL
          : CANCELLATION_STATUSES.COMPLETED,
      affectedRefs,
      failedRefs,
      partialRefs,
      sideEffectNotice: hasExternalSideEffects
        ? {
            externalSideEffectsMayHaveOccurred: true,
            summary: 'External side effects may have occurred during tool execution before cancellation',
          }
        : undefined,
    };
  }

  async cancelKernelRun(kernelRunId: string): Promise<CancellationResult> {
    const kernelRun = this.config.kernelRunStore.getById(kernelRunId);

    if (!kernelRun) {
      return {
        status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
        affectedRefs: [],
        failedRefs: [kernelRunId],
        partialRefs: [],
      };
    }

    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    if (terminalStatuses.includes(kernelRun.status)) {
      return {
        status: CANCELLATION_STATUSES.ALREADY_TERMINAL,
        affectedRefs: [],
        failedRefs: [],
        partialRefs: [kernelRunId],
      };
    }

    const affectedRefs: string[] = [kernelRunId];
    const failedRefs: string[] = [];

    const pendingToolCalls = kernelRun.pendingToolCalls || [];

    for (const toolCallId of pendingToolCalls) {
      try {
        await this.cancelTool(toolCallId);
        affectedRefs.push(toolCallId);
      } catch {
        failedRefs.push(toolCallId);
      }
    }

    this.config.kernelRunStore.updateStatus(kernelRunId, 'cancelled');

    this.emitCancellationEvent('kernel_run_cancelled', kernelRunId, undefined, undefined);

    return {
      status: failedRefs.length > 0 ? CANCELLATION_STATUSES.PARTIAL : CANCELLATION_STATUSES.COMPLETED,
      affectedRefs,
      failedRefs,
      partialRefs: [],
    };
  }

  async cancelBackgroundRun(bgRunId: string): Promise<CancellationResult> {
    const bgRun = this.config.backgroundRunStore.getById(bgRunId);

    if (!bgRun) {
      return {
        status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
        affectedRefs: [],
        failedRefs: [bgRunId],
        partialRefs: [],
      };
    }

    const cancellableStatuses = ['queued', 'running', 'recovering'];
    if (!cancellableStatuses.includes(bgRun.status)) {
      return {
        status: CANCELLATION_STATUSES.ALREADY_TERMINAL,
        affectedRefs: [],
        failedRefs: [],
        partialRefs: [bgRunId],
      };
    }

    this.config.backgroundRunStore.updateStatus(bgRunId, 'cancelled');

    this.emitCancellationEvent('background_run_cancelled', bgRunId, undefined, undefined);

    return {
      status: CANCELLATION_STATUSES.COMPLETED,
      affectedRefs: [bgRunId],
      failedRefs: [],
      partialRefs: [],
    };
  }

  async cancelWorkflowRun(workflowRunId: string): Promise<CancellationResult> {
    const workflowStore = this.config.workflowRunStore;
    if (!workflowStore) {
      return this.notCancellable(workflowRunId);
    }

    const workflowRun = workflowStore.getWorkflowRunById(workflowRunId);
    if (!workflowRun) {
      return this.notCancellable(workflowRunId);
    }

    if (this.isTerminalStatus(workflowRun.status)) {
      return this.alreadyTerminal(workflowRunId);
    }

    const affectedRefs: string[] = [workflowRunId];
    const failedRefs: string[] = [];
    const partialRefs: string[] = [];
    let hasExternalSideEffects = false;

    const stepRuns = workflowStore.getStepsByWorkflowRunId(workflowRunId);
    for (const stepRun of stepRuns) {
      if (this.isTerminalStatus(stepRun.status)) {
        partialRefs.push(stepRun.stepRunId);
        continue;
      }

      try {
        workflowStore.updateStepStatus(stepRun.stepRunId, 'cancelled');
        affectedRefs.push(stepRun.stepRunId);
        const childRefs = this.getWorkflowStepChildRefs(stepRun);
        for (const childRef of childRefs) {
          const childResult = await this.cancelRef(childRef);
          if (childResult.cancelled) affectedRefs.push(childRef.refId);
          if (childResult.alreadyTerminal) partialRefs.push(childRef.refId);
          if (childResult.hasExternalSideEffects) hasExternalSideEffects = true;
        }
      } catch {
        failedRefs.push(stepRun.stepRunId);
      }
    }

    workflowStore.updateWorkflowStatus(workflowRunId, 'cancelled');
    this.emitCancellationEvent('workflow_run_cancelled', workflowRunId, workflowRun.ownerUserId, undefined);

    return {
      status: failedRefs.length > 0 || partialRefs.length > 0 ? CANCELLATION_STATUSES.PARTIAL : CANCELLATION_STATUSES.COMPLETED,
      affectedRefs,
      failedRefs,
      partialRefs,
      sideEffectNotice: hasExternalSideEffects
        ? {
            externalSideEffectsMayHaveOccurred: true,
            summary: 'External side effects may have occurred during workflow cancellation',
          }
        : undefined,
    };
  }

  async pause(request: CancellationRequest): Promise<CancellationResult> {
    return this.transitionTarget(request.targetType, request.targetId, 'paused', 'paused');
  }

  async resume(request: CancellationRequest): Promise<CancellationResult> {
    return this.transitionTarget(request.targetType, request.targetId, 'running', 'resumed');
  }

  private async cancelWorkflowStepRun(stepRunId: string): Promise<CancellationResult> {
    const workflowStore = this.config.workflowRunStore;
    const stepRun = workflowStore?.getStepRunById?.(stepRunId);
    if (!workflowStore || !stepRun) {
      return this.notCancellable(stepRunId);
    }

    if (this.isTerminalStatus(stepRun.status)) {
      return this.alreadyTerminal(stepRunId);
    }

    workflowStore.updateStepStatus(stepRunId, 'cancelled');
    const affectedRefs = [stepRunId];
    const failedRefs: string[] = [];
    const partialRefs: string[] = [];

    for (const ref of this.getWorkflowStepChildRefs(stepRun)) {
      try {
        const result = await this.cancelRef(ref);
        if (result.cancelled) affectedRefs.push(ref.refId);
        if (result.alreadyTerminal) partialRefs.push(ref.refId);
      } catch {
        failedRefs.push(ref.refId);
      }
    }

    this.emitCancellationEvent('workflow_step_run_cancelled', stepRunId, undefined, undefined);

    return {
      status: failedRefs.length > 0 || partialRefs.length > 0 ? CANCELLATION_STATUSES.PARTIAL : CANCELLATION_STATUSES.COMPLETED,
      affectedRefs,
      failedRefs,
      partialRefs,
    };
  }

  private async cancelRef(ref: { refId: string; refType: string; status: string }): Promise<{ cancelled: boolean; alreadyTerminal: boolean; hasExternalSideEffects: boolean }> {
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    if (terminalStatuses.includes(ref.status)) {
      return { cancelled: false, alreadyTerminal: true, hasExternalSideEffects: false };
    }

    let hasExternalSideEffects = false;

    switch (ref.refType) {
      case 'tool_execution': {
        const toolExecution = this.config.toolExecutionStore.getById(ref.refId);
        if (toolExecution && this.hasExternalSideEffects(toolExecution.toolName)) {
          hasExternalSideEffects = true;
        }
        await this.cancelTool(ref.refId);
        return { cancelled: true, alreadyTerminal: false, hasExternalSideEffects };
      }

      case 'background_run': {
        await this.cancelBackgroundRun(ref.refId);
        return { cancelled: true, alreadyTerminal: false, hasExternalSideEffects };
      }

      case 'kernel_run': {
        await this.cancelKernelRun(ref.refId);
        return { cancelled: true, alreadyTerminal: false, hasExternalSideEffects };
      }

      case 'workflow_run': {
        await this.cancelWorkflowRun(ref.refId);
        return { cancelled: true, alreadyTerminal: false, hasExternalSideEffects };
      }

      case 'workflow_step_run': {
        await this.cancelWorkflowStepRun(ref.refId);
        return { cancelled: true, alreadyTerminal: false, hasExternalSideEffects };
      }

      case 'approval_request': {
        const result = await this.cancelTerminalStoreRef(ref.refId, 'approval_request_cancelled', this.config.approvalRequestStore);
        return { cancelled: result.status === CANCELLATION_STATUSES.COMPLETED, alreadyTerminal: result.status === CANCELLATION_STATUSES.ALREADY_TERMINAL, hasExternalSideEffects };
      }

      case 'wait_condition': {
        const result = await this.cancelTerminalStoreRef(ref.refId, 'wait_condition_cancelled', this.config.waitConditionStore);
        return { cancelled: result.status === CANCELLATION_STATUSES.COMPLETED, alreadyTerminal: result.status === CANCELLATION_STATUSES.ALREADY_TERMINAL, hasExternalSideEffects };
      }

      case 'connector_operation': {
        const result = await this.cancelTerminalStoreRef(ref.refId, 'connector_operation_cancelled', this.config.connectorOperationStore);
        return { cancelled: result.status === CANCELLATION_STATUSES.COMPLETED, alreadyTerminal: result.status === CANCELLATION_STATUSES.ALREADY_TERMINAL, hasExternalSideEffects };
      }

      default:
        return { cancelled: false, alreadyTerminal: false, hasExternalSideEffects: false };
    }
  }

  private async cancelTerminalStoreRef(refId: string, eventType: string, store?: { getById: (id: string) => { status: string } | null; updateStatus: (id: string, status: string) => void }): Promise<CancellationResult> {
    if (!store) {
      return this.notCancellable(refId);
    }

    const ref = store.getById(refId);
    if (!ref) {
      return this.notCancellable(refId);
    }

    if (this.isTerminalStatus(ref.status)) {
      return this.alreadyTerminal(refId);
    }

    store.updateStatus(refId, 'cancelled');
    this.emitCancellationEvent(eventType, refId, undefined, undefined);
    return {
      status: CANCELLATION_STATUSES.COMPLETED,
      affectedRefs: [refId],
      failedRefs: [],
      partialRefs: [],
    };
  }

  private transitionTarget(targetType: string, targetId: string, status: string, eventSuffix: string): CancellationResult {
    const store = this.getTransitionStore(targetType);
    if (!store) {
      return this.notCancellable(targetId);
    }

    const ref = store.getById(targetId);
    if (!ref) {
      return this.notCancellable(targetId);
    }

    if (this.isTerminalStatus(ref.status)) {
      return this.alreadyTerminal(targetId);
    }

    store.updateStatus(targetId, status);
    this.emitCancellationEvent(`${targetType}_${eventSuffix}`, targetId, undefined, undefined);
    return {
      status: CANCELLATION_STATUSES.COMPLETED,
      affectedRefs: [targetId],
      failedRefs: [],
      partialRefs: [],
    };
  }

  private getTransitionStore(targetType: string): { getById: (id: string) => { status: string } | null; updateStatus: (id: string, status: string) => void } | undefined {
    switch (targetType) {
      case CANCELLATION_TARGET_TYPES.PLANNER_RUN:
        return this.config.plannerRunStore;
      case CANCELLATION_TARGET_TYPES.KERNEL_RUN:
        return this.config.kernelRunStore;
      case CANCELLATION_TARGET_TYPES.BACKGROUND_RUN:
      case CANCELLATION_TARGET_TYPES.SUBAGENT_RUN:
        return this.config.backgroundRunStore;
      case CANCELLATION_TARGET_TYPES.TOOL_EXECUTION:
        return this.config.toolExecutionStore;
      case CANCELLATION_TARGET_TYPES.WAIT_CONDITION:
        return this.config.waitConditionStore;
      default:
        return undefined;
    }
  }

  private getWorkflowStepChildRefs(stepRun: { status: string; kernelRunId?: string; subagentRunId?: string; toolCallId?: string; approvalId?: string }): Array<{ refId: string; refType: string; status: string }> {
    const refs: Array<{ refId: string; refType: string; status: string }> = [];
    if (stepRun.kernelRunId) refs.push({ refId: stepRun.kernelRunId, refType: 'kernel_run', status: stepRun.status });
    if (stepRun.subagentRunId) refs.push({ refId: stepRun.subagentRunId, refType: 'background_run', status: stepRun.status });
    if (stepRun.toolCallId) refs.push({ refId: stepRun.toolCallId, refType: 'tool_execution', status: stepRun.status });
    if (stepRun.approvalId) refs.push({ refId: stepRun.approvalId, refType: 'approval_request', status: stepRun.status });
    return refs;
  }

  private isTerminalStatus(status: string): boolean {
    return ['completed', 'failed', 'cancelled', 'archived', 'expired', 'timeout', 'denied', 'rejected'].includes(status);
  }

  private notCancellable(targetId: string): CancellationResult {
    return {
      status: CANCELLATION_STATUSES.NOT_CANCELLABLE,
      affectedRefs: [],
      failedRefs: [targetId],
      partialRefs: [],
    };
  }

  private alreadyTerminal(targetId: string): CancellationResult {
    return {
      status: CANCELLATION_STATUSES.ALREADY_TERMINAL,
      affectedRefs: [],
      failedRefs: [],
      partialRefs: [targetId],
    };
  }

  private hasExternalSideEffects(toolName: string): boolean {
    const externalTools = [
      'sendEmail',
      'sendMessage',
      'createTicket',
      'postToApi',
      'writeFile',
      'deleteFile',
      'updateDatabase',
      'sendNotification',
    ];
    return externalTools.some(t => toolName.toLowerCase().includes(t.toLowerCase()));
  }

  private emitCancellationEvent(eventType: string, targetId: string, userId: string | undefined, sessionId: string | undefined): void {
    const now = new Date().toISOString();
    this.config.eventStore.append({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      eventType,
      sourceModule: 'recovery',
      userId,
      sessionId,
      correlationId: targetId,
      relatedRefs: { [eventType]: targetId },
      payload: {
        targetId,
        cancelledAt: now,
      },
      sensitivity: 'medium',
      retentionClass: 'standard',
      createdAt: now,
    });
  }
}

export function createCancellationCoordinator(config: CancellationCoordinatorConfig): CancellationCoordinator {
  return new CancellationCoordinatorImpl(config);
}
