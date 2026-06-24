import type { PermissionMode } from '../permissions/types.js'

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
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType: string
  /**
   * Profile identifier for this subagent. Maps to AgentProfile.id in the
   * taxonomy registry. During migration this defaults to the same value as
   * `agentType` for backward compatibility.
   */
  agentProfile?: string
  displayName: string
  description: string
  modality: SubagentModality
  promptId: string
  allowedToolIds: string[]
  disallowedToolIds?: string[]
  /** Allowed skill IDs — intersected with AgentType envelope at runtime. */
  allowedSkillIds?: string[]
  defaultMaxIterations: number
  defaultTimeoutMs: number
  supportedExecutionModes: SubagentExecutionMode[]
  canRunInBackground: boolean
  providerPolicy: SubagentProviderPolicy
  permissionProfile: PermissionMode
  summaryPolicy: {
    returnMode: 'summary_only' | 'summary_with_artifacts' | 'full_result_allowed'
    maxSummaryTokens: number
  }
}

/**
 * Resolution result when looking up a subagent definition by a route parameter.
 * Carries the matched definition plus metadata about how it was resolved.
 */
export interface ResolvedSubagent {
  definition: SubagentDefinition
  /** The runtime lifecycle type (e.g. 'subagent'). */
  runtimeType: string
  /** The profile identifier (e.g. 'document_processor'). */
  profileId: string
  /** True when the caller used a legacy agentType-style param that now means profileId. */
  isLegacyParam: boolean
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

  /**
   * Resolve a route parameter value to a subagent definition.
   *
   * During the migration period the route param `:agentType` carries profile
   * labels like `document_processor`.  This method:
   *   1. Tries an exact key match (agentType field).
   *   2. Falls back to scanning `agentProfile` fields.
   *   3. Returns a `ResolvedSubagent` that separates runtime type from
   *      profile id, so callers can emit clean responses.
   *
   * Returns `undefined` when no definition matches.
   */
  resolveByProfileId(profileId: string): ResolvedSubagent | undefined
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

    resolveByProfileId(profileId: string): ResolvedSubagent | undefined {
      const direct = definitions.get(profileId)
      if (direct) {
        const resolvedProfileId = direct.agentProfile ?? direct.agentType
        return {
          definition: direct,
          runtimeType: 'subagent',
          profileId: resolvedProfileId,
          isLegacyParam: direct.agentProfile === undefined,
        }
      }

      for (const def of definitions.values()) {
        if (def.agentProfile === profileId) {
          return {
            definition: def,
            runtimeType: 'subagent',
            profileId: def.agentProfile,
            isLegacyParam: false,
          }
        }
      }

      return undefined
    },
  }
}
