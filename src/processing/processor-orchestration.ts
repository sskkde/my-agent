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
import { isForegroundDecideEnabled } from '../foreground/foreground-agent.js';
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
import type { LongTermMemoryScheduler } from '../memory/long-term-memory-scheduler.js';
import type { ProcessingStatusPayload, TokenStreamPayload, ProcessingToolStatus } from '../api/types.js';
import { ProcessingStageLabel, type ProcessingStage } from '../api/types.js';
import { resolveProviderAndModel, type FallbackMetadata } from '../llm/agent-provider-resolver.js';
import type { SearchSubagent, SearchSubagentInput, SearchSubagentResult } from '../search/search-subagent.js';
import { randomUUID } from 'crypto';
import { isToolLoopV2Enabled } from '../prompt/feature-flags.js';
import { mapToolResultToMessage } from '../tools/runtime/tool-result-message-mapper.js';
import type { ForegroundKernelRunner } from '../foreground/foreground-kernel-runner.js';
import { isForegroundKernelRunnerEnabled } from '../foreground/foreground-kernel-runner.js';
import type { ForegroundTurnInput } from '../foreground/foreground-runner-types.js';

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
  'file.read',
  'file.glob',
  'file.grep',
  'session.list',
  'session.history',
  'web.fetch',
  'web.search',
];

/**
 * Tools that are synchronous read/search operations.
 * When TOOL_LOOP_V2 is enabled and dispatch completes, these tools
 * return their result summary directly instead of an ack message.
 */
const SYNCHRONOUS_READ_SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'web.search',
  'web.fetch',
  'file.read',
  'file.glob',
  'file.grep',
  'memory.retrieve',
  'docs.search',
  'transcript.search',
  'status.query',
  'session.list',
  'session.history',
]);

const CONVERSATION_HISTORY_TURN_LIMIT = 20;

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
  runWithProvidersForUser?: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>;
  /** Observer for emitting processing status events (channel-neutral) */
  processingObserver?: {
    emitStatus(payload: ProcessingStatusPayload): void;
    emitToken?(payload: TokenStreamPayload): void;
  };
  /** Scheduler for async long-term memory extraction after transcript persistence */
  memoryExtractionScheduler?: LongTermMemoryScheduler;
  /** Search subagent for pure web.search dispatch */
  searchSubagent?: SearchSubagent;
  /** ForegroundKernelRunner for the new turn-based execution path */
  foregroundKernelRunner?: ForegroundKernelRunner;
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

function emitStatus(
  deps: ProcessorOrchestrationDeps,
  payload: ProcessingStatusPayload
): void {
  deps.processingObserver?.emitStatus(payload);
}

