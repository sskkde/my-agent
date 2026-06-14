/**
 * Context Bundle Adapter - Stateless adapter that converts ContextBundle
 * (from context/types.ts) to ContextBundleData (from model-input-types.ts).
 *
 * This bridges the interface mismatch between the kernel's ContextManager
 * (which produces ContextBundle) and ModelInputBuilder (which expects
 * ContextBundleData).
 *
 * @module kernel/model-input/context-bundle-adapter
 */

import type { ContextBundle, ContextItem } from '../../context/types.js'
import type { ContextBundleData, ContextItemData } from './model-input-types.js'

/**
 * Converts a ContextBundle (from ContextManager.assembleBundle()) to
 * ContextBundleData (for ModelInputBuilder Layer 7 input).
 *
 * This is a pure stateless projection - no mutation, no side effects.
 */
export function projectBundleToData(bundle: ContextBundle): ContextBundleData {
  return {
    pinnedItems: bundle.pinnedItems.map(itemToData),
    orderedItems: bundle.orderedItems.map(itemToData),
    summaryBlocks: bundle.summaryBlocks?.map(itemToData),
    planView: bundle.planView ? formatPlanView(bundle.planView) : undefined,
    workflowStepView: bundle.workflowStepView ? formatWorkflowStepView(bundle.workflowStepView) : undefined,
    backgroundRunView: bundle.backgroundRunView ? formatBackgroundRunView(bundle.backgroundRunView) : undefined,
    triggerView: bundle.triggerView ? formatTriggerView(bundle.triggerView) : undefined,
  }
}

function itemToData(item: ContextItem): ContextItemData {
  return {
    itemId: item.itemId,
    content: item.content,
    semanticType: item.semanticType,
    isPinned: item.isPinned,
    requiresPairIntegrity: item.requiresPairIntegrity,
    pairId: item.pairId,
  }
}

function formatPlanView(planView: NonNullable<ContextBundle['planView']>): string {
  const parts: string[] = [`Plan: ${planView.objective} (status: ${planView.version})`]

  if (planView.currentStep) {
    parts.push(`Current Step: ${planView.currentStep.title} - ${planView.currentStep.description ?? ''}`)
  }

  if (planView.completedSummary && planView.completedSummary.length > 0) {
    parts.push(`Completed: ${planView.completedSummary.join('; ')}`)
  }

  if (planView.nextCandidateActions && planView.nextCandidateActions.length > 0) {
    parts.push(`Next Actions: ${planView.nextCandidateActions.join('; ')}`)
  }

  if (planView.todoSummary && planView.todoSummary.length > 0) {
    const todoLines = planView.todoSummary.map(
      (entry) => `[${entry.ownerAgentType}] ${entry.todoListId}: ${entry.status}`,
    )
    parts.push(`Active Todos:\n${todoLines.join('\n')}`)
  }

  return parts.join('\n')
}

function formatWorkflowStepView(stepView: NonNullable<ContextBundle['workflowStepView']>): string {
  const parts: string[] = [`Workflow: ${stepView.stepTitle} (${stepView.stepType})`]

  if (stepView.inputSummary) {
    parts.push(`Input: ${stepView.inputSummary}`)
  }

  if (stepView.workflowConstraints && stepView.workflowConstraints.length > 0) {
    parts.push(`Constraints: ${stepView.workflowConstraints.join('; ')}`)
  }

  return parts.join('\n')
}

function formatBackgroundRunView(runView: NonNullable<ContextBundle['backgroundRunView']>): string {
  const parts: string[] = [`Background Run: ${runView.objective} (status: ${runView.status})`]

  if (runView.progressSummary) {
    parts.push(`Progress: ${runView.progressSummary}`)
  }

  return parts.join('\n')
}

function formatTriggerView(triggerView: NonNullable<ContextBundle['triggerView']>): string {
  const parts: string[] = [`Trigger: ${triggerView.eventType} (source: ${triggerView.source})`]

  if (triggerView.payloadSummary) {
    parts.push(`Payload: ${triggerView.payloadSummary}`)
  }

  return parts.join('\n')
}
