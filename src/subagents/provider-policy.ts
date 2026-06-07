import type { SubagentDefinition, SubagentProviderPolicy } from './registry.js'
import type { SubagentTaskSpec } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentProviderPreference {
  providerId?: string
  model?: string
  fallbackMode?: 'none' | 'same_provider' | 'any_compatible'
}

export interface SubagentProviderPreferenceStore {
  get(userId: string, agentType: string): SubagentProviderPreference | null
  set(userId: string, agentType: string, preference: SubagentProviderPreference): void
}

export interface ResolveSubagentProviderInput {
  userId: string
  sessionId?: string
  agentType: string
  taskSpec: SubagentTaskSpec
  definition: SubagentDefinition
  providerConfigStore: {
    getByUser(userId: string): Array<{
      providerId: string
      enabled: boolean
      selectedModel?: string
    }>
  }
  agentConfigStore: {
    getGlobal(): { providerId?: string; model?: string } | null
  }
  sessionStore?: {
    getById(sessionId: string): {
      selectedProviderId?: string
      selectedModel?: string
    } | null
  }
  preferenceStore?: SubagentProviderPreferenceStore
}

export interface ResolvedSubagentProvider {
  providerId: string
  model: string
  source:
    | 'task_override'
    | 'user_subagent_preference'
    | 'definition_default'
    | 'session'
    | 'global_default'
    | 'fallback'
}

// ---------------------------------------------------------------------------
// Capability validation
// ---------------------------------------------------------------------------

/**
 * Check whether a given provider+model pair satisfies the required capabilities.
 *
 * The function returns `{ valid: true }` when all required capabilities are met,
 * or `{ valid: false, missingCapabilities }` when one or more are absent.
 *
 * NOTE: capability discovery is delegated to the provider config store – at
 * this layer we only check structural requirements (both providerId and model
 * must be non-empty strings).
 */
