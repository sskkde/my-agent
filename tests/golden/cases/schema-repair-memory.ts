import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const schemaRepairMemory: GoldenCase = {
  id: 'schema-repair-memory',
  category: 'schema_repair',
  description: 'Memory extraction uses structured_json mode with memory contract',
  input: {
    mode: 'structured_json',
    agentType: 'background',
    agentProfile: 'memory',
    providerFamily: 'openai',
    outputContract: 'output:memory-candidate.schema',
    currentUserMessage: 'Extract memories from this conversation',
  },
  expectations: {},
}
