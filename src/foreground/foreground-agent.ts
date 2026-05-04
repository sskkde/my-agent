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
  TaskComplexity,
} from './types.js';
import type { RuntimeAction, TargetRuntime } from '../dispatcher/types.js';

import type { LLMAdapter } from '../llm/adapter.js';
import type { LLMRequest, LLMResult } from '../llm/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';

export interface ForegroundAgent {
  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): Promise<ForegroundDecision>;
}

/**
 * Known tool IDs from the catalog - used for server-side validation
 * TOOL IDs must be kept in sync with src/api/tool-catalog.ts
 */
const KNOWN_TOOL_IDS: string[] = [
  'artifact.create',
  'artifact.update',
  'ask_user',
  'status.query',
  'memory.retrieve',
  'transcript.search',
  'plan.patch',
  'docs.search',
];

/**
 * LLM Router output structure
 * NOTE: runtimeAction from LLM is REJECTED - server creates all runtime actions
 */
interface LLMRouterOutput {
  route: ForegroundDecisionRoute;
  reason: string;
  userVisibleResponse?: string;
  estimatedSteps?: number;
  complexity?: TaskComplexity;
  suggestedTools?: string[];
}

/**
 * Router error codes
 */
type RouterErrorCode =
  | 'MALFORMED_JSON'
  | 'INVALID_ROUTE'
  | 'MISSING_REQUIRED_FIELD'
  | 'EMPTY_REASON'
  | 'INVALID_RUNTIME_ACTION'
  | 'INVALID_COMPLEXITY'
  | 'INVALID_FIELD_TYPE'
  | 'LLM_REQUEST_FAILED';

/**
 * Router result type
 */
interface RouterResult {
  success: boolean;
  output?: LLMRouterOutput;
  error?: {
    code: RouterErrorCode;
    message: string;
    retryable: boolean;
  };
}

