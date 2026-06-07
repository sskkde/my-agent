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

import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../../tools/types.js'
import { STATUS_QUERY_TOOL_ID, type StatusQueryData } from './status-query-tool.js'
import { SPAWN_PLANNER_TOOL_ID, type SpawnPlannerInput, type SpawnPlannerData } from './planner-spawn-tool.js'
import { RESUME_PLANNER_TOOL_ID, type ResumePlannerInput, type ResumePlannerData } from './planner-resume-tool.js'
import { LAUNCH_SUBAGENT_TOOL_ID, type LaunchSubagentInput, type LaunchSubagentData } from './subagent-launch-tool.js'
import { CANCEL_MODIFY_TOOL_ID, type CancelModifyInput, type CancelModifyData } from './cancel-modify-task-tool.js'
import {
  APPROVAL_REQUEST_TOOL_ID,
  type ApprovalRequestInput,
  type ApprovalRequestData,
  type ApprovalResponseInput,
  type ApprovalResponseData,
} from './approval-request-tool.js'
import { SEARCH_SUBAGENT_TOOL_ID, type SearchSubagentToolInput } from '../../search/search-subagent-tool.js'
import type { ToolRegistry } from '../../tools/types.js'

// Re-export tool IDs
export {
  STATUS_QUERY_TOOL_ID,
  SPAWN_PLANNER_TOOL_ID,
  RESUME_PLANNER_TOOL_ID,
  LAUNCH_SUBAGENT_TOOL_ID,
  CANCEL_MODIFY_TOOL_ID,
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
export { handleApprovalRequest, handleApprovalResponse } from './approval-request-tool.js'
export { handleSearchSubagentTool } from '../../search/search-subagent-tool.js'

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
 * Create the search_subagent tool definition.
 * - sensitivity: 'medium'
 * - category: 'search'
 * - requiresApproval: false
 */
export function createSearchSubagentToolDefinition(): ToolDefinition {
  return {
    name: SEARCH_SUBAGENT_TOOL_ID,
    description:
      'Search the web for information. Returns structured search results with extracted facts and source URLs. Uses a constrained subagent for safe web searching.',
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
  }
}

/**
 * Create the foreground_status_query tool definition.
 * - sensitivity: 'low'
 * - category: 'read'
 * - requiresApproval: false
 */
export function createForegroundStatusQueryToolDefinition(): ToolDefinition {
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
    handler: foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: false,
    },
  }
}

/**
 * Create the foreground_spawn_planner tool definition.
 * - sensitivity: 'medium'
 * - category: 'write'
 * - requiresApproval: true
 */
export function createForegroundSpawnPlannerToolDefinition(): ToolDefinition {
  return {
    name: SPAWN_PLANNER_TOOL_ID,
    description:
      'Create a new planner run to work on a task. The planner will generate a plan and begin executing it in the background. Use this for complex, multi-step tasks.',
    category: 'write',
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
    handler: foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_resume_planner tool definition.
 * - sensitivity: 'medium'
 * - category: 'write'
 * - requiresApproval: true
 */
export function createForegroundResumePlannerToolDefinition(): ToolDefinition {
  return {
    name: RESUME_PLANNER_TOOL_ID,
    description:
      'Resume an existing planner run that was paused or is waiting for input. Provide a message to continue the planning process.',
    category: 'write',
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
    handler: foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_launch_subagent tool definition.
 * - sensitivity: 'medium'
 * - category: 'execute'
 * - requiresApproval: true
 */
export function createForegroundLaunchSubagentToolDefinition(): ToolDefinition {
  return {
    name: LAUNCH_SUBAGENT_TOOL_ID,
    description:
      'Launch a background subagent to perform a specific task. Subagents run asynchronously and can be monitored via status queries.',
    category: 'execute',
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
    handler: foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: true,
    },
  }
}

/**
 * Create the foreground_cancel_or_modify_task tool definition.
 * - sensitivity: 'high'
 * - category: 'execute'
 * - requiresApproval: true
 */
export function createForegroundCancelOrModifyTaskToolDefinition(): ToolDefinition {
  return {
    name: CANCEL_MODIFY_TOOL_ID,
    description:
      'Cancel, pause, resume, or modify an active task (planner run or subagent). This is a high-risk operation that can interrupt ongoing work.',
    category: 'execute',
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
    handler: foregroundToolPlaceholderHandler,
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
export function createForegroundHandleApprovalToolDefinition(): ToolDefinition {
  return {
    name: APPROVAL_REQUEST_TOOL_ID,
    description:
      'Handle approval requests and responses for high-risk foreground operations. Use this to approve or deny pending approval requests.',
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
    handler: foregroundToolPlaceholderHandler,
    metadata: {
      requiresApproval: false,
    },
  }
}

/**
 * Register all foreground tools with a tool registry.
 *
 * This function creates tool definitions and registers them with the provided registry.
 * Each tool is registered with appropriate sensitivity, category, and approval metadata.
 *
 * @param registry - The tool registry to register tools with
 */
export function registerAllForegroundTools(registry: ToolRegistry): void {
  registry.register(createSearchSubagentToolDefinition())
  registry.register(createForegroundStatusQueryToolDefinition())
  registry.register(createForegroundSpawnPlannerToolDefinition())
  registry.register(createForegroundResumePlannerToolDefinition())
  registry.register(createForegroundLaunchSubagentToolDefinition())
  registry.register(createForegroundCancelOrModifyTaskToolDefinition())
  registry.register(createForegroundHandleApprovalToolDefinition())
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
    APPROVAL_REQUEST_TOOL_ID,
  ]
}

/**
 * Get foreground tools that should be in the default projection.
 * These are safe tools (low/medium sensitivity, read/search/internal category).
 */
export function getDefaultProjectionForegroundToolIds(): string[] {
  return [
    SEARCH_SUBAGENT_TOOL_ID, // search, medium
    STATUS_QUERY_TOOL_ID, // read, low
    APPROVAL_REQUEST_TOOL_ID, // internal, low
  ]
}

/**
 * Get foreground tools that require approval.
 * These are high-risk or side-effect tools.
 */
export function getRequiresApprovalForegroundToolIds(): string[] {
  return [SPAWN_PLANNER_TOOL_ID, RESUME_PLANNER_TOOL_ID, LAUNCH_SUBAGENT_TOOL_ID, CANCEL_MODIFY_TOOL_ID]
}
