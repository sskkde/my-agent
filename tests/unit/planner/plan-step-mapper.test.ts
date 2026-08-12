import { describe, it, expect } from 'vitest'
import {
  mapSchemaPlanStepToStorage,
  mapSchemaPlanStepsToStorage,
  mapStoragePlanStepToSchema,
  mapStoragePlanStepsToSchema,
} from '../../../src/planner/plan-step-mapper.js'
import type { PlanStep as SchemaPlanStep } from '../../../src/planner/plan-schema.js'

describe('plan-step-mapper', () => {
  const schemaStep: SchemaPlanStep = {
    id: 'step_001',
    kind: 'tool_call',
    title: 'Search web',
    description: 'Search the web for AI trends',
    executor: 'agent_kernel',
    toolName: 'web_search',
    dependsOn: [{ type: 'depends_on', targetStepId: 'step_000' }],
  }

  it('maps a schema step to storage form', () => {
    const storage = mapSchemaPlanStepToStorage(schemaStep)

    expect(storage).toEqual({
      stepId: 'step_001',
      description: 'Search the web for AI trends',
      status: 'pending',
      kind: 'tool_call',
      executor: 'agent_kernel',
      toolName: 'web_search',
      dependencies: ['step_000'],
    })
  })

  it('falls back to title when description is empty', () => {
    const storage = mapSchemaPlanStepToStorage({ ...schemaStep, description: '' })

    expect(storage.description).toBe('Search web')
  })

  it('omits dependencies when absent', () => {
    const storage = mapSchemaPlanStepToStorage({ ...schemaStep, dependsOn: undefined })

    expect(storage.dependencies).toBeUndefined()
  })

  it('maps a storage step back to schema form', () => {
    const schema = mapStoragePlanStepToSchema({
      stepId: 'step_001',
      description: 'Search the web for AI trends',
      status: 'completed',
      dependencies: ['step_000'],
    })

    expect(schema.id).toBe('step_001')
    expect(schema.kind).toBe('agent_task')
    expect(schema.executor).toBe('agent_kernel')
    expect(schema.dependsOn).toEqual([{ type: 'depends_on', targetStepId: 'step_000' }])
  })

  it('preserves kind, executor and tool metadata through a storage round-trip', () => {
    const storage = mapSchemaPlanStepToStorage(schemaStep)
    expect(storage.kind).toBe('tool_call')
    expect(storage.executor).toBe('agent_kernel')
    expect(storage.toolName).toBe('web_search')

    const schema = mapStoragePlanStepToSchema(storage)
    expect(schema.kind).toBe('tool_call')
    expect(schema.executor).toBe('agent_kernel')
    expect(schema.toolName).toBe('web_search')
    expect(schema.title).toBe('Search the web for AI trends')
  })

  it('passes through approvalRequirementId and expectedOutput when present', () => {
    const schemaWithMeta: SchemaPlanStep = {
      ...schemaStep,
      approvalRequirementId: 'apr_001',
      expectedOutput: 'structured summary',
    }

    const storage = mapSchemaPlanStepToStorage(schemaWithMeta)
    expect(storage.approvalRequirementId).toBe('apr_001')
    expect(storage.expectedOutput).toBe('structured summary')

    const back = mapStoragePlanStepToSchema(storage)
    expect(back.approvalRequirementId).toBe('apr_001')
    expect(back.expectedOutput).toBe('structured summary')
  })

  it('omits optional metadata fields when absent from the schema step', () => {
    const storage = mapSchemaPlanStepToStorage({ ...schemaStep, toolName: undefined })

    expect(storage.toolName).toBeUndefined()
    expect(storage.approvalRequirementId).toBeUndefined()
    expect(storage.expectedOutput).toBeUndefined()
  })

  it('defaults kind and executor when absent from the storage step', () => {
    const schema = mapStoragePlanStepToSchema({
      stepId: 'step_002',
      description: 'Wrap up',
      status: 'pending',
    })

    expect(schema.kind).toBe('agent_task')
    expect(schema.executor).toBe('agent_kernel')
  })

  it('maps collections both ways', () => {
    const storage = mapSchemaPlanStepsToStorage([schemaStep])
    expect(storage).toHaveLength(1)

    const back = mapStoragePlanStepsToSchema(storage)
    expect(back[0]?.id).toBe('step_001')
  })
})
