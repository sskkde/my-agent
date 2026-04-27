/**
 * Foreground Conversation Agent
 * Processes user messages and routes to appropriate decision
 */

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
} from './types.js';

export interface ForegroundAgent {
  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): ForegroundDecision;
}

class ForegroundAgentImpl implements ForegroundAgent {
  private patterns: IntentPatterns;

  constructor(patterns: IntentPatterns = DEFAULT_INTENT_PATTERNS) {
    this.patterns = patterns;
  }

  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): ForegroundDecision {
    const message = input.message.trim();
    const { effectivePolicy, activeWorkRefs } = state;

    // 1. Check for approval response
    if (input.metadata?.isApprovalResponse) {
      return this.createDecision('approval_handler', {
        reason: 'Processing approval response',
        userVisibleResponse: 'Processing your approval response...',
      });
    }

    // 2. Check for cancel/modify with active work
    if (this.isCancelOrModify(message) && this.hasActiveWork(activeWorkRefs, state.hydratedSession.sessionContext)) {
      const targetWork = this.resolveActiveWork(activeWorkRefs, state.hydratedSession.sessionContext);
      return this.createDecision('cancel_or_modify_task', {
        reason: `Cancel/modify request for active work: ${targetWork.workId}`,
        userVisibleResponse: 'Processing your cancel/modify request...',
        targetRef: {
          plannerRunId: targetWork.workType === 'planner_run' ? targetWork.workId : undefined,
          runtimeActionId: targetWork.workType === 'runtime_action' ? targetWork.workId : undefined,
        },
      });
    }

    // 3. Check for status query
    if (this.isStatusQuery(message)) {
      return this.createDecision('status_query', {
        reason: 'User requested status update',
        userVisibleResponse: 'Checking active work status...',
      });
    }

    // 4. Analyze task complexity
    const analysis = this.analyzeTask(message);

    // 5. Simple QA detection
    if (this.shouldAnswerDirectly(message, analysis)) {
      return this.createDecision('answer_directly', {
        reason: 'Simple question detected',
        userVisibleResponse: this.generateDirectResponse(message),
      });
    }

    // 6. Multi-step task -> spawn planner
    if (this.shouldSpawnPlanner(analysis, effectivePolicy)) {
      return this.createDecision('spawn_planner', {
        reason: `Complex task detected (${analysis.estimatedSteps} steps)`,
        userVisibleResponse: 'This looks like a multi-step task. Spawning planner...',
        requiresPlanner: true,
        estimatedSteps: analysis.estimatedSteps,
        complexity: analysis.complexity,
      });
    }

    // 7. Simple read -> dispatch_tool
    if (analysis.isSimpleRead && this.isAllowedToolCategory('read', effectivePolicy)) {
      return this.createDecision('dispatch_tool', {
        reason: 'Simple read task detected',
        userVisibleResponse: 'Processing your request...',
        suggestedTools: analysis.toolName ? [analysis.toolName] : undefined,
      });
    }

    // 8. Resume existing planner if one is active
    const plannerRunIds = state.hydratedSession.sessionContext.activePlannerRunIds;
    if (plannerRunIds.length > 0) {
      return this.createDecision('resume_existing_planner', {
        reason: 'Resuming existing planner run',
        userVisibleResponse: 'Resuming your previous task...',
        targetRef: { plannerRunId: plannerRunIds[0] },
      });
    }

    // Default: answer directly
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
      estimatedSteps: options.estimatedSteps,
      complexity: options.complexity,
      suggestedTools: options.suggestedTools,
    };
  }

  private isCancelOrModify(message: string): boolean {
    const lower = message.toLowerCase();
    return this.patterns.cancelKeywords.some(k => lower.includes(k.toLowerCase()));
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

  private resolveActiveWork(activeWorkRefs: ForegroundSessionState['activeWorkRefs'], sessionContext: ForegroundSessionState['hydratedSession']['sessionContext']) {
    if (sessionContext.activePlannerRunIds.length > 0) {
      return { workType: 'planner_run' as const, workId: sessionContext.activePlannerRunIds[0], canCancel: true };
    }
    if (sessionContext.activeBackgroundRunIds.length > 0) {
      return { workType: 'runtime_action' as const, workId: sessionContext.activeBackgroundRunIds[0], canCancel: true };
    }
    if (activeWorkRefs.activeRuns.length > 0) {
      return { workType: 'runtime_action' as const, workId: activeWorkRefs.activeRuns[0], canCancel: true };
    }
    return { workType: null as null, canCancel: false };
  }

  private shouldAnswerDirectly(message: string, analysis: TaskAnalysis): boolean {
    // Short questions without action verbs
    if (analysis.isQuestion && !analysis.hasMultipleActions && analysis.estimatedSteps <= 1) {
      return true;
    }
    // Very short messages with question marks
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

    // Detect questions
    if (this.patterns.questionIndicators.some(q => lower.includes(q.toLowerCase()))) {
      isQuestion = true;
    }
    if (message.includes('?') || message.includes('？')) {
      isQuestion = true;
    }

    // Detect multiple actions
    const actionCount = this.patterns.actionVerbs.filter(v => lower.includes(v.toLowerCase())).length;
    if (actionCount > 1 || this.patterns.multiStepIndicators.some(m => lower.includes(m.toLowerCase()))) {
      hasMultipleActions = true;
      estimatedSteps = Math.max(estimatedSteps, actionCount, 2);
    }

    // Detect complex tasks
    if (this.patterns.complexTaskIndicators.some(c => lower.includes(c.toLowerCase()))) {
      estimatedSteps = Math.max(estimatedSteps, 3);
      complexity = 'medium';
    }

    // Length-based complexity
    if (message.length > 100) {
      estimatedSteps = Math.max(estimatedSteps, 2);
      complexity = complexity === 'low' ? 'medium' : complexity;
    }
    if (message.length > 200) {
      estimatedSteps = Math.max(estimatedSteps, 3);
      complexity = 'high';
    }

    // Detect simple read (only if not a multi-step task)
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
