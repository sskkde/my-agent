import type { ToolDefinition, ToolCategory, ToolSensitivity, ToolRegistry } from './types.js'

export type ToolExecutionPlane = 'standard' | 'foreground' | 'connector' | 'mock_connector' | 'catalog_only'
export type ToolAvailability = 'registered' | 'foreground_only' | 'deferred' | 'disabled' | 'mock'
export type ToolSource = 'builtin' | 'foreground' | 'connector' | 'mcp' | 'mock' | 'unknown'

export interface CanonicalToolCatalogEntry {
  name: string
  description: string
  category: ToolCategory
  sensitivity: ToolSensitivity
  executionPlane: ToolExecutionPlane
  availability: ToolAvailability
  isMock: boolean
  source: ToolSource
  requiresPermission?: boolean
  metadata?: Record<string, unknown>
}

export interface ToolSummary {
  name: string
  description: string
  category: ToolCategory
  sensitivity: ToolSensitivity
}

export interface SummarizeToolOptions {
  source?: ToolSource
  executionPlane?: ToolExecutionPlane
  availability?: ToolAvailability
}

export function summarizeToolDefinition(
  tool: ToolDefinition,
  overrides: SummarizeToolOptions = {},
): CanonicalToolCatalogEntry {
  const source = overrides.source ?? inferToolSource(tool)
  const executionPlane = overrides.executionPlane ?? inferExecutionPlane(tool, source)
  const availability = overrides.availability ?? inferAvailability(source)

  return {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    sensitivity: tool.sensitivity,
    executionPlane,
    availability,
    isMock: source === 'mock',
    source,
    requiresPermission: tool.requiresPermission,
    metadata: tool.metadata,
  }
}

function inferToolSource(tool: ToolDefinition): ToolSource {
  const foregroundToolNames = new Set([
    'search_subagent',
    'foreground_status_query',
    'foreground_spawn_planner',
    'foreground_resume_planner',
    'foreground_launch_subagent',
    'foreground_cancel_or_modify_task',
    'foreground_handle_approval',
  ])

  if (foregroundToolNames.has(tool.name)) {
    return 'foreground'
  }

  const mockConnectorToolNames = new Set([
    'email_search',
    'email_send_draft',
    'calendar_list',
    'calendar_create_event',
    'contacts_search',
    'docs_read',
  ])

  if (mockConnectorToolNames.has(tool.name)) {
    return 'mock'
  }

  const connectorToolPatterns = ['github_', 'google_', 'notion_', 'slack_']

  for (const pattern of connectorToolPatterns) {
    if (tool.name.startsWith(pattern)) {
      return 'connector'
    }
  }

  return 'builtin'
}

function inferExecutionPlane(tool: ToolDefinition, source: ToolSource): ToolExecutionPlane {
  if (source === 'mock') {
    return 'mock_connector'
  }

  if (source === 'connector') {
    return 'connector'
  }

  if (tool.category === 'internal' && source === 'foreground') {
    return 'foreground'
  }

  return 'standard'
}

function inferAvailability(source: ToolSource): ToolAvailability {
  if (source === 'mock') {
    return 'mock'
  }

  if (source === 'foreground') {
    return 'foreground_only'
  }

  return 'registered'
}

export interface BuildRuntimeCatalogOptions {
  includeMock?: boolean
}

export function buildRuntimeToolCatalog(
  registry: ToolRegistry,
  options: BuildRuntimeCatalogOptions = {},
): CanonicalToolCatalogEntry[] {
  const tools = registry.listTools()

  return tools
    .filter((tool) => {
      if (!options.includeMock) {
        const source = inferToolSource(tool)
        return source !== 'mock'
      }
      return true
    })
    .map((tool) => summarizeToolDefinition(tool))
}

const MOCK_CONNECTOR_TOOLS: ToolSummary[] = [
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
]

export function getFallbackToolCatalog(): CanonicalToolCatalogEntry[] {
  const builtInTools: ToolSummary[] = [
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
    { name: 'plan_patch', description: 'Apply a patch to an execution plan', category: 'write', sensitivity: 'high' },
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
    { name: 'session_history', description: 'Get session message history', category: 'read', sensitivity: 'medium' },
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

  const allTools = [...builtInTools, ...MOCK_CONNECTOR_TOOLS]

  return allTools.map((tool) => {
    const isMock = MOCK_CONNECTOR_TOOLS.some((m) => m.name === tool.name)
    const source = isMock ? 'mock' : 'builtin'
    const executionPlane = isMock ? 'mock_connector' : tool.category === 'internal' ? 'foreground' : 'standard'

    return {
      name: tool.name,
      description: tool.description,
      category: tool.category,
      sensitivity: tool.sensitivity,
      executionPlane,
      availability: 'registered',
      isMock,
      source,
    }
  })
}