function generateActionId(): string {
  return `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

class ForegroundAgentImpl implements ForegroundAgent {
  private llmAdapter?: LLMAdapter;
  private agentConfig?: AgentConfig;

  constructor(_patterns: IntentPatterns = DEFAULT_INTENT_PATTERNS, llmAdapter?: LLMAdapter, agentConfig?: AgentConfig) {
    this.llmAdapter = llmAdapter;
    this.agentConfig = agentConfig;
  }

  async processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): Promise<ForegroundDecision> {
    const message = input.message.trim();
    const { activeWorkRefs: _activeWorkRefs } = state;

    // Bypass 1: Approval metadata - route directly without LLM
    if (input.metadata?.isApprovalResponse) {
      return this.createDecision('approval_handler', {
        reason: 'Processing approval response',
        userVisibleResponse: 'Processing your approval response...',
      });
    }

    // Bypass 2: No LLM provider available - return processing error
    if (!this.llmAdapter) {
      return this.createDecision('answer_directly', {
        reason: 'No LLM provider available for routing',
        userVisibleResponse: 'Unable to process message: no AI provider configured.',
      });
    }

    const prompt = this.buildRoutingPrompt(message, state);
    const llmResult = await this.callLLMRouter(prompt, state);

    if (!llmResult.success) {
      // Retry with repair prompt if attempts remain
      const maxRepairAttempts = this.agentConfig?.repairAttempts ?? 1;
      if (maxRepairAttempts > 0 && llmResult.error?.retryable) {
        const repairPrompt = this.buildRepairPrompt(prompt, llmResult.error?.message || 'Unknown error');
        const retryResult = await this.callLLMRouter(repairPrompt, state);

        if (retryResult.success) {
          return this.mapRouterOutputToDecision(retryResult.output!, input, state);
        }
      }

      // Both attempts failed - return graceful processing error
      return this.createDecision('answer_directly', {
        reason: 'LLM routing temporarily unavailable',
        userVisibleResponse: 'Routing temporarily unavailable. Please try again in a moment.',
      });
    }

    return this.mapRouterOutputToDecision(llmResult.output!, input, state);
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

  /**
   * Build the routing prompt for the LLM
   */
  private buildRoutingPrompt(message: string, state: ForegroundSessionState): string {
    const { effectivePolicy, currentPersona, hydratedSession } = state;
    const sessionContext = hydratedSession.sessionContext;

    const activeWorkSummary = this.buildActiveWorkSummary(state);
    const policySummary = `Steps threshold: ${effectivePolicy.estimatedStepsGte}, Max complexity: ${effectivePolicy.maxComplexity}, Allowed tools: ${effectivePolicy.allowedToolCategories.join(', ') || 'none'}`;
    const personaPrompt = currentPersona.directDelegationPolicy ? `Persona: ${currentPersona.name}` : '';

    return `You are a message router for an AI assistant. Analyze the user message and decide how to handle it.

AVAILABLE ROUTES:
- answer_directly: Simple questions, greetings, or anything that needs a direct response
- dispatch_tool: Simple read/search operations that can use a tool directly
- spawn_planner: Multi-step complex tasks requiring planning
- resume_existing_planner: Continue an existing planner session
- cancel_or_modify_task: Cancel, pause, resume, or modify active work
- status_query: Check status of active tasks
- dispatch_subagent: Tasks suitable for background execution
- approval_handler: Handle approval responses

SESSION STATE:
- Active planner runs: ${sessionContext.activePlannerRunIds.length}
- Active background runs: ${sessionContext.activeBackgroundRunIds.length}
${activeWorkSummary}

POLICY: ${policySummary}
${personaPrompt}

USER MESSAGE: "${message}"

Respond with valid JSON only:
{
  "route": "<one of the available routes>",
  "reason": "<brief explanation of routing decision>",
  "userVisibleResponse": "<optional immediate response to show user>",
  "estimatedSteps": <optional number>,
  "complexity": "<optional: low|medium|high|critical>",
  "suggestedTools": ["<optional tool names>"]
}`;
  }

  /**
   * Build a summary of active work for the prompt
   */
  private buildActiveWorkSummary(state: ForegroundSessionState): string {
    const parts: string[] = [];
    const { activeWorkRefs, hydratedSession } = state;
    const { activePlannerRunIds, activeBackgroundRunIds } = hydratedSession.sessionContext;

    if (activePlannerRunIds.length > 0) {
      parts.push(`- Planner runs: ${activePlannerRunIds.join(', ')}`);
    }
    if (activeBackgroundRunIds.length > 0) {
      parts.push(`- Background runs: ${activeBackgroundRunIds.join(', ')}`);
    }
    if (activeWorkRefs.pendingApprovals.length > 0) {
      parts.push(`- Pending approvals: ${activeWorkRefs.pendingApprovals.length}`);
    }
    if (activeWorkRefs.activeRuns.length > 0) {
      parts.push(`- Active runs: ${activeWorkRefs.activeRuns.join(', ')}`);
    }

    return parts.length > 0 ? `- ${parts.join('\n- ')}` : '- No active work';
  }

  /**
   * Build repair prompt when initial routing fails
   */
  private buildRepairPrompt(originalPrompt: string, errorMessage: string): string {
    return `${originalPrompt}

IMPORTANT: Your previous response was invalid. Error: ${errorMessage}
Please respond with valid JSON matching the exact schema shown above.`;
  }

  /**
   * Call the LLM router with 10s timeout and parse the response
   */
  private async callLLMRouter(prompt: string, state?: ForegroundSessionState): Promise<RouterResult> {
    if (!this.llmAdapter) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: 'No LLM adapter available',
          retryable: false,
        },
      };
    }

    const resolvedModel = state?.resolvedModel ?? this.agentConfig?.model ?? 'gpt-4o-mini';
    const systemPrompt = this.agentConfig?.systemPrompt ?? 'You are a message routing assistant. Respond only with valid JSON.';
    const routingPrompt = this.agentConfig?.routingPrompt;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (routingPrompt) {
      messages.push({ role: 'system', content: routingPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const request: LLMRequest = {
      model: resolvedModel,
      messages,
      temperature: 0.1,
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    };

    const ROUTER_TIMEOUT_MS = 10000;

    try {
      const result: LLMResult = await this.callLLMWithTimeout(request, ROUTER_TIMEOUT_MS);

      if (!result.success) {
        return {
          success: false,
          error: {
            code: 'LLM_REQUEST_FAILED',
            message: `LLM request failed: ${result.error?.message || 'Unknown error'}`,
            retryable: false,
          },
        };
      }

      return this.parseRouterOutput(result.response.content);
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: `Exception calling LLM: ${error instanceof Error ? error.message : 'Unknown error'}`,
          retryable: false,
        },
      };
    }
  }

  private async callLLMWithTimeout(request: LLMRequest, timeoutMs: number): Promise<LLMResult> {
    if (!this.llmAdapter) {
      return this.createTimeoutErrorResult('No LLM adapter available');
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`LLM router timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([this.llmAdapter.complete(request), timeoutPromise]).catch((error) =>
      this.createTimeoutErrorResult(error instanceof Error ? error.message : 'Unknown timeout error')
    );
  }

  private createTimeoutErrorResult(message: string): LLMResult {
    const now = new Date().toISOString();
    return {
      success: false,
      error: {
        errorId: `timeout-${Date.now()}`,
        category: 'timeout',
        code: 'ROUTER_TIMEOUT',
        message,
        recoverability: 'retryable_later',
        source: { module: 'foreground_agent' },
        createdAt: now,
      },
      providerId: 'unknown',
    };
  }

  /**
   * Parse and validate router output
   */
  private parseRouterOutput(rawOutput: string): RouterResult {
    const validRoutes: ForegroundDecisionRoute[] = [
      'answer_directly',
      'dispatch_tool',
      'dispatch_subagent',
      'spawn_planner',
      'resume_existing_planner',
      'approval_handler',
      'cancel_or_modify_task',
      'status_query',
    ];

    const validComplexities: TaskComplexity[] = ['low', 'medium', 'high', 'critical'];

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: 'Response is not valid JSON',
          retryable: true,
        },
      };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_JSON',
          message: 'Response must be a JSON object, not an array or primitive',
          retryable: true,
        },
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (!('route' in obj)) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: route',
          retryable: true,
        },
      };
    }

    if (!('reason' in obj)) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: reason',
          retryable: true,
        },
      };
    }

    // Validate route type and value
    if (typeof obj.route !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_FIELD_TYPE',
          message: 'Field "route" must be a string',
          retryable: true,
        },
      };
    }

    if (!validRoutes.includes(obj.route as ForegroundDecisionRoute)) {
      return {
        success: false,
        error: {
          code: 'INVALID_ROUTE',
          message: `Invalid route value: ${obj.route}. Must be one of: ${validRoutes.join(', ')}`,
          retryable: true,
        },
      };
    }

    // Validate reason type and value
    if (typeof obj.reason !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_FIELD_TYPE',
          message: 'Field "reason" must be a string',
          retryable: true,
        },
      };
    }

    if (obj.reason.trim().length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_REASON',
          message: 'Field "reason" must be a non-empty string',
          retryable: true,
        },
      };
    }

    // Validate optional fields
    if (obj.userVisibleResponse !== undefined && typeof obj.userVisibleResponse !== 'string') {
      return {
        success: false,
        error: {
          code: 'INVALID_FIELD_TYPE',
          message: 'Field "userVisibleResponse" must be a string',
          retryable: true,
        },
      };
    }

    if (obj.estimatedSteps !== undefined && typeof obj.estimatedSteps !== 'number') {
      return {
        success: false,
        error: {
          code: 'INVALID_FIELD_TYPE',
          message: 'Field "estimatedSteps" must be a number',
          retryable: true,
        },
      };
    }

    if (obj.complexity !== undefined) {
      if (typeof obj.complexity !== 'string' || !validComplexities.includes(obj.complexity as TaskComplexity)) {
        return {
          success: false,
          error: {
            code: 'INVALID_COMPLEXITY',
            message: `Field "complexity" must be one of: ${validComplexities.join(', ')}`,
            retryable: true,
          },
        };
      }
    }

    if (obj.suggestedTools !== undefined && !Array.isArray(obj.suggestedTools)) {
      return {
        success: false,
        error: {
          code: 'INVALID_FIELD_TYPE',
          message: 'Field "suggestedTools" must be an array',
          retryable: true,
        },
      };
    }

    // SECURITY: Reject LLM-provided runtimeAction - server creates all runtime actions
    // If LLM hallucinated a runtimeAction, we silently ignore it
    void obj.runtimeAction; // Explicitly mark as intentionally unused

    // Filter suggestedTools to only known tools (intersection with catalog)
    const rawSuggestedTools = obj.suggestedTools as string[] | undefined;
    const filteredSuggestedTools = rawSuggestedTools
      ? this.filterAllowedTools(rawSuggestedTools)
      : undefined;

    return {
      success: true,
      output: {
        route: obj.route as ForegroundDecisionRoute,
        reason: obj.reason,
        userVisibleResponse: obj.userVisibleResponse as string | undefined,
        estimatedSteps: obj.estimatedSteps as number | undefined,
        complexity: obj.complexity as TaskComplexity | undefined,
        suggestedTools: filteredSuggestedTools,
      },
    };
  }

  /**
   * Filter suggested tools against known tool catalog.
   * SECURITY: Only allow tools that exist in the known catalog.
   */
  private filterAllowedTools(suggestedTools: string[]): string[] {
    return suggestedTools.filter(toolId => KNOWN_TOOL_IDS.includes(toolId));
  }

  /**
   * Map router output to a ForegroundDecision
   */
  private mapRouterOutputToDecision(
    output: LLMRouterOutput,
    input: ForegroundMessageInput,
    state: ForegroundSessionState
  ): ForegroundDecision {
    const { route, reason, userVisibleResponse, estimatedSteps, complexity, suggestedTools } = output;

    // Handle special routes that need runtime actions
    if (route === 'cancel_or_modify_task') {
      const resolvedWork = this.resolveActiveWork(state.activeWorkRefs, state.hydratedSession.sessionContext);
      const interruptType = this.detectInterruptType(input.message);

      if (resolvedWork.isAmbiguous) {
        return this.createDecision('cancel_or_modify_task', {
          reason: 'Cancel/modify requested but multiple active tasks found',
          userVisibleResponse: 'You have multiple active tasks. Which one would you like to cancel?',
          requiresPlanner: false,
        });
      }

      if (!resolvedWork.targetWork?.workId) {
        return this.createDecision('answer_directly', {
          reason: 'Cancel/modify requested but no active work found',
          userVisibleResponse: 'There is no active work to cancel or modify.',
        });
      }

      const targetWork = resolvedWork.targetWork;
      const runtimeAction = this.createInterruptRuntimeAction(
        interruptType,
        targetWork,
        input.userId,
        input.sessionId,
        input.message
      );

      return this.createDecision('cancel_or_modify_task', {
        reason: `${reason} (${interruptType} request)`,
        userVisibleResponse: userVisibleResponse || `Processing your ${interruptType} request...`,
        targetRef: {
          plannerRunId: targetWork.workType === 'planner_run' ? targetWork.workId : undefined,
          runtimeActionId: targetWork.workType === 'runtime_action' ? targetWork.workId : undefined,
        },
        runtimeAction,
      });
    }

    if (route === 'status_query') {
      const runtimeAction = this.createStatusQueryRuntimeAction(input.userId, input.sessionId);
      return this.createDecision('status_query', {
        reason,
        userVisibleResponse: userVisibleResponse || 'Checking active work status...',
        targetRef: {},
        runtimeAction,
      });
    }

    // For routes that need active work resolution (resume_existing_planner)
    if (route === 'resume_existing_planner') {
      const plannerRunIds = state.hydratedSession.sessionContext.activePlannerRunIds;
      return this.createDecision('resume_existing_planner', {
        reason,
        userVisibleResponse: userVisibleResponse || 'Resuming your previous task...',
        targetRef: plannerRunIds.length > 0 ? { plannerRunId: plannerRunIds[0] } : {},
      });
    }

    // Default mapping for other routes
    return this.createDecision(route, {
      reason,
      userVisibleResponse,
      requiresPlanner: route === 'spawn_planner',
      estimatedSteps,
      complexity,
      suggestedTools,
    });
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
}

export interface CreateForegroundAgentOptions {
  patterns?: IntentPatterns;
  llmAdapter?: LLMAdapter;
  agentConfig?: AgentConfig;
}

export function createForegroundAgent(options?: CreateForegroundAgentOptions): ForegroundAgent {
  return new ForegroundAgentImpl(options?.patterns, options?.llmAdapter, options?.agentConfig);
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
