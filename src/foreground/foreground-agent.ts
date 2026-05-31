/**
 * Foreground Agent — User-facing conversation routing
 *
 * This module implements the foreground agent, which handles user-facing
 * interactions and produces routing decisions via the `foreground.decide`
 * internal tool or legacy routing_json mechanism.
 *
 * ## Foreground.decide Mechanism
 *
 * The `foreground.decide` tool is an **internal-only** structured-output
 * mechanism for native LLM function calling. It is NOT registered in the
 * public tool catalog. When enabled, the LLM invokes this tool to produce
 * a structured routing decision instead of free-form JSON text.
 *
 * ## Fallback Chain
 *
 * When foreground.decide is enabled, the fallback chain is:
 *   1. `foreground.decide` tool call
 *   2. Repair/retry (if extraction error is retryable)
 *   3. `routing_json` (legacy JSON-in-text mode, if FOREGROUND_DECIDE_LEGACY_FALLBACK=true)
 *   4. Deterministic routing (pattern-based fallback)
 *   5. `answer_directly` (final fallback)
 *
 * ## Feature Flags
 *
 * | Flag | Default | Description |
 * |------|---------|-------------|
 * | `FOREGROUND_DECIDE_ENABLED` | `false` | Enable the decide tool path |
 * | `FOREGROUND_DECIDE_SHADOW_MODE` | `false` | Run both decide + legacy paths, log diffs, return legacy result |
 * | `FOREGROUND_DECIDE_LEGACY_FALLBACK` | `true` | Fall back to routing_json if decide fails |
 *
 * ## Security Invariant
 *
 * **CRITICAL**: `runtimeAction` is NEVER taken from LLM output. The server
 * creates all runtime actions based on the decided route. This invariant
 * is enforced in multiple layers:
 *   - `foreground-decision-schema.ts`: runtimeAction excluded from schema
 *   - `foreground-decision-validator.ts`: runtimeAction stripped during normalization
 *   - `foreground-decide-extractor.ts`: runtimeAction never extracted
 *   - `mapRouterOutputToDecision()`: runtimeAction created server-side only
 *
 * ## P5 Cleanup Prerequisites
 *
 * In Phase 5, the following legacy code paths will be removed:
 *   - `callLLMRouter()` (legacy routing_json path)
 *   - `parseRouterOutput()` (legacy JSON parsing)
 *   - `FOREGROUND_DECIDE_LEGACY_FALLBACK` flag (no longer needed)
 *   - Shadow mode logging infrastructure
 *
 * Prerequisites for P5 cleanup:
 *   1. `FOREGROUND_DECIDE_ENABLED=true` must be the default
 *   2. All providers must support function calling
 *   3. Shadow mode tests must show 99%+ parity with legacy
 *   4. No production incidents attributed to decide path
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
  ActiveWorkResolution,
  ResolvedActiveWork,
  TaskComplexity,
} from './types.js';
import type { RuntimeAction, TargetRuntime } from '../dispatcher/types.js';
import { buildLaunchSubagentAction, inferSubagentType } from '../subagents/action-mapper.js';

import { extractForegroundDecideToolCall } from './foreground-decide-extractor.js';
import type { LLMAdapter } from '../llm/adapter.js';
import type { LLMRequest, LLMResult, LLMMessage } from '../llm/types.js';
import type { AgentConfig } from '../storage/agent-config-store.js';
import { DEFAULT_REPAIR_ATTEMPTS, DEFAULT_ROUTING_TIMEOUT_MS } from '../storage/agent-config-store.js';
import { buildRoutingMessages, computeEffectiveAllowedToolIds } from '../agents/prompt-builder.js';
import { getToolCatalog } from '../api/tool-catalog.js';
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js';
import { extractToolsForRequest } from '../kernel/model-input/model-input-builder.js';
import { resolveProviderFamily } from '../kernel/model-input/model-input-types.js';
import type { ModelInputBuildInput } from '../kernel/model-input/model-input-types.js';
import type { ModelInputSnapshotStore } from '../kernel/model-input/model-input-snapshot-store.js';
import { isPromptMemoryP0Enabled } from '../prompt/feature-flags.js';
import type { PromptProjectionResolver, PromptProjectionResolveResult } from '../prompt/prompt-projection-types.js';
import { FOREGROUND_DECIDE_SCHEMA } from './foreground-decision-schema.js';
import { validateForegroundDecideParams } from './foreground-decision-validator.js';
import type { AgentKernel } from '../kernel/agent-kernel.js';
import type { ContextBundle, ContextItem } from '../context/types.js';
import type { KernelRunResult, ToolUseRequest } from '../kernel/types.js';

// ─── Feature Flags ──────────────────────────────────────────────────────────
function isModelInputBuilderEnabled(): boolean {
  return process.env.MODEL_INPUT_BUILDER_ENABLED !== 'false';
}
function isModelInputShadowMode(): boolean {
  return process.env.MODEL_INPUT_SHADOW_MODE === 'true';
}
function isModelInputLegacyFallback(): boolean {
  return process.env.MODEL_INPUT_LEGACY_FALLBACK !== 'false';
}
export function isMemorySemanticPolicyEnabled(): boolean {
  return process.env.MEMORY_SEMANTIC_POLICY_ENABLED === 'true';
}

export function isForegroundDecideEnabled(): boolean {
  return process.env.FOREGROUND_DECIDE_ENABLED === 'true';
}

export function isForegroundDecideShadowMode(): boolean {
  return process.env.FOREGROUND_DECIDE_SHADOW_MODE === 'true';
}

export function isForegroundDecideLegacyFallback(): boolean {
  return process.env.FOREGROUND_DECIDE_LEGACY_FALLBACK !== 'false';
}

/**
 * Log deprecation warning when foreground.decide falls back to legacy routing_json.
 * Only logs in non-production environments.
 * Sanitized: does not include user message content or tool arguments.
 */
