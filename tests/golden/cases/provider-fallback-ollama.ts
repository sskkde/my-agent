import type { GoldenCase } from '../../../src/golden/golden-case-types.js'

export const providerFallbackOllama: GoldenCase = {
  id: 'provider-fallback-ollama',
  category: 'provider_fallback',
  description: 'Ollama provider fallback with local model',
  input: {
    mode: 'function_calling',
    agentType: 'main',
    agentProfile: 'default_main',
    providerFamily: 'ollama',
    currentUserMessage: 'Hello, local model',
  },
  expectations: {},
}
