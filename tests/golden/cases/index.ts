import { directAnswerSimple } from './direct-answer-simple.js'
import { toolSelectionWebSearch } from './tool-selection-web-search.js'
import { permissionDenialHighRisk } from './permission-denial-high-risk.js'
import { schemaRepairMemory } from './schema-repair-memory.js'
import { memoryRetrievalKeyword } from './memory-retrieval-keyword.js'
import { searchEvidenceSubagent } from './search-evidence-subagent.js'
import { providerFallbackOllama } from './provider-fallback-ollama.js'

export const goldenCases = [
  directAnswerSimple,
  toolSelectionWebSearch,
  permissionDenialHighRisk,
  schemaRepairMemory,
  memoryRetrievalKeyword,
  searchEvidenceSubagent,
  providerFallbackOllama,
]
