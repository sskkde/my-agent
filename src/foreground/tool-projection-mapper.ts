/**
 * Tool Projection Mapper - Maps suggested tool names to ToolPlaneProjection.
 *
 * Provides a pure function for filtering suggested tools against a tool catalog
 * and creating a ToolPlaneProjection for the model input builder.
 *
 * With envelope enforcement, the projection is:
 *   effective = AgentTypeEnvelope ∩ safeTools ∩ policy
 *
 * @module foreground/tool-projection-mapper
 */

import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolDefinition } from '../llm/types.js'
import type { ForegroundTurnInput } from './foreground-runner-types.js'
import type { ToolCategory, ToolSensitivity, ToolRegistry } from '../tools/types.js'
import type { AgentType } from '../context/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'
import { getWorkdirFileToolIds } from '../permissions/agent-type-tool-envelope.js'
import { toLLMToolDefinition } from '../tools/tool-plane-prompt-projection.js'

/**
 * Maps suggested tool names to a ToolPlaneProjection.
 *
 * This is a pure function that filters suggested tools against a known tool catalog,
 * returning only the tools that exist in the catalog. If either input is empty,
 * returns an empty projection.
 *
 * @param suggestedTools - Array of tool names suggested by the router
 * @param toolCatalog - Array of valid tool names from the catalog
 * @returns ToolPlaneProjection with filtered toolIds
 *
 * @example
 * ```typescript
 * const suggested = ['file_read', 'web_search', 'unknown.tool'];
 * const catalog = ['file_read', 'web_search', 'memory_retrieve'];
 * const projection = mapSuggestedToolsToProjection(suggested, catalog);
 * // projection.toolIds = ['file_read', 'web_search']
 * ```
 */
export function mapSuggestedToolsToProjection(suggestedTools: string[], toolCatalog: string[]): ToolPlaneProjection {
  if (suggestedTools.length === 0 || toolCatalog.length === 0) {
    return { toolIds: [] }
  }

  const filteredToolIds = suggestedTools.filter((toolId) => toolCatalog.includes(toolId))

  return { toolIds: filteredToolIds }
}

/**
 * Tool categories that are considered safe by default (least privilege).
 * These categories only read or search data without side effects.
 */
const SAFE_TOOL_CATEGORIES: Set<ToolCategory> = new Set(['read', 'search', 'internal'])

/**
 * Tool categories that are considered high-risk and require explicit approval.
 * These categories have side effects and should only be projected with explicit
 * permission or policy override.
 */
export const HIGH_RISK_TOOL_CATEGORIES: Set<ToolCategory> = new Set(['write', 'delete', 'send', 'execute', 'admin'])

/**
 * Check if a tool is safe for default projection.
 * A tool is safe if it belongs to a safe category AND has low/medium sensitivity.
 */
function isToolSafeForDefaultProjection(category: ToolCategory, sensitivity: ToolSensitivity): boolean {
  return SAFE_TOOL_CATEGORIES.has(category) && (sensitivity === 'low' || sensitivity === 'medium')
}

/**
 * Result of building a foreground tool projection.
 */
export interface ForegroundToolProjectionResult {
  /** Allowed tool IDs for the projection */
  allowedToolIds: string[]
  /** Full tool definitions for function calling mode */
  toolDefinitions: ToolDefinition[]
  /** Projection mode */
  projectionMode: 'function_calling'
}

/**
 * Build a foreground tool projection for the kernel execution phase.
 *
 * This function implements the least-privilege principle by default,
 * projecting only safe tools (read/search/internal) unless explicitly
 * allowed by policy or approval.
 *
 * @param input - Foreground turn input containing context and configuration
 * @param allTools - Array of all available tool definitions
 * @param toolRegistry - Optional ToolRegistry for looking up full tool definitions with schemas
 * @returns Tool projection result with allowed tool IDs and definitions
 *
 * @example
 * ```typescript
 * const projection = buildForegroundToolProjection(input, allTools, toolRegistry);
 * // projection.allowedToolIds = ['web_search', 'status_query', 'ask_user', ...]
 * // projection.toolDefinitions = [{ type: 'function', function: { ... } }, ...]
 * ```
 */