function logForegroundDecideFallback(reason: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.log('[ForegroundAgent] foreground.decide fallback:', reason);
}

export interface ForegroundAgent {
  processMessage(input: ForegroundMessageInput, state: ForegroundSessionState): Promise<ForegroundDecision>;
  /** Inject AgentKernel for kernel-backed foreground.decide routing. No-op if not supported. */
  setAgentKernel?(kernel: AgentKernel): void;
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
  private modelInputBuilder?: ModelInputBuilder;
  private modelInputSnapshotStore?: ModelInputSnapshotStore;
  private promptProjectionResolver?: PromptProjectionResolver;
  private agentKernel?: AgentKernel;

  constructor(
    _patterns: IntentPatterns = DEFAULT_INTENT_PATTERNS,
    llmAdapter?: LLMAdapter,
    agentConfig?: AgentConfig,
    modelInputBuilder?: ModelInputBuilder,
    modelInputSnapshotStore?: ModelInputSnapshotStore,
    promptProjectionResolver?: PromptProjectionResolver,
    agentKernel?: AgentKernel,
  ) {
    this.llmAdapter = llmAdapter;
    this.agentConfig = agentConfig;
    this.modelInputBuilder = modelInputBuilder;
    this.modelInputSnapshotStore = modelInputSnapshotStore;
    this.promptProjectionResolver = promptProjectionResolver;
    this.agentKernel = agentKernel;
  }

