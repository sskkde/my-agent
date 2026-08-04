import { getToolCatalog } from '../api/tool-catalog.js'
import type { AgentKernel } from '../kernel/agent-kernel.js'
import type { SkillPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { KernelRunInput, KernelRunResult } from '../kernel/types.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../permissions/agent-type-skill-envelope.js'
import type { SkillRegistry } from '../skills/types.js'
import type { SkillDocumentLoader } from '../skills/skill-document-loader.js'
import { buildSkillPlaneProjection } from '../skills/skill-plane-projection.js'
import type { AgentProfileRegistry } from '../taxonomy/agent-profile-registry.js'
import type { AgentConfig } from '../storage/agent-config-store.js'
import type { BackgroundRuntime } from '../subagents/background-runtime.js'
import type { ToolRegistry } from '../tools/types.js'
import { buildContextBundleFromForegroundState, type AttachmentResolver } from './context-bundle-builder.js'
import {
  DEFAULT_FOREGROUND_MAX_ITERATIONS,
  DEFAULT_FOREGROUND_TIMEOUT_MS,
  DEFAULT_FOREGROUND_TOKEN_BUDGET,
  mapKernelErrorToForegroundResult,
} from './kernel-guard-constants.js'
import type { ForegroundTurnInput, ForegroundTurnResult } from './foreground-runner-types.js'
import { buildForegroundToolProjection, toToolPlaneProjection } from './tool-projection-mapper.js'
import {
  mapKernelResultToTranscript,
  mapKernelResultToVisibleMessages,
  buildToolCallSummaries,
} from './tools/transcript-redaction-mapper.js'

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
  private readonly skillRegistry?: SkillRegistry
  private readonly skillEnvelopeRegistry?: AgentTypeSkillEnvelopeRegistry
  private readonly skillDocumentLoader?: SkillDocumentLoader
  private readonly agentProfileRegistry?: AgentProfileRegistry
  private readonly attachmentResolver?: AttachmentResolver
  private readonly backgroundRuntime?: BackgroundRuntime

  constructor(options?: CreateForegroundAgentOptions) {
    this.agentConfig = options?.agentConfig
    this.agentKernel = options?.agentKernel
    this.toolCatalog = options?.toolCatalog
    this.toolRegistry = options?.toolRegistry
    this.maxIterations = options?.maxIterations ?? DEFAULT_FOREGROUND_MAX_ITERATIONS
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_FOREGROUND_TIMEOUT_MS
    this.skillRegistry = options?.skillRegistry
    this.skillEnvelopeRegistry = options?.skillEnvelopeRegistry
    this.skillDocumentLoader = options?.skillDocumentLoader
    this.agentProfileRegistry = options?.agentProfileRegistry
    this.attachmentResolver = options?.attachmentResolver
    this.backgroundRuntime = options?.backgroundRuntime
  }

  setAgentKernel(kernel: AgentKernel): void {
    this.agentKernel = kernel
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry
  }

  private getToolSummaries(): ReturnType<typeof getToolCatalog> {
    if (this.toolCatalog) {
      return this.toolCatalog
    }

    if (!this.toolRegistry) {
      return []
    }

    return this.toolRegistry.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      sensitivity: tool.sensitivity,
    }))
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

    const contextBundle = buildContextBundleFromForegroundState(
      input.foregroundState,
      input,
      undefined,
      DEFAULT_FOREGROUND_TOKEN_BUDGET,
      this.attachmentResolver,
    )
    if (this.backgroundRuntime) {
      const notifications = this.backgroundRuntime.collectParentTurnNotifications({
        parentSessionId: input.sessionId,
      })
      if (notifications.length > 0) {
        contextBundle.orderedItems.push(...notifications)
      }
    }
    const allTools = this.getToolSummaries()
    const projectionResult = buildForegroundToolProjection(input, allTools, this.toolRegistry)
    const toolProjection = toToolPlaneProjection(projectionResult)
    const effectiveConfig = input.agentConfig ?? this.agentConfig
    const resolvedModel = input.foregroundState.resolvedModel ?? effectiveConfig?.model ?? 'gpt-4o-mini'

    const skillProjection = await this.buildForegroundSkillProjection(effectiveConfig)

    const kernelInput: KernelRunInput = {
      contextBundle,
      runId: input.turnId,
      agentId: input.agentId ?? 'foreground.default',
      agentType: 'main',
      userId: input.userId,
      sessionId: input.sessionId,
      toolProjection,
      ...(skillProjection ? { skillProjection } : {}),
      model: resolvedModel,
      ...(input.foregroundState.reasoningDepth ? { reasoningDepth: input.foregroundState.reasoningDepth } : {}),
      maxIterations: input.maxIterations ?? this.maxIterations,
      timeoutMs: input.timeoutMs ?? this.timeoutMs,
      ...(input.workDirRoot ? { workDirRoot: input.workDirRoot } : {}),
      ...(input.workDirId ? { workDirId: input.workDirId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }

    const kernelResult = await this.agentKernel.run(kernelInput)
    return this.mapKernelResultToForegroundResult(kernelResult, input.turnId)
  }

  private mapKernelResultToForegroundResult(kernelResult: KernelRunResult, turnId: string): ForegroundTurnResult {
    if (kernelResult.finalStatus === 'completed') {
      const runtimeSummary = mapKernelResultToTranscript(kernelResult) ?? undefined
      const visibleMessages = mapKernelResultToVisibleMessages(kernelResult, turnId)
      const toolCallSummaries = runtimeSummary?.toolCallSummaries ?? buildToolCallSummaries(kernelResult) ?? undefined
      return {
        status: 'completed',
        finalResponse: kernelResult.finalResponse ?? '',
        decisionTrace: {
          route: 'answer_directly',
          requiresPlanner: false,
          reason: 'Kernel execution completed',
        },
        structuredTrace: kernelResult.structuredTrace,
        runtimeSummary,
        toolCallSummaries,
        ...(visibleMessages.length > 0 ? { visibleMessages } : {}),
        kernelResult: {
          finalStatus: kernelResult.finalStatus,
          finalResponse: kernelResult.finalResponse,
          iterationsUsed: kernelResult.iterationsUsed,
          toolCallCount: kernelResult.toolCalls.length,
          ...(kernelResult.tokenUsage ? { tokenUsage: kernelResult.tokenUsage } : {}),
        },
      }
    }

    // Project partial visible messages from the kernel transcript so the
    // persisted transcript includes streamed text/tools that ran before the
    // hang/timeout. The error message is appended by persistTurnTranscript.
    const failedResult = mapKernelErrorToForegroundResult(kernelResult)
    const partialVisibleMessages = mapKernelResultToVisibleMessages(kernelResult, turnId)
    if (partialVisibleMessages.length > 0) {
      return { ...failedResult, visibleMessages: partialVisibleMessages }
    }
    return failedResult
  }

  private async buildForegroundSkillProjection(
    effectiveConfig?: AgentConfig,
  ): Promise<SkillPlaneProjection | undefined> {
    if (!this.skillRegistry || !this.skillEnvelopeRegistry || !this.skillDocumentLoader) {
      return undefined
    }

    const agentProfile = 'default_main'
    const profileDefaultSkillIds = this.agentProfileRegistry?.get(agentProfile)?.defaultSkillIds

    return buildSkillPlaneProjection({
      agentType: 'main',
      registry: this.skillRegistry,
      envelopeRegistry: this.skillEnvelopeRegistry,
      documentLoader: this.skillDocumentLoader,
      agentConfigAllowedSkillIds: effectiveConfig?.allowedSkillIds ?? undefined,
      profileDefaultSkillIds: profileDefaultSkillIds ?? undefined,
      mode: 'documents',
    })
  }
}

export interface CreateForegroundAgentOptions {
  readonly agentConfig?: AgentConfig
  readonly agentKernel?: AgentKernel
  readonly toolCatalog?: ReturnType<typeof getToolCatalog>
  readonly toolRegistry?: ToolRegistry
  readonly skillRegistry?: SkillRegistry
  readonly skillEnvelopeRegistry?: AgentTypeSkillEnvelopeRegistry
  readonly skillDocumentLoader?: SkillDocumentLoader
  readonly agentProfileRegistry?: AgentProfileRegistry
  readonly maxIterations?: number
  readonly timeoutMs?: number
  readonly attachmentResolver?: AttachmentResolver
  /** Optional background runtime: injects exactly-once child-task notifications into the parent turn. */
  readonly backgroundRuntime?: BackgroundRuntime
}

export function createForegroundAgent(options?: CreateForegroundAgentOptions): ForegroundAgent {
  return new ForegroundAgentImpl(options)
}
