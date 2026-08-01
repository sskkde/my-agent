/**
 * Foreground Tools Index - Registration and exports for foreground tools.
 *
 * This module provides:
 * - Tool ID constants for all foreground tools
 * - Factory functions for creating tool definitions
 * - registerAllForegroundTools() for registry assembly
 *
 * @module foreground/tools/index
 */

import type { ToolDefinition, ToolHandler, ToolExecutionContext, ToolExecutionResult } from '../../tools/types.js'
import { STATUS_QUERY_TOOL_ID, handleStatusQuery, type StatusQueryData } from './status-query-tool.js'
import {
  SPAWN_PLANNER_TOOL_ID,
  handleSpawnPlanner,
  type SpawnPlannerInput,
  type SpawnPlannerData,
} from './planner-spawn-tool.js'
import {
  RESUME_PLANNER_TOOL_ID,
  handleResumePlanner,
  type ResumePlannerInput,
  type ResumePlannerData,
} from './planner-resume-tool.js'
import {
  LAUNCH_SUBAGENT_TOOL_ID,
  handleLaunchSubagent,
  type LaunchSubagentInput,
  type LaunchSubagentData,
} from './subagent-launch-tool.js'
import {
  CANCEL_MODIFY_TOOL_ID,
  handleCancelOrModifyTask,
  type CancelModifyInput,
  type CancelModifyData,
} from './cancel-modify-task-tool.js'
import {
  CANCEL_PLANNER_TOOL_ID,
  handleCancelPlanner,
  type CancelPlannerInput,
  type CancelPlannerData,
} from './cancel-planner-tool.js'
import {
  APPROVAL_REQUEST_TOOL_ID,
  handleApprovalRequest,
  handleApprovalResponse,
  type ApprovalRequestInput,
  type ApprovalRequestData,
  type ApprovalResponseInput,
  type ApprovalResponseData,
} from './approval-request-tool.js'
import { SEARCH_SUBAGENT_TOOL_ID, type SearchSubagentToolInput } from '../../search/search-subagent-tool.js'
import type { ToolRegistry } from '../../tools/types.js'
import {
  mapForegroundToolResult,
  resolveTurnIdentity,
  type ForegroundToolRuntimeDeps,
} from './foreground-tool-runtime.js'

// Re-export tool IDs
export {
  STATUS_QUERY_TOOL_ID,
  SPAWN_PLANNER_TOOL_ID,
  RESUME_PLANNER_TOOL_ID,
  LAUNCH_SUBAGENT_TOOL_ID,
  CANCEL_MODIFY_TOOL_ID,
  CANCEL_PLANNER_TOOL_ID,
  APPROVAL_REQUEST_TOOL_ID,
  SEARCH_SUBAGENT_TOOL_ID,
}

// Re-export tool types
export type {
  StatusQueryData,
  SpawnPlannerInput,
  SpawnPlannerData,
  ResumePlannerInput,
  ResumePlannerData,
  LaunchSubagentInput,
  LaunchSubagentData,
  CancelModifyInput,
  CancelModifyData,
  CancelPlannerInput,
  CancelPlannerData,
  ApprovalRequestInput,
  ApprovalRequestData,
  ApprovalResponseInput,
  ApprovalResponseData,
  SearchSubagentToolInput,
}

// Re-export handlers (for testing and direct invocation)
export { handleStatusQuery } from './status-query-tool.js'
export { handleSpawnPlanner } from './planner-spawn-tool.js'
export { handleResumePlanner } from './planner-resume-tool.js'
export { handleLaunchSubagent } from './subagent-launch-tool.js'
export { handleCancelOrModifyTask } from './cancel-modify-task-tool.js'
export { handleCancelPlanner } from './cancel-planner-tool.js'
export { handleApprovalRequest, handleApprovalResponse } from './approval-request-tool.js'
export { handleSearchSubagentTool } from '../../search/search-subagent-tool.js'
export type { SearchSubagentToolDeps } from '../../search/search-subagent-tool.js'
export { DefaultSearchQueryPlanner, DefaultSearchResultNormalizer } from '../../search/search-subagent-tool.js'
export { assertSearchScope } from '../../search/search-subagent-types.js'

