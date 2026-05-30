/**
 * Foreground Decision Schema
 *
 * Defines the `foreground.decide` internal tool schema for native LLM
 * function/tool calling. The model invokes this tool to produce a structured
 * routing decision instead of free-form text.
 *
 * IMPORTANT: This schema intentionally excludes:
 *   - `runtimeAction` (the server creates it based on the route)
 *   - Privileged `targetRef` fields: `runtimeActionId`, `subagentRunId`, `workflowRunId`
 *     (these are server-assigned and must not be suggested by the LLM)
 */

import type { ToolDefinition } from '../llm/types.js';
import type { ForegroundDecisionRoute, TaskComplexity } from './types.js';

// ---------------------------------------------------------------------------
// Schema version constant
// ---------------------------------------------------------------------------

/** Current schema version for `foreground.decide` tool parameters */
export const FOREGROUND_DECIDE_SCHEMA_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// TypeScript interface (the "params" the LLM should produce)
// ---------------------------------------------------------------------------

/**
 * Parameters for the `foreground.decide` internal tool.
 *
 * The LLM produces a JSON object matching this shape. The foreground agent
 * then uses it to route the conversation appropriately.
 */
export interface ForegroundDecideParams {
  /** Schema version — must match {@link FOREGROUND_DECIDE_SCHEMA_VERSION} */
  schemaVersion: string;

  /**
   * The routing decision.
   * Determines how the foreground agent should handle the user's request.
   */
  route: ForegroundDecisionRoute;

  /**
   * Whether a planner agent is required to fulfil this request.
   * Set to `true` for multi-step or complex tasks.
   */
  requiresPlanner: boolean;

  /**
   * Human-readable explanation of why this route was chosen.
   * Must be non-empty (max 1000 characters).
   */
  reason: string;

  /**
   * Optional response text shown to the user immediately
   * (e.g. acknowledgement, clarification question).
   */
  userVisibleResponse?: string;

  /**
   * Suggested tool IDs when `route` is `'dispatch_tool'`.
   * Helps the dispatcher select the right tools.
   */
  suggestedTools?: string[];

  /**
   * Estimated number of discrete steps needed to complete the task.
   * Valid range: 1–50. Useful for complexity heuristics.
   */
  estimatedSteps?: number;

  /**
   * Detected task complexity level.
   * Guides planner depth and resource allocation.
   */
  complexity?: TaskComplexity;

  /**
   * Non-privileged target references.
   * Only `plannerRunId` and `planId` are exposed here.
   * Privileged refs (`runtimeActionId`, `subagentRunId`, `workflowRunId`)
   * are server-assigned and intentionally omitted.
   */
  targetRef?: {
    /** Existing planner run ID to resume */
    plannerRunId?: string;
    /** Existing plan ID to resume */
    planId?: string;
  };
}

// ---------------------------------------------------------------------------
// JSON Schema (OpenAI / OpenRouter function-calling format)
// ---------------------------------------------------------------------------

/**
 * JSON Schema for `ForegroundDecideParams`, suitable for use in
 * OpenAI-compatible function/tool calling APIs.
 *
 * Follows the standard `{ type: 'function', function: { name, description, parameters } }`
 * shape expected by OpenAI, OpenRouter, and most LLM providers.
 */
export const FOREGROUND_DECIDE_SCHEMA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'foreground.decide',
    description:
      'Produce a structured routing decision for the current user message. ' +
      'Call this tool instead of generating a free-form response when you need ' +
      'to route the request to a tool, subagent, planner, or other handler.',
    parameters: {
      type: 'object',
      properties: {
        schemaVersion: {
          type: 'string',
          description: 'Schema version. Must be "1.0".',
          const: FOREGROUND_DECIDE_SCHEMA_VERSION,
        },
        route: {
          type: 'string',
          enum: [
            'answer_directly',
            'dispatch_tool',
            'dispatch_subagent',
            'spawn_planner',
            'resume_existing_planner',
            'approval_handler',
            'cancel_or_modify_task',
            'status_query',
          ],
          description:
            'The routing decision. Determines how the foreground agent handles the request.',
        },
        requiresPlanner: {
          type: 'boolean',
          description:
            'Whether a planner agent is required. Set true for multi-step or complex tasks.',
        },
        reason: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description:
            'Human-readable explanation of why this route was chosen (1–1000 chars).',
        },
        userVisibleResponse: {
          type: 'string',
          description:
            'Optional text shown to the user immediately (acknowledgement, clarification, etc.).',
        },
        suggestedTools: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Suggested tool IDs when route is "dispatch_tool". Helps the dispatcher.',
        },
        estimatedSteps: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description:
            'Estimated number of discrete steps to complete the task (1–50).',
        },
        complexity: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Detected task complexity level.',
        },
        targetRef: {
          type: 'object',
          properties: {
            plannerRunId: {
              type: 'string',
              description: 'Existing planner run ID to resume.',
            },
            planId: {
              type: 'string',
              description: 'Existing plan ID to reference.',
            },
          },
          additionalProperties: false,
          description:
            'Non-privileged target references. Only plannerRunId and planId are allowed. ' +
            'Privileged fields (runtimeActionId, subagentRunId, workflowRunId) are server-assigned.',
        },
      },
      required: ['schemaVersion', 'route', 'requiresPlanner', 'reason'],
      additionalProperties: false,
    },
  },
};

// ---------------------------------------------------------------------------
// Default params factory
// ---------------------------------------------------------------------------

/**
 * Create a `ForegroundDecideParams` object with sensible defaults.
 *
 * Useful as a starting point that callers can spread-override:
 * ```ts
 * const params = { ...createDefaultForegroundDecideParams(), route: 'dispatch_tool' };
 * ```
 */
export function createDefaultForegroundDecideParams(): ForegroundDecideParams {
  return {
    schemaVersion: FOREGROUND_DECIDE_SCHEMA_VERSION,
    route: 'answer_directly',
    requiresPlanner: false,
    reason: '',
  };
}
