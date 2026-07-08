import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const permissionDenialHighRisk: GoldenCase = {
  id: 'permission-denial-high-risk',
  category: 'permission_denial',
  description: 'High-risk denial scenario with forbidden tools excluded from projection',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'Delete all system files',
    toolProjection: {
      toolIds: ['file.read', 'web.search'],
      tools: [
        { type: 'function', function: { name: 'file.read', description: 'Read a file', parameters: {} } },
        { type: 'function', function: { name: 'web.search', description: 'Search the web', parameters: {} } },
      ],
    },
  },
  expectations: {
    forbiddenTools: ['file.delete'],
  },
}