import { handleSearchSubagentTool } from '../../search/search-subagent-tool.js'

/**
 * Placeholder handler for foreground tools.
 * Foreground tools are executed via the processor pipeline, not the standard ToolExecutor.
 * This handler returns a synthetic result indicating the tool requires foreground execution.
 */
const foregroundToolPlaceholderHandler: ToolHandler = async (): Promise<ToolExecutionResult> => {
  return {
    success: false,
    synthetic: true,
    error: {
      code: 'FOREGROUND_TOOL_REQUIRES_KERNEL',
      message: 'This tool must be executed via the foreground processor pipeline',
      recoverable: false,
    },
    resultPreview: 'Tool requires foreground kernel execution',
  }
}

/**
 * Create the search_subagent tool definition with production dependencies.
 * - sensitivity: 'medium'
 * - category: 'search'
 * - requiresApproval: false
 */
export function createSearchSubagentToolDefinition(
  deps: import('../../search/search-subagent-tool.js').SearchSubagentToolDeps,
): ToolDefinition {
  return {
    name: SEARCH_SUBAGENT_TOOL_ID,
    description:
      'Search the web for information. Returns structured evidence with extracted facts and source URLs. Uses a synchronous search service.',
    category: 'search',
    sensitivity: 'medium',
    requiresPermission: false,
    schema: {
      type: 'object',
      properties: {
        originalQuestion: {
          type: 'string',
          description: 'The original question to search for',
        },
        intent: {
          type: 'string',
          enum: ['fact', 'definition', 'how_to', 'comparison', 'news', 'location', 'event'],
          description: 'The search intent type',
        },
        locale: {
          type: 'string',
          description: 'Locale for search results (e.g., "en-US")',
        },
        freshnessRequired: {
          type: 'boolean',
          description: 'Whether fresh/recent results are required',
        },
      },
      required: ['originalQuestion'],
    },
    handler: async (params: unknown): Promise<ToolExecutionResult> => {
      const result = await handleSearchSubagentTool(deps, params as SearchSubagentToolInput)
      return {
        success: result.success,
        data: result.data,
        error: result.error,
        resultPreview: result.userVisibleSummary,
      }
    },
    metadata: {
      requiresApproval: false,
    },
  }
}

/**
 * Create the foreground_status_query tool definition.
 * - sensitivity: 'low'
 * - category: 'read'
 * - requiresApproval: false
 */
export function createForegroundStatusQueryToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: STATUS_QUERY_TOOL_ID,
    description:
      'Query the status of active work including planner runs, background subagents, and pending approvals. Returns current status for all active tasks.',
    category: 'read',
    sensitivity: 'low',
    requiresPermission: false,
    schema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const userMessage = (params as { userMessage?: string } | undefined)?.userMessage
          const result = await handleStatusQuery(
            {
              plannerRunStore: runtimeDeps.plannerRunStore,
              subagentRunStore: runtimeDeps.subagentRunStore,
              approvalStore: runtimeDeps.approvalStore,
              userId: identity.userId,
              sessionId: identity.sessionId,
              turnId: identity.turnId,
            },
            userMessage,
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: false,
    },
  }
}

/**
 * Create the foreground_spawn_planner tool definition.
 * - sensitivity: 'medium'
 * - category: 'internal'
 * - requiresApproval: true
 */
export function createForegroundSpawnPlannerToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: SPAWN_PLANNER_TOOL_ID,
    description:
      'Create a new planner run to work on a task. The planner will generate a plan and begin executing it in the background. Use this for complex, multi-step tasks.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'The objective or task for the planner to work on',
        },
        estimatedSteps: {
          type: 'number',
          description: 'Estimated number of steps to complete the task',
        },
        complexity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Estimated complexity of the task',
        },
        reason: {
          type: 'string',
          description: 'Reason for spawning the planner',
        },
      },
      required: ['objective'],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const result = await handleSpawnPlanner(
            {
              plannerRuntime: runtimeDeps.plannerRuntime,
              userId: identity.userId,
              sessionId: identity.sessionId,
            },
            params as SpawnPlannerInput,
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_resume_planner tool definition.
 * - sensitivity: 'medium'
 * - category: 'internal'
 * - requiresApproval: true
 */
export function createForegroundResumePlannerToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: RESUME_PLANNER_TOOL_ID,
    description:
      'Resume an existing planner run that was paused or is waiting for input. Provide a message to continue the planning process.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        plannerRunId: {
          type: 'string',
          description: 'ID of the planner run to resume',
        },
        userMessage: {
          type: 'string',
          description: 'Message to send to the planner',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of the resume request',
        },
      },
      required: ['plannerRunId', 'userMessage', 'timestamp'],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const input = params as ResumePlannerInput
          const result = await handleResumePlanner(
            {
              plannerRuntime: runtimeDeps.plannerRuntime,
              plannerRunStore: runtimeDeps.plannerRunStore,
              userId: identity.userId,
              sessionId: identity.sessionId,
            },
            { ...input, timestamp: input.timestamp ?? new Date().toISOString() },
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_launch_subagent tool definition.
 * - sensitivity: 'medium'
 * - category: 'internal'
 * - requiresApproval: true
 */
export function createForegroundLaunchSubagentToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: LAUNCH_SUBAGENT_TOOL_ID,
    description:
      'Launch a background subagent to perform a specific task. Subagents run asynchronously and can be monitored via status queries.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'The objective for the subagent to accomplish',
        },
        agentType: {
          type: 'string',
          description: 'Type of subagent to launch (e.g., "search", "code-review")',
        },
        suggestedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested tools the subagent should have access to',
        },
      },
      required: ['objective'],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const result = await handleLaunchSubagent(
            {
              runtimeDispatcher: runtimeDeps.runtimeDispatcher,
              userId: identity.userId,
              sessionId: identity.sessionId,
              turnId: identity.turnId,
              profileRegistry: runtimeDeps.profileRegistry,
            },
            params as LaunchSubagentInput,
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_cancel_or_modify_task tool definition.
 * - sensitivity: 'high'
 * - category: 'internal'
 * - requiresApproval: true
 */
export function createForegroundCancelOrModifyTaskToolDefinition(
  runtimeDeps?: ForegroundToolRuntimeDeps,
): ToolDefinition {
  return {
    name: CANCEL_MODIFY_TOOL_ID,
    description:
      'Cancel, pause, resume, or modify an active task (planner run or subagent). This is a high-risk operation that can interrupt ongoing work.',
    category: 'internal',
    sensitivity: 'high',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        plannerRunId: {
          type: 'string',
          description: 'ID of the planner run to cancel/modify',
        },
        runtimeActionId: {
          type: 'string',
          description: 'ID of the subagent runtime action to cancel/modify',
        },
        reason: {
          type: 'string',
          description: 'Reason for the cancel/modify operation',
        },
        interruptType: {
          type: 'string',
          enum: ['cancel', 'pause', 'resume', 'modify'],
          description: 'Type of interrupt operation',
        },
      },
      required: ['reason', 'interruptType'],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const result = await handleCancelOrModifyTask(
            {
              runtimeDispatcher: runtimeDeps.runtimeDispatcher,
              plannerRunStore: runtimeDeps.plannerRunStore,
              subagentRunStore: runtimeDeps.subagentRunStore,
              userId: identity.userId,
              sessionId: identity.sessionId,
              turnId: identity.turnId,
            },
            params as CancelModifyInput,
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

export function createForegroundCancelPlannerToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: CANCEL_PLANNER_TOOL_ID,
    description:
      'Cancel an active planner run to stop its execution. Use this when a planner run is stuck, no longer needed, or producing unwanted results.',
    category: 'internal',
    sensitivity: 'medium',
    requiresPermission: true,
    schema: {
      type: 'object',
      properties: {
        plannerRunId: {
          type: 'string',
          description: 'ID of the planner run to cancel',
        },
        reason: {
          type: 'string',
          description: 'Reason for canceling the planner run',
        },
      },
      required: ['plannerRunId'],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const result = await handleCancelPlanner(
            {
              plannerRuntime: runtimeDeps.plannerRuntime,
              plannerRunStore: runtimeDeps.plannerRunStore,
              userId: identity.userId,
              sessionId: identity.sessionId,
            },
            params as CancelPlannerInput,
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_handle_approval tool definition.
 * - sensitivity: 'low'
 * - category: 'internal'
 * - requiresApproval: false
 */
export function createForegroundHandleApprovalToolDefinition(runtimeDeps?: ForegroundToolRuntimeDeps): ToolDefinition {
  return {
    name: APPROVAL_REQUEST_TOOL_ID,
    description:
      'Handle approval requests and responses for high-risk foreground operations. Use this to approve or deny pending approval requests (response mode needs approvalId+decision), or create a new approval request for an operation (request mode requires "operation" field).',
    category: 'internal',
    sensitivity: 'low',
    requiresPermission: false,
    schema: {
      type: 'object',
      properties: {
        // Request mode
        operation: {
          type: 'string',
          description: 'The operation requesting approval',
        },
        operationArgs: {
          type: 'object',
          description: 'Arguments for the operation',
        },
        requiresApproval: {
          type: 'boolean',
          description: 'Whether approval is required',
        },
        correlationId: {
          type: 'string',
          description: 'Correlation ID for tracking',
        },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Risk level of the operation',
        },
        // Response mode
        approvalId: {
          type: 'string',
          description: 'ID of the approval request to respond to',
        },
        decision: {
          type: 'string',
          enum: ['approved', 'denied'],
          description: 'Decision on the approval request',
        },
        responseReason: {
          type: 'string',
          description: 'Reason for the decision',
        },
      },
      required: [],
    },
    handler: runtimeDeps
      ? async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
          const identity = resolveTurnIdentity(context)
          if ('error' in identity) return identity.error
          const p = params as {
            approvalId?: string
            decision?: 'approved' | 'denied'
            operation?: string
            operationArgs?: Record<string, unknown>
            requiresApproval?: boolean
            correlationId?: string
            riskLevel?: string
            responseReason?: string
          } | null
          // Response mode: both approvalId and decision present
          if (typeof p?.approvalId === 'string' && (p.decision === 'approved' || p.decision === 'denied')) {
            const result = await handleApprovalResponse(
              {
                approvalStore: runtimeDeps.approvalStore,
                userId: identity.userId,
                sessionId: identity.sessionId,
                turnId: identity.turnId,
              },
              { approvalId: p.approvalId, decision: p.decision, responseReason: p.responseReason },
            )
            return mapForegroundToolResult(result)
          }
          // Request mode: default requiresApproval=true when operation present and flag omitted
          const requestInput = p ?? {}
          const requiresApproval = requestInput.requiresApproval ?? requestInput.operation !== undefined
          const result = await handleApprovalRequest(
            {
              approvalStore: runtimeDeps.approvalStore,
              userId: identity.userId,
              sessionId: identity.sessionId,
              turnId: identity.turnId,
            },
            {
              operation: requestInput.operation ?? '',
              operationArgs: requestInput.operationArgs ?? {},
              requiresApproval,
              correlationId: requestInput.correlationId,
              riskLevel: requestInput.riskLevel,
            },
          )
          return mapForegroundToolResult(result)
        }
      : foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: false,
    },
  }
}

/**
 * Register all foreground tools with the provided registry.
 * The search_subagent tool requires production dependencies.
 *
 * @param registry - The tool registry to register tools with
 * @param optionsOrLegacyDeps - Either a SearchSubagentToolDeps (legacy positional
 *   form, recognized by its `searchSubagent` property) or an options object
 *   `{ searchSubagentDeps?, runtimeDeps? }`. When `runtimeDeps` is provided,
 *   the six foreground orchestration tools are wired with real handlers;
 *   otherwise they fall back to the placeholder handler.
 */
export function registerAllForegroundTools(
  registry: ToolRegistry,
  optionsOrLegacyDeps?:
    | {
        searchSubagentDeps?: import('../../search/search-subagent-tool.js').SearchSubagentToolDeps
        runtimeDeps?: ForegroundToolRuntimeDeps
      }
    | import('../../search/search-subagent-tool.js').SearchSubagentToolDeps,
): void {
  // Normalize: legacy positional form has `searchSubagent` property; options object does not
  let searchSubagentDeps: import('../../search/search-subagent-tool.js').SearchSubagentToolDeps | undefined
  let runtimeDeps: ForegroundToolRuntimeDeps | undefined
  if (optionsOrLegacyDeps) {
    if ('searchSubagent' in optionsOrLegacyDeps) {
      searchSubagentDeps = optionsOrLegacyDeps
    } else {
      searchSubagentDeps = optionsOrLegacyDeps.searchSubagentDeps
      runtimeDeps = optionsOrLegacyDeps.runtimeDeps
    }
  }

  if (searchSubagentDeps) {
    registry.register(createSearchSubagentToolDefinition(searchSubagentDeps))
  } else {
    registry.register({
      name: SEARCH_SUBAGENT_TOOL_ID,
      description:
        'Search the web for information. Returns structured evidence with extracted facts and source URLs. Uses a synchronous search service.',
      category: 'search',
      sensitivity: 'medium',
      requiresPermission: false,
      schema: {
        type: 'object',
        properties: {
          originalQuestion: {
            type: 'string',
            description: 'The original question to search for',
          },
          intent: {
            type: 'string',
            enum: ['fact', 'definition', 'how_to', 'comparison', 'news', 'location', 'event'],
            description: 'The search intent type',
          },
          locale: {
            type: 'string',
            description: 'Locale for search results (e.g., "en-US")',
          },
          freshnessRequired: {
            type: 'boolean',
            description: 'Whether fresh/recent results are required',
          },
        },
        required: ['originalQuestion'],
      },
      handler: foregroundToolPlaceholderHandler,
      metadata: {
        requiresApproval: false,
      },
    })
  }
  registry.register(createForegroundStatusQueryToolDefinition(runtimeDeps))
  registry.register(createForegroundSpawnPlannerToolDefinition(runtimeDeps))
  registry.register(createForegroundResumePlannerToolDefinition(runtimeDeps))
  registry.register(createForegroundLaunchSubagentToolDefinition(runtimeDeps))
  registry.register(createForegroundCancelOrModifyTaskToolDefinition(runtimeDeps))
  registry.register(createForegroundCancelPlannerToolDefinition(runtimeDeps))
  registry.register(createForegroundHandleApprovalToolDefinition(runtimeDeps))
}

/**
 * Get all foreground tool IDs.
 * Useful for testing and validation.
 */
export function getForegroundToolIds(): string[] {
  return [
    SEARCH_SUBAGENT_TOOL_ID,
    STATUS_QUERY_TOOL_ID,
    SPAWN_PLANNER_TOOL_ID,
    RESUME_PLANNER_TOOL_ID,
    LAUNCH_SUBAGENT_TOOL_ID,
    CANCEL_MODIFY_TOOL_ID,
    CANCEL_PLANNER_TOOL_ID,
    APPROVAL_REQUEST_TOOL_ID,
  ]
}

/**
 * Get foreground tools that should be in the default projection.
 * These are safe tools (low/medium sensitivity, read/search/internal category).
 * Orchestration tools (spawn/resume/launch) are included because they are
 * internal + medium (safe for main). Cancel remains excluded due to high sensitivity.
 */
export function getDefaultProjectionForegroundToolIds(): string[] {
  return [
    SEARCH_SUBAGENT_TOOL_ID, // search, medium
    STATUS_QUERY_TOOL_ID, // read, low
    APPROVAL_REQUEST_TOOL_ID, // internal, low
    SPAWN_PLANNER_TOOL_ID, // internal, medium — orchestration, safe for main
    RESUME_PLANNER_TOOL_ID, // internal, medium — orchestration, safe for main
    LAUNCH_SUBAGENT_TOOL_ID, // internal, medium — orchestration, safe for main
    CANCEL_PLANNER_TOOL_ID, // internal, medium - orchestration, safe for main
    // CANCEL_MODIFY_TOOL_ID intentionally excluded — high sensitivity, risky
  ]
}

/**
 * Get foreground tools that require approval.
 * These are high-risk or side-effect tools.
 */
export function getRequiresApprovalForegroundToolIds(): string[] {
  return [SPAWN_PLANNER_TOOL_ID, RESUME_PLANNER_TOOL_ID, LAUNCH_SUBAGENT_TOOL_ID, CANCEL_PLANNER_TOOL_ID, CANCEL_MODIFY_TOOL_ID]
}
