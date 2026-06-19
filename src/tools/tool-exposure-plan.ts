/**
 * Tool Exposure Plan - Defines how tools are exposed to the LLM.
 *
 * Exposure levels determine when and how tools are visible to the model:
 * - always_on: Always visible in tool plane
 * - intent_loaded: Loaded when user intent matches
 * - agent_loaded: Loaded when agent session requires them
 * - lazy_discoverable: Discoverable but not in initial context
 * - hidden: Never exposed to LLM
 *
 * With envelope enforcement, exposure plans are intersected with the
 * AgentType envelope before tools are projected.
 *
 * @module tools/tool-exposure-plan
 */

import type { ToolDefinition, ToolCategory, ToolSensitivity } from './types.js'
import type { AgentType } from '../context/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'

/**
 * Exposure levels for tool visibility to LLM.
 */
export type ExposureLevel = 'always_on' | 'intent_loaded' | 'agent_loaded' | 'lazy_discoverable' | 'hidden'

/**
 * Schema exposure modes for tool definitions.
 * - full: Complete schema with all properties
 * - simplified: Essential properties only
 * - card_only: Minimal representation (name, description, category)
 */
export type SchemaMode = 'full' | 'simplified' | 'card_only'

/**
 * Risk level for tool classification.
 */
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'restricted'

/**
 * Tool exposure plan determines how a tool is presented to the LLM.
 */
export interface ToolExposurePlan {
  /** Tool identifier */
  toolId: string
  /** When this tool is exposed to the LLM */
  exposureLevel: ExposureLevel
  /** Risk classification for this tool */
  riskLevel: ToolRiskLevel
  /** Whether this tool requires explicit approval before execution */
  requiresApproval: boolean
  /** How much of the schema to expose */
  schemaMode: SchemaMode
  /** Categories this tool belongs to */
  categories: string[]
}

/**
 * Mapping from ToolSensitivity to ToolRiskLevel.
 */
const SENSITIVITY_TO_RISK: Record<ToolSensitivity, ToolRiskLevel> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  restricted: 'restricted',
}

/**
 * Categories that require approval by default.
 */
const APPROVAL_REQUIRED_CATEGORIES: Set<ToolCategory> = new Set(['write', 'delete', 'send', 'execute'])

/**
 * Categories that are always hidden from LLM.
 */
const HIDDEN_CATEGORIES: Set<ToolCategory> = new Set([])

/**
 * Determine exposure level based on tool properties.
 */
export function determineExposureLevel(category: ToolCategory, sensitivity: ToolSensitivity): ExposureLevel {
  if (HIDDEN_CATEGORIES.has(category)) {
    return 'hidden'
  }

  if (sensitivity === 'restricted') {
    return 'lazy_discoverable'
  }

  if (sensitivity === 'high') {
    return 'agent_loaded'
  }

  if (category === 'read' || category === 'search' || category === 'internal') {
    return 'always_on'
  }

  return 'intent_loaded'
}

/**
 * Determine schema mode based on exposure and risk.
 */
export function determineSchemaMode(exposureLevel: ExposureLevel, riskLevel: ToolRiskLevel): SchemaMode {
  if (exposureLevel === 'hidden') {
    return 'card_only'
  }

  if (riskLevel === 'high' || riskLevel === 'restricted') {
    return 'simplified'
  }

  if (exposureLevel === 'always_on' && riskLevel === 'low') {
    return 'full'
  }

  return 'simplified'
}

/**
 * Create a ToolExposurePlan from a ToolDefinition.
 */
export function createToolExposurePlan(tool: ToolDefinition): ToolExposurePlan {
  const riskLevel = SENSITIVITY_TO_RISK[tool.sensitivity]
  const exposureLevel = determineExposureLevel(tool.category, tool.sensitivity)
  const schemaMode = determineSchemaMode(exposureLevel, riskLevel)
  const requiresApproval =
    APPROVAL_REQUIRED_CATEGORIES.has(tool.category) ||
    tool.requiresPermission === true ||
    tool.sensitivity === 'high' ||
    tool.sensitivity === 'restricted'

  return {
    toolId: tool.name,
    exposureLevel,
    riskLevel,
    requiresApproval,
    schemaMode,
    categories: [tool.category],
  }
}

/**
 * Create exposure plans for multiple tools.
 */
export function createToolExposurePlans(tools: ToolDefinition[]): Map<string, ToolExposurePlan> {
  const plans = new Map<string, ToolExposurePlan>()
  for (const tool of tools) {
    plans.set(tool.name, createToolExposurePlan(tool))
  }
  return plans
}

/**
 * Check if an exposure level allows visibility.
 */
export function isExposureVisible(exposureLevel: ExposureLevel): boolean {
  return exposureLevel !== 'hidden'
}

/**
 * Filter tools by exposure level.
 */
export function filterToolsByExposure(
  tools: ToolDefinition[],
  plans: Map<string, ToolExposurePlan>,
  allowedLevels: ExposureLevel[],
): ToolDefinition[] {
  return tools.filter((tool) => {
    const plan = plans.get(tool.name)
    if (!plan) return false
    return allowedLevels.includes(plan.exposureLevel)
  })
}

/**
 * Filter exposure plans by AgentType envelope.
 *
 * Returns only plans for tools that pass the envelope boundary.
 * Tools outside the envelope are effectively "hidden" regardless of exposure level.
 */
export function filterExposurePlansByEnvelope(
  plans: Map<string, ToolExposurePlan>,
  tools: ToolDefinition[],
  agentType: AgentType,
  envelopeRegistry: AgentTypeToolEnvelopeRegistry,
): Map<string, ToolExposurePlan> {
  const filtered = new Map<string, ToolExposurePlan>()
  for (const tool of tools) {
    if (envelopeRegistry.isToolAllowedByEnvelope(agentType, tool.name, tool.category)) {
      const plan = plans.get(tool.name)
      if (plan) {
        filtered.set(tool.name, plan)
      }
    }
  }
  return filtered
}
