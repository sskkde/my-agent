import { describe, it, expect, beforeEach } from 'vitest'
import { PlanValidator, type PlanValidatorDeps } from '../../../src/planner/plan-validator.js'
import type { ExecutionPlan, PlanStep } from '../../../src/planner/plan-schema.js'

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'plan-001',
    goal: 'Test goal',
    steps: [
      {
        id: 'step-1',
        kind: 'tool_call',
        title: 'Read file',
        description: 'Read the config file',
        executor: 'tool_plane',
        toolName: 'read_tool',
      },
      {
        id: 'step-2',
        kind: 'final_response',
        title: 'Respond',
        description: 'Return result',
        executor: 'foreground',
      },
    ],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  }
}

function makeToolCallStep(id: string, toolName: string, overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id,
    kind: 'tool_call',
    title: `Step ${id}`,
    description: `Execute ${toolName}`,
    executor: 'tool_plane',
    toolName,
    ...overrides,
  }
}

function makeFinalResponseStep(id: string): PlanStep {
  return {
    id,
    kind: 'final_response',
    title: 'Done',
    description: 'Return final response',
    executor: 'foreground',
  }
}

function createMockDeps(): PlanValidatorDeps {
  const tools = new Map<string, { name: string; category: string }>()
  tools.set('read_tool', { name: 'read_tool', category: 'read' })
  tools.set('write_tool', { name: 'write_tool', category: 'write' })
  tools.set('delete_tool', { name: 'delete_tool', category: 'delete' })
  tools.set('search_tool', { name: 'search_tool', category: 'search' })

  const riskPolicies = new Map<string, { requiresApproval: boolean }>()
  riskPolicies.set('write_tool', { requiresApproval: true })
  riskPolicies.set('delete_tool', { requiresApproval: true })
  riskPolicies.set('read_tool', { requiresApproval: false })

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

describe('PlanValidator', () => {
  let validator: PlanValidator
  let deps: PlanValidatorDeps

  beforeEach(() => {
    deps = createMockDeps()
    validator = new PlanValidator(deps)
  })

  it('accepts a valid plan', () => {
    const plan = makePlan({
      successCriteria: ['File read successfully'],
      steps: [makeToolCallStep('step-1', 'read_tool'), makeFinalResponseStep('step-2')],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a plan with missing goal', () => {
    const plan = makePlan({ goal: '' })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'PLAN_MISSING_GOAL')).toBe(true)
  })

  it('rejects a plan with duplicate step IDs', () => {
    const plan = makePlan({
      steps: [
        makeToolCallStep('dup-id', 'read_tool'),
        makeToolCallStep('dup-id', 'search_tool'),
        makeFinalResponseStep('step-3'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'DUPLICATE_STEP_ID')).toBe(true)
  })

  it('rejects a plan with unknown executor', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'step-1',
          kind: 'tool_call',
          title: 'Test',
          description: 'Test',
          executor: 'invalid_executor' as any,
          toolName: 'read_tool',
        },
        makeFinalResponseStep('step-2'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'INVALID_EXECUTOR')).toBe(true)
  })

  it('rejects a tool_call step without toolName', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'step-1',
          kind: 'tool_call',
          title: 'Missing tool',
          description: 'No toolName',
          executor: 'tool_plane',
        },
        makeFinalResponseStep('step-2'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'TOOL_CALL_MISSING_TOOL_NAME')).toBe(true)
  })

  it('errors on write tool without approval', () => {
    const plan = makePlan({
      steps: [makeToolCallStep('step-1', 'write_tool'), makeFinalResponseStep('step-2')],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'WRITE_TOOL_WITHOUT_APPROVAL')).toBe(true)
  })

  it('accepts write tool with approval', () => {
    const plan = makePlan({
      steps: [
        makeToolCallStep('step-1', 'write_tool', { approvalRequirementId: 'approval-1' }),
        makeFinalResponseStep('step-2'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('detects circular dependency A→B→A', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'A',
          kind: 'tool_call',
          title: 'Step A',
          description: 'Depends on B',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
        },
        {
          id: 'B',
          kind: 'tool_call',
          title: 'Step B',
          description: 'Depends on A',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
        },
        makeFinalResponseStep('C'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true)
  })

  it('detects circular dependency A→B→C→A', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'A',
          kind: 'tool_call',
          title: 'Step A',
          description: 'Depends on B',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
        },
        {
          id: 'B',
          kind: 'tool_call',
          title: 'Step B',
          description: 'Depends on C',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'C' }],
        },
        {
          id: 'C',
          kind: 'tool_call',
          title: 'Step C',
          description: 'Depends on A',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'A' }],
        },
        makeFinalResponseStep('D'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true)
  })

  it('errors when dependency references non-existent step', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'step-1',
          kind: 'tool_call',
          title: 'Step 1',
          description: 'Depends on missing step',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'non_existent' }],
        },
        makeFinalResponseStep('step-2'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'DEPENDENCY_MISSING_TARGET')).toBe(true)
  })

  it('warns when no final_response step exists', () => {
    const plan = makePlan({
      steps: [makeToolCallStep('step-1', 'read_tool'), makeToolCallStep('step-2', 'search_tool')],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.code === 'NO_FINAL_RESPONSE')).toBe(true)
  })

  it('errors on unknown tool name', () => {
    const plan = makePlan({
      steps: [makeToolCallStep('step-1', 'nonexistent_tool'), makeFinalResponseStep('step-2')],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'UNKNOWN_TOOL')).toBe(true)
  })

  it('errors on empty steps array', () => {
    const plan = makePlan({ steps: [] })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'PLAN_EMPTY_STEPS')).toBe(true)
  })

  it('warns when no success criteria defined', () => {
    const plan = makePlan({
      successCriteria: undefined,
      steps: [makeToolCallStep('step-1', 'read_tool'), makeFinalResponseStep('step-2')],
    })
    const result = validator.validate(plan)
    expect(result.warnings.some((w) => w.code === 'NO_SUCCESS_CRITERIA')).toBe(true)
  })

  it('rejects a plan with missing id', () => {
    const plan = makePlan({ id: '' })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'PLAN_MISSING_ID')).toBe(true)
  })

  it('errors on delete tool without approval', () => {
    const plan = makePlan({
      steps: [makeToolCallStep('step-1', 'delete_tool'), makeFinalResponseStep('step-2')],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'WRITE_TOOL_WITHOUT_APPROVAL')).toBe(true)
  })

  it('rejects invalid step kind', () => {
    const plan = makePlan({
      steps: [
        {
          id: 'step-1',
          kind: 'bad_kind' as any,
          title: 'Bad kind',
          description: 'Invalid',
          executor: 'foreground',
        },
        makeFinalResponseStep('step-2'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'INVALID_STEP_KIND')).toBe(true)
  })

  it('accepts plan with valid dependencies (no cycles)', () => {
    const plan = makePlan({
      successCriteria: ['Done'],
      steps: [
        {
          id: 'A',
          kind: 'tool_call',
          title: 'Step A',
          description: 'Depends on B',
          executor: 'tool_plane',
          toolName: 'read_tool',
          dependsOn: [{ type: 'depends_on', targetStepId: 'B' }],
        },
        {
          id: 'B',
          kind: 'tool_call',
          title: 'Step B',
          description: 'No deps',
          executor: 'tool_plane',
          toolName: 'read_tool',
        },
        makeFinalResponseStep('C'),
      ],
    })
    const result = validator.validate(plan)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
