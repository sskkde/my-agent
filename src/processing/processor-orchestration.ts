/**
 * Message Processor Orchestration
 *
 * Full-pipeline implementation that hydrates state, runs
 * ForegroundAgent.runTurn(), persists transcripts, and returns
 * channel-neutral output.
 *
 * ## Architecture Flow
 *
 *   1. Hydrate session state via Gateway
 *   2. Resolve LLM provider/model with fallback
 *   3. Call ForegroundAgent.runTurn()
 *      → AgentKernel.run() with projected tools
 *      → Final response
 *   4. Persist turn transcript
 *   5. Schedule async memory extraction
 *
 * This module is strictly channel-neutral — no WebUI, SSE, ChannelRegistry,
 * or route delivery concerns leak into processing logic.
 */

import type {
  MessageProcessorInput,
  MessageProcessorOutput,
  MessageProcessorResult,
} from './types.js';
import type { ForegroundSessionState } from '../foreground/types.js';
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
import type { LongTermMemoryScheduler } from '../memory/long-term-memory-scheduler.js';
import type { ProcessingStatusPayload, TokenStreamPayload, ProcessingToolStatus } from '../api/types.js';
import { ProcessingStageLabel, type ProcessingStage } from '../api/types.js';
import { resolveProviderAndModel, type FallbackMetadata } from '../llm/agent-provider-resolver.js';
import type { ForegroundTurnInput } from '../foreground/foreground-runner-types.js';

const CONVERSATION_HISTORY_TURN_LIMIT = 20;

/**
 * Dependencies required for full-pipeline message processing
 */
export interface ProcessorOrchestrationDeps {
  /** Gateway for state hydration */
  gateway: Gateway;
  /** Stores for hydration and persistence */
  stores: Stores;
  /** Foreground agent for message processing (optional during transition) */
  foregroundAgent?: ForegroundAgent;
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

          const turnResult = await (deps.foregroundAgent?.runTurn?.(turnInput) ?? Promise.resolve({
            status: 'failed' as const,
            finalResponse: '',
            decisionTrace: {
              route: 'answer_directly' as const,
              requiresPlanner: false,
              reason: 'ForegroundAgent.runTurn not available',
            },
            error: {
              code: 'RUNTURN_UNAVAILABLE',
              message: 'ForegroundAgent.runTurn method not implemented',
            },
          }));

          if (turnResult.status === 'failed' || turnResult.error) {
            output = createErrorOutput(
              input.correlationId,
              'PROCESSING_ERROR',
              turnResult.error?.message ?? 'Foreground turn failed',
              turnResult.error?.code ? { foregroundErrorCode: turnResult.error.code } : undefined
            );
          } else {
            output = createSuccessOutput(input.correlationId, {
              text: turnResult.finalResponse || '',
              route: turnResult.decisionTrace?.route || 'answer_directly',
              data: {
                reason: turnResult.decisionTrace?.reason,
                runtimeSummary: turnResult.runtimeSummary,
                kernelResult: turnResult.kernelResult,
              },
            });
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

  const runtimeSummary = (output.success && output.result?.data?.runtimeSummary)
    ? output.result.data.runtimeSummary as TurnTranscript['runtimeSummary']
    : undefined;

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
