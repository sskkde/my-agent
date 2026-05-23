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
import { DEFAULT_REPAIR_ATTEMPTS, DEFAULT_ROUTING_TIMEOUT_MS } from '../storage/agent-config-store.js';
import { buildRoutingMessages, computeEffectiveAllowedToolIds } from '../agents/prompt-builder.js';
import { getToolCatalog } from '../api/tool-catalog.js';

export interface ForegroundAgent {
  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): Promise<ForegroundDecision>;
}

const TOOL_ALIASES: Record<string, string[]> = {
  search: ['docs.search'],
  'web.search': ['web.search'],
  'internet.search': ['web.search'],
  web: ['web.search'],
  'docs': ['docs.search'],
  'documentation.search': ['docs.search'],
  'transcript': ['transcript.search'],
  'memory.search': ['memory.retrieve'],
  'memory': ['memory.retrieve'],
  status: ['status.query'],
};

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
    const effectiveConfig = this.getEffectiveConfig(state);

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

    const toolCatalog = getToolCatalog().map(t => t.name);
    const messages = buildRoutingMessages({
      message,
      sessionState: state,
      agentConfig: effectiveConfig,
      toolCatalog,
    });
    const llmResult = await this.callLLMRouter(messages, state, toolCatalog);

    if (!llmResult.success) {
      // Retry with repair prompt if attempts remain
      const maxRepairAttempts = effectiveConfig?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS;
      if (maxRepairAttempts > 0 && llmResult.error?.retryable) {
        const retryMessages = llmResult.error.code === 'LLM_REQUEST_FAILED'
          ? messages
          : this.buildRepairMessages(messages, llmResult.error?.message || 'Unknown error');
        const retryResult = await this.callLLMRouter(retryMessages, state, toolCatalog);

        if (retryResult.success) {
          return this.mapRouterOutputToDecision(retryResult.output!, input, state, toolCatalog);
        }
      }

      // Deterministic fallback when LLM fails
      if (llmResult.error?.code === 'LLM_REQUEST_FAILED') {
        const fallbackDecision = this.routeDeterministically(input.message, state, toolCatalog);
        if (fallbackDecision) {
          return fallbackDecision;
        }
      }

      // Both attempts failed - return graceful processing error
      return this.createDecision('answer_directly', {
        reason: 'LLM routing temporarily unavailable',
        userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
      });
    }

    return this.mapRouterOutputToDecision(llmResult.output!, input, state, toolCatalog);
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

  private routeDeterministically(
    userMessage: string,
    state: ForegroundSessionState,
    toolCatalog: string[]
  ): ForegroundDecision | null {
    const content = userMessage.toLowerCase().trim();

    const effectiveConfig = this.getEffectiveConfig(state);
    const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog);

    if (content.includes('search') || content.includes('find') || content.includes('look up') || content.includes('搜索') || content.includes('查找')) {
      const suggestedTools = this.filterAllowedTools(['docs.search'], effectiveToolIds);
      if (suggestedTools.length > 0) {
        return this.createDecision('dispatch_tool', {
          reason: 'Deterministic fallback: search-related query detected',
          userVisibleResponse: 'Searching for information...',
          suggestedTools,
        });
      }
    }

    if (content.includes('status') || content.includes('progress') || content.includes('what is running') || content.includes('状态')) {
      const suggestedTools = this.filterAllowedTools(['status.query'], effectiveToolIds);
      if (suggestedTools.length > 0) {
        return this.createDecision('status_query', {
          reason: 'Deterministic fallback: status query detected',
          userVisibleResponse: 'Checking status...',
          suggestedTools,
        });
      }
    }

    if (content.includes('plan') || content.includes('step') || content.includes('task') || content.includes('计划') || content.includes('步骤')) {
      return this.createDecision('spawn_planner', {
        reason: 'Deterministic fallback: planning-related query detected',
        userVisibleResponse: 'Planning your task...',
        requiresPlanner: true,
      });
    }

    return null;
  }

  private getEffectiveConfig(state?: ForegroundSessionState): AgentConfig | undefined {
    return state?.agentConfig ?? this.agentConfig;
  }

  private buildRepairMessages(
    originalMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    errorMessage: string
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    let lastUserIndex = -1;
    for (let i = originalMessages.length - 1; i >= 0; i--) {
      if (originalMessages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) {
      return originalMessages;
    }
    const lastUserMessage = originalMessages[lastUserIndex];
    const repairedUserContent = `${lastUserMessage.content}

IMPORTANT: Your previous response was invalid. Error: ${errorMessage}
Please respond with valid JSON matching the exact schema shown above.`;
    return originalMessages.map((m, i) =>
      i === lastUserIndex
        ? { ...m, content: repairedUserContent }
        : m
    );
  }

  private async callLLMRouter(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    state?: ForegroundSessionState,
    _toolCatalog?: string[]
  ): Promise<RouterResult> {
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

    const effectiveConfig = this.getEffectiveConfig(state);
    const resolvedModel = state?.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini';
    const routingTimeoutMs = effectiveConfig?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS;

    const healthyProviders = this.llmAdapter.getHealthyProviders();
    const supportsJsonMode =
      healthyProviders.length > 0 &&
      healthyProviders.every((provider) => provider.config.capabilities.supportsJsonMode);

    const request: LLMRequest = {
      model: resolvedModel,
      messages,
      temperature: 0.1,
      maxTokens: 500,
      ...(supportsJsonMode ? { responseFormat: { type: 'json_object' } } : {}),
    };

    // Dev-only logging for prompt token estimation
    if (process.env.NODE_ENV !== 'production') {
      const promptTokens = messages.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0);
      console.log('[ForegroundAgent] callLLMRouter prompt estimate:', {
        messageCount: messages.length,
        estimatedPromptTokens: promptTokens,
        model: resolvedModel,
        temperature: 0.1,
        maxTokens: 500,
        jsonMode: supportsJsonMode,
      });
    }

    try {
      const result: LLMResult = await this.callLLMWithTimeout(request, routingTimeoutMs);

      if (!result.success) {
        const isRetryableProviderError = result.error?.recoverability === 'retryable_later' || result.error?.category === 'timeout';
        return {
          success: false,
          error: {
            code: 'LLM_REQUEST_FAILED',
            message: `LLM request failed: ${result.error?.message || 'Unknown error'}`,
            retryable: isRetryableProviderError,
          },
        };
      }

      return this.parseRouterOutput(result.response.content, state, _toolCatalog);
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
  private parseRouterOutput(
    rawOutput: string,
    state?: ForegroundSessionState,
    toolCatalog?: string[]
  ): RouterResult {
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
    const effectiveConfig = this.getEffectiveConfig(state);
    const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog ?? []);
    const filteredSuggestedTools = rawSuggestedTools
      ? this.filterAllowedTools(rawSuggestedTools, effectiveToolIds)
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
   * Filter suggested tools against known tool catalog and allowed tools.
   * SECURITY: Only allow tools that exist in the known catalog AND are in the allowed list.
   */
  private filterAllowedTools(suggestedTools: string[], effectiveToolIds: string[]): string[] {
    const knownToolIds = getToolCatalog().map(t => t.name);
    const normalizedTools = suggestedTools.flatMap((toolId) => (
      knownToolIds.includes(toolId) ? [toolId] : TOOL_ALIASES[toolId] ?? []
    ));
    return [...new Set(normalizedTools)].filter((id) => effectiveToolIds.includes(id));
  }

  /**
   * Map router output to a ForegroundDecision
   */
  private mapRouterOutputToDecision(
    output: LLMRouterOutput,
    input: ForegroundMessageInput,
    state: ForegroundSessionState,
    toolCatalog: string[]
  ): ForegroundDecision {
    const { route, reason, userVisibleResponse, estimatedSteps, complexity, suggestedTools } = output;

    // Deterministic safety: if dispatch_tool has no allowed suggested tools, convert to answer_directly
    if (route === 'dispatch_tool') {
      const effectiveConfig = this.getEffectiveConfig(state);
      const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog);
      const hasAllowedTools = suggestedTools && suggestedTools.length > 0 &&
        suggestedTools.some((t) => effectiveToolIds.includes(t));
      if (!hasAllowedTools) {
        return this.createDecision('answer_directly', {
          reason: `Dispatch tool requested but no allowed tools suggested (suggested: ${suggestedTools?.join(', ') ?? 'none'}); falling back to direct answer`,
          userVisibleResponse: userVisibleResponse || 'I don\'t have the right tools available to handle this request directly. Let me answer based on what I know.',
        });
      }
    }

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
