/**
 * Message Processor Orchestration
 * Full-pipeline implementation that hydrates state, builds ForegroundMessageInput,
 * calls ForegroundAgent.processMessage(), and returns channel-neutral output.
 *
 * This module is strictly channel-neutral - no WebUI, SSE, ChannelRegistry,
 * or route delivery concerns leak into processing logic.
 */

import type {
  MessageProcessorInput,
  MessageProcessorOutput,
  MessageProcessorResult,
} from './types.js';
import type { ForegroundMessageInput, ForegroundSessionState } from '../foreground/types.js';
import type { ForegroundAgent } from '../foreground/foreground-agent.js';
import type { HydratedSessionState, Stores } from '../gateway/types.js';
import type { Gateway } from '../gateway/gateway.js';
import type { RuntimeDispatcher } from '../dispatcher/types.js';
import type { PlannerRuntime } from '../planner/planner-runtime.js';
import type { AgentKernel } from '../kernel/agent-kernel.js';
import type { LLMAdapter } from '../llm/adapter.js';
import type { TranscriptStore, TurnTranscript, VisibleMessage } from '../storage/transcript-store.js';
import type { EventStore } from '../storage/event-store.js';
import type { ProviderConfigStore } from '../storage/provider-config-store.js';
import type { AgentConfigStore, AgentConfig } from '../storage/agent-config-store.js';
import type { SessionStore } from '../storage/session-store.js';
import { resolveProviderAndModel, type FallbackMetadata } from '../llm/agent-provider-resolver.js';

/**
 * Known tool IDs from the catalog - used for server-side validation
 * Must be kept in sync with src/api/tool-catalog.ts
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
 * Filter suggested tools against AgentConfig allowlist and known catalog.
 * SECURITY: Intersects LLM suggestions with configured allowlists.
 */
function filterToolsAgainstAllowlist(
  suggestedTools: string[] | undefined,
  agentConfig: AgentConfig | null
): string[] | undefined {
  if (!suggestedTools || suggestedTools.length === 0) {
    return undefined;
  }

  // Get allowed tools from AgentConfig, or use all known tools if no config
  const allowedToolIds = agentConfig?.allowedToolIds?.length
    ? agentConfig.allowedToolIds
    : KNOWN_TOOL_IDS;

  // Intersection: suggested tools ∩ allowed tools ∩ known tools
  return suggestedTools.filter(
    toolId => allowedToolIds.includes(toolId) && KNOWN_TOOL_IDS.includes(toolId)
  );
}

/**
 * Validates if a route is allowed based on the decision content and guardrails.
 * Returns error message if route should be rejected, null if allowed.
 */
function validateRouteGuardrails(
  decision: import('../foreground/types.js').ForegroundDecision,
  _agentConfig: AgentConfig | null
): string | null {
  // For cancel_or_modify_task and status_query: ensure runtimeAction was created server-side
  // (ForegroundAgent already creates these, but we double-check here)
  if (decision.route === 'cancel_or_modify_task' || decision.route === 'status_query') {
    if (!decision.runtimeAction) {
      return `Route '${decision.route}' requires a server-created runtimeAction`;
    }
  }

  // Future: Use _agentConfig to check if certain routes are disabled for this agent

  // All other routes are allowed through (tool filtering happens at dispatch time)
  return null;
}

/**
 * Dependencies required for full-pipeline message processing
 */
export interface ProcessorOrchestrationDeps {
  /** Gateway for state hydration */
  gateway: Gateway;
  /** Stores for hydration and persistence */
  stores: Stores;
  /** Foreground agent for message processing */
  foregroundAgent: ForegroundAgent;
  /** Runtime dispatcher for action routing */
  runtimeDispatcher: RuntimeDispatcher;
  /** Planner runtime for planner operations */
  plannerRuntime: PlannerRuntime;
  /** Agent kernel for LLM execution */
  agentKernel: AgentKernel;
  /** LLM adapter for provider access */
  llmAdapter: LLMAdapter;
  /** Transcript store for persisting turn transcripts */
  transcriptStore: TranscriptStore;
  /** Event store for logging provider fallback events */
  eventStore?: EventStore;
  /** Provider config store for resolving providers */
  providerConfigStore?: ProviderConfigStore;
  /** Agent config store for agent configuration */
  agentConfigStore?: AgentConfigStore;
  /** Session store for session-specific provider/model selection */
  sessionStore?: SessionStore;
  /** Runs processing with request-scoped LLM providers for the current user */
  runWithProvidersForUser?: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
}

