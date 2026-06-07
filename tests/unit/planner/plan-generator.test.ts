import { describe, it, expect, beforeEach } from 'vitest'
import { DeterministicPlanGenerator, type ToolClassifier } from '../../../src/planner/deterministic-plan-generator.js'
import { PlanValidator, type PlanValidatorDeps } from '../../../src/planner/plan-validator.js'
import type { PlanGenerationInput } from '../../../src/planner/plan-schema.js'

const VALID_STEP_KINDS: ReadonlySet<string> = new Set([
  'agent_task',
  'tool_call',
  'subagent_task',
  'workflow_step',
  'user_approval',
  'final_response',
])

function createToolClassifier(writeTools: string[]): ToolClassifier {
  const writeSet = new Set(writeTools)
  return {
    isWriteTool(toolName: string): boolean {
      return writeSet.has(toolName)
    },
  }
}

function createValidatorDeps(): PlanValidatorDeps {
  const tools = new Map<string, { name: string; category: string }>()
  tools.set('read_tool', { name: 'read_tool', category: 'read' })
  tools.set('search_tool', { name: 'search_tool', category: 'search' })
  tools.set('write_tool', { name: 'write_tool', category: 'write' })
  tools.set('delete_tool', { name: 'delete_tool', category: 'delete' })
  tools.set('send_tool', { name: 'send_tool', category: 'write' })

  const riskPolicies = new Map<string, { requiresApproval: boolean }>()
  riskPolicies.set('write_tool', { requiresApproval: true })
  riskPolicies.set('delete_tool', { requiresApproval: true })
  riskPolicies.set('send_tool', { requiresApproval: true })
  riskPolicies.set('read_tool', { requiresApproval: false })
  riskPolicies.set('search_tool', { requiresApproval: false })

  return {
    toolRegistry: {
      hasTool(name: string): boolean {
        return tools.has(name)
      },
      getTool(name: string): { name: string; category: string } | null {
        return tools.get(name) ?? null
      },
    },
    getToolRiskPolicy(toolName: string): { requiresApproval: boolean } {
      return riskPolicies.get(toolName) ?? { requiresApproval: false }
    },
  }
}

