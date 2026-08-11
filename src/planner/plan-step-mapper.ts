/**
 * Bidirectional mapping between the planner schema PlanStep
 * (`src/planner/plan-schema.ts`) and the persisted storage PlanStep
 * (`src/storage/plan-store.ts`). The schema shape carries kind/executor/tool
 * metadata for generation/validation; the storage shape is what plan_store
 * persists and what the child kernel loop consumes for execution/回写.
 */

import type { PlanStep as SchemaPlanStep } from './plan-schema.js'
import type { PlanStep as StoragePlanStep } from '../storage/plan-store.js'

/** Map a schema step to its persisted storage form. */
export function mapSchemaPlanStepToStorage(step: SchemaPlanStep): StoragePlanStep {
  return {
    stepId: step.id,
    description: step.description || step.title,
    status: 'pending',
    ...(step.dependsOn && step.dependsOn.length > 0 ? { dependencies: step.dependsOn.map((d) => d.targetStepId) } : {}),
  }
}

/** Map an execution plan's steps to persisted storage steps. */
export function mapSchemaPlanStepsToStorage(steps: SchemaPlanStep[]): StoragePlanStep[] {
  return steps.map(mapSchemaPlanStepToStorage)
}

/** Map a persisted storage step back to a schema step (display/validation). */
export function mapStoragePlanStepToSchema(step: StoragePlanStep): SchemaPlanStep {
  return {
    id: step.stepId,
    kind: 'agent_task',
    title: step.description,
    description: step.description,
    executor: 'agent_kernel',
    ...(step.dependencies && step.dependencies.length > 0
      ? { dependsOn: step.dependencies.map((targetStepId) => ({ type: 'depends_on' as const, targetStepId })) }
      : {}),
  }
}

/** Map persisted storage steps back to schema steps. */
export function mapStoragePlanStepsToSchema(steps: StoragePlanStep[]): SchemaPlanStep[] {
  return steps.map(mapStoragePlanStepToSchema)
}