/**
 * Options for creating the orchestration processor function
 */
export interface CreateOrchestrationProcessorOptions {
  /** Dependencies for processing */
  deps: ProcessorOrchestrationDeps;
  /** Default persona ID to use */
  defaultPersonaId?: string;
  /** Default persona name */
  defaultPersonaName?: string;
  /** Session-scoped provider/model selection */
  sessionProviderSelection?: {
    selectedProviderId?: string;
    selectedModel?: string;
  };
}

/**
 * Creates a processor function that orchestrates the full pipeline:
 * hydrate -> foreground decision -> route handling -> output -> persist transcript
 *
 * @param options - Configuration options including dependencies
 * @returns Processor function compatible with MessageProcessorConfig
 */
export function createOrchestrationProcessor(
  options: CreateOrchestrationProcessorOptions
): (input: MessageProcessorInput) => Promise<MessageProcessorOutput> {
  const { deps, defaultPersonaId = 'default', defaultPersonaName = 'Assistant', sessionProviderSelection: optionSessionProviderSelection } = options;

  return async (input: MessageProcessorInput): Promise<MessageProcessorOutput> => {
    const execute = async (): Promise<MessageProcessorOutput> => {
      let output: MessageProcessorOutput;

      try {
        const sessionProviderSelection = deps.sessionStore
          ? (() => {
              const session = deps.sessionStore.getById(input.sessionId);
              return session
                ? { selectedProviderId: session.selectedProviderId, selectedModel: session.selectedModel }
                : {};
            })()
          : optionSessionProviderSelection ?? {};

      const providerResolution = resolveProviderWithFallback(
        deps.providerConfigStore,
        deps.eventStore,
        deps.agentConfigStore,
        input,
        sessionProviderSelection
      );

        const hasNoProvider = providerResolution?.type === 'no-provider' || deps.llmAdapter.providers.length === 0;

        if (hasNoProvider) {
          output = createErrorOutput(
            input.correlationId,
            'PROCESSING_ERROR',
            'No LLM providers configured. Message received but cannot be processed.'
          );
        } else {
          const hydratedSession = deps.gateway.assembleHydratedState(
            input.userId,
            input.sessionId,
            deps.stores
          );

          const foregroundInput = buildForegroundMessageInput(input);

          const resolvedProvider = providerResolution?.type === 'success' ? providerResolution.selectedProviderId : undefined;
          const resolvedModel = providerResolution?.type === 'success' ? (providerResolution.selectedModel ?? undefined) : undefined;

          const foregroundState = buildForegroundSessionState(
            hydratedSession,
            defaultPersonaId,
            defaultPersonaName,
            resolvedProvider,
            resolvedModel
          );

          const decision = await deps.foregroundAgent.processMessage(foregroundInput, foregroundState);

          // Step 5: Handle the decision route and produce output
          output = await handleDecisionRoute(input.correlationId, decision, deps, input);
        }
      } catch (error) {
        output = createErrorOutput(
          input.correlationId,
          'PROCESSING_ERROR',
          error instanceof Error ? error.message : 'Unknown processing error'
        );
      }

      // Step 6: Persist transcript (always execute, even on error)
      persistTurnTranscript(input, output, deps.transcriptStore);

      return output;
    };

    if (deps.runWithProvidersForUser) {
      return deps.runWithProvidersForUser(input.userId, execute);
    }

    return execute();
  };
}

