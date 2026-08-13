import { describe, it, expect } from 'vitest'
import {
  extractJson,
  normalizeExecutionPlan,
  parseExecutionPlan,
  createPlannerLLMPlanAdapter,
} from '../../../src/planner/llm-plan-adapter.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import type { LLMMessage } from '../../../src/llm/types.js'

function createTemplateDeps() {
  return {
    templateRegistry: new PromptTemplateRegistry(),
    templateLoader: new TemplateLoader(),
  }
}

const VALID_PLAN_JSON = JSON.stringify({
  id: 'plan_abc',
  goal: 'Search AI trends',
  steps: [
    {
      id: 'step_001',
      kind: 'tool_call',
      title: 'Search web',
      description: 'Search the web for AI agent trends',
      executor: 'agent_kernel',
      toolName: 'web_search',
    },
    {
      id: 'step_002',
      kind: 'final_response',
      title: 'Summarize',
      description: 'Summarize findings',
      executor: 'foreground',
    },
  ],
  successCriteria: ['results gathered'],
})

describe('llm-plan-adapter extractJson', () => {
  it('extracts raw JSON', () => {
    expect(extractJson(VALID_PLAN_JSON)).toBe(VALID_PLAN_JSON)
  })

  it('extracts JSON from a code fence', () => {
    const content = `Here is the plan:\n\`\`\`json\n${VALID_PLAN_JSON}\n\`\`\``
    expect(extractJson(content)).toBe(VALID_PLAN_JSON)
  })

  it('extracts JSON from surrounding prose', () => {
    const content = `Plan: ${VALID_PLAN_JSON} That is all.`
    expect(extractJson(content)).toBe(VALID_PLAN_JSON)
  })

  it('returns null for non-JSON content', () => {
    expect(extractJson('no plan here')).toBeNull()
  })
})

describe('llm-plan-adapter normalizeExecutionPlan', () => {
  it('normalizes a valid payload', () => {
    const plan = normalizeExecutionPlan(JSON.parse(VALID_PLAN_JSON))
    expect(plan).not.toBeNull()
    expect(plan?.id).toBe('plan_abc')
    expect(plan?.goal).toBe('Search AI trends')
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[0]?.toolName).toBe('web_search')
  })

  it('rejects missing goal', () => {
    expect(normalizeExecutionPlan({ id: 'p', steps: [] })).toBeNull()
  })

  it('rejects empty steps', () => {
    expect(normalizeExecutionPlan({ id: 'p', goal: 'g', steps: [] })).toBeNull()
  })

  it('rejects duplicate step ids', () => {
    const raw = JSON.parse(VALID_PLAN_JSON)
    raw.steps = [raw.steps[0], { ...raw.steps[0] }]
    expect(normalizeExecutionPlan(raw)).toBeNull()
  })

  it('drops malformed steps but keeps valid ones', () => {
    const raw = JSON.parse(VALID_PLAN_JSON) as Record<string, unknown>
    raw.steps = [{ id: 'step_001', title: 'ok', description: 'ok', kind: 'tool_call', executor: 'agent_kernel' }, 'bad']
    const plan = normalizeExecutionPlan(raw)
    expect(plan?.steps).toHaveLength(1)
  })

  it('parses expectedOutput, outOfScope, assumptions and riskNotes', () => {
    const raw = JSON.parse(VALID_PLAN_JSON) as Record<string, unknown>
    const steps = raw.steps as unknown[]
    steps[0] = {
      ...(steps[0] as object),
      expectedOutput: 'search results list',
      outOfScope: 'email notifications',
    }
    raw.assumptions = ['network is available']
    raw.riskNotes = ['rate limits may apply']
    const plan = normalizeExecutionPlan(raw)
    expect(plan?.steps[0]?.expectedOutput).toBe('search results list')
    expect(plan?.steps[0]?.outOfScope).toBe('email notifications')
    expect(plan?.assumptions).toEqual(['network is available'])
    expect(plan?.riskNotes).toEqual(['rate limits may apply'])
  })
})

