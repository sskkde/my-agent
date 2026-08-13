/**
 * Planner-domain LLM adapter: drives the platform LLM adapter to produce a
 * structured ExecutionPlan JSON, with tolerant parsing. Returns null on any
 * failure so the LLMPlanGenerator falls back to the deterministic generator.
 */

import type { LLMAdapter as PlatformLLMAdapter } from '../llm/adapter.js'
import type { LLMMessage } from '../llm/types.js'
import type {
  ExecutionPlan,
  PlanDependency,
  PlanExecutor,
  PlanGenerationInput,
  PlanStep,
  PlanStepKind,
} from './plan-schema.js'
import type { LLMAdapter } from './llm-plan-generator.js'
import type { PromptTemplateRegistry, SevenLayerInput } from '../prompt/prompt-template-registry.js'
import type { TemplateLoader } from '../prompt/template-loader.js'

export interface PlannerLLMPlanAdapterDeps {
  /** Platform LLM adapter with multi-provider failover. */
  llmAdapter: PlatformLLMAdapter
  /** Model id used for the plan generation call. */
  model: string
  /** Seven-layer template registry used to assemble the plan-generation prefix (L1-L5). */
  templateRegistry: PromptTemplateRegistry
  /** Template loader used to render the resolved L1-L5 records. */
  templateLoader: TemplateLoader
  /** Provider family of the plan-generation model (drives L2 provider template). */
  providerFamily?: string
  maxSteps?: number
  maxTokens?: number
}

const PLAN_GENERATION_SEVEN_LAYER: Omit<SevenLayerInput, 'providerFamily'> = {
  agentType: 'subagent',
  agentProfile: 'planner_plan',
  outputContract: 'output:planner.schema',
}

function buildUserPrompt(input: PlanGenerationInput): string {
  const lines: string[] = [`Goal: ${input.goal}`]

  if (input.userConstraints && input.userConstraints.length > 0) {
    lines.push(`Constraints: ${input.userConstraints.join('; ')}`)
  }

  if (input.toolDescriptions && Object.keys(input.toolDescriptions).length > 0) {
    const tools = Object.entries(input.toolDescriptions)
      .map(([name, description]) => `- ${name}: ${description}`)
      .join('\n')
    lines.push(`Available tools:\n${tools}`)
  } else if (input.availableTools && input.availableTools.length > 0) {
    lines.push(`Available tools: ${input.availableTools.join(', ')}`)
  }

  if (input.contextSummary) {
    lines.push(`Context: ${input.contextSummary}`)
  }

  return lines.join('\n\n')
}

/** Extract a JSON document from an LLM response (tolerates code fences / prose). */
export function extractJson(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  // 1. Direct parse
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch {
    // fall through
  }

  // 2. ```json ... ``` fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim()
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      // fall through
    }
  }

  // 3. First { to last }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {
      return null
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStep(raw: unknown): PlanStep | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : title
  const kind = (typeof raw.kind === 'string' ? raw.kind : 'agent_task') as PlanStepKind
  const executor = (typeof raw.executor === 'string' ? raw.executor : 'agent_kernel') as PlanExecutor
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : undefined
  const expectedOutput =
    typeof raw.expectedOutput === 'string' && raw.expectedOutput.trim() ? raw.expectedOutput.trim() : undefined
  const outOfScope = typeof raw.outOfScope === 'string' && raw.outOfScope.trim() ? raw.outOfScope.trim() : undefined

  if (!id || !title || !description) return null

  const step: PlanStep = {
    id,
    kind,
    title,
    description,
    executor,
    ...(toolName ? { toolName } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
    ...(outOfScope ? { outOfScope } : {}),
  }

  if (Array.isArray(raw.dependsOn)) {
    const dependsOn: PlanDependency[] = []
    for (const d of raw.dependsOn) {
      if (!isRecord(d)) continue
      const targetStepId = typeof d.targetStepId === 'string' ? d.targetStepId : ''
      if (!targetStepId) continue
      dependsOn.push({
        type: (typeof d.type === 'string' ? d.type : 'depends_on') as PlanDependency['type'],
        targetStepId,
      })
    }
    if (dependsOn.length > 0) step.dependsOn = dependsOn
  }

  return step
}

/** Tolerant normalization of a parsed LLM plan payload. Returns null when structurally invalid. */
export function normalizeExecutionPlan(raw: unknown): ExecutionPlan | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `plan_${Date.now().toString(36)}`
  const goal = typeof raw.goal === 'string' && raw.goal.trim() ? raw.goal.trim() : null
  if (!goal) return null

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  if (rawSteps.length === 0) return null

  const steps: PlanStep[] = []
  for (const rawStep of rawSteps) {
    const step = normalizeStep(rawStep)
    if (step) steps.push(step)
  }
  if (steps.length === 0) return null

  const seenIds = new Set<string>()
  for (const step of steps) {
    if (seenIds.has(step.id)) return null
    seenIds.add(step.id)
  }

  const now = new Date().toISOString()
  const successCriteria = Array.isArray(raw.successCriteria)
    ? raw.successCriteria.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : undefined
  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : undefined
  const riskNotes = Array.isArray(raw.riskNotes)
    ? raw.riskNotes.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : undefined

  return {
    id,
    goal,
    steps,
    ...(assumptions && assumptions.length > 0 ? { assumptions } : {}),
    ...(successCriteria && successCriteria.length > 0 ? { successCriteria } : {}),
    ...(riskNotes && riskNotes.length > 0 ? { riskNotes } : {}),
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

/** Parse an LLM completion into a plan, or null on any failure. */
export function parseExecutionPlan(content: string): ExecutionPlan | null {
  const json = extractJson(content)
  if (!json) return null
  try {
    return normalizeExecutionPlan(JSON.parse(json))
  } catch {
    return null
  }
}

export function createPlannerLLMPlanAdapter(deps: PlannerLLMPlanAdapterDeps): LLMAdapter {
  async function buildSevenLayerSystemPrompt(providerFamily: string): Promise<string> {
    const sevenLayerInput: SevenLayerInput = { ...PLAN_GENERATION_SEVEN_LAYER, providerFamily }
    const resolved = deps.templateRegistry.resolveSevenLayer(sevenLayerInput)
    const templateVars: Record<string, string> = {
      agentKind: sevenLayerInput.agentProfile ?? sevenLayerInput.agentType,
      providerFamily,
      agentType: sevenLayerInput.agentType,
      agentProfile: sevenLayerInput.agentProfile ?? '',
      outputContract: sevenLayerInput.outputContract ?? '',
    }

    const parts: string[] = []
    for (const record of resolved) {
      if (record.layer > 5) continue
      let content: string
      try {
        content =
          record.content !== undefined
            ? deps.templateLoader.loadFromString(record.content, templateVars)
            : await deps.templateLoader.load(record.id, templateVars)
      } catch {
        continue
      }
      if (content.trim()) parts.push(content)
    }
    return parts.join('\n\n')
  }

  return {
    async generatePlan(input: PlanGenerationInput): Promise<ExecutionPlan | null> {
      if (!deps.model) return null

      const providerFamily = deps.providerFamily ?? 'openai'
      const systemContent = await buildSevenLayerSystemPrompt(providerFamily)

      const messages: LLMMessage[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: buildUserPrompt(input) },
      ]

      let result
      try {
        result = await deps.llmAdapter.complete({
          model: deps.model,
          messages,
          temperature: 0.2,
          maxTokens: deps.maxTokens ?? 2048,
        })
      } catch {
        return null
      }

      if (!result.success) return null
      return parseExecutionPlan(result.response.content)
    },
  }
}
