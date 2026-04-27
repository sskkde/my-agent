import {
  DEFAULT_INTENT_PATTERNS,
} from './types.js';
import type {
  ForegroundDecision,
  ForegroundDecisionRoute,
  ForegroundMessageInput,
  ForegroundSessionState,
  TaskAnalysis,
  DirectDelegationPolicy,
  IntentPatterns,
  ActiveWorkResolution,
  ResolvedActiveWork,
} from './types.js';
import type { RuntimeAction, TargetRuntime } from '../dispatcher/types.js';

export interface ForegroundAgent {
  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): ForegroundDecision;
}

function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

class ForegroundAgentImpl implements ForegroundAgent {
  private patterns: IntentPatterns;

  constructor(patterns: IntentPatterns = DEFAULT_INTENT_PATTERNS) {
    this.patterns = patterns;
  }

  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): ForegroundDecision {
    const message = input.message.trim();
    const { effectivePolicy, activeWorkRefs } = state;

    if (input.metadata?.isApprovalResponse) {
      return this.createDecision('approval_handler', {
        reason: 'Processing approval response',
        userVisibleResponse: 'Processing your approval response...',
      });
    }

    if (this.isCancelOrModify(message)) {
      if (!this.hasActiveWork(activeWorkRefs, state.hydratedSession.sessionContext)) {
        return this.createDecision('answer_directly', {
          reason: 'Cancel/modify requested but no active work found',
          userVisibleResponse: 'There is no active work to cancel or modify.',
        });
      }

      const resolvedWork = this.resolveActiveWork(activeWorkRefs, state.hydratedSession.sessionContext);
      const interruptType = this.detectInterruptType(message);

      if (resolvedWork.isAmbiguous) {
        return this.createDecision('cancel_or_modify_task', {
          reason: 'Cancel/modify request with ambiguous target',
          userVisibleResponse: this.generateAmbiguousTargetResponse(resolvedWork),
        });
      }

      const targetWork = resolvedWork.targetWork;
      if (!targetWork || !targetWork.workId) {
        return this.createDecision('answer_directly', {
          reason: 'Cancel/modify requested but no active work found',
          userVisibleResponse: 'There is no active work to cancel or modify.',
        });
      }

      const runtimeAction = this.createInterruptRuntimeAction(
        interruptType,
        targetWork,
        input.userId,
        input.sessionId,
        message
      );

      return this.createDecision('cancel_or_modify_task', {
        reason: `${interruptType} request for active work: ${targetWork.workId}`,
        userVisibleResponse: `Processing your ${interruptType} request...`,
        targetRef: {
          plannerRunId: targetWork.workType === 'planner_run' ? targetWork.workId : undefined,
          runtimeActionId: targetWork.workType === 'runtime_action' ? targetWork.workId : undefined,
        },
        runtimeAction,
      });
    }

    if (this.isStatusQuery(message)) {
      const runtimeAction = this.createStatusQueryRuntimeAction(input.userId, input.sessionId);
      return this.createDecision('status_query', {
        reason: 'User requested status update',
        userVisibleResponse: 'Checking active work status...',
        targetRef: {},
        runtimeAction,
      });
    }

    const analysis = this.analyzeTask(message);

    if (this.shouldAnswerDirectly(message, analysis)) {
      return this.createDecision('answer_directly', {
        reason: 'Simple question detected',
        userVisibleResponse: this.generateDirectResponse(message),
      });
    }

    if (this.shouldSpawnPlanner(analysis, effectivePolicy)) {
      return this.createDecision('spawn_planner', {
        reason: `Complex task detected (${analysis.estimatedSteps} steps)`,
        userVisibleResponse: 'This looks like a multi-step task. Spawning planner...',
        requiresPlanner: true,
        estimatedSteps: analysis.estimatedSteps,
        complexity: analysis.complexity,
      });
    }

    if (analysis.isSimpleRead && this.isAllowedToolCategory('read', effectivePolicy)) {
      return this.createDecision('dispatch_tool', {
        reason: 'Simple read task detected',
        userVisibleResponse: 'Processing your request...',
        suggestedTools: analysis.toolName ? [analysis.toolName] : undefined,
      });
    }

    const plannerRunIds = state.hydratedSession.sessionContext.activePlannerRunIds;
    if (plannerRunIds.length > 0) {
      return this.createDecision('resume_existing_planner', {
        reason: 'Resuming existing planner run',
        userVisibleResponse: 'Resuming your previous task...',
        targetRef: { plannerRunId: plannerRunIds[0] },
      });
    }

    return this.createDecision('answer_directly', {
      reason: 'Default fallback - no action needed',
      userVisibleResponse: this.generateDirectResponse(message),
    });
  }

  private createDecision(
    route: ForegroundDecisionRoute,
    options: {
      reason: string;
      userVisibleResponse?: string;
      requiresPlanner?: boolean;
      targetRef?: ForegroundDecision['targetRef'];
      runtimeAction?: RuntimeAction;
      estimatedSteps?: number;
      complexity?: TaskAnalysis['complexity'];
      suggestedTools?: string[];
    }
  ): ForegroundDecision {
    return {
      route,
      requiresPlanner: options.requiresPlanner ?? false,
      reason: options.reason,
      userVisibleResponse: options.userVisibleResponse,
      targetRef: options.targetRef,
      runtimeAction: options.runtimeAction,
      estimatedSteps: options.estimatedSteps,
      complexity: options.complexity,
      suggestedTools: options.suggestedTools,
    };
  }

  private createInterruptRuntimeAction(
    interruptType: string,
    targetWork: ActiveWorkResolution,
    userId: string,
    sessionId: string,
    originalMessage: string
  ): RuntimeAction {
    const actionType = this.mapInterruptTypeToActionType(interruptType, targetWork.workType);
    const targetRuntime = this.mapWorkTypeToTargetRuntime(targetWork.workType);
    const now = new Date().toISOString();

    return {
      actionId: generateActionId(),
      actionType: actionType as RuntimeAction['actionType'],
      targetRuntime: targetRuntime as RuntimeAction['targetRuntime'],
      source: {
        sourceModule: 'foreground_conversation_agent',
        sourceAction: interruptType,
      },
      userId,
      sessionId,
      targetRef: {
        runId: targetWork.workId,
      },
      targetAction: interruptType,
      payload: {
        workId: targetWork.workId,
        workType: targetWork.workType,
        reason: `User requested ${interruptType}`,
        originalMessage,
      },
      createdAt: now,
      updatedAt: now,
      status: 'created',
    };
  }

  private createStatusQueryRuntimeAction(userId: string, sessionId: string): RuntimeAction {
    const now = new Date().toISOString();

    return {
      actionId: generateActionId(),
      actionType: 'query_active_work',
      targetRuntime: 'gateway',
      source: {
        sourceModule: 'foreground_conversation_agent',
        sourceAction: 'status_query',
      },
      userId,
      sessionId,
      targetRef: {},
      targetAction: 'query',
      payload: {
        queryType: 'active_work_status',
        includeDetails: true,
      },
      createdAt: now,
      updatedAt: now,
      status: 'created',
    };
  }

  private mapInterruptTypeToActionType(
    interruptType: string,
    workType: ActiveWorkResolution['workType']
  ): string {
    if (workType === 'planner_run') {
      switch (interruptType) {
        case 'cancel':
          return 'cancel_planner_run';
        case 'pause':
          return 'pause_planner_run';
        case 'resume':
          return 'resume_planner_run';
        case 'modify':
          return 'update_plan_state';
        default:
          return 'cancel_planner_run';
      }
    }
    if (workType === 'runtime_action') {
      switch (interruptType) {
        case 'cancel':
          return 'cancel_planner_run';
        case 'pause':
          return 'pause_background_run';
        case 'resume':
          return 'resume_background_run';
        default:
          return 'cancel_planner_run';
      }
    }
    return 'cancel_planner_run';
  }

  private mapWorkTypeToTargetRuntime(workType: ActiveWorkResolution['workType']): TargetRuntime {
    switch (workType) {
      case 'planner_run':
        return 'planner_runtime';
      case 'runtime_action':
        return 'subagent_runtime';
      case 'subagent_run':
        return 'subagent_runtime';
      case 'workflow_run':
        return 'workflow_runtime';
      default:
        return 'planner_runtime';
    }
  }

  private detectInterruptType(message: string): string {
    const lower = message.toLowerCase();

    if (lower.includes('resume') || lower.includes('继续') || lower.includes('恢复')) {
      return 'resume';
    }
    if (lower.includes('pause') || lower.includes('暂停')) {
      return 'pause';
    }
    if (lower.includes('modify') || lower.includes('change') || lower.includes('update') ||
        lower.includes('调整') || lower.includes('修改') || lower.includes('更改')) {
      return 'modify';
    }
    return 'cancel';
  }

  private generateAmbiguousTargetResponse(resolvedWork: ResolvedActiveWork): string {
    const count = resolvedWork.activeWorkCount;
    return `You have ${count} active tasks. Please specify which one you want to cancel (multiple active tasks detected). Say something like "cancel the [task name]" or "cancel task [number]".`;
  }

  private isCancelOrModify(message: string): boolean {
    const lower = message.toLowerCase();
    return this.patterns.cancelKeywords.some(k => lower.includes(k.toLowerCase())) ||
           lower.includes('pause') ||
           lower.includes('resume') ||
           lower.includes('modify') ||
           lower.includes('change') ||
           lower.includes('update') ||
           lower.includes('adjust');
  }

  private isStatusQuery(message: string): boolean {
    const lower = message.toLowerCase();
    return this.patterns.statusKeywords.some(k => lower.includes(k.toLowerCase()));
  }

  private hasActiveWork(activeWorkRefs: ForegroundSessionState['activeWorkRefs'], sessionContext: ForegroundSessionState['hydratedSession']['sessionContext']): boolean {
    return (
      sessionContext.activePlannerRunIds.length > 0 ||
      sessionContext.activeBackgroundRunIds.length > 0 ||
      activeWorkRefs.activeRuns.length > 0 ||
      activeWorkRefs.pendingApprovals.length > 0
    );
  }

  private resolveActiveWork(activeWorkRefs: ForegroundSessionState['activeWorkRefs'], sessionContext: ForegroundSessionState['hydratedSession']['sessionContext']): ResolvedActiveWork {
    const allActiveWork: ActiveWorkResolution[] = [];

    for (const runId of sessionContext.activePlannerRunIds) {
      allActiveWork.push({
        workType: 'planner_run',
        workId: runId,
        canCancel: true,
        status: 'running',
      });
    }

    for (const runId of sessionContext.activeBackgroundRunIds) {
      allActiveWork.push({
        workType: 'runtime_action',
        workId: runId,
        canCancel: true,
        status: 'running',
      });
    }

    for (const runId of activeWorkRefs.activeRuns) {
      allActiveWork.push({
        workType: 'runtime_action',
        workId: runId,
        canCancel: true,
        status: 'running',
      });
    }

    if (allActiveWork.length === 0) {
      return {
        isAmbiguous: false,
        activeWorkCount: 0,
      };
    }

    if (allActiveWork.length === 1) {
      return {
        isAmbiguous: false,
        activeWorkCount: 1,
        targetWork: allActiveWork[0],
      };
    }

    return {
      isAmbiguous: true,
      activeWorkCount: allActiveWork.length,
      allActiveWork,
    };
  }

  private shouldAnswerDirectly(message: string, analysis: TaskAnalysis): boolean {
    if (analysis.isQuestion && !analysis.hasMultipleActions && analysis.estimatedSteps <= 1) {
      return true;
    }
    if (message.length < 50 && (message.includes('?') || message.includes('？') || message.includes('吗'))) {
      return true;
    }
    return false;
  }

  private shouldSpawnPlanner(analysis: TaskAnalysis, policy: DirectDelegationPolicy): boolean {
    return analysis.estimatedSteps >= policy.estimatedStepsGte || analysis.complexity === 'high';
  }

  private isAllowedToolCategory(category: string, policy: DirectDelegationPolicy): boolean {
    return policy.allowedToolCategories.includes(category as any);
  }

  private analyzeTask(message: string): TaskAnalysis {
    const lower = message.toLowerCase();
    let estimatedSteps = 1;
    let complexity: TaskAnalysis['complexity'] = 'low';
    let isQuestion = false;
    let hasMultipleActions = false;
    let isSimpleRead = false;

    if (this.patterns.questionIndicators.some(q => lower.includes(q.toLowerCase()))) {
      isQuestion = true;
    }
    if (message.includes('?') || message.includes('？')) {
      isQuestion = true;
    }

    const actionCount = this.patterns.actionVerbs.filter(v => lower.includes(v.toLowerCase())).length;
    if (actionCount > 1 || this.patterns.multiStepIndicators.some(m => lower.includes(m.toLowerCase()))) {
      hasMultipleActions = true;
      estimatedSteps = Math.max(estimatedSteps, actionCount, 2);
    }

    if (this.patterns.complexTaskIndicators.some(c => lower.includes(c.toLowerCase()))) {
      estimatedSteps = Math.max(estimatedSteps, 3);
      complexity = 'medium';
    }

    if (message.length > 100) {
      estimatedSteps = Math.max(estimatedSteps, 2);
      complexity = complexity === 'low' ? 'medium' : complexity;
    }
    if (message.length > 200) {
      estimatedSteps = Math.max(estimatedSteps, 3);
      complexity = 'high';
    }

    if (!hasMultipleActions && (lower.includes('search') || lower.includes('find') || lower.includes('get') || lower.includes('查找') || lower.includes('搜索')) && actionCount <= 1) {
      isSimpleRead = true;
    }

    return {
      estimatedSteps,
      complexity,
      isQuestion,
      hasMultipleActions,
      isSimpleRead,
    };
  }

  private generateDirectResponse(message: string): string {
    return `I understand: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`;
  }
}

export function createForegroundAgent(patterns?: IntentPatterns): ForegroundAgent {
  return new ForegroundAgentImpl(patterns);
}

export function mergeDelegationPolicies(
  personaPolicy: DirectDelegationPolicy,
  systemPolicy?: Partial<DirectDelegationPolicy>
): DirectDelegationPolicy {
  return {
    estimatedStepsGte: systemPolicy?.estimatedStepsGte ?? personaPolicy.estimatedStepsGte,
    maxComplexity: systemPolicy?.maxComplexity ?? personaPolicy.maxComplexity,
    allowedToolCategories: systemPolicy?.allowedToolCategories ?? personaPolicy.allowedToolCategories,
    requireConfirmationFor: systemPolicy?.requireConfirmationFor ?? personaPolicy.requireConfirmationFor,
  };
}