function buildStatusPayload(
  sessionId: string,
  attemptId: string,
  stage: ProcessingStage,
  providerId?: string,
  model?: string,
  activeTools: ProcessingToolStatus[] = [],
  error?: string
): ProcessingStatusPayload {
  return {
    sessionId,
    attemptId,
    stage,
    stageLabel: ProcessingStageLabel[stage],
    providerId,
    model,
    contextUsage: null, // Exact usage not available at this layer
    activeTools,
    timestamp: new Date().toISOString(),
    error,
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

    const resolvedProviderId = providerResolution?.type === 'success' ? providerResolution.selectedProviderId : undefined;
    const resolvedModel = providerResolution?.type === 'success' ? (providerResolution.selectedModel ?? undefined) : undefined;

    const execute = async (): Promise<MessageProcessorOutput> => {
      let output: MessageProcessorOutput;

      try {
        // Check inside execute() so the provider-scoped adapter's providers getter
        // runs within the AsyncLocalStorage scope set by runWithProvidersForUser.
        const hasNoProvider = providerResolution?.type === 'no-provider' || (!providerResolution && deps.llmAdapter.providers.length === 0);

        if (hasNoProvider) {
          emitStatus(deps, buildStatusPayload(
            input.sessionId,
            input.correlationId,
            'failed',
            undefined,
            undefined,
            [],
            'No LLM providers configured'
          ));
          
          output = createErrorOutput(
            input.correlationId,
            'PROCESSING_ERROR',
            'No LLM providers configured. Message received but cannot be processed.'
          );
        } else {
          emitStatus(deps, buildStatusPayload(
            input.sessionId,
            input.correlationId,
            'receiving',
            resolvedProviderId,
            resolvedModel
          ));

          const hydratedSession = deps.gateway.assembleHydratedState(
            input.userId,
            input.sessionId,
            deps.stores
          );

          const foregroundInput = buildForegroundMessageInput(input);

          const agentConfig = deps.agentConfigStore?.getByUser(input.userId);

          const resolvedProvider = providerResolution?.type === 'success' ? providerResolution.selectedProviderId : undefined;
          const resolvedModelInner = providerResolution?.type === 'success' ? (providerResolution.selectedModel ?? undefined) : undefined;

          const foregroundState = buildForegroundSessionState(
            hydratedSession,
            defaultPersonaId,
            defaultPersonaName,
            resolvedProvider,
            resolvedModelInner,
            agentConfig ?? undefined,
            buildConversationHistory(deps.transcriptStore, input.sessionId)
          );

          emitStatus(deps, buildStatusPayload(
            input.sessionId,
            input.correlationId,
            'routing',
            resolvedProviderId,
            resolvedModel
          ));

          emitStatus(deps, buildStatusPayload(
            input.sessionId,
            input.correlationId,
            'model_call',
            resolvedProviderId,
            resolvedModel
          ));

          const foregroundKernelRunnerEnabled = isForegroundKernelRunnerEnabled();

          if (foregroundKernelRunnerEnabled && deps.foregroundKernelRunner) {
            const turnInput: ForegroundTurnInput = {
              userId: input.userId,
              sessionId: input.sessionId,
              turnId: input.correlationId,
              message: input.text,
              timestamp: input.timestamp,
              hydratedState: hydratedSession,
              foregroundState,
              agentConfig: agentConfig ?? undefined,
            };

            const turnResult = await deps.foregroundKernelRunner.runTurn(turnInput);

            output = createSuccessOutput(input.correlationId, {
              text: turnResult.finalResponse || '',
              route: turnResult.decisionTrace?.route || 'answer_directly',
              data: {
                reason: turnResult.decisionTrace?.reason,
                runtimeSummary: turnResult.runtimeSummary,
                kernelResult: turnResult.kernelResult,
              },
            });
          } else {
            const decision = await deps.foregroundAgent.processMessage(foregroundInput, foregroundState);
            output = await handleDecisionRoute(input.correlationId, decision, deps, input, resolvedProviderId, resolvedModel);
          }
        }
      } catch (error) {
        emitStatus(deps, buildStatusPayload(
          input.sessionId,
          input.correlationId,
          'failed',
          resolvedProviderId,
          resolvedModel,
          [],
          error instanceof Error ? error.message : 'Unknown processing error'
        ));
        
        output = createErrorOutput(
          input.correlationId,
          'PROCESSING_ERROR',
          error instanceof Error ? error.message : 'Unknown processing error'
        );
      }

      emitStatus(deps, buildStatusPayload(
        input.sessionId,
        input.correlationId,
        'persisting',
        resolvedProviderId,
        resolvedModel
      ));

      const persisted = persistTurnTranscript(input, output, deps.transcriptStore);

      if (deps.memoryExtractionScheduler && persisted && output.success) {
        deps.memoryExtractionScheduler.scheduleAfterTurn({
          userId: input.userId,
          sessionId: input.sessionId,
          triggerTurnId: input.correlationId,
        });
      }

      emitStatus(deps, buildStatusPayload(
        input.sessionId,
        input.correlationId,
        'completed',
        resolvedProviderId,
        resolvedModel,
        []
      ));

      return output;
    };

    if (deps.runWithProvidersForUser) {
      return deps.runWithProvidersForUser(input.userId, execute, resolvedProviderId);
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
  resolvedModel?: string,
  agentConfig?: AgentConfig,
  conversationHistory?: ForegroundSessionState['conversationHistory']
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
    agentConfig,
    resolvedProvider,
    resolvedModel,
    conversationHistory,
  };
}

function buildConversationHistory(
  transcriptStore: TranscriptStore,
  sessionId: string
): ForegroundSessionState['conversationHistory'] {
  const transcripts = transcriptStore
    .findBySession(sessionId)
    .slice(-CONVERSATION_HISTORY_TURN_LIMIT);

  const history: NonNullable<ForegroundSessionState['conversationHistory']> = [];

  for (const turn of transcripts) {
    const userMessage = turn.input.userMessageSummary?.trim();
    let hasUserMessage = false;

    if (userMessage) {
      history.push({
        turnId: turn.turnId,
        role: 'user',
        message: userMessage,
        timestamp: turn.input.inboundTimestamp ?? turn.createdAt,
      });
      hasUserMessage = true;
    }

    for (const visibleMessage of turn.output.visibleMessages) {
      const content = visibleMessage.content.trim();
      if (!content) {
        continue;
      }

      if (visibleMessage.role === 'assistant') {
        history.push({
          turnId: turn.turnId,
          role: 'assistant',
          message: content,
          timestamp: turn.createdAt,
        });
      } else if (visibleMessage.role === 'user' && !hasUserMessage) {
        history.push({
          turnId: turn.turnId,
          role: 'user',
          message: content,
          timestamp: turn.input.inboundTimestamp ?? turn.createdAt,
        });
        hasUserMessage = true;
      }
    }
  }

  return history.length > 0 ? history : undefined;
}

/**
 * @deprecated P5: Remove once FOREGROUND_KERNEL_RUNNER_ENABLED=true is the only path.
 * This is the legacy route switch that handles ForegroundDecision routing.
 * Replaced by ForegroundKernelRunner.runTurn() when the feature flag is active.
 *
 * Removal prerequisites:
 * - FOREGROUND_KERNEL_RUNNER_ENABLED=true is the default (no fallback to processMessage path)
 * - All tests pass with FOREGROUND_KERNEL_RUNNER_ENABLED=true and FOREGROUND_DECIDE_ENABLED=true
 * - No remaining consumers of the legacy dispatch_tool/status_query/spawn_planner routing paths
 * - handleStatusQueryRoute, handleDispatchToolRoute, handleSpawnPlannerRoute are also removed
 * - validateRouteGuardrails and filterToolsAgainstAllowlist are either migrated or no longer needed
 */
async function handleDecisionRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  deps: ProcessorOrchestrationDeps,
  input: MessageProcessorInput,
  resolvedProviderId?: string,
  resolvedModel?: string
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
      return handleDispatchToolRoute(correlationId, decision, deps, input, filteredTools, resolvedProviderId, resolvedModel);

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
 * Handles the status_query route.
 *
 * @deprecated P5: Remove once FOREGROUND_KERNEL_RUNNER_ENABLED=true is the only path.
 * This is a legacy route handler invoked by handleDecisionRoute's switch statement.
 * ForegroundKernelRunner.runTurn() handles status_query internally via its own routing.
 *
 * Removal prerequisites:
 * - handleDecisionRoute is removed (no callers remain)
 * - FOREGROUND_KERNEL_RUNNER_ENABLED=true is the default
 * - All tests pass without this function
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
 * Infers appropriate parameters for a tool based on its name and user text.
 * Server-side parameter construction prevents LLM from injecting arbitrary payloads.
 */
function inferToolParams(toolName: string, text: string): Record<string, unknown> {
  switch (toolName) {
    case 'docs.search':
    case 'web.search':
      return { query: text };
    case 'status.query':
      return {};
    case 'memory.retrieve':
      return { query: text };
    case 'transcript.search':
      return { query: text };
    default:
      return { query: text };
  }
}

function resolveToolResultText(
  dispatchResult: { status: string; result?: unknown; error?: { code: string; message: string; recoverable: boolean } },
  toolCallId: string,
  toolName: string,
  fallbackText: string,
): string {
  if (!isToolLoopV2Enabled()) return fallbackText;
  if (dispatchResult.status !== 'completed') return fallbackText;
  if (!SYNCHRONOUS_READ_SEARCH_TOOLS.has(toolName)) return fallbackText;
  if (!dispatchResult.result && !dispatchResult.error) return fallbackText;

  const toolUseResult = {
    toolCallId,
    result: dispatchResult.result,
    ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
  };
  return mapToolResultToMessage(toolUseResult).content;
}

/**
 * Handles the dispatch_tool route.
 *
 * @deprecated P5: Remove once FOREGROUND_KERNEL_RUNNER_ENABLED=true is the only path.
 * This is a legacy route handler invoked by handleDecisionRoute's switch statement.
 * ForegroundKernelRunner.runTurn() handles dispatch_tool internally via ForegroundKernelRunner.
 *
 * Removal prerequisites:
 * - handleDecisionRoute is removed (no callers remain)
 * - FOREGROUND_KERNEL_RUNNER_ENABLED=true is the default
 * - All tests pass without this function
 * - SearchSubagent invocation (web.search exact-match branch) is migrated to ForegroundKernelRunner
 * - inferToolParams and resolveToolResultText are either migrated or no longer needed
 */
async function handleDispatchToolRoute(
  correlationId: string,
  decision: import('../foreground/types.js').ForegroundDecision,
  deps: ProcessorOrchestrationDeps,
  input: MessageProcessorInput,
  filteredTools: string[] | undefined,
  resolvedProviderId?: string,
  resolvedModel?: string
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
  // EXACT-MATCH BRANCH: Invoke SearchSubagent for pure web.search
  // Metis guardrail: Only invoke when filteredTools.length === 1 && filteredTools[0] === 'web.search'
  if (filteredTools.length === 1 && filteredTools[0] === 'web.search' && deps.searchSubagent) {
    // Get effective AgentConfig for user
    const agentConfig = deps.agentConfigStore?.getByUser(input.userId);
    
    if (agentConfig && agentConfig.searchLlmProviderId && agentConfig.searchLlmModel) {
      try {
        const searchInput: SearchSubagentInput = {
          query: input.text,
          userId: input.userId,
          sessionId: input.sessionId,
        };
        
        const searchResult: SearchSubagentResult = await deps.searchSubagent.execute(searchInput);
        
        if (searchResult.success) {
          return createSuccessOutput(correlationId, {
            text: searchResult.answer,
            route: decision.route,
            data: {
              reason: decision.reason,
              suggestedTools: filteredTools,
              searchSubagentMetadata: searchResult.metadata,
            },
          });
        } else {
          // SearchSubagent failed - fall through to default behavior
          // Log the failure but don't block the request
        }
      } catch (error) {
        // SearchSubagent threw an error - fall through to default behavior
        // Log the error but don't block the request
      }
    }
  }

  const activeTools: ProcessingToolStatus[] = filteredTools.map(toolId => ({
    toolId,
    status: 'running' as const,
  }));
  
  emitStatus(deps, buildStatusPayload(
    input.sessionId,
    input.correlationId,
    'tool_call',
    resolvedProviderId,
    resolvedModel,
    activeTools
  ));

  if (!decision.runtimeAction && filteredTools && filteredTools.length > 0) {
    const primaryTool = filteredTools[0];
    const now = new Date().toISOString();
    const serverRuntimeAction = {
      actionId: randomUUID(),
      actionType: 'execute_tool' as const,
      source: { sourceModule: 'processing', sourceAction: 'handleDispatchToolRoute' },
      targetRuntime: 'tool_plane' as const,
      targetAction: 'execute_tool',
      userId: input.userId,
      sessionId: input.sessionId,
      payload: {
        toolCallId: randomUUID(),
        toolName: primaryTool,
        params: inferToolParams(primaryTool, input.text),
      },
      status: 'created' as const,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const dispatchResult = await deps.runtimeDispatcher.dispatch({
        requestId: correlationId,
        action: serverRuntimeAction,
        context: {
          userId: input.userId,
          sessionId: input.sessionId,
          callerModule: 'processing',
        },
      });

      return createSuccessOutput(correlationId, {
        text: resolveToolResultText(
          dispatchResult,
          serverRuntimeAction.payload.toolCallId,
          primaryTool,
          decision.userVisibleResponse || 'Processing tool request...',
        ),
        route: decision.route,
        data: {
          reason: decision.reason,
          suggestedTools: filteredTools,
          hasRuntimeAction: true,
          dispatchResult: {
            actionId: dispatchResult.actionId,
            status: dispatchResult.status,
            targetRuntime: dispatchResult.targetRuntime,
            resultPreview: dispatchResult.result ? String(dispatchResult.result).substring(0, 256) : undefined,
            resultRef: dispatchResult.result ? `tr:${dispatchResult.actionId}` : undefined,
          },
        },
      });
    } catch (error) {
      // Dispatch failed - fall through to default behavior
      // This can happen when no adapter is registered for the target runtime
    }
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
        text: resolveToolResultText(
          dispatchResult,
          (decision.runtimeAction.payload?.toolCallId as string) ?? correlationId,
          (decision.runtimeAction.payload?.toolName as string) ?? '',
          decision.userVisibleResponse || 'Processing tool request...',
        ),
        route: decision.route,
        data: {
          reason: decision.reason,
          suggestedTools: filteredTools,
          hasRuntimeAction: true,
          dispatchResult: {
            actionId: dispatchResult.actionId,
            status: dispatchResult.status,
            targetRuntime: dispatchResult.targetRuntime,
            resultPreview: dispatchResult.result ? String(dispatchResult.result).substring(0, 256) : undefined,
            resultRef: dispatchResult.result ? `tr:${dispatchResult.actionId}` : undefined,
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

/**
 * @deprecated P5: Remove once FOREGROUND_KERNEL_RUNNER_ENABLED=true is the only path.
 * This is a legacy route handler invoked by handleDecisionRoute's switch statement.
 * ForegroundKernelRunner.runTurn() handles spawn_planner internally via its own routing.
 *
 * Removal prerequisites:
 * - handleDecisionRoute is removed (no callers remain)
 * - FOREGROUND_KERNEL_RUNNER_ENABLED=true is the default
 * - All tests pass without this function
 */
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
): boolean {
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

  let runtimeSummary: TurnTranscript['runtimeSummary'] | undefined;
  const kernelRunnerDecideActive = isForegroundKernelRunnerEnabled() && isForegroundDecideEnabled();

  if (output.success && output.result?.data?.runtimeSummary) {
    // New path: real runtimeSummary from ForegroundKernelRunner (real toolCallIds from kernel)
    runtimeSummary = output.result.data.runtimeSummary as TurnTranscript['runtimeSummary'];
  } else if (kernelRunnerDecideActive) {
    // Kernel runner/decide path is active but didn't supply a runtimeSummary.
    // Skip forging — real toolCallIds from kernel results take precedence.
    if (output.success && output.result?.route === 'dispatch_tool') {
      console.log('[persistTurnTranscript] Forging bypassed: FOREGROUND_KERNEL_RUNNER + FOREGROUND_DECIDE active; no forging applied for dispatch_tool route');
    }
  } else if (isToolLoopV2Enabled() && output.success && output.result?.route === 'dispatch_tool') {
    // Legacy forging: synthetic toolCallIds from suggestedTools (TOOL_LOOP_V2 only)
    const suggestedTools = output.result.data?.suggestedTools as string[] | undefined;
    if (suggestedTools && suggestedTools.length > 0) {
      const toolCallSummaries = suggestedTools.map((toolName, index) => ({
        toolCallId: `tc-${input.correlationId}-${index}`,
        toolName,
        status: 'completed' as const,
      }));
      runtimeSummary = { toolCallSummaries };
    }
  }

  const transcript: TurnTranscript = {
    turnId: input.correlationId,
    sessionId: input.sessionId,
    userId: input.userId,
    input: {
      inboundEventId,
      userMessageSummary: input.text,
      inboundTimestamp: input.timestamp,
    },
    output: {
      visibleMessages,
    },
    runtimeSummary,
    visibility: 'public',
    createdAt: output.timestamp,
  };

  try {
    transcriptStore.saveTurn(transcript);
    return true;
  } catch {
    return false;
  }
}
