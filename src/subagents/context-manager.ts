import type { ContextBundle, ContextItem } from '../context/types.js'
import type { SubagentTaskSpec } from './types.js'
import type { SubagentDefinition } from './registry.js'
import type { ModelInputBuilder } from '../kernel/model-input/model-input-builder.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../kernel/model-input/model-input-types.js'

export interface SubagentContextManager {
  createIsolatedContext(options: {
    parentContext: ContextBundle
    taskSpec: SubagentTaskSpec
    subagentRunId: string
    definition: SubagentDefinition
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

      const agentId = `subagent.${definition.agentType}`
      const bundleId = `bundle-${subagentRunId}`

      const systemPrompt = buildSystemPrompt(definition.promptId, taskSpec.objective, definition)

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
        agentType: definition.agentType,
        agentProfile: definition.agentProfile ?? definition.agentType,
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

function buildSystemPrompt(promptId: string, objective: string, definition: SubagentDefinition): string {
  const lines: string[] = []

  lines.push(`You are a "${definition.agentType}" subagent (${definition.displayName}).`)
  lines.push(definition.description)
  lines.push('')
  lines.push('## Objective')
  lines.push(objective)
  lines.push('')
  lines.push(`Prompt ID: ${promptId}`)

  if (definition.allowedToolIds.length > 0) {
    lines.push('')
    lines.push('## Allowed Tools')
    lines.push(definition.allowedToolIds.join(', '))
  }

  lines.push('')
  lines.push('## Configuration')
  lines.push(`Execution modes: ${definition.supportedExecutionModes.join(', ')}`)
  lines.push(`Max iterations: ${definition.defaultMaxIterations}`)
  lines.push(`Timeout: ${definition.defaultTimeoutMs}ms`)

  return lines.join('\n')
}

export async function buildSevenLayerModelInput(options: {
  definition: SubagentDefinition
  taskSpec: SubagentTaskSpec
  providerFamily: string
  modelInputBuilder: ModelInputBuilder
}): Promise<BuiltModelInput> {
  const { definition, taskSpec, providerFamily, modelInputBuilder } = options

  const agentProfile = definition.agentProfile ?? definition.agentType

  modelInputBuilder.registerAgentTemplate(`agents:${agentProfile}`, {
    id: `agents:${agentProfile}`,
    version: '2026-05-24',
    path: `agents/${agentProfile}.md`,
    agentKind: agentProfile,
    providerFamily: '*',
    layer: 3,
    content: definition.description,
    description: `${definition.displayName} agent template`,
  })

  const input: ModelInputBuildInput = {
    mode: 'function_calling',
    agentType: 'subagent',
    agentProfile,
    providerFamily,
    systemPrompt: `You are a "${definition.agentType}" subagent (${definition.displayName}).`,
    toolProjection: {
      toolIds: definition.allowedToolIds,
    },
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
