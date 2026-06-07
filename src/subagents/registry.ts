export type SubagentExecutionMode = 'sync' | 'background'

export type SubagentModality = 'text' | 'document' | 'image' | 'data' | 'audio' | 'code' | 'mixed'

export interface SubagentProviderPolicy {
  defaultProviderId?: string
  defaultModel?: string
  allowedProviderIds?: string[]
  allowedModelIds?: string[]
  requiredCapabilities?: Array<
    | 'text'
    | 'function_calling'
    | 'json_schema'
    | 'vision'
    | 'audio_input'
    | 'audio_transcription'
    | 'long_context'
    | 'code_reasoning'
  >
  fallbackMode: 'none' | 'same_provider' | 'any_compatible'
}

export interface SubagentDefinition {
  agentType: string
  displayName: string
  description: string
  modality: SubagentModality
  promptId: string
  allowedToolIds: string[]
  disallowedToolIds?: string[]
  defaultMaxIterations: number
  defaultTimeoutMs: number
  supportedExecutionModes: SubagentExecutionMode[]
  canRunInBackground: boolean
  providerPolicy: SubagentProviderPolicy
  permissionProfile: 'read_only' | 'ask_on_write' | 'write_allowed' | 'restricted'
  summaryPolicy: {
    returnMode: 'summary_only' | 'summary_with_artifacts' | 'full_result_allowed'
    maxSummaryTokens: number
  }
}

export interface SubagentRegistry {
  /** Register a new subagent definition. Throws if agentType already exists. */
  register(definition: SubagentDefinition): void

  /** Look up a definition by agentType. Returns undefined when not found. */
  get(agentType: string): SubagentDefinition | undefined

  /** Return all registered definitions. */
  list(): SubagentDefinition[]

  /**
   * Return the definition for agentType or throw if it does not exist.
   * Useful for call-sites that treat a missing agent as a programming error.
   */
  assertAllowed(agentType: string): SubagentDefinition
}

/**
 * Create an in-memory SubagentRegistry backed by a Map.
 */
export function createSubagentRegistry(): SubagentRegistry {
  const definitions = new Map<string, SubagentDefinition>()

  return {
    register(definition: SubagentDefinition): void {
      if (definitions.has(definition.agentType)) {
        throw new Error(`Subagent already registered: "${definition.agentType}"`)
      }
      definitions.set(definition.agentType, definition)
    },

    get(agentType: string): SubagentDefinition | undefined {
      return definitions.get(agentType)
    },

    list(): SubagentDefinition[] {
      return [...definitions.values()]
    },

    assertAllowed(agentType: string): SubagentDefinition {
      const def = definitions.get(agentType)
      if (!def) {
        throw new Error(`Unknown subagent type: "${agentType}"`)
      }
      return def
    },
  }
}