/**
 * Builds ForegroundMessageInput from MessageProcessorInput
 */
function buildForegroundMessageInput(input: MessageProcessorInput): ForegroundMessageInput {
  return {
    message: input.text,
    userId: input.userId,
    sessionId: input.sessionId,
    turnId: input.correlationId, // Use correlationId as turnId for tracing
    timestamp: input.timestamp,
    metadata: input.metadata,
  };
}

function buildForegroundSessionState(
  hydratedSession: HydratedSessionState,
  personaId: string,
  personaName: string,
  resolvedProvider?: string,
  resolvedModel?: string
): ForegroundSessionState {
  return {
    hydratedSession,
    activeWorkRefs: hydratedSession.activeWorkRefs,
    currentPersona: {
      personaId,
      name: personaName,
      directDelegationPolicy: {
        estimatedStepsGte: 3,
        maxComplexity: 'medium',
        allowedToolCategories: ['read', 'search', 'internal'],
      },
    },
    effectivePolicy: {
      estimatedStepsGte: 3,
      maxComplexity: 'medium',
      allowedToolCategories: ['read', 'search', 'internal'],
    },
    resolvedProvider,
    resolvedModel,
  };
}

async function handleDecisionRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  deps: ProcessorOrchestrationDeps,
  input: MessageProcessorInput
): Promise<MessageProcessorOutput> {
  // Load AgentConfig for allowlist enforcement
  const agentConfig = deps.agentConfigStore?.getByUser(input.userId) ?? null;

  // Apply guardrails: validate route requirements
  const guardrailError = validateRouteGuardrails(decision, agentConfig);
  if (guardrailError) {
    return createErrorOutput(
      correlationId,
      'ROUTE_GUARDARIL_VIOLATION',
      guardrailError,
      { route: decision.route }
    );
  }

  // Filter suggested tools against allowlists
  const filteredTools = filterToolsAgainstAllowlist(decision.suggestedTools, agentConfig);

  switch (decision.route) {
    case 'answer_directly':
      return createSuccessOutput(correlationId, {
        text: decision.userVisibleResponse || 'I understand.',
        route: decision.route,
        data: {
          reason: decision.reason,
        },
      });

    case 'status_query':
      return handleStatusQueryRoute(correlationId, decision, deps);

    case 'dispatch_tool':
      return handleDispatchToolRoute(correlationId, decision, deps, input, filteredTools);

    case 'spawn_planner':
      return handleSpawnPlannerRoute(correlationId, decision, deps, input);

    case 'resume_existing_planner':
      return handleResumePlannerRoute(correlationId, decision);

    case 'dispatch_subagent':
      return handleDispatchSubagentRoute(correlationId, decision);

    case 'approval_handler':
      return handleApprovalHandlerRoute(correlationId, decision);

    case 'cancel_or_modify_task':
      return handleCancelOrModifyRoute(correlationId, decision);

    default:
      return createErrorOutput(
        correlationId,
        'UNSUPPORTED_ROUTE',
        `Route '${decision.route}' is not supported by this processor`,
        { route: decision.route }
      );
  }
}

/**
 * Handles the status_query route
 */
function handleStatusQueryRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  _deps: ProcessorOrchestrationDeps
): MessageProcessorOutput {
  // Status query is acknowledged but actual status retrieval would require
  // additional store queries. Return user-visible response.
  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Checking status...',
    route: decision.route,
    data: {
      reason: decision.reason,
      hasRuntimeAction: !!decision.runtimeAction,
    },
  });
}

/**
 * Handles the dispatch_tool route
 */
