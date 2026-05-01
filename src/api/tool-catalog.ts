import type { ToolSummary } from './types.js';

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
];

export function getToolCatalog(): ToolSummary[] {
  return [...BUILT_IN_TOOLS];
}