describe('llm-plan-adapter parseExecutionPlan', () => {
  it('parses valid content', () => {
    const plan = parseExecutionPlan(VALID_PLAN_JSON)
    expect(plan?.id).toBe('plan_abc')
  })

  it('returns null on garbage', () => {
    expect(parseExecutionPlan('not json')).toBeNull()
  })
})

describe('createPlannerLLMPlanAdapter', () => {
  it('returns null when model is empty', async () => {
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: {} as never,
      model: '',
      ...createTemplateDeps(),
    })
    expect(await adapter.generatePlan({ goal: 'g' })).toBeNull()
  })

  it('delegates to platform adapter and parses the response', async () => {
    const platform = {
      complete: async () => ({ success: true, response: { content: VALID_PLAN_JSON }, providerId: 'p' }),
    }
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: platform as never,
      model: 'test-model',
      ...createTemplateDeps(),
    })
    const plan = await adapter.generatePlan({ goal: 'Search AI trends', availableTools: ['web_search'] })
    expect(plan).not.toBeNull()
    expect(plan?.goal).toBe('Search AI trends')
  })

  it('returns null when platform call fails', async () => {
    const platform = { complete: async () => ({ success: false, error: { message: 'x' }, providerId: 'p' }) }
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: platform as never,
      model: 'test-model',
      ...createTemplateDeps(),
    })
    expect(await adapter.generatePlan({ goal: 'g' })).toBeNull()
  })

  it('returns null when platform call throws', async () => {
    const platform = {
      complete: async () => {
        throw new Error('boom')
      },
    }
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: platform as never,
      model: 'test-model',
      ...createTemplateDeps(),
    })
    expect(await adapter.generatePlan({ goal: 'g' })).toBeNull()
  })

  it('assembles the system prompt from seven-layer templates (L1-L5)', async () => {
    let capturedMessages: LLMMessage[] | null = null
    const platform = {
      complete: async (req: { messages: LLMMessage[] }) => {
        capturedMessages = req.messages
        return { success: true, response: { content: VALID_PLAN_JSON }, providerId: 'p' }
      },
    }
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: platform as never,
      model: 'test-model',
      ...createTemplateDeps(),
      providerFamily: 'deepseek',
    })
    await adapter.generatePlan({ goal: 'Search AI trends' })

    expect(capturedMessages).not.toBeNull()
    const systemContent = capturedMessages!.find((m) => m.role === 'system')?.content ?? ''
    expect(systemContent).toContain('Plan Generation Protocol')
    expect(systemContent).toContain('Decompose into atomic tasks')
    expect(systemContent).toContain('2-10 tasks per plan')
    expect(systemContent).toContain('output:planner.schema')
    expect(systemContent).not.toContain('You are a task planner. Decompose the user goal')
  })

  it('injects tool descriptions, constraints and context into the user prompt', async () => {
    let capturedMessages: LLMMessage[] | null = null
    const platform = {
      complete: async (req: { messages: LLMMessage[] }) => {
        capturedMessages = req.messages
        return { success: true, response: { content: VALID_PLAN_JSON }, providerId: 'p' }
      },
    }
    const adapter = createPlannerLLMPlanAdapter({
      llmAdapter: platform as never,
      model: 'test-model',
      ...createTemplateDeps(),
    })
    await adapter.generatePlan({
      goal: 'Search AI trends',
      toolDescriptions: { web_search: 'Search the web for current information' },
      userConstraints: ['No paid services'],
      contextSummary: 'User is evaluating agent platforms',
    })

    expect(capturedMessages).not.toBeNull()
    const userContent = capturedMessages!.find((m) => m.role === 'user')?.content ?? ''
    expect(userContent).toContain('Goal: Search AI trends')
    expect(userContent).toContain('- web_search: Search the web for current information')
    expect(userContent).toContain('Constraints: No paid services')
    expect(userContent).toContain('Context: User is evaluating agent platforms')
  })
})