async function handleDispatchToolRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  deps: ProcessorOrchestrationDeps,
  input: MessageProcessorInput,
  filteredTools: string[] | undefined
): Promise<MessageProcessorOutput> {
  // SECURITY: Reject dispatch if no tools remain after filtering
  if (!filteredTools || filteredTools.length === 0) {
    return createErrorOutput(
      correlationId,
      'DISALLOWED_TOOLS',
      'None of the suggested tools are allowed for this user',
      { route: decision.route, originalSuggestions: decision.suggestedTools }
    );
  }

  if (decision.runtimeAction) {
    try {
      const dispatchResult = await deps.runtimeDispatcher.dispatch({
        requestId: correlationId,
        action: decision.runtimeAction,
        context: {
          userId: input.userId,
          sessionId: input.sessionId,
          callerModule: 'processing',
        },
      });

      return createSuccessOutput(correlationId, {
        text: decision.userVisibleResponse || 'Processing tool request...',
        route: decision.route,
        data: {
          reason: decision.reason,
          suggestedTools: filteredTools,
          hasRuntimeAction: true,
          dispatchResult: {
            actionId: dispatchResult.actionId,
            status: dispatchResult.status,
            targetRuntime: dispatchResult.targetRuntime,
          },
        },
      });
    } catch (error) {
      return createErrorOutput(
        correlationId,
        'DISPATCH_ERROR',
        error instanceof Error ? error.message : 'Tool dispatch failed',
        { route: decision.route, suggestedTools: filteredTools }
      );
    }
  }

  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Processing tool request...',
    route: decision.route,
    data: {
      reason: decision.reason,
      suggestedTools: filteredTools,
      hasRuntimeAction: false,
    },
  });
}

async function handleSpawnPlannerRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  deps: ProcessorOrchestrationDeps,
  input: MessageProcessorInput
): Promise<MessageProcessorOutput> {
  try {
    const plannerResult = deps.plannerRuntime.createPlannerRun({
      objective: decision.userVisibleResponse || input.text,
      userId: input.userId,
      sessionId: input.sessionId,
      contextBundle: {
        correlationId,
        estimatedSteps: decision.estimatedSteps,
        complexity: decision.complexity,
        reason: decision.reason,
      },
    });

    return createSuccessOutput(correlationId, {
      text: decision.userVisibleResponse || 'Spawning planner for multi-step task...',
      route: decision.route,
      data: {
        reason: decision.reason,
        estimatedSteps: decision.estimatedSteps,
        complexity: decision.complexity,
        requiresPlanner: decision.requiresPlanner,
        plannerRunId: plannerResult.plannerRunId,
        planId: plannerResult.planId,
        plannerStatus: plannerResult.status,
      },
    });
  } catch (error) {
    return createErrorOutput(
      correlationId,
      'PLANNER_SPAWN_ERROR',
      error instanceof Error ? error.message : 'Failed to spawn planner',
      { route: decision.route, estimatedSteps: decision.estimatedSteps }
    );
  }
}

/**
 * Handles the resume_existing_planner route
 */
function handleResumePlannerRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision
): MessageProcessorOutput {
  // Planner resume is acknowledged
  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Resuming existing planner...',
    route: decision.route,
    data: {
      reason: decision.reason,
      targetRef: decision.targetRef,
    },
  });
}

/**
 * Handles the dispatch_subagent route
 */
function handleDispatchSubagentRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision
): MessageProcessorOutput {
  // Subagent dispatch is acknowledged
  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Dispatching subagent...',
    route: decision.route,
    data: {
      reason: decision.reason,
      hasRuntimeAction: !!decision.runtimeAction,
    },
  });
}

/**
 * Handles the approval_handler route
 */
function handleApprovalHandlerRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision
): MessageProcessorOutput {
  // Approval handler is acknowledged
  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Processing approval...',
    route: decision.route,
    data: {
      reason: decision.reason,
    },
  });
}

/**
 * Handles the cancel_or_modify_task route
 */
function handleCancelOrModifyRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision
): MessageProcessorOutput {
  // Cancel/modify is acknowledged
  return createSuccessOutput(correlationId, {
    text: decision.userVisibleResponse || 'Processing cancel/modify request...',
    route: decision.route,
    data: {
      reason: decision.reason,
      targetRef: decision.targetRef,
      hasRuntimeAction: !!decision.runtimeAction,
    },
  });
}

