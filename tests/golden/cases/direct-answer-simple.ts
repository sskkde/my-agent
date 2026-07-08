import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const directAnswerSimple: GoldenCase = {
  id: 'direct-answer-simple',
  category: 'direct_answer',
  description: 'Simple direct answer with default chat output contract',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'openai',
    outputContract: 'output:default-chat.schema',
    currentUserMessage: 'Hello, how are you?',
  },
  expectations: {},
}
