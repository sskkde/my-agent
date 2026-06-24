import type { KernelAdapter, SubagentTaskSpec } from './types.js'
import type { SubagentDefinition, SubagentRegistry } from './registry.js'
import { resolveSubagentProvider } from './provider-policy.js'
import type { SubagentProviderPreferenceStore } from './provider-policy.js'
import type { AgentKernel } from '../kernel/agent-kernel.js'
import type { KernelRunInput, KernelRunResult } from '../kernel/types.js'
import type { ContextBundle, AgentType } from '../context/types.js'
import type { ProviderConfigStore } from '../storage/provider-config-store.js'
import type { AgentConfigStore } from '../storage/agent-config-store.js'
import type { SessionStore } from '../storage/session-store.js'
import type { ToolPlaneProjection, SkillPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolRegistry } from '../tools/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../permissions/agent-type-skill-envelope.js'
import type { SkillRegistry } from '../skills/types.js'
import type { SkillDocumentLoader } from '../skills/skill-document-loader.js'
import { buildSkillPlaneProjection } from '../skills/skill-plane-projection.js'
import { toLLMToolDefinition } from '../tools/tool-plane-prompt-projection.js'
import { isKnownAgentLabel, normalizeAgentLabel } from '../taxonomy/agent-label-normalizer.js'

export function buildToolProjection(
  definition: SubagentDefinition,
  taskSpec: SubagentTaskSpec,
  toolRegistry: ToolRegistry,
  envelopeRegistry?: AgentTypeToolEnvelopeRegistry,
): ToolPlaneProjection {
  const allowedIds = definition.allowedToolIds ?? []
  const requestedIds = taskSpec.tools ?? []

  let effectiveIds = requestedIds.length > 0 ? allowedIds.filter((id) => requestedIds.includes(id)) : allowedIds

  if (envelopeRegistry) {
    const profileLabel = definition.agentProfile ?? definition.agentType
    const agentType: AgentType = isKnownAgentLabel(profileLabel)
      ? normalizeAgentLabel(profileLabel).agentType
      : 'subagent'
    const catalog = effectiveIds.map((id) => {
      const tool = toolRegistry.getTool(id)
      return { id, category: tool?.category ?? 'internal' }
    })
    effectiveIds = envelopeRegistry.getAllowedToolIds(agentType, catalog)
  }

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
    private readonly envelopeRegistry?: AgentTypeToolEnvelopeRegistry,
    private readonly skillRegistry?: SkillRegistry,
    private readonly skillEnvelopeRegistry?: AgentTypeSkillEnvelopeRegistry,
    private readonly skillDocumentLoader?: SkillDocumentLoader,
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

    const toolProjection = buildToolProjection(definition, taskSpec, this.toolRegistry, this.envelopeRegistry)

    const skillProjection = await this.buildSubagentSkillProjection(definition)

    const kernelInput: KernelRunInput = {
      contextBundle,
      runId: contextBundle.runId,
      agentId: contextBundle.agentId,
      agentType: 'subagent',
      userId,
      sessionId,
      toolProjection,
      ...(skillProjection ? { skillProjection } : {}),
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

  private async buildSubagentSkillProjection(
    definition: SubagentDefinition,
  ): Promise<SkillPlaneProjection | undefined> {
    if (!this.skillRegistry || !this.skillEnvelopeRegistry || !this.skillDocumentLoader) {
      return undefined
    }

    const profileLabel = definition.agentProfile ?? definition.agentType
    const agentType: AgentType = isKnownAgentLabel(profileLabel)
      ? normalizeAgentLabel(profileLabel).agentType
      : 'subagent'

    return buildSkillPlaneProjection({
      agentType,
      registry: this.skillRegistry,
      envelopeRegistry: this.skillEnvelopeRegistry,
      documentLoader: this.skillDocumentLoader,
      profileDefaultSkillIds: definition.allowedSkillIds ?? undefined,
      mode: 'documents',
    })
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
  envelopeRegistry?: AgentTypeToolEnvelopeRegistry
  skillRegistry?: SkillRegistry
  skillEnvelopeRegistry?: AgentTypeSkillEnvelopeRegistry
  skillDocumentLoader?: SkillDocumentLoader
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
    deps.envelopeRegistry,
    deps.skillRegistry,
    deps.skillEnvelopeRegistry,
    deps.skillDocumentLoader,
  )
}