describe('DeterministicPlanGenerator', () => {
  let generator: DeterministicPlanGenerator
  let validator: PlanValidator
  let deps: PlanValidatorDeps

  beforeEach(() => {
    const classifier = createToolClassifier(['write_tool', 'delete_tool', 'send_tool'])
    generator = new DeterministicPlanGenerator(classifier)
    deps = createValidatorDeps()
    validator = new PlanValidator(deps)
  })

  function makeInput(overrides: Partial<PlanGenerationInput> = {}): PlanGenerationInput {
    return {
      goal: 'Test goal',
      ...overrides,
    }
  }

  it('generates 1-2 steps for a simple Chinese goal', () => {
    const input = makeInput({ goal: '帮我查一下状态' })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeGreaterThanOrEqual(1)
    expect(output.plan.steps.length).toBeLessThanOrEqual(2)
  })

  it('generates 1-2 steps for a simple English goal', () => {
    const input = makeInput({ goal: 'check status' })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeGreaterThanOrEqual(1)
    expect(output.plan.steps.length).toBeLessThanOrEqual(2)
  })

  it('generates 3+ steps for a complex goal with write keywords', () => {
    const input = makeInput({ goal: '帮我创建项目计划并发送给团队' })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeGreaterThanOrEqual(3)
  })

  it('generates 3+ steps for a complex English goal', () => {
    const input = makeInput({ goal: 'create a new project and send it to the team' })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeGreaterThanOrEqual(3)
  })

  it('produces identical step IDs for the same input (deterministic)', () => {
    const input = makeInput({ goal: '创建一个测试文件' })
    const out1 = generator.generate(input)
    const out2 = generator.generate(input)

    expect(out1.plan.id).toBe(out2.plan.id)
    expect(out1.plan.steps.length).toBe(out2.plan.steps.length)
    for (let i = 0; i < out1.plan.steps.length; i++) {
      expect(out1.plan.steps[i].id).toBe(out2.plan.steps[i].id)
      expect(out1.plan.steps[i].kind).toBe(out2.plan.steps[i].kind)
      expect(out1.plan.steps[i].title).toBe(out2.plan.steps[i].title)
    }
  })

  it('includes approval requirement for write goals', () => {
    const input = makeInput({
      goal: '创建一个文件',
      availableTools: ['read_tool', 'write_tool'],
    })
    const output = generator.generate(input)

    const writeSteps = output.plan.steps.filter((s) => s.kind === 'tool_call' && s.toolName === 'write_tool')
    expect(writeSteps.length).toBeGreaterThan(0)

    for (const step of writeSteps) {
      expect(step.approvalRequirementId).toBeTruthy()
    }

    expect(output.plan.requiredApprovals).toBeDefined()
    expect(output.plan.requiredApprovals!.length).toBeGreaterThan(0)
  })

  it('generated plan passes PlanValidator.validate()', () => {
    const input = makeInput({
      goal: 'read config file',
      availableTools: ['read_tool'],
    })
    const output = generator.generate(input)

    const result = validator.validate(output.plan)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('generated write plan passes PlanValidator.validate()', () => {
    const input = makeInput({
      goal: '创建一个文件',
      availableTools: ['read_tool', 'write_tool'],
    })
    const output = generator.generate(input)

    const result = validator.validate(output.plan)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('generates only valid step kinds', () => {
    const inputs: PlanGenerationInput[] = [
      makeInput({ goal: '简单查询' }),
      makeInput({ goal: '创建并发送项目计划给团队' }),
      makeInput({ goal: 'delete old files and clean up', availableTools: ['read_tool', 'delete_tool'] }),
    ]

    for (const input of inputs) {
      const output = generator.generate(input)
      for (const step of output.plan.steps) {
        expect(VALID_STEP_KINDS.has(step.kind)).toBe(true)
      }
    }
  })

  it('respects maxSteps constraint', () => {
    const input = makeInput({
      goal: '创建项目计划并发送给团队',
      constraints: { maxSteps: 2 },
    })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeLessThanOrEqual(2)
  })

  it('respects maxSteps constraint with larger limit', () => {
    const input = makeInput({
      goal: '创建项目计划并发送给团队',
      constraints: { maxSteps: 4 },
    })
    const output = generator.generate(input)
    expect(output.plan.steps.length).toBeLessThanOrEqual(4)
  })

  it('always ends with a final_response step', () => {
    const inputs: PlanGenerationInput[] = [
      makeInput({ goal: '简单查询' }),
      makeInput({ goal: '创建并发送项目计划给团队' }),
      makeInput({ goal: 'check the current status of all running services' }),
      makeInput({ goal: 'delete old files', availableTools: ['read_tool', 'delete_tool'] }),
    ]

    for (const input of inputs) {
      const output = generator.generate(input)
      const lastStep = output.plan.steps[output.plan.steps.length - 1]
      expect(lastStep.kind).toBe('final_response')
    }
  })

  it('generates plans with valid executor types', () => {
    const validExecutors = new Set(['agent_kernel', 'tool_plane', 'subagent', 'workflow_runtime', 'foreground'])

    const inputs: PlanGenerationInput[] = [
      makeInput({ goal: '简单查询' }),
      makeInput({ goal: '创建项目计划', availableTools: ['read_tool', 'write_tool'] }),
    ]

    for (const input of inputs) {
      const output = generator.generate(input)
      for (const step of output.plan.steps) {
        expect(validExecutors.has(step.executor)).toBe(true)
      }
    }
  })

  it('generates plans with non-empty goal and id', () => {
    const input = makeInput({ goal: '帮我查一下状态' })
    const output = generator.generate(input)

    expect(output.plan.id).toBeTruthy()
    expect(output.plan.goal).toBe(input.goal)
    expect(output.plan.steps.length).toBeGreaterThan(0)
  })
})
