import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const searchEvidenceSubagent: GoldenCase = {
  id: 'search-evidence-subagent',
  category: 'search_evidence',
  description: 'Search subagent uses search-evidence output contract',
  input: {
    mode: 'function_calling',
    agentType: 'subagent',
    agentProfile: 'search',
    providerFamily: 'openai',
    outputContract: 'output:search-evidence.schema',
    currentUserMessage: 'Find information about TypeScript 5.5',
  },
  expectations: {},
}