export function buildForegroundToolProjection(
  input: ForegroundTurnInput,
  allTools: Array<{
    name: string
    category: ToolCategory
    sensitivity: ToolSensitivity
    description: string
    schema?: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
      description?: string
    }
  }>,
  toolRegistry?: ToolRegistry,
): ForegroundToolProjectionResult {
  const safeTools = allTools.filter((tool) => isToolSafeForDefaultProjection(tool.category, tool.sensitivity))

  let projectedTools = safeTools
  if (input.workDirRoot) {
    const workdirToolIds = getWorkdirFileToolIds()
    const workdirFileTools = allTools.filter(
      (tool) => workdirToolIds.has(tool.name) && !safeTools.some((s) => s.name === tool.name),
    )
    projectedTools = [...safeTools, ...workdirFileTools]
  }

  // Apply preference: hide web_search when search_subagent is available
  const hasSearchSubagent = projectedTools.some((tool) => tool.name === 'search_subagent')
  projectedTools = hasSearchSubagent ? projectedTools.filter((tool) => tool.name !== 'web_search') : projectedTools

  const allowedToolIds = projectedTools.map((tool) => tool.name)

  // Use ToolRegistry to get full tool definitions with real schemas
  const toolDefinitions: ToolDefinition[] = projectedTools.map((tool) => {
    // If ToolRegistry is provided, look up the full tool definition
    if (toolRegistry) {
      const fullTool = toolRegistry.getTool(tool.name)
      if (fullTool) {
        // Use the helper to convert with real schema
        return toLLMToolDefinition(fullTool)
      }
    }

    // Fallback: use the schema from the summary if available, otherwise empty schema
    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema ?? { type: 'object' as const, properties: {} },
      },
    }
  })

  return {
    allowedToolIds,
    toolDefinitions,
    projectionMode: 'function_calling',
  }
}

/**
 * Convert ForegroundToolProjectionResult to ToolPlaneProjection.
 *
 * This helper converts the detailed projection result to the format
 * expected by the kernel's ToolPlaneProjection interface.
 */
export function toToolPlaneProjection(result: ForegroundToolProjectionResult): ToolPlaneProjection {
  return {
    toolIds: result.allowedToolIds,
    tools: result.toolDefinitions,
  }
}

/**
 * Apply AgentType envelope filter to a foreground tool projection.
 *
 * This function takes the result of `buildForegroundToolProjection` and
 * intersects it with the AgentType envelope, ensuring no tool outside
 * the envelope boundary is projected.
 *
 * The envelope is the outermost security boundary:
 *   final = envelope ∩ buildForegroundToolProjection result
 *
 * @param projectionResult - Result from buildForegroundToolProjection
 * @param agentType - The AgentType whose envelope is the boundary
 * @param envelopeRegistry - Registry containing AgentType envelopes
 * @param allTools - Full tool definitions with category metadata
 * @returns Filtered ForegroundToolProjectionResult
 */
export function applyEnvelopeToProjection(
  projectionResult: ForegroundToolProjectionResult,
  agentType: AgentType,
  envelopeRegistry: AgentTypeToolEnvelopeRegistry,
  allTools: Array<{
    name: string
    category: ToolCategory
    sensitivity: ToolSensitivity
    description: string
    schema?: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
      description?: string
    }
  }>,
): ForegroundToolProjectionResult {
  const envelope = envelopeRegistry.getEnvelope(agentType)
  if (!envelope) {
    return { allowedToolIds: [], toolDefinitions: [], projectionMode: 'function_calling' }
  }

  const filteredIds: string[] = []
  for (const toolId of projectionResult.allowedToolIds) {
    const toolDef = allTools.find((t) => t.name === toolId)
    if (toolDef && envelopeRegistry.isToolAllowedByEnvelope(agentType, toolId, toolDef.category)) {
      filteredIds.push(toolId)
    }
  }

  const filteredDefinitions = projectionResult.toolDefinitions.filter((def) =>
    filteredIds.includes(def.function.name),
  )

  return {
    allowedToolIds: filteredIds,
    toolDefinitions: filteredDefinitions,
    projectionMode: 'function_calling',
  }
}
