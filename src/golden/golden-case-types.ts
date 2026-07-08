import type { ModelInputMode, ModelInputSegmentHashes } from '../kernel/model-input/model-input-types.js'
import type { AgentType, ContextBundle } from '../context/types.js'
import type { ToolDefinition } from '../llm/types.js'

export type GoldenCaseCategory =
  | 'direct_answer' | 'tool_selection' | 'permission_denial'
  | 'schema_repair' | 'memory_retrieval' | 'search_evidence' | 'provider_fallback'

export interface GoldenCaseInput {
  mode: ModelInputMode
  agentType: AgentType
  agentProfile: string
  providerFamily: string
  outputContract?: string
  currentUserMessage: string
  toolProjection?: { toolIds: string[]; tools?: ToolDefinition[] }
  contextBundle?: Partial<ContextBundle>
}

export interface GoldenCaseExpectations {
  expectedTools?: string[]
  forbiddenTools?: string[]
  expectedSegmentHashes?: Partial<ModelInputSegmentHashes>
  maxTokenEstimate?: number
  outputContractMustValidate?: boolean
}

export interface GoldenCase {
  id: string
  category: GoldenCaseCategory
  description: string
  input: GoldenCaseInput
  expectations: GoldenCaseExpectations
}
