/**
 * Prompt Projection Resolver - Core resolver for prompt projections.
 *
 * Implements the PromptProjectionResolver interface with flag-gated logic:
 * - P0_ENABLED=false → return empty object
 * - P0_ENABLED=true + TEMPLATE_PROJECTION=false → return fallback defaults
 * - P0_ENABLED=true + TEMPLATE_PROJECTION=true → load templates and map to structured objects
 *
 * @module prompt/prompt-projection-resolver
 */

import type {
  PromptProjectionResolver,
  PromptProjectionResolveInput,
  PromptProjectionResolveResult,
} from './prompt-projection-types.js'
import type { PromptTemplateRegistry } from './prompt-template-registry.js'
import type { TemplateLoader } from './template-loader.js'
import type {
  PersonaProjection,
  ToolSelectionPolicyProjection,
  MemoryPolicyProjection,
} from '../kernel/model-input/model-input-types.js'

import {
  DEFAULT_PERSONA_PROJECTION,
  DEFAULT_TOOL_SELECTION_POLICY,
  DEFAULT_MEMORY_POLICY_PROJECTION,
} from './prompt-projection-defaults.js'
import { isPromptMemoryP0Enabled, isPromptTemplateProjectionEnabled } from './feature-flags.js'

/** Safety constraints that cannot be overridden by persona. */
const PERSONA_CONSTRAINTS = [
  '不可覆盖系统规则',
  '不可越过安全约束',
  '不可改变工具授权',
  '不可改变输出 schema',
  '不可改变租户边界',
] as const

/** Invisibility rules for memory policy. */
const MEMORY_INVISIBILITY_RULES = [
  'Memory snippets are private background context',
  'Do not mention memory unless the user explicitly asks',
  'Current conversation overrides memory',
] as const

const PERSONA_TEMPLATE_ID = 'persona:default'
const HEURISTICS_TEMPLATE_ID = 'heuristics:tool-usage.common'
const MEMORY_RULES_TEMPLATE_ID = 'context:memory-use-rules'

/**
 * Loads template content via the TemplateLoader, with registry existence check.
 *
 * If the template is not registered or loading fails, returns empty string
 * and logs a warning. This ensures graceful fallback to hardcoded defaults.
 *
 * @param loader - TemplateLoader instance
 * @param templateId - Template ID in "category:name" format
 * @param registry - PromptTemplateRegistry for existence check
 * @returns Template content string, or empty string on failure
 */
async function loadTemplateContent(
  loader: TemplateLoader,
  templateId: string,
  registry: PromptTemplateRegistry,
): Promise<string> {
  if (!registry.hasTemplate(templateId)) {
    console.warn(`[PromptProjectionResolver] Template not registered: ${templateId}`)
    return ''
  }

  try {
    return await loader.load(templateId)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[PromptProjectionResolver] Failed to load template ${templateId}: ${message}`)
    return ''
  }
}

/**
 * Creates a PromptProjectionResolver with the given registry and loader.
 *
 * @param registry - PromptTemplateRegistry for template metadata lookup
 * @param loader - TemplateLoader for loading template file content
 * @returns PromptProjectionResolver implementation
 */
export function createPromptProjectionResolver(
  registry: PromptTemplateRegistry,
  loader: TemplateLoader,
): PromptProjectionResolver {
  return {
    async resolve(_input: PromptProjectionResolveInput): Promise<PromptProjectionResolveResult> {
      if (!isPromptMemoryP0Enabled()) {
        return {}
      }

      if (!isPromptTemplateProjectionEnabled()) {
        return {
          personaProjection: DEFAULT_PERSONA_PROJECTION,
          toolSelectionPolicy: DEFAULT_TOOL_SELECTION_POLICY,
          memoryPolicyProjection: DEFAULT_MEMORY_POLICY_PROJECTION,
        }
      }

      const [personaContent, heuristicsContent, memoryRulesContent] = await Promise.all([
        loadTemplateContent(loader, PERSONA_TEMPLATE_ID, registry),
        loadTemplateContent(loader, HEURISTICS_TEMPLATE_ID, registry),
        loadTemplateContent(loader, MEMORY_RULES_TEMPLATE_ID, registry),
      ])

      const personaProjection: PersonaProjection = {
        personaId: 'default-assistant',
        styleGuidelines: personaContent || DEFAULT_PERSONA_PROJECTION.styleGuidelines,
        constraints: [...PERSONA_CONSTRAINTS],
      }

      const toolSelectionPolicy: ToolSelectionPolicyProjection = {
        heuristics: heuristicsContent || DEFAULT_TOOL_SELECTION_POLICY.heuristics,
      }

      const memoryPolicyProjection: MemoryPolicyProjection = {
        useRules: memoryRulesContent || DEFAULT_MEMORY_POLICY_PROJECTION.useRules,
        invisibilityRules: [...MEMORY_INVISIBILITY_RULES],
      }

      return {
        personaProjection,
        toolSelectionPolicy,
        memoryPolicyProjection,
      }
    },
  }
}