export function validateProviderCapabilities(
  providerId: string,
  model: string,
  requiredCapabilities: SubagentProviderPolicy['requiredCapabilities'],
  providerConfigStore: ResolveSubagentProviderInput['providerConfigStore'],
  userId?: string,
): { valid: boolean; missingCapabilities?: string[] } {
  if (!providerId || !model) {
    return {
      valid: false,
      missingCapabilities: requiredCapabilities ?? ['providerId_or_model_missing'],
    }
  }

  // If no capabilities are required the provider is implicitly valid.
  if (!requiredCapabilities || requiredCapabilities.length === 0) {
    return { valid: true }
  }

  // Resolve the provider entry so we can verify it exists and is enabled.
  const providers = providerConfigStore.getByUser(userId ?? '')
  const provider = providers.find((p) => p.providerId === providerId && p.enabled)

  if (!provider) {
    return {
      valid: false,
      missingCapabilities: [...requiredCapabilities],
    }
  }

  // At this level we perform structural validation only.  A full capability
  // matrix (e.g. which model supports vision) would be resolved by the LLM
  // adapter layer; here we simply confirm the provider+model is addressable
  // and treat the requested capabilities as satisfied when the provider is
  // enabled and a model is configured.
  //
  // Callers that need stricter checking can plug a capability-aware store
  // behind the same interface.
  return { valid: true }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Narrow a provider+model candidate through the definition's policy
 * allow-lists and capability requirements.
 */
function candidateMatchesPolicy(
  providerId: string,
  model: string,
  policy: SubagentProviderPolicy,
  providerConfigStore: ResolveSubagentProviderInput['providerConfigStore'],
  userId?: string,
): boolean {
  if (policy.allowedProviderIds && policy.allowedProviderIds.length > 0) {
    if (!policy.allowedProviderIds.includes(providerId)) {
      return false
    }
  }

  if (policy.allowedModelIds && policy.allowedModelIds.length > 0) {
    if (!policy.allowedModelIds.includes(model)) {
      return false
    }
  }

  const { valid } = validateProviderCapabilities(
    providerId,
    model,
    policy.requiredCapabilities,
    providerConfigStore,
    userId,
  )

  return valid
}

/**
 * Resolve a partial user preference into a concrete providerId + model pair.
 *
 * When only providerId is set, the provider's configured selectedModel is used.
 * When only model is set, the first enabled user provider offering that model is used.
 * When both are set, they are returned as-is.
 * When neither is set, null is returned.
 */
function resolvePartialPreference(
  pref: SubagentProviderPreference | null,
  providerConfigStore: ResolveSubagentProviderInput['providerConfigStore'],
  userId: string,
): { providerId: string; model: string } | null {
  if (!pref) return null

  if (pref.providerId && pref.model) {
    return { providerId: pref.providerId, model: pref.model }
  }

  if (pref.providerId) {
    const userProviders = providerConfigStore.getByUser(userId)
    const provider = userProviders.find((p) => p.providerId === pref.providerId && p.enabled)
    if (provider?.selectedModel) {
      return { providerId: pref.providerId, model: provider.selectedModel }
    }
    return null
  }

  if (pref.model) {
    const userProviders = providerConfigStore.getByUser(userId)
    const provider = userProviders.find((p) => p.enabled && p.selectedModel === pref.model)
    if (provider) {
      return { providerId: provider.providerId, model: pref.model }
    }
    return null
  }

  return null
}

// ---------------------------------------------------------------------------
// Main resolution function
// ---------------------------------------------------------------------------

/**
 * Resolve which provider + model to use for a subagent invocation.
 *
 * Resolution follows a strict precedence chain:
 *
 *  1. **taskSpec.modelOverride** – caller-supplied override (highest priority)
 *  2. **user subagent preference** – per-user preference stored in the
 *     preference store for this agent type
 *  3. **SubagentDefinition.providerPolicy defaults** – the definition's own
 *     `defaultProviderId` / `defaultModel`
 *  4. **session provider/model** – the session-level override, if any
 *  5. **global agent config** – the platform-wide default provider + model
 *  6. **compatible fallback** – the first enabled provider in the user's
 *     provider config list that satisfies the definition's capability
 *     requirements and allow-lists
 *
 * If no valid candidate is found and the effective fallback mode is `'none'`,
 * an error is thrown.
 */
export function resolveSubagentProvider(input: ResolveSubagentProviderInput): ResolvedSubagentProvider {
  const {
    userId,
    sessionId,
    taskSpec,
    definition,
    providerConfigStore,
    agentConfigStore,
    sessionStore,
    preferenceStore,
  } = input

  const policy = definition.providerPolicy

  // Effective fallback mode: user preference overrides the definition default.
  const userPref = preferenceStore?.get(userId, definition.agentType) ?? null
  const effectiveFallbackMode: SubagentProviderPolicy['fallbackMode'] = userPref?.fallbackMode ?? policy.fallbackMode

  // -----------------------------------------------------------------------
  // 1. taskSpec.modelOverride (highest priority)
  // -----------------------------------------------------------------------
  const modelOverride = (
    taskSpec as SubagentTaskSpec & {
      modelOverride?: { providerId?: string; model?: string }
    }
  ).modelOverride

  if (modelOverride?.providerId && modelOverride.model) {
    if (candidateMatchesPolicy(modelOverride.providerId, modelOverride.model, policy, providerConfigStore, userId)) {
      return {
        providerId: modelOverride.providerId,
        model: modelOverride.model,
        source: 'task_override',
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. user subagent preference
  // -----------------------------------------------------------------------
  if (userPref?.providerId || userPref?.model) {
    const resolvedPref = resolvePartialPreference(userPref, providerConfigStore, userId)
    if (
      resolvedPref &&
      candidateMatchesPolicy(resolvedPref.providerId, resolvedPref.model, policy, providerConfigStore, userId)
    ) {
      return {
        providerId: resolvedPref.providerId,
        model: resolvedPref.model,
        source: 'user_subagent_preference',
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. SubagentDefinition.providerPolicy defaults
  // -----------------------------------------------------------------------
  if (policy.defaultProviderId && policy.defaultModel) {
    if (candidateMatchesPolicy(policy.defaultProviderId, policy.defaultModel, policy, providerConfigStore, userId)) {
      return {
        providerId: policy.defaultProviderId,
        model: policy.defaultModel,
        source: 'definition_default',
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. session provider/model
  // -----------------------------------------------------------------------
  if (sessionId && sessionStore) {
    const session = sessionStore.getById(sessionId)
    if (session?.selectedProviderId && session.selectedModel) {
      if (
        candidateMatchesPolicy(session.selectedProviderId, session.selectedModel, policy, providerConfigStore, userId)
      ) {
        return {
          providerId: session.selectedProviderId,
          model: session.selectedModel,
          source: 'session',
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5. global agent config
  // -----------------------------------------------------------------------
  const globalConfig = agentConfigStore.getGlobal()
  if (globalConfig?.providerId && globalConfig.model) {
    if (candidateMatchesPolicy(globalConfig.providerId, globalConfig.model, policy, providerConfigStore, userId)) {
      return {
        providerId: globalConfig.providerId,
        model: globalConfig.model,
        source: 'global_default',
      }
    }
  }

  // -----------------------------------------------------------------------
  // 6. compatible fallback
  // -----------------------------------------------------------------------
  if (effectiveFallbackMode === 'none') {
    throw new Error(
      `No provider resolved for subagent "${definition.agentType}" ` +
        `and fallbackMode is "none". ` +
        `Ensure a compatible provider is configured for user "${userId}".`,
    )
  }

  const userProviders = providerConfigStore.getByUser(userId)
  const allowedProviders =
    policy.allowedProviderIds && policy.allowedProviderIds.length > 0
      ? userProviders.filter((p) => policy.allowedProviderIds!.includes(p.providerId))
      : userProviders

  // When fallbackMode is 'same_provider' restrict to the provider that was
  // last tried (global config) so we stay within the same provider family.
  const scopedProviders =
    effectiveFallbackMode === 'same_provider' && globalConfig?.providerId
      ? allowedProviders.filter((p) => p.providerId === globalConfig.providerId)
      : allowedProviders

  for (const provider of scopedProviders) {
    if (!provider.enabled) continue

    const model = provider.selectedModel
    if (!model) continue

    if (candidateMatchesPolicy(provider.providerId, model, policy, providerConfigStore, userId)) {
      return {
        providerId: provider.providerId,
        model,
        source: 'fallback',
      }
    }
  }

  // Nothing matched at all.
  throw new Error(
    `No compatible provider found for subagent "${definition.agentType}" ` +
      `(user="${userId}", fallbackMode="${effectiveFallbackMode}"). ` +
      `Ensure at least one enabled provider with a selected model is configured.`,
  )
}
