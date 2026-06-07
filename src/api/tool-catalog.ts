import type { ToolSummary } from './types.js'
import type { ToolDefinition } from '../llm/types.js'
import type { ToolRegistry } from '../tools/types.js'
import type { CanonicalToolCatalogEntry } from '../tools/tool-catalog.js'
import { getFallbackToolCatalog, buildRuntimeToolCatalog } from '../tools/tool-catalog.js'

export const BUILT_IN_TOOLS: ToolSummary[] = [
  {
    name: 'artifact_create',
    description: 'Create a new artifact with the given title and content',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'artifact_update',
    description: 'Update an existing artifact with new content',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'ask_user',
    description: 'Ask the user for clarification or input on a question',
    category: 'internal',
    sensitivity: 'low',
  },
  {
    name: 'status_query',
    description: 'Query active work status for the current user or a specific run',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve memory records from session or user memory',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'transcript_search',
    description: 'Search transcript records for matching content',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'plan_patch',
    description: 'Apply a patch to an execution plan',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'docs_search',
    description: 'Search documentation for relevant content',
    category: 'search',
    sensitivity: 'low',
  },
  {
    name: 'file_read',
    description: 'Read file contents from the workspace',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'file_glob',
    description: 'Find files matching a glob pattern in the workspace',
    category: 'search',
    sensitivity: 'low',
  },
  {
    name: 'file_grep',
    description: 'Search for pattern matches in files within the workspace',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'file_write',
    description: 'Write content to a file in the workspace',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'file_edit',
    description: 'Edit a file by replacing a specific string in the workspace',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'file_apply_patch',
    description: 'Apply a multi-file patch with add/update/delete operations',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'session_list',
    description: 'List sessions for the current user',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'session_history',
    description: 'Get session message history',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL (read-only, safe)',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'web_search',
    description: 'Search the public web for information using an external search provider',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'exec',
    description: 'Execute a shell command with security validation, timeout, and output management',
    category: 'execute',
    sensitivity: 'high',
  },
  {
    name: 'bash',
    description: 'Execute a bash command (alias for exec tool)',
    category: 'execute',
    sensitivity: 'high',
  },
  {
    name: 'process',
    description: 'Manage background process sessions: list, poll, log, write stdin, kill, clear',
    category: 'execute',
    sensitivity: 'high',
  },
  {
    name: 'code_execution',
    description: 'Execute code in JavaScript, TypeScript, or Bash with temp file cleanup',
    category: 'execute',
    sensitivity: 'high',
  },
  {
    name: 'email_search',
    description: 'Search emails matching a query (mock implementation)',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'email_send_draft',
    description: 'Create an email draft (mock implementation)',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'calendar_list',
    description: 'List calendar events (mock implementation)',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'calendar_create_event',
    description: 'Create a calendar event (mock implementation)',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'contacts_search',
    description: 'Search contacts matching a query (mock implementation)',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'docs_read',
    description: 'Read a document by ID (mock implementation)',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'search_subagent',
    description: 'Search the web for information using a constrained subagent',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'foreground_status_query',
    description: 'Query active work status for the current user',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'foreground_spawn_planner',
    description: 'Create a new planner run to work on a task',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'foreground_resume_planner',
    description: 'Resume an existing planner run',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'foreground_launch_subagent',
    description: 'Launch a background subagent to perform a task',
    category: 'execute',
    sensitivity: 'medium',
  },
  {
    name: 'foreground_cancel_or_modify_task',
    description: 'Cancel, pause, resume, or modify an active task',
    category: 'execute',
    sensitivity: 'high',
  },
  {
    name: 'foreground_handle_approval',
    description: 'Handle approval requests and responses',
    category: 'internal',
    sensitivity: 'low',
  },
]

export function getToolCatalog(): ToolSummary[] {
  const fallbackCatalog = getFallbackToolCatalog()
  return fallbackCatalog.map((entry) => ({
    name: entry.name,
    description: entry.description,
    category: entry.category,
    sensitivity: entry.sensitivity,
  }))
}

export function getToolCatalogWithMetadata(registry?: ToolRegistry): CanonicalToolCatalogEntry[] {
  if (registry) {
    return buildRuntimeToolCatalog(registry, { includeMock: true })
  }
  return getFallbackToolCatalog()
}

export function getToolDefinitions(): ToolDefinition[] {
  const fallbackCatalog = getFallbackToolCatalog()
  return fallbackCatalog.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {} },
    },
  }))
}
