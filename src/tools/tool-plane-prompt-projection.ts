/**
 * Tool Plane Prompt Projection - Generate model-visible tool projections.
 *
 * Routing mode: Only tool IDs + capability summary (no full schemas)
 * Execution mode: Full schemas in LLMRequest.tools
 *
 * With envelope enforcement, the projection is:
 *   effective = AgentTypeEnvelope ∩ allowedToolIds ∩ exposurePlan
 *
 * @module tools/tool-plane-prompt-projection
 */

import type { ToolDefinition as ToolDef } from './types.js'
import type { ToolDefinition as LLMToolDefinition } from '../llm/types.js'
import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolExposurePlan } from './tool-exposure-plan.js'
import type { AgentType } from '../context/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'
import { createToolExposurePlans, isExposureVisible } from './tool-exposure-plan.js'
import { stableToolSort } from './tool-schema-canonicalizer.js'

export type ProjectionMode = 'routing_json' | 'function_calling'

export interface ToolPlaneProjectionParams {
  tools: ToolDef[]
  mode: ProjectionMode
  allowedToolIds?: string[]
  deniedToolIds?: string[]
  exposurePlans?: Map<string, ToolExposurePlan>
}

export interface ToolSummary {
  id: string
  description: string
  category: string
}

function filterTools(tools: ToolDef[], allowedToolIds?: string[], deniedToolIds?: string[]): ToolDef[] {
  let filtered = tools

  if (deniedToolIds && deniedToolIds.length > 0) {
    const deniedSet = new Set(deniedToolIds)
    filtered = filtered.filter((t) => !deniedSet.has(t.name))
  }

  if (allowedToolIds && allowedToolIds.length > 0) {
    const allowedSet = new Set(allowedToolIds)
    filtered = filtered.filter((t) => allowedSet.has(t.name))
  }

  return filtered
}

function filterHiddenTools(tools: ToolDef[], exposurePlans: Map<string, ToolExposurePlan>): ToolDef[] {
  return tools.filter((tool) => {
    const plan = exposurePlans.get(tool.name)
    if (!plan) return true
    return isExposureVisible(plan.exposureLevel)
  })
}

export function toLLMToolDefinition(tool: ToolDef): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema as unknown as Record<string, unknown>,
    },
  }
}

export function convertToolDefinitionsToLLM(tools: ToolDef[], selectedToolIds?: string[]): LLMToolDefinition[] {
  const filtered = selectedToolIds ? tools.filter((tool) => selectedToolIds.includes(tool.name)) : tools

  return filtered.map(toLLMToolDefinition)
}

function generateToolSummaries(tools: ToolDef[]): string {
  const summaries = tools.map((t) => {
    const summary: ToolSummary = {
      id: t.name,
      description: t.description,
      category: t.category,
    }
    return `- ${summary.id} (${summary.category}): ${summary.description}`
  })

  return `Available Tools:\n${summaries.join('\n')}`
}

export function generateToolPlaneProjection(params: ToolPlaneProjectionParams): ToolPlaneProjection {
  const { tools, mode, allowedToolIds, deniedToolIds, exposurePlans: providedPlans } = params

  const exposurePlans = providedPlans ?? createToolExposurePlans(tools)

  let filteredTools = filterTools(tools, allowedToolIds, deniedToolIds)
  filteredTools = filterHiddenTools(filteredTools, exposurePlans)

  const sortedTools = stableToolSort(filteredTools)
  const toolIds = sortedTools.map((t) => t.name)

  if (mode === 'routing_json') {
    const toolSummaries = generateToolSummaries(sortedTools)
    return {
      toolIds,
      toolSummaries,
    }
  }

  const llmTools = sortedTools.map(toLLMToolDefinition)

  return {
    toolIds,
    tools: llmTools,
  }
}

export function generateRoutingToolProjection(
  tools: ToolDef[],
  options?: {
    allowedToolIds?: string[]
    deniedToolIds?: string[]
    exposurePlans?: Map<string, ToolExposurePlan>
  },
): ToolPlaneProjection {
  return generateToolPlaneProjection({
    tools,
    mode: 'routing_json',
    ...options,
  })
}

export function generateExecutionToolProjection(
  tools: ToolDef[],
  options?: {
    allowedToolIds?: string[]
    deniedToolIds?: string[]
    exposurePlans?: Map<string, ToolExposurePlan>
  },
): ToolPlaneProjection {
  return generateToolPlaneProjection({
    tools,
    mode: 'function_calling',
    ...options,
  })
}

export function generateEnvelopeFilteredProjection(
  tools: ToolDef[],
  agentType: AgentType,
  envelopeRegistry: AgentTypeToolEnvelopeRegistry,
  mode: ProjectionMode,
  options?: {
    allowedToolIds?: string[]
    deniedToolIds?: string[]
    exposurePlans?: Map<string, ToolExposurePlan>
  },
): ToolPlaneProjection {
  const envelopeAllowedIds = envelopeRegistry.getAllowedToolIds(
    agentType,
    tools.map((t) => ({ id: t.name, category: t.category })),
  )

  const envelopeAllowedSet = new Set(envelopeAllowedIds)
  const envelopeFilteredTools = tools.filter((t) => envelopeAllowedSet.has(t.name))

  return generateToolPlaneProjection({
    tools: envelopeFilteredTools,
    mode,
    ...options,
  })
}
