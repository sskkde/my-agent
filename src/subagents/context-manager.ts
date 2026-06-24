import type { ContextBundle, ContextItem } from '../context/types.js'
import type { SubagentTaskSpec } from './types.js'
import type { SubagentDefinition } from './registry.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { BuiltModelInput, ModelInputBuildInput, SkillPlaneProjection } from '../kernel/model-input/model-input-types.js'

export interface SubagentContextManager {
  createIsolatedContext(options: {
    parentContext: ContextBundle
    taskSpec: SubagentTaskSpec
    subagentRunId: string
    definition?: SubagentDefinition
  }): ContextBundle
}

export function createDefaultSubagentContextManager(deps: {
  summaryStore?: { get(id: string): { content: string } | null }
  transcriptStore?: { get(id: string): unknown }
  artifactStore?: { get(id: string): unknown }
}): SubagentContextManager {
  return {
    createIsolatedContext(options): ContextBundle {
      const { parentContext, taskSpec, subagentRunId, definition } = options

      const profileLabel = definition?.agentProfile ?? definition?.agentType ?? taskSpec.agentType ?? 'unknown'
      const agentId = `subagent.${profileLabel}.${subagentRunId}`
      const bundleId = `bundle-${subagentRunId}`

      const systemPrompt = composeSevenLayerPrompt(definition, taskSpec)

      const systemPromptItem: ContextItem = {
        itemId: `${bundleId}-system-prompt`,
        sourceType: 'system_note',
        semanticType: 'instruction',
        content: systemPrompt,
        priority: 100,
        isPinned: true,
        isCompressible: false,
      }

      const relevantItems: ContextItem[] = [systemPromptItem]

      for (const item of parentContext.pinnedItems) {
        relevantItems.push(item)
      }

      for (const item of parentContext.orderedItems) {
        relevantItems.push(item)
      }

      if (deps.summaryStore && parentContext.summaryBlocks) {
        for (const block of parentContext.summaryBlocks) {
          const stored = deps.summaryStore.get(block.itemId)
          if (stored && stored.content) {
            relevantItems.push({
              itemId: `${bundleId}-summary-${block.itemId}`,
              sourceType: block.sourceType,
              semanticType: block.semanticType,
              content: stored.content,
              priority: block.priority ?? 50,
            })
          }
        }
      }

      const totalContent = relevantItems.reduce((sum, item) => sum + item.content.length, 0)
      const tokenEstimate = Math.ceil(totalContent / 4)

      const bundle: ContextBundle = {
        bundleId,
        runId: subagentRunId,
        agentId,
        agentType: 'subagent',
        agentProfile: profileLabel,
        userId: parentContext.userId,
        invocationSource: 'subagent_runtime',
        pinnedItems: relevantItems,
        orderedItems: [...relevantItems],
        tokenEstimate,
      } as ContextBundle

      ;(bundle as Record<string, unknown>).parentContextRef = {
        runId: parentContext.runId,
        bundleId: parentContext.bundleId,
      }

      return bundle
    },
  }
}

/**
 * Compose a system prompt using seven-layer segment structure.
 *
 * This is the synchronous equivalent of buildSevenLayerModelInput(),
 * distributing content across the same segment boundaries:
 *   Segment A (Layer 1–4): agent template / description
 *   Segment B (Layer 5):   role identification (system prompt)
 *   Segment C (Layer 6):   tool plane (allowed tool IDs)
 *   Segment D (Layer 7):   context bundle (objective)
 */
function composeSevenLayerPrompt(definition: SubagentDefinition | undefined, taskSpec: SubagentTaskSpec): string {
  const segments: string[] = []

  // Segment A – Layer 1-4: agent template content
  segments.push(definition?.description ?? `Subagent profile: ${taskSpec.agentType ?? 'unknown'}`)

  // Segment B – Layer 5: role identification (system prompt)
  segments.push(
    definition
      ? `You are a "${definition.agentType}" subagent (${definition.displayName}).`
      : `You are a "${taskSpec.agentType ?? 'unknown'}" subagent.`,
  )

  // Segment C – Layer 6: tool plane
  if (definition && definition.allowedToolIds.length > 0) {
    segments.push(`Available Tool IDs: ${definition.allowedToolIds.join(', ')}`)
  }

  // Segment D – Layer 7: context bundle with objective
  segments.push('--- Context Bundle ---')
  segments.push(`[PINNED] ${taskSpec.objective}`)

  return segments.join('\n\n')
}

export async function buildSevenLayerModelInput(options: {
  definition: SubagentDefinition
  taskSpec: SubagentTaskSpec
  providerFamily: string
  modelInputBuilder: ModelInputBuilder
  skillProjection?: SkillPlaneProjection
}): Promise<BuiltModelInput> {
  const { definition, taskSpec, providerFamily, modelInputBuilder, skillProjection } = options

  const agentProfile = definition.agentProfile ?? definition.agentType

  const input: ModelInputBuildInput = {
    mode: 'function_calling',
    agentType: 'subagent',
    agentProfile,
    providerFamily,
    systemPrompt: `You are a "${definition.agentType}" subagent (${definition.displayName}).`,
    toolProjection: {
      toolIds: definition.allowedToolIds,
    },
    ...(skillProjection ? { skillProjection } : {}),
    contextBundle: {
      pinnedItems: [
        {
          itemId: 'objective',
          content: taskSpec.objective,
          semanticType: 'instruction',
          isPinned: true,
        },
      ],
    },
  }

  return modelInputBuilder.build(input)
}
