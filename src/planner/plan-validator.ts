import type { ExecutionPlan, PlanStep, PlanValidationIssue, PlanValidationResult } from './plan-schema.js'

export interface PlanValidatorDeps {
  toolRegistry: {
    hasTool(name: string): boolean
    getTool?(name: string): { name: string; category: string } | null
  }
  getToolRiskPolicy?(toolName: string): { requiresApproval: boolean }
}

const VALID_STEP_KINDS = new Set([
  'agent_task',
  'tool_call',
  'subagent_task',
  'workflow_step',
  'user_approval',
  'final_response',
])

const VALID_EXECUTORS = new Set(['agent_kernel', 'tool_plane', 'subagent', 'workflow_runtime', 'foreground'])

export class PlanValidator {
  private toolRegistry: PlanValidatorDeps['toolRegistry']
  private getToolRiskPolicy?: PlanValidatorDeps['getToolRiskPolicy']

  constructor(deps: PlanValidatorDeps) {
    this.toolRegistry = deps.toolRegistry
    this.getToolRiskPolicy = deps.getToolRiskPolicy
  }

  validate(plan: ExecutionPlan): PlanValidationResult {
    const errors: PlanValidationIssue[] = []
    const warnings: PlanValidationIssue[] = []

    if (!plan.id || plan.id.trim() === '') {
      errors.push({
        code: 'PLAN_MISSING_ID',
        message: 'Plan id is required',
        severity: 'error',
        path: 'id',
      })
    }

    if (!plan.goal || plan.goal.trim() === '') {
      errors.push({
        code: 'PLAN_MISSING_GOAL',
        message: 'Plan goal is required and must be non-empty',
        severity: 'error',
        path: 'goal',
      })
    }

    if (!plan.steps || plan.steps.length === 0) {
      errors.push({
        code: 'PLAN_EMPTY_STEPS',
        message: 'Plan must have at least one step',
        severity: 'error',
        path: 'steps',
      })
      return { valid: false, errors, warnings }
    }

    const stepIds = plan.steps.map((s) => s.id)
    const seenIds = new Set<string>()

    for (const stepId of stepIds) {
      if (seenIds.has(stepId)) {
        errors.push({
          code: 'DUPLICATE_STEP_ID',
          message: `Duplicate step id: ${stepId}`,
          severity: 'error',
          path: `steps.${stepId}`,
        })
      }
      seenIds.add(stepId)
    }

    const validStepIds = new Set(stepIds)
    let hasFinalResponse = false

    for (const step of plan.steps) {
      if (!VALID_STEP_KINDS.has(step.kind)) {
        errors.push({
          code: 'INVALID_STEP_KIND',
          message: `Invalid step kind: ${step.kind}`,
          severity: 'error',
          path: `steps.${step.id}.kind`,
        })
      }

      if (!VALID_EXECUTORS.has(step.executor)) {
        errors.push({
          code: 'INVALID_EXECUTOR',
          message: `Invalid executor: ${step.executor}`,
          severity: 'error',
          path: `steps.${step.id}.executor`,
        })
      }

      if (step.kind === 'tool_call' && !step.toolName) {
        errors.push({
          code: 'TOOL_CALL_MISSING_TOOL_NAME',
          message: 'tool_call step must have toolName',
          severity: 'error',
          path: `steps.${step.id}.toolName`,
        })
      }

      if (step.toolName && !this.toolRegistry.hasTool(step.toolName)) {
        errors.push({
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${step.toolName}`,
          severity: 'error',
          path: `steps.${step.id}.toolName`,
        })
      }

      if (step.toolName && step.kind === 'tool_call') {
        const tool = this.toolRegistry.getTool?.(step.toolName) ?? null
        const riskPolicy = this.getToolRiskPolicy?.(step.toolName)
        const requiresApproval =
          (tool !== null && (tool.category === 'write' || tool.category === 'delete')) ||
          riskPolicy?.requiresApproval === true

        if (requiresApproval && !step.approvalRequirementId) {
          errors.push({
            code: 'WRITE_TOOL_WITHOUT_APPROVAL',
            message: `Write/delete tool "${step.toolName}" requires approval`,
            severity: 'error',
            path: `steps.${step.id}.approvalRequirementId`,
          })
        }
      }

      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!validStepIds.has(dep.targetStepId)) {
            errors.push({
              code: 'DEPENDENCY_MISSING_TARGET',
              message: `Dependency target step "${dep.targetStepId}" not found`,
              severity: 'error',
              path: `steps.${step.id}.dependsOn`,
            })
          }
        }
      }

      if (step.kind === 'final_response') {
        hasFinalResponse = true
      }
    }

    const cycleError = this.detectCycles(plan.steps)
    if (cycleError) {
      errors.push(cycleError)
    }

    if (!hasFinalResponse) {
      warnings.push({
        code: 'NO_FINAL_RESPONSE',
        message: 'Plan has no final_response step',
        severity: 'warning',
      })
    }

    if (!plan.successCriteria || plan.successCriteria.length === 0) {
      warnings.push({
        code: 'NO_SUCCESS_CRITERIA',
        message: 'Plan has no success criteria',
        severity: 'warning',
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  private detectCycles(steps: PlanStep[]): PlanValidationIssue | null {
    const stepIds = new Map<string, PlanStep>()
    for (const step of steps) {
      stepIds.set(step.id, step)
    }

    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const colors = new Map<string, number>()
    for (const step of steps) {
      colors.set(step.id, WHITE)
    }

    let cyclePath: string[] | null = null

    const dfs = (stepId: string, path: string[]): boolean => {
      const color = colors.get(stepId)
      if (color === GRAY) {
        const cycleStart = path.indexOf(stepId)
        cyclePath = [...path.slice(cycleStart), stepId]
        return true
      }
      if (color === BLACK) return false

      colors.set(stepId, GRAY)
      path.push(stepId)

      const step = stepIds.get(stepId)
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          if (dfs(dep.targetStepId, path)) {
            return true
          }
        }
      }

      path.pop()
      colors.set(stepId, BLACK)
      return false
    }

    for (const step of steps) {
      if (colors.get(step.id) === WHITE) {
        const path: string[] = []
        if (dfs(step.id, path)) {
          return {
            code: 'CIRCULAR_DEPENDENCY',
            message: `Circular dependency detected: ${(cyclePath ?? []).join(' → ')}`,
            severity: 'error',
          }
        }
      }
    }

    return null
  }
}
