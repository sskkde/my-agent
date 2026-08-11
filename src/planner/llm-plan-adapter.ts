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

export interface PlannerLLMPlanAdapterDeps {
  /** Platform LLM adapter with multi-provider failover. */
  llmAdapter: PlatformLLMAdapter
  /** Model id used for the plan generation call. */
  model: string
  maxSteps?: number
  maxTokens?: number
}

const MAX_PLAN_STEPS = 10

function buildSystemPrompt(maxSteps: number): string {
  return [
    'You are a task planner. Decompose the user goal into a structured execution plan.',
    'Respond with ONLY a valid JSON object (no markdown, no commentary) matching this shape:',
    '{',
    '  "id": "plan_<shortid>",',
    '  "goal": "<the original goal>",',
    '  "steps": [',
    '    { "id": "step_001", "kind": "tool_call", "title": "<short title>", "description": "<what to do>", "executor": "agent_kernel", "toolName": "<tool id if known>", "dependsOn": [{"type": "depends_on", "targetStepId": "step_000"}] }',
    '  ],',
    '  "successCriteria": ["<criterion 1>"]',
    '}',
    `Rules: 1-${maxSteps} steps (max ${MAX_PLAN_STEPS}); "kind" is one of agent_task|tool_call|subagent_task|workflow_step|user_approval|final_response; "executor" is one of agent_kernel|tool_plane|subagent|workflow_runtime|foreground; "toolName" only when you know the exact tool id from the provided available tools; the last step should be a final_response step; step ids unique and sequential.`,
  ].join('\n')
}

function buildUserPrompt(input: PlanGenerationInput): string {
  const lines: string[] = [`Goal: ${input.goal}`]
  if (input.availableTools && input.availableTools.length > 0) {
    lines.push(`Available tools: ${input.availableTools.join(', ')}`)
  }
  return lines.join('\n')
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

  if (!id || !title || !description) return null

  const step: PlanStep = {
    id,
    kind,
    title,
    description,
    executor,
    ...(toolName ? { toolName } : {}),
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

  return {
    id,
    goal,
    steps,
    ...(successCriteria && successCriteria.length > 0 ? { successCriteria } : {}),
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
  const maxSteps = Math.min(Math.max(1, deps.maxSteps ?? 8), MAX_PLAN_STEPS)

  return {
    async generatePlan(input: PlanGenerationInput): Promise<ExecutionPlan | null> {
      if (!deps.model) return null

      const messages: LLMMessage[] = [
        { role: 'system', content: buildSystemPrompt(maxSteps) },
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
