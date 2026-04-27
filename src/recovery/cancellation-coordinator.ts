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

      default:
        return { cancelled: false, alreadyTerminal: false, hasExternalSideEffects: false };
    }
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