  setAgentKernel(kernel: AgentKernel): void {
    this.agentKernel = kernel;
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

    // ─── ModelInputBuilder integration ──────────────────────────────────────
    if (isModelInputBuilderEnabled() && this.modelInputBuilder) {
      const newBuildInput = await this.buildModelInput(input, state, toolCatalog);
      const isDecideMode = newBuildInput.mode === 'routing_tool_call';

      // ─── Decide shadow mode ─────────────────────────────────────────────
      // Run both decide + legacy paths in parallel, log diffs, return legacy result
      if (isDecideMode && isForegroundDecideShadowMode()) {
        const [legacyResult, decideResult] = await Promise.allSettled([
          this.callLLMRouter(messages, state, toolCatalog),
          this.runDecidePathWithRepair(newBuildInput, state, toolCatalog),
        ]);

        const legacyRouterResult = legacyResult.status === 'fulfilled' ? legacyResult.value : undefined;
        const decideRouterResult = decideResult.status === 'fulfilled' ? decideResult.value : undefined;

        if (decideRouterResult?.success && legacyRouterResult?.success) {
          this.logShadowDiff(decideRouterResult.output, legacyRouterResult.output);
        }

        if (legacyRouterResult) {
          return this.processRouterResult(legacyRouterResult, messages, state, toolCatalog, effectiveConfig, input);
        }
        return this.createDecision('answer_directly', {
          reason: 'LLM routing temporarily unavailable',
          userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
        });
      }

      // ─── Decide path active (not shadow) ────────────────────────────────
      // Fallback chain: kernel decide → direct decide → repair → routing_json → deterministic → answer_directly
      if (isDecideMode && this.agentKernel) {
        try {
          const kernelDecideResult = await this.runDecidePathViaKernel(newBuildInput, state, toolCatalog);
          if (kernelDecideResult.success) {
            return this.mapRouterOutputToDecision(kernelDecideResult.output!, input, state, toolCatalog);
          }
          logForegroundDecideFallback(`kernel decide path failed (${kernelDecideResult.error?.code}), falling back to direct decide`);
        } catch {
          logForegroundDecideFallback('kernel decide path threw, falling back to direct decide');
        }
      }

      if (isDecideMode) {
        try {
          const decideResult = await this.runDecidePathWithRepair(newBuildInput, state, toolCatalog);
          if (decideResult.success) {
            return this.mapRouterOutputToDecision(decideResult.output!, input, state, toolCatalog);
          }

          // Decide failed — fall back to routing_json if legacy fallback enabled
          if (isForegroundDecideLegacyFallback()) {
            logForegroundDecideFallback(`decide path failed (${decideResult.error?.code}), falling back to routing_json`);
            const legacyFallbackResult = await this.callLLMRouter(messages, state, toolCatalog);
            return this.processRouterResult(legacyFallbackResult, messages, state, toolCatalog, effectiveConfig, input);
          }

          // No legacy fallback — try deterministic, then answer_directly
          logForegroundDecideFallback('legacy fallback disabled, returning answer_directly');
          const deterministicDecision = this.routeDeterministically(input.message, state, toolCatalog);
          if (deterministicDecision) {
            return deterministicDecision;
          }
          return this.createDecision('answer_directly', {
            reason: 'LLM routing temporarily unavailable',
            userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
          });
        } catch {
          // Decide threw unexpectedly — fall back to routing_json if legacy fallback enabled
          if (isForegroundDecideLegacyFallback()) {
            logForegroundDecideFallback('decide tool LLM request failed, falling back to routing_json');
            const legacyFallbackResult = await this.callLLMRouter(messages, state, toolCatalog);
            return this.processRouterResult(legacyFallbackResult, messages, state, toolCatalog, effectiveConfig, input);
          }
          logForegroundDecideFallback('legacy fallback disabled, returning answer_directly');
          return this.createDecision('answer_directly', {
            reason: 'LLM routing temporarily unavailable',
            userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
          });
        }
      }

      // ─── Non-decide model-input-builder path ────────────────────────────
      if (isModelInputShadowMode()) {
        // Shadow: run both paths in parallel, log diffs, use old path result
        const [legacyResult, newBuildResult] = await Promise.allSettled([
          this.callLLMRouter(messages, state, toolCatalog),
          this.runNewPath(newBuildInput, state, toolCatalog),
        ]);

        const legacyRouterResult = legacyResult.status === 'fulfilled' ? legacyResult.value : undefined;

        if (newBuildResult.status === 'fulfilled' && newBuildResult.value.success && legacyRouterResult) {
          this.logShadowDiff(newBuildResult.value.output, legacyRouterResult.output);
        }

        if (legacyRouterResult) {
          return this.processRouterResult(legacyRouterResult, messages, state, toolCatalog, effectiveConfig, input);
        }
        return this.createDecision('answer_directly', {
          reason: 'LLM routing temporarily unavailable',
          userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
        });
      }

      // New path active (not shadow)
      try {
        const newResult = await this.runNewPath(newBuildInput, state, toolCatalog);
        if (newResult.success) {
          return this.mapRouterOutputToDecision(newResult.output!, input, state, toolCatalog);
        }

        // New path failed — fall back to legacy if enabled
        if (isModelInputLegacyFallback()) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[ForegroundAgent] new path failed, falling back to legacy:', newResult.error?.message);
          }
          const legacyFallbackResult = await this.callLLMRouter(messages, state, toolCatalog);
          return this.processRouterResult(legacyFallbackResult, messages, state, toolCatalog, effectiveConfig, input);
        }

        // No fallback — return error
        return this.createDecision('answer_directly', {
          reason: 'LLM routing temporarily unavailable',
          userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
        });
      } catch {
        // New path threw unexpectedly — fall back to legacy if enabled
        if (isModelInputLegacyFallback()) {
          const legacyFallbackResult = await this.callLLMRouter(messages, state, toolCatalog);
          return this.processRouterResult(legacyFallbackResult, messages, state, toolCatalog, effectiveConfig, input);
        }
        return this.createDecision('answer_directly', {
          reason: 'LLM routing temporarily unavailable',
          userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
        });
      }
    }

    // ─── Legacy path (flag off or no builder) ───────────────────────────────
    const legacyResult = await this.callLLMRouter(messages, state, toolCatalog);
    return this.processRouterResult(legacyResult, messages, state, toolCatalog, effectiveConfig, input);
  }

  private async processRouterResult(
    llmResult: RouterResult,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    state: ForegroundSessionState,
    toolCatalog: string[],
    effectiveConfig: AgentConfig | undefined,
    input: ForegroundMessageInput,
  ): Promise<ForegroundDecision> {
    if (!llmResult.success) {
      const maxRepairAttempts = effectiveConfig?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS;
      if (maxRepairAttempts > 0 && llmResult.error?.retryable) {
        const repairMessages = llmResult.error.code === 'LLM_REQUEST_FAILED'
          ? messages
          : this.buildRepairMessages(messages, llmResult.error?.message || 'Unknown error');
        const retryResult = await this.callLLMRouter(repairMessages, state, toolCatalog);
        if (retryResult.success) {
          return this.mapRouterOutputToDecision(retryResult.output!, input, state, toolCatalog);
        }
      }

      if (llmResult.error?.code === 'LLM_REQUEST_FAILED') {
        const fallbackDecision = this.routeDeterministically(input.message, state, toolCatalog);
        if (fallbackDecision) {
          return fallbackDecision;
        }
      }

      return this.createDecision('answer_directly', {
        reason: 'LLM routing temporarily unavailable',
        userVisibleResponse: 'The AI provider did not respond in time. Please try again in a moment.',
      });
    }

    return this.mapRouterOutputToDecision(llmResult.output!, input, state, toolCatalog);
  }

  private async buildModelInput(
    input: ForegroundMessageInput,
    state: ForegroundSessionState,
    toolCatalog: string[],
  ): Promise<ModelInputBuildInput> {
    const effectiveConfig = this.getEffectiveConfig(state);
    const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog);
    const providerFamily = resolveProviderFamily(state.resolvedProvider);

    const projections = await this.resolveProjections();

    const healthyProviders = this.llmAdapter?.getHealthyProviders() ?? [];
    const supportsFunctionCalling = healthyProviders.length > 0 && healthyProviders.every(p => p.config.capabilities.supportsFunctionCalling);
    const useDecide = isForegroundDecideEnabled() && supportsFunctionCalling;

    const mode = useDecide ? 'routing_tool_call' : 'routing_json';

    const toolProjectionTools = useDecide ? [FOREGROUND_DECIDE_SCHEMA] : undefined;

    return {
      mode,
      agentKind: 'foreground',
      providerFamily,
      systemPrompt: effectiveConfig?.systemPrompt ?? undefined,
      routingPrompt: effectiveConfig?.routingPrompt ?? undefined,
      toolProjection: {
        toolIds: effectiveToolIds,
        ...(toolProjectionTools ? { tools: toolProjectionTools } : {}),
      },
      contextBundle: {
        transcript: state.conversationHistory?.map(entry => ({
          role: entry.role as 'user' | 'assistant',
          content: entry.message,
        })),
      },
      currentUserMessage: input.message,
      currentDate: new Date().toISOString(),
      sessionId: input.sessionId,
      runId: input.turnId,
      messageId: input.turnId,
      requestId: input.turnId,
      ...projections,
    };
  }

  private async resolveProjections(): Promise<PromptProjectionResolveResult> {
    if (!isPromptMemoryP0Enabled() || !this.promptProjectionResolver) {
      return {};
    }
    return await this.promptProjectionResolver.resolve({});
  }

  private async runNewPath(
    buildInput: ModelInputBuildInput,
    state: ForegroundSessionState,
    _toolCatalog: string[],
  ): Promise<RouterResult> {
    if (!this.modelInputBuilder || !this.llmAdapter) {
      return { success: false, error: { code: 'LLM_REQUEST_FAILED', message: 'ModelInputBuilder or LLMAdapter not available', retryable: false } };
    }

    const built = await this.modelInputBuilder.build(buildInput);
    const effectiveConfig = this.getEffectiveConfig(state);
    const resolvedModel = state.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini';
    const routingTimeoutMs = effectiveConfig?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS;

    const healthyProviders = this.llmAdapter.getHealthyProviders();
    const supportsJsonMode = healthyProviders.length > 0 && healthyProviders.every(p => p.config.capabilities.supportsJsonMode);

    const isDecideMode = buildInput.mode === 'routing_tool_call';
    const toolsForRequest = isDecideMode ? extractToolsForRequest(buildInput) : undefined;

    const request: LLMRequest = {
      model: resolvedModel,
      messages: built.messages,
      temperature: 0.1,
      maxTokens: 500,
      ...(isDecideMode && toolsForRequest
        ? {
            tools: toolsForRequest,
            toolChoice: { type: 'function' as const, function: { name: 'foreground.decide' } },
          }
        : supportsJsonMode
          ? { responseFormat: { type: 'json_object' as const } }
          : {}),
    };

    if (process.env.NODE_ENV !== 'production') {
      const promptTokens = built.messages.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0);
      console.log('[ForegroundAgent] new path prompt estimate:', {
        messageCount: built.messages.length,
        estimatedPromptTokens: promptTokens,
        segmentHashes: built.segmentHashes,
        model: resolvedModel,
        isDecideMode,
      });
    }

    try {
      const result: LLMResult = await this.callLLMWithTimeout(request, routingTimeoutMs);
      if (!result.success) {
        const isRetryable = result.error?.recoverability === 'retryable_later' || result.error?.category === 'timeout';
        return { success: false, error: { code: 'LLM_REQUEST_FAILED', message: `LLM request failed: ${result.error?.message || 'Unknown error'}`, retryable: isRetryable } };
      }

      this.modelInputSnapshotStore?.record({
        agentKind: 'foreground',
        mode: buildInput.mode,
        builtInput: built,
        response: { content: result.response.content, toolCalls: result.response.toolCalls },
        tokenUsage: result.response.usage,
        provider: state.resolvedProvider,
        model: resolvedModel,
      });

      if (isDecideMode) {
        const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, _toolCatalog);
        const extraction = extractForegroundDecideToolCall(result.response.toolCalls, {
          toolCatalog: _toolCatalog,
          effectiveToolIds,
        });

        if (!extraction.success) {
          return {
            success: false,
            error: { code: 'MALFORMED_JSON', message: `foreground.decide extraction failed: ${extraction.detail}`, retryable: extraction.canRetry },
          };
        }

        const { decision } = extraction;
        return {
          success: true,
          output: {
            // SECURITY: Only safe fields extracted — runtimeAction is never passed through
            route: decision.route,
            reason: decision.reason,
            userVisibleResponse: decision.userVisibleResponse,
            estimatedSteps: decision.estimatedSteps,
            complexity: decision.complexity,
            suggestedTools: decision.suggestedTools,
          },
        };
      }

      return this.parseRouterOutput(result.response.content, state, _toolCatalog);
    } catch (error) {
      return { success: false, error: { code: 'MALFORMED_JSON', message: `Exception calling LLM: ${error instanceof Error ? error.message : 'Unknown error'}`, retryable: false } };
    }
  }

  /**
   * Call LLM with `foreground.decide` tool schema and extract the decision.
   * Shared by initial decide calls and repair attempts.
   */
  private async callDecideLLM(
    messages: LLMMessage[],
    state: ForegroundSessionState,
    toolCatalog: string[],
    buildInput: ModelInputBuildInput,
    built?: Awaited<ReturnType<NonNullable<ModelInputBuilder['build']>>>,
  ): Promise<RouterResult> {
    if (!this.llmAdapter) {
      return { success: false, error: { code: 'LLM_REQUEST_FAILED', message: 'LLMAdapter not available', retryable: false } };
    }

    const effectiveConfig = this.getEffectiveConfig(state);
    const resolvedModel = state.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini';
    const routingTimeoutMs = effectiveConfig?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS;

    const toolsForRequest = extractToolsForRequest(buildInput);

    const request: LLMRequest = {
      model: resolvedModel,
      messages,
      temperature: 0.1,
      maxTokens: 500,
      tools: toolsForRequest,
      toolChoice: { type: 'function' as const, function: { name: 'foreground.decide' } },
    };

    if (process.env.NODE_ENV !== 'production') {
      const promptTokens = messages.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0);
      console.log('[ForegroundAgent] decide LLM call prompt estimate:', {
        messageCount: messages.length,
        estimatedPromptTokens: promptTokens,
        model: resolvedModel,
      });
    }

    try {
      const result: LLMResult = await this.callLLMWithTimeout(request, routingTimeoutMs);
      if (!result.success) {
        const isRetryable = result.error?.recoverability === 'retryable_later' || result.error?.category === 'timeout';
        return { success: false, error: { code: 'LLM_REQUEST_FAILED', message: `LLM request failed: ${result.error?.message || 'Unknown error'}`, retryable: isRetryable } };
      }

      if (built) {
        this.modelInputSnapshotStore?.record({
          agentKind: 'foreground',
          mode: buildInput.mode,
          builtInput: built,
          response: { content: result.response.content, toolCalls: result.response.toolCalls },
          tokenUsage: result.response.usage,
          provider: state.resolvedProvider,
          model: resolvedModel,
        });
      }

      const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog);
      const extraction = extractForegroundDecideToolCall(result.response.toolCalls, {
        toolCatalog,
        effectiveToolIds,
      });

      if (!extraction.success) {
        return {
          success: false,
          error: { code: 'MALFORMED_JSON', message: `foreground.decide extraction failed: ${extraction.detail}`, retryable: extraction.canRetry },
        };
      }

      const { decision } = extraction;
      return {
        success: true,
        output: {
          // SECURITY: Only safe fields extracted — runtimeAction is never passed through
          route: decision.route,
          reason: decision.reason,
          userVisibleResponse: decision.userVisibleResponse,
          estimatedSteps: decision.estimatedSteps,
          complexity: decision.complexity,
          suggestedTools: decision.suggestedTools,
        },
      };
    } catch (error) {
      return { success: false, error: { code: 'MALFORMED_JSON', message: `Exception calling LLM: ${error instanceof Error ? error.message : 'Unknown error'}`, retryable: false } };
    }
  }

  /**
   * Run the decide path with a repair attempt on retryable extraction errors.
   *
   * Flow: build messages → call LLM with decide tool → extraction fails (retryable)
   *       → repair (add error to user message, re-call LLM) → return final result
   */
  private async runDecidePathWithRepair(
    buildInput: ModelInputBuildInput,
    state: ForegroundSessionState,
    toolCatalog: string[],
  ): Promise<RouterResult> {
    if (!this.modelInputBuilder) {
      return { success: false, error: { code: 'LLM_REQUEST_FAILED', message: 'ModelInputBuilder not available', retryable: false } };
    }

    const built = await this.modelInputBuilder.build(buildInput);
    const result = await this.callDecideLLM(built.messages, state, toolCatalog, buildInput, built);

    if (result.success) {
      return result;
    }

    if (!result.error?.retryable) {
      return result;
    }

    const effectiveConfig = this.getEffectiveConfig(state);
    const maxRepairAttempts = effectiveConfig?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS;
    if (maxRepairAttempts <= 0) {
      return result;
    }

    const repairMessages = this.buildRepairMessages(
      built.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      result.error.message,
    );
    return this.callDecideLLM(repairMessages, state, toolCatalog, buildInput, built);
  }

  /**
   * Run the decide path via AgentKernel infrastructure.
   *
   * Uses the kernel's shared modelInputBuilder, llmAdapter, and
   * modelInputSnapshotStore for a single-shot routing decision with
   * `foreground.decide` as an internal handler.
   *
   * The existing buildModelInput() output serves as modelInputOverride,
   * bypassing the kernel's own model input construction.
   *
   * On failure, callers should fall through to runDecidePathWithRepair
   * or legacy routing_json.
   */
  private async runDecidePathViaKernel(
    buildInput: ModelInputBuildInput,
    state: ForegroundSessionState,
    toolCatalog: string[],
  ): Promise<RouterResult> {
    if (!this.agentKernel) {
      return {
        success: false,
        error: { code: 'LLM_REQUEST_FAILED', message: 'AgentKernel not available', retryable: false },
      };
    }

    const effectiveConfig = this.getEffectiveConfig(state);
    const routingTimeoutMs = effectiveConfig?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS;
    const effectiveToolIds = computeEffectiveAllowedToolIds(effectiveConfig, toolCatalog);
    const resolvedModel = state.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini';
    const modelInputOverride: ModelInputBuildInput = {
      ...buildInput,
      toolProjection: {
        toolIds: effectiveToolIds,
        tools: [FOREGROUND_DECIDE_SCHEMA],
      },
    };

    try {
      const kernelResult = await this.agentKernel.run({
        contextBundle: this.buildKernelRoutingContextBundle(modelInputOverride, state),
        runId: modelInputOverride.runId ?? `foreground-route-${Date.now()}`,
        agentId: 'foreground.default',
        agentType: 'main',
        userId: state.hydratedSession.userContext.userId,
        sessionId: modelInputOverride.sessionId ?? state.hydratedSession.userContext.sessionId,
        toolProjection: modelInputOverride.toolProjection,
        internalToolHandlers: {
          'foreground.decide': async (request) => this.handleForegroundDecideToolCall(request, toolCatalog, effectiveToolIds),
        },
        modelInputOverride,
        temperature: 0.1,
        maxTokens: 500,
        toolChoice: { type: 'function' as const, function: { name: 'foreground.decide' } },
        model: resolvedModel,
        maxIterations: 1,
        timeoutMs: routingTimeoutMs,
      });

      return this.routerResultFromKernelResult(kernelResult);
    } catch (error) {
      return {
        success: false,
        error: { code: 'MALFORMED_JSON', message: `Exception calling LLM: ${error instanceof Error ? error.message : 'Unknown error'}`, retryable: false },
      };
    }
  }

  private buildKernelRoutingContextBundle(
    buildInput: ModelInputBuildInput,
    state: ForegroundSessionState,
  ): ContextBundle {
    const currentMessage = buildInput.currentUserMessage ?? '';
    const orderedItems: ContextItem[] = currentMessage
      ? [{
          itemId: `${buildInput.requestId ?? buildInput.runId ?? 'foreground'}-message`,
          sourceType: 'session_history',
          semanticType: 'instruction',
          content: currentMessage,
          estimatedTokens: Math.ceil(currentMessage.length / 4),
          freshnessTs: new Date().toISOString(),
        }]
      : [];

    return {
      bundleId: `${buildInput.runId ?? 'foreground-routing'}-bundle`,
      runId: buildInput.runId ?? `foreground-route-${Date.now()}`,
      agentId: 'foreground.default',
      agentType: 'main',
      userId: state.hydratedSession.userContext.userId,
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems,
      tokenEstimate: Math.max(1000, orderedItems.reduce((sum, item) => sum + (item.estimatedTokens ?? 0), 0)),
    };
  }

  private async handleForegroundDecideToolCall(
    request: ToolUseRequest,
    toolCatalog: string[],
    effectiveToolIds: string[],
  ) {
    const validation = validateForegroundDecideParams(request.params, {
      toolCatalog,
      effectiveToolIds,
    });

    if (!validation.valid) {
      const validationError = validation.error ?? {
        code: 'INVALID_PARAMS' as const,
        message: 'foreground.decide validation failed',
      };
      return {
        toolResult: {
          toolCallId: request.toolCallId,
          result: null,
          error: {
            code: validationError.code,
            message: validationError.message,
            recoverable: true,
          },
        },
        stop: true,
      };
    }

    const structuredResult = { decision: validation.decision };
    return {
      toolResult: {
        toolCallId: request.toolCallId,
        result: structuredResult,
      },
      stop: true,
      structuredResult,
    };
  }

  private routerResultFromKernelResult(kernelResult: KernelRunResult): RouterResult {
    if (kernelResult.error) {
      return {
        success: false,
        error: {
          code: 'LLM_REQUEST_FAILED',
          message: kernelResult.error.message,
          retryable: kernelResult.finalStatus === 'timeout',
        },
      };
    }

    if (!this.isForegroundDecisionStructuredResult(kernelResult.structuredResult)) {
      const toolError = this.firstKernelToolError(kernelResult);
      return {
        success: false,
        error: {
          code: toolError?.code === 'INVALID_ROUTE' ? 'INVALID_ROUTE' : 'MALFORMED_JSON',
          message: toolError?.message ?? `Kernel foreground.decide did not return a structured decision (status: ${kernelResult.finalStatus})`,
          retryable: toolError?.recoverable ?? true,
        },
      };
    }

    const { decision } = kernelResult.structuredResult;
    return {
      success: true,
      output: this.routerOutputFromDecision(decision),
    };
  }

  private firstKernelToolError(kernelResult: KernelRunResult): { code: string; message: string; recoverable: boolean } | undefined {
    for (const entry of kernelResult.transcript) {
      if (entry.type !== 'tool_result') continue;
      const content = entry.content;
      if (this.isToolResultWithError(content)) {
        return content.error;
      }
    }
    return undefined;
  }

  private isToolResultWithError(value: unknown): value is { error: { code: string; message: string; recoverable: boolean } } {
    if (typeof value !== 'object' || value === null || !('error' in value)) return false;
    const error = (value as { error?: unknown }).error;
    return typeof error === 'object'
      && error !== null
      && typeof (error as { code?: unknown }).code === 'string'
      && typeof (error as { message?: unknown }).message === 'string'
      && typeof (error as { recoverable?: unknown }).recoverable === 'boolean';
  }

  private isForegroundDecisionStructuredResult(value: unknown): value is { decision: ForegroundDecision } {
    if (typeof value !== 'object' || value === null || !('decision' in value)) return false;
    const decision = (value as { decision?: unknown }).decision;
    return typeof decision === 'object'
      && decision !== null
      && typeof (decision as { route?: unknown }).route === 'string'
      && typeof (decision as { reason?: unknown }).reason === 'string';
  }

  private routerOutputFromDecision(decision: ForegroundDecision): LLMRouterOutput {
    return {
      route: decision.route,
      reason: decision.reason,
      userVisibleResponse: decision.userVisibleResponse,
      estimatedSteps: decision.estimatedSteps,
      complexity: decision.complexity,
      suggestedTools: decision.suggestedTools,
    };
  }

  private logShadowDiff(newOutput: LLMRouterOutput | undefined, legacyOutput: LLMRouterOutput | undefined): void {
    if (!newOutput || !legacyOutput) return;

    if (process.env.NODE_ENV === 'production') return;

    const diffs: string[] = [];

    if (newOutput.route !== legacyOutput.route) {
      diffs.push(`route: new=${newOutput.route} legacy=${legacyOutput.route}`);
    }

    const newTools = newOutput.suggestedTools ?? [];
    const legacyTools = legacyOutput.suggestedTools ?? [];
    if (JSON.stringify([...newTools].sort()) !== JSON.stringify([...legacyTools].sort())) {
      diffs.push(`suggestedTools: new=[${newTools.join(',')}] legacy=[${legacyTools.join(',')}]`);
    }

    if (newOutput.complexity !== legacyOutput.complexity) {
      diffs.push(`complexity: new=${newOutput.complexity} legacy=${legacyOutput.complexity}`);
    }

    if (diffs.length === 0) {
      console.log('[ForegroundAgent] shadow mode: no diff');
    } else {
      console.log('[ForegroundAgent] shadow mode diff:', diffs.join('; '));
    }
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
   * Parse and validate router output.
   *
   * SECURITY: The LLM output is parsed into `LLMRouterOutput` which intentionally
   * excludes `runtimeAction`. Any runtime actions in the raw JSON are discarded
   * during parsing. Server-side creation happens only in `mapRouterOutputToDecision`.
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
   * Map router output to a ForegroundDecision.
   *
   * SECURITY INVARIANT: `runtimeAction` is NEVER taken from the LLM. It is
   * created server-side only for `status_query` and `cancel_or_modify_task`
   * routes. The `LLMRouterOutput` type omits `runtimeAction` entirely, so the
   * LLM-provided value cannot reach this function.
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

    // SECURITY: Server-side runtime action creation for special routes.
    // Neither handler reads runtimeAction from LLM output — they always create fresh.
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
      // SECURITY: runtimeAction created server-side — never from LLM
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
      // SECURITY: runtimeAction created server-side — never from LLM
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

    if (route === 'dispatch_subagent') {
      const agentType = inferSubagentType({
        message: input.message,
        suggestedTools,
        metadata: input.metadata as Record<string, unknown> | undefined,
      });

      const runtimeAction = buildLaunchSubagentAction({
        agentType,
        taskSpec: {
          objective: input.message,
          agentType,
          tools: suggestedTools,
        },
        userId: input.userId,
        sessionId: input.sessionId,
        sourceRef: {
          sourceType: 'foreground_turn',
          turnId: input.turnId,
        },
      });

      return this.createDecision('dispatch_subagent', {
        reason,
        userVisibleResponse: userVisibleResponse || 'Dispatching a specialized subagent...',
        runtimeAction,
        estimatedSteps,
        complexity,
        suggestedTools,
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
  modelInputBuilder?: ModelInputBuilder;
  modelInputSnapshotStore?: ModelInputSnapshotStore;
  promptProjectionResolver?: PromptProjectionResolver;
  agentKernel?: AgentKernel;
}

export function createForegroundAgent(options?: CreateForegroundAgentOptions): ForegroundAgent {
  return new ForegroundAgentImpl(options?.patterns, options?.llmAdapter, options?.agentConfig, options?.modelInputBuilder, options?.modelInputSnapshotStore, options?.promptProjectionResolver, options?.agentKernel);
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
