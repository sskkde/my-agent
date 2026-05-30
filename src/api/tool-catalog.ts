import type { ToolSummary } from './types.js';
import type { ToolDefinition } from '../llm/types.js';

export const BUILT_IN_TOOLS: ToolSummary[] = [
  {
    name: 'artifact.create',
    description: 'Create a new artifact with the given title and content',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'artifact.update',
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
    name: 'status.query',
    description: 'Query active work status for the current user or a specific run',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'memory.retrieve',
    description: 'Retrieve memory records from session or user memory',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'transcript.search',
    description: 'Search transcript records for matching content',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'plan.patch',
    description: 'Apply a patch to an execution plan',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'docs.search',
    description: 'Search documentation for relevant content',
    category: 'search',
    sensitivity: 'low',
  },
  {
    name: 'file.read',
    description: 'Read file contents from the workspace',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'file.glob',
    description: 'Find files matching a glob pattern in the workspace',
    category: 'search',
    sensitivity: 'low',
  },
  {
    name: 'file.grep',
    description: 'Search for pattern matches in files within the workspace',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'session.list',
    description: 'List sessions for the current user',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'session.history',
    description: 'Get session message history',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'web.fetch',
    description: 'Fetch content from a URL (read-only, safe)',
    category: 'read',
    sensitivity: 'medium',
  },
  {
    name: 'web.search',
    description: 'Search the public web for information using an external search provider',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'email.search',
    description: 'Search emails matching a query (mock implementation)',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'email.send_draft',
    description: 'Create an email draft (mock implementation)',
    category: 'write',
    sensitivity: 'high',
  },
  {
    name: 'calendar.list',
    description: 'List calendar events (mock implementation)',
    category: 'read',
    sensitivity: 'low',
  },
  {
    name: 'calendar.create_event',
    description: 'Create a calendar event (mock implementation)',
    category: 'write',
    sensitivity: 'medium',
  },
  {
    name: 'contacts.search',
    description: 'Search contacts matching a query (mock implementation)',
    category: 'search',
    sensitivity: 'medium',
  },
  {
    name: 'docs.read',
    description: 'Read a document by ID (mock implementation)',
    category: 'read',
    sensitivity: 'low',
  },
];

export function getToolCatalog(): ToolSummary[] {
  return [...BUILT_IN_TOOLS];
}

export function getToolDefinitions(): ToolDefinition[] {
  return BUILT_IN_TOOLS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: 'object', properties: {} },
    },
  }));
}
