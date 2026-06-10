import type { KernelAdapter, SubagentTaskSpec } from './types.js'
import type { SubagentDefinition, SubagentRegistry } from './registry.js'
import { resolveSubagentProvider } from './provider-policy.js'
import type { SubagentProviderPreferenceStore } from './provider-policy.js'
import type { AgentKernel } from '../kernel/agent-kernel.js'
import type { KernelRunInput, KernelRunResult } from '../kernel/types.js'
import type { ContextBundle } from '../context/types.js'
import type { ProviderConfigStore } from '../storage/provider-config-store.js'
import type { AgentConfigStore } from '../storage/agent-config-store.js'
import type { SessionStore } from '../storage/session-store.js'
import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolRegistry } from '../tools/types.js'
import { toLLMToolDefinition } from '../tools/tool-plane-prompt-projection.js'

export function buildToolProjection(
  definition: SubagentDefinition,
  taskSpec: SubagentTaskSpec,
  toolRegistry: ToolRegistry,
): ToolPlaneProjection {
  const allowedIds = definition.allowedToolIds ?? []
  const requestedIds = taskSpec.tools ?? []

  const effectiveIds = requestedIds.length > 0 ? allowedIds.filter((id) => requestedIds.includes(id)) : allowedIds

  const tools: ToolPlaneProjection['tools'] = []
  for (const toolId of effectiveIds) {
    const toolDef = toolRegistry.getTool(toolId)
    if (toolDef) {
      tools.push(toLLMToolDefinition(toolDef))
    } else {
      // Explicit safe failure: skip missing tools rather than granting broad access
      console.warn(`[SubagentAdapter] Tool "${toolId}" not found in registry, skipping`)
    }
  }

  return {
    toolIds: effectiveIds,
    tools,
  }
}

function extractSessionId(contextBundle: ContextBundle): string | undefined {
  for (const item of contextBundle.orderedItems) {
    if (item.structuredPayload?.sessionId) {
      return item.structuredPayload.sessionId as string
    }
  }
  for (const item of contextBundle.pinnedItems) {
    if (item.structuredPayload?.sessionId) {
      return item.structuredPayload.sessionId as string
    }
  }
  return undefined
}

class AgentKernelSubagentAdapter implements KernelAdapter {
  constructor(
    private readonly agentKernel: AgentKernel,
    private readonly subagentRegistry: SubagentRegistry,
    private readonly providerConfigStore: ProviderConfigStore,
    private readonly agentConfigStore: AgentConfigStore,
    private readonly sessionStore: SessionStore,
    private readonly toolRegistry: ToolRegistry,
    private readonly preferenceStore?: SubagentProviderPreferenceStore,
    private readonly runWithProvidersForUser?: <T>(
      userId: string,
      fn: () => Promise<T>,
      preferredProviderId?: string,
    ) => Promise<T>,
  ) {}

  async execute(options: {
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    onCancel?: () => boolean
    taskSpec?: SubagentTaskSpec
    definition?: SubagentDefinition
  }): Promise<KernelRunResult> {
    const { contextBundle, maxIterations, timeoutMs } = options
    let definition = options.definition
    let taskSpec = options.taskSpec

    if (!definition) {
      const lookupType = taskSpec?.agentType ?? contextBundle.agentType
      const resolved = this.subagentRegistry.get(lookupType)
      if (resolved) {
        definition = resolved
      } else {
        throw new Error(
          `Cannot resolve subagent definition for agentType "${lookupType}". ` +
            `Provide definition explicitly via options.definition.`,
        )
      }
    }

    if (!taskSpec) {
      taskSpec = {
        objective: `Subagent execution: ${definition.displayName}`,
        maxIterations,
        timeoutMs,
        agentType: definition.agentType,
      }
    }

    const userId = contextBundle.userId
    const sessionId = extractSessionId(contextBundle)

    const resolvedProvider = resolveSubagentProvider({
      userId,
      sessionId,
      agentType: definition.agentType,
      taskSpec,
      definition,
      providerConfigStore: {
        getByUser: (uid: string) => {
          return this.providerConfigStore.listByUser(uid).map((p) => ({
            providerId: p.providerId,
            enabled: p.enabled,
            selectedModel: p.selectedModel ?? undefined,
          }))
        },
      },
      agentConfigStore: {
        getGlobal: () => {
          const global = this.agentConfigStore.getGlobalDefault()
          if (!global) return null
          return {
            providerId: global.providerId ?? undefined,
            model: global.model ?? undefined,
          }
        },
      },
      sessionStore: sessionId
        ? {
            getById: (sid: string) => {
              const session = this.sessionStore.getById(sid)
              if (!session) return null
              return {
                selectedProviderId: session.selectedProviderId,
                selectedModel: session.selectedModel,
              }
            },
          }
        : undefined,
      preferenceStore: this.preferenceStore,
    })

    const toolProjection = buildToolProjection(definition, taskSpec, this.toolRegistry)

    const kernelInput: KernelRunInput = {
      contextBundle,
      runId: contextBundle.runId,
      agentId: contextBundle.agentId,
      agentType: 'subagent',
      userId,
      sessionId,
      toolProjection,
      maxIterations,
      timeoutMs,
      model: resolvedProvider.model,
    }

    const kernelRunFn = () => this.agentKernel.run(kernelInput)

    if (this.runWithProvidersForUser) {
      return this.runWithProvidersForUser(userId, kernelRunFn, resolvedProvider.providerId)
    }

    return kernelRunFn()
  }
}

export function createSubagentKernelAdapter(deps: {
  agentKernel: AgentKernel
  subagentRegistry: SubagentRegistry
  providerConfigStore: ProviderConfigStore
  agentConfigStore: AgentConfigStore
  sessionStore: SessionStore
  toolRegistry: ToolRegistry
  preferenceStore?: SubagentProviderPreferenceStore
  runWithProvidersForUser?: <T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string) => Promise<T>
}): KernelAdapter {
  return new AgentKernelSubagentAdapter(
    deps.agentKernel,
    deps.subagentRegistry,
    deps.providerConfigStore,
    deps.agentConfigStore,
    deps.sessionStore,
    deps.toolRegistry,
    deps.preferenceStore,
    deps.runWithProvidersForUser,
  )
}
