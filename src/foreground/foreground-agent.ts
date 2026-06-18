import { getToolCatalog } from '../api/tool-catalog.js'
import type { AgentKernel } from '../kernel/agent-kernel.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { ModelInputSnapshotStore } from '../kernel/model-input/model-input-snapshot-store.js'
import type { KernelRunInput, KernelRunResult } from '../kernel/types.js'
import type { LLMAdapter } from '../llm/adapter.js'
import type { PromptProjectionResolver } from '../prompt/prompt-projection-types.js'
import type { AgentConfig } from '../storage/agent-config-store.js'
import type { ToolRegistry } from '../tools/types.js'
import { buildContextBundleFromForegroundState } from './context-bundle-builder.js'
import {
  DEFAULT_FOREGROUND_MAX_ITERATIONS,
  DEFAULT_FOREGROUND_TIMEOUT_MS,
  mapKernelErrorToForegroundResult,
} from './kernel-guard-constants.js'
import type { ForegroundTurnInput, ForegroundTurnResult, ToolCallSummary } from './foreground-runner-types.js'
import { buildForegroundToolProjection, toToolPlaneProjection } from './tool-projection-mapper.js'
import { mapKernelResultToTranscript } from './tools/transcript-redaction-mapper.js'

export function isMemorySemanticPolicyEnabled(): boolean {
  return process.env.MEMORY_SEMANTIC_POLICY_ENABLED === 'true'
}

export interface ForegroundAgent {
  runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult>
  setAgentKernel?(kernel: AgentKernel): void
  setToolRegistry?(registry: ToolRegistry): void
}

class ForegroundAgentImpl implements ForegroundAgent {
  private readonly agentConfig?: AgentConfig
  private agentKernel?: AgentKernel
  private readonly toolCatalog?: ReturnType<typeof getToolCatalog>
  private toolRegistry?: ToolRegistry
  private readonly maxIterations: number
  private readonly timeoutMs: number

  constructor(options?: CreateForegroundAgentOptions) {
    this.agentConfig = options?.agentConfig
    this.agentKernel = options?.agentKernel
    this.toolCatalog = options?.toolCatalog
    this.toolRegistry = options?.toolRegistry
    this.maxIterations = options?.maxIterations ?? DEFAULT_FOREGROUND_MAX_ITERATIONS
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS
  }

  setAgentKernel(kernel: AgentKernel): void {
    this.agentKernel = kernel
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry
  }

  async runTurn(input: ForegroundTurnInput): Promise<ForegroundTurnResult> {
    if (!this.agentKernel) {
      return {
        status: 'failed',
        finalResponse: 'The kernel execution system is not configured. Please try again.',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'AgentKernel not available for runTurn',
        },
        error: {
          code: 'KERNEL_UNAVAILABLE',
          message: 'AgentKernel not injected',
        },
      }
    }

    const contextBundle = buildContextBundleFromForegroundState(input.foregroundState, input)
    const allTools = this.toolCatalog ?? getToolCatalog()
    const projectionResult = buildForegroundToolProjection(input, allTools, this.toolRegistry)
    const toolProjection = toToolPlaneProjection(projectionResult)
    const effectiveConfig = input.agentConfig ?? this.agentConfig
    const resolvedModel = input.foregroundState.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini'

    const kernelInput: KernelRunInput = {
      contextBundle,
      runId: input.turnId,
      agentId: input.agentId ?? 'foreground.default',
      agentType: 'main',
      userId: input.userId,
      sessionId: input.sessionId,
      toolProjection,
      model: resolvedModel,
      maxIterations: input.maxIterations ?? this.maxIterations,
      timeoutMs: input.timeoutMs ?? this.timeoutMs,
    }

    const kernelResult = await this.agentKernel.run(kernelInput)
    return this.mapKernelResultToForegroundResult(kernelResult)
  }

  private mapKernelResultToForegroundResult(kernelResult: KernelRunResult): ForegroundTurnResult {
    if (kernelResult.finalStatus === 'completed') {
      return {
        status: 'completed',
        finalResponse: kernelResult.finalResponse ?? '',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Kernel execution completed',
        },
        runtimeSummary: mapKernelResultToTranscript(kernelResult) ?? undefined,
        toolCallSummaries: this.extractToolCallSummaries(kernelResult),
        kernelResult: {
          finalStatus: kernelResult.finalStatus,
          finalResponse: kernelResult.finalResponse,
          iterationsUsed: kernelResult.iterationsUsed,
          toolCallCount: kernelResult.toolCalls.length,
        },
      }
    }

    return mapKernelErrorToForegroundResult(kernelResult)
  }

  private extractToolCallSummaries(kernelResult: KernelRunResult): ToolCallSummary[] {
    return kernelResult.toolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      status: 'completed',
    }))
  }
}

export interface CreateForegroundAgentOptions {
  readonly llmAdapter?: LLMAdapter
  readonly agentConfig?: AgentConfig
  readonly modelInputBuilder?: ModelInputBuilder
  readonly modelInputSnapshotStore?: ModelInputSnapshotStore
  readonly promptProjectionResolver?: PromptProjectionResolver
  readonly agentKernel?: AgentKernel
  readonly toolCatalog?: ReturnType<typeof getToolCatalog>
  readonly toolRegistry?: ToolRegistry
  readonly maxIterations?: number
  readonly timeoutMs?: number
}

export function createForegroundAgent(options?: CreateForegroundAgentOptions): ForegroundAgent {
  return new ForegroundAgentImpl(options)
}
