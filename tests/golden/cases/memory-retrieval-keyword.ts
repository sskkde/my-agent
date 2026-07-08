import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const memoryRetrievalKeyword: GoldenCase = {
  id: 'memory-retrieval-keyword',
  category: 'memory_retrieval',
  description: 'Memory retrieval with context bundle containing memory items',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    currentUserMessage: 'What do I know about Python?',
    contextBundle: {
      pinnedItems: [
        {
          itemId: 'mem-1',
          content: 'User knows Python, TypeScript, and Rust',
          sourceType: 'memory',
          semanticType: 'fact',
        },
      ],
    },
  },
  expectations: {},
}
