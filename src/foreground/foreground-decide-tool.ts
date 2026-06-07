/**
 * Foreground Decide Tool — Internal routing decision tool
 *
 * This is an **internal-only** structured-output mechanism used by the
 * foreground agent to produce a routing decision via native LLM function
 * calling. It is intentionally NOT registered in the public tool catalog.
 *
 * The tool validates the LLM-produced params and returns a
 * {@link ForegroundDecision} object. It does **not** set `runtimeAction` —
 * that field is the server's responsibility after the decision is made.
 */

import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolSchema } from '../tools/types.js'
import type { ForegroundDecideParams } from './foreground-decision-schema.js'
import { FOREGROUND_DECIDE_SCHEMA } from './foreground-decision-schema.js'
import type { ForegroundDecision } from './types.js'

/**
 * Structured result returned by the `foreground_decide` tool handler.
 *
 * Contains the validated {@link ForegroundDecision} and an optional list of
 * validation errors (present only when `success` is `false` on the outer
 * {@link ToolExecutionResult}).
 */
export interface ForegroundDecideResult {
  decision: ForegroundDecision
  validationErrors?: string[]
}

/**
 * Create the `foreground_decide` internal tool definition.
 *
 * This tool is **not** registered in the public tool catalog. It is only
 * available to the foreground agent as a structured-output mechanism for
 * native LLM function calling.
 *
 * The handler:
 * 1. Casts params to {@link ForegroundDecideParams}
 * 2. Validates that `reason` is non-empty
 * 3. Builds a {@link ForegroundDecision} from validated params
 * 4. Returns the decision as a structured result
 *
 * **Important:** `runtimeAction` is intentionally omitted — the server
 * creates it based on the decided route after the tool returns.
 */
export function createForegroundDecideTool(): ToolDefinition {
  const handler: ToolHandler = (params: unknown): ToolExecutionResult => {
    const typedParams = params as ForegroundDecideParams

    const validationErrors: string[] = []

    if (!typedParams.reason || typedParams.reason.trim().length === 0) {
      validationErrors.push('reason must be a non-empty string')
    }

    if (validationErrors.length > 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: `Validation failed: ${validationErrors.join('; ')}`,
          recoverable: true,
        },
        data: { validationErrors } satisfies Partial<ForegroundDecideResult>,
      }
    }

    const decision: ForegroundDecision = {
      route: typedParams.route,
      requiresPlanner: typedParams.requiresPlanner,
      reason: typedParams.reason,
      userVisibleResponse: typedParams.userVisibleResponse,
      estimatedSteps: typedParams.estimatedSteps,
      complexity: typedParams.complexity,
      suggestedTools: typedParams.suggestedTools,
      targetRef: typedParams.targetRef
        ? {
            plannerRunId: typedParams.targetRef.plannerRunId,
            planId: typedParams.targetRef.planId,
          }
        : undefined,
    }

    const result: ForegroundDecideResult = { decision }

    return {
      success: true,
      data: result,
      resultPreview: `Decision: ${decision.route} — ${decision.reason}`,
      structuredContent: result as unknown as Record<string, unknown>,
    }
  }

  const schema: ToolSchema = FOREGROUND_DECIDE_SCHEMA.function.parameters as unknown as ToolSchema

  return {
    name: 'foreground_decide',
    description:
      'Internal routing decision tool for the foreground agent. ' +
      'Produce a structured routing decision for the current user message instead of free-form text. ' +
      'This tool is internal-only and not registered in the public catalog.',
    category: 'internal',
    sensitivity: 'low',
    schema,
    handler,
  }
}
