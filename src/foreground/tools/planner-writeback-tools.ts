import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../tools/types.js'
import type { PlannerRuntime } from '../../planner/planner-runtime.js'

export const MARK_PLANNER_STEP_TOOL_ID = 'foreground_mark_planner_step'
export const COMPLETE_PLANNER_TOOL_ID = 'foreground_complete_planner'

/**
 * Registry-level definitions for the planner write-back tools. Planner
 * children see them through their tool projection (and execute them via the
 * injected internal handlers); the main foreground agent never projects them.
 */
export function createPlannerMarkStepToolDefinition(plannerRuntime: PlannerRuntime): ToolDefinition {
  return {
    name: MARK_PLANNER_STEP_TOOL_ID,
    description:
      'Update the status of a single planner run step. Use this to record progress while executing a plan, then call foreground_complete_planner once all steps are done.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        plannerRunId: { type: 'string', description: 'ID of the planner run containing the step' },
        stepId: { type: 'string', description: 'ID of the step to update' },
        status: {
          type: 'string',
          enum: ['completed', 'failed', 'in_progress'],
          description: 'New status for the step',
        },
        result: { type: 'string', description: 'Optional result or note for the step update' },
      },
      required: ['plannerRunId', 'stepId', 'status'],
    },
    handler: async (params: unknown): Promise<ToolExecutionResult> => {
      const input = (params ?? {}) as { plannerRunId?: string; stepId?: string; status?: string; result?: string }
      if (!input.plannerRunId || !input.stepId) {
        return {
          success: false,
          error: { code: 'INVALID_ARGUMENTS', message: 'plannerRunId and stepId are required', recoverable: true },
        }
      }
      const status = input.status === 'failed' ? 'failed' : input.status === 'in_progress' ? 'in_progress' : 'completed'
      try {
        plannerRuntime.markStep(input.plannerRunId, input.stepId, status, input.result)
        return { success: true, data: { stepId: input.stepId, status } }
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'MARK_STEP_FAILED',
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          },
        }
      }
    },
    metadata: { requiresApproval: true },
  }
}

export function createPlannerCompleteToolDefinition(plannerRuntime: PlannerRuntime): ToolDefinition {
  return {
    name: COMPLETE_PLANNER_TOOL_ID,
    description:
      'Mark a planner run as completed once all of its plan steps have been executed and the task is finished.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        plannerRunId: { type: 'string', description: 'ID of the planner run to mark as completed' },
        summary: { type: 'string', description: 'Optional summary of what was accomplished' },
      },
      required: ['plannerRunId'],
    },
    handler: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const input = (params ?? {}) as { plannerRunId?: string; summary?: string }
      if (!input.plannerRunId) {
        return {
          success: false,
          error: { code: 'INVALID_ARGUMENTS', message: 'plannerRunId is required', recoverable: true },
        }
      }
      try {
        const outcome = plannerRuntime.completePlannerRun(
          input.plannerRunId,
          typeof input.summary === 'string' ? input.summary : undefined,
        )
        return { success: true, data: { plannerRunId: input.plannerRunId, status: outcome.status } }
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'COMPLETE_PLANNER_FAILED',
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          },
        }
      }
    },
    metadata: { requiresApproval: true },
  }
}