/**
 * Creates a successful processing output
 */
function createSuccessOutput(
  correlationId: string,
  result: MessageProcessorResult
): MessageProcessorOutput {
  return {
    correlationId,
    success: true,
    result,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an error processing output
 */
function createErrorOutput(
  correlationId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>
): MessageProcessorOutput {
  return {
    correlationId,
    success: false,
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  };
}

function resolveProviderWithFallback(
  providerConfigStore: ProviderConfigStore | undefined,
  eventStore: EventStore | undefined,
  agentConfigStore: AgentConfigStore | undefined,
  input: MessageProcessorInput,
  sessionProviderSelection: { selectedProviderId?: string; selectedModel?: string }
): ReturnType<typeof resolveProviderAndModel> | null {
  if (!providerConfigStore) {
    return null;
  }

  const agentConfig = agentConfigStore?.getByUser(input.userId);
  const agentConfigProviderSettings = agentConfig
    ? { providerId: agentConfig.providerId ?? undefined, model: agentConfig.model ?? undefined }
    : {};

  const resolution = resolveProviderAndModel({
    session: sessionProviderSelection,
    agentConfig: agentConfigProviderSettings,
    userId: input.userId,
    providerConfigStore,
    includeEnvProviders: true,
  });

  if (resolution.type === 'success' && resolution.fallbackMetadata && eventStore) {
    logProviderFallbackEvent(eventStore, input, resolution.fallbackMetadata);
  }

  return resolution;
}

function logProviderFallbackEvent(
  eventStore: EventStore,
  input: MessageProcessorInput,
  fallbackMetadata: FallbackMetadata
): void {
  const eventId = `evt-fallback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  eventStore.append({
    eventId,
    eventType: 'llm_provider_fallback',
    sourceModule: 'foreground_agent',
    userId: input.userId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    payload: {
      originalProviderId: fallbackMetadata.originalProviderId,
      actualProviderId: fallbackMetadata.actualProviderId,
      fallbackReason: fallbackMetadata.fallbackReason,
    },
    sensitivity: 'low',
    retentionClass: 'standard',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Persists a turn transcript from the processing input and output.
 * Creates visible messages for assistant responses and errors.
 * SAFETY: Never persists raw internal reasoning as thinking_summary.
 */
function persistTurnTranscript(
  input: MessageProcessorInput,
  output: MessageProcessorOutput,
  transcriptStore: TranscriptStore
): void {
  const visibleMessages: VisibleMessage[] = [];

  if (output.success && output.result) {
    if (output.result.text) {
      visibleMessages.push({
        messageId: `msg-${input.correlationId}-assistant`,
        role: 'assistant',
        content: output.result.text,
      });
    }

    if (output.result.route && output.result.route !== 'answer_directly') {
      const statusContent = output.result.data?.reason
        ? `${output.result.route}: ${output.result.data.reason}`
        : `Processing via ${output.result.route}`;
      visibleMessages.push({
        messageId: `msg-${input.correlationId}-status`,
        role: 'system_status',
        content: statusContent,
      });
    }
  } else if (!output.success && output.error) {
    visibleMessages.push({
      messageId: `msg-${input.correlationId}-error`,
      role: 'error',
      content: `[${output.error.code}] ${output.error.message}`,
    });
  }

  const inboundEventId = input.metadata?.inboundEventId as string | undefined;

  const transcript: TurnTranscript = {
    turnId: input.correlationId,
    sessionId: input.sessionId,
    userId: input.userId,
    input: {
      inboundEventId,
      userMessageSummary: input.text,
    },
    output: {
      visibleMessages,
    },
    visibility: 'public',
    createdAt: output.timestamp,
  };

  try {
    transcriptStore.saveTurn(transcript);
  } catch {
    // Intentionally suppressed: transcript persistence is best-effort.
    // Processing result must be returned even if persistence fails.
    // Storage layer handles its own errors; processor continues.
  }
}
