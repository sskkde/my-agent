import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const toolSelectionWebSearch: GoldenCase = {
  id: 'tool-selection-web-search',
  category: 'tool_selection',
  description: 'Tool selection with web_search tool available',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'Search the web for AI news',
    toolProjection: {
      toolIds: ['web.search', 'file.read'],
      tools: [
        { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
        { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
      ],
    },
  },
  expectations: {
    expectedTools: ['web.search'],
  },
}
