import type { ProviderConfigStore, ProviderConfigSanitized, ProviderType } from '../storage/provider-config-store.js'
import { DOMESTIC_PROVIDERS } from './catalog/domestic-providers.js'
import { getProviderCatalogEntry } from './catalog/provider-catalog.js'

/**
 * Session provider/model selection
 */
export interface SessionSelection {
  selectedProviderId?: string
  selectedModel?: string
}

/**
 * Agent configuration provider/model settings
 */
export interface AgentConfigProviderSettings {
  providerId?: string
  model?: string
}

/**
 * Options for resolving provider and model
 */
export interface ResolveProviderOptions {
  session: SessionSelection
  agentConfig: AgentConfigProviderSettings
  userId: string
  providerConfigStore: ProviderConfigStore
  includeEnvProviders?: boolean
}

/**
 * Provider candidate in the resolution chain
 */
export interface ProviderCandidate {
  providerId: string
  providerType: ProviderType
  displayName: string
  enabled: boolean
  configured: boolean
  selectedModel: string | null
  source: 'session' | 'agent-config' | 'user-default' | 'env'
}

/**
 * Metadata about fallback that occurred during resolution
 */
export interface FallbackMetadata {
  originalProviderId: string
  actualProviderId: string
  fallbackReason: 'provider_disabled' | 'provider_unconfigured' | 'provider_not_found'
  timestamp: string
}

/**
 * Successful provider resolution result
 */
export interface ProviderResolutionResult {
  type: 'success'
  selectedProviderId: string
  selectedModel: string | null
  candidates: ProviderCandidate[]
  fallbackMetadata?: FallbackMetadata
}

/**
 * No provider available result
 */
export interface NoProviderAvailableResult {
  type: 'no-provider'
  reason: 'no_configured_providers' | 'requested_provider_unavailable'
  requestedProviderId?: string
  candidates: ProviderCandidate[]
}

/**
 * Union type for all resolution results
 */
export type ProviderResolutionResultUnion = ProviderResolutionResult | NoProviderAvailableResult

/**
 * Get env providers as candidates
 */
function getEnvProviderCandidates(): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = []

  if (process.env.OPENROUTER_API_KEY) {
    candidates.push({
      providerId: 'openrouter',
      providerType: 'openrouter',
      displayName: 'OpenRouter (Env)',
      enabled: true,
      configured: true,
      selectedModel: null,
      source: 'env',
    })
  }

  if (process.env.OPENAI_API_KEY) {
    candidates.push({
      providerId: 'openai',
      providerType: 'openai',
      displayName: 'OpenAI (Env)',
      enabled: true,
      configured: true,
      selectedModel: null,
      source: 'env',
    })
  }

  if (process.env.OLLAMA_BASE_URL) {
    candidates.push({
      providerId: 'ollama',
      providerType: 'ollama',
      displayName: 'Ollama (Env)',
      enabled: true,
      configured: true,
      selectedModel: null,
      source: 'env',
    })
  }

  for (const provider of DOMESTIC_PROVIDERS) {
    if (process.env[provider.envApiKey]) {
      candidates.push({
        providerId: provider.providerType,
        providerType: provider.providerType as ProviderType,
        displayName: `${provider.displayName} (Env)`,
        enabled: true,
        configured: true,
        selectedModel: provider.defaultModel,
        source: 'env',
      })
    }
  }

  return candidates
}

/**
 * Convert stored provider config to candidate
 */
function storedProviderToCandidate(
  provider: ProviderConfigSanitized,
  source: 'session' | 'agent-config' | 'user-default',
): ProviderCandidate {
  return {
    providerId: provider.providerId,
    providerType: provider.providerType,
    displayName: provider.displayName,
    enabled: provider.enabled,
    configured: provider.configured,
    selectedModel: provider.selectedModel,
    source,
  }
}

/**
 * Check if a candidate is usable (enabled and configured)
 */
function isUsableCandidate(candidate: ProviderCandidate): boolean {
  return candidate.enabled && candidate.configured
}

/**
 * Build the fallback reason based on candidate state
 */
function buildFallbackReason(candidate: ProviderCandidate | null): FallbackMetadata['fallbackReason'] {
  if (!candidate) {
    return 'provider_not_found'
  }
  if (!candidate.enabled) {
    return 'provider_disabled'
  }
  if (!candidate.configured) {
    return 'provider_unconfigured'
  }
  return 'provider_not_found'
}

/**
 * Resolve provider and model based on precedence:
 * 1. Session selected provider/model
 * 2. Agent config provider/model
 * 3. User provider defaults (first enabled/configured from providerConfigStore.listByUser)
 * 4. Env providers
 *
 * Best-effort fallback skips disabled/unconfigured providers.
 * Logs fallback metadata without exposing secrets.
 */
export function resolveProviderAndModel(options: ResolveProviderOptions): ProviderResolutionResultUnion {
  const { session, agentConfig, userId, providerConfigStore, includeEnvProviders = true } = options
  const candidates: ProviderCandidate[] = []
  const timestamp = new Date().toISOString()

  // Collect user providers from store
  const userProviders = providerConfigStore.listByUser(userId)
  const usableUserProviders = userProviders.filter((p) => p.enabled && p.configured)

  // Build candidate list based on precedence

  // 1. Session selected provider (highest precedence)
  if (session.selectedProviderId) {
    const sessionProvider = userProviders.find((p) => p.providerId === session.selectedProviderId)
    candidates.push({
      providerId: session.selectedProviderId,
      providerType: sessionProvider?.providerType ?? 'custom',
      displayName: sessionProvider?.displayName ?? session.selectedProviderId,
      enabled: sessionProvider?.enabled ?? false,
      configured: sessionProvider?.configured ?? false,
      selectedModel: session.selectedModel ?? sessionProvider?.selectedModel ?? null,
      source: 'session',
    })
  }

  // 2. Agent config provider
  if (agentConfig.providerId) {
    const agentProvider = userProviders.find((p) => p.providerId === agentConfig.providerId)
    // Only add if different from session provider
    if (!candidates.find((c) => c.providerId === agentConfig.providerId)) {
      candidates.push({
        providerId: agentConfig.providerId,
        providerType: agentProvider?.providerType ?? 'custom',
        displayName: agentProvider?.displayName ?? agentConfig.providerId,
        enabled: agentProvider?.enabled ?? false,
        configured: agentProvider?.configured ?? false,
        selectedModel: agentConfig.model ?? agentProvider?.selectedModel ?? null,
        source: 'agent-config',
      })
    }
  }

  // 3. User provider defaults (enabled/configured providers from store)
  for (const provider of usableUserProviders) {
    if (!candidates.find((c) => c.providerId === provider.providerId)) {
      candidates.push(storedProviderToCandidate(provider, 'user-default'))
    }
  }

  // 4. Env providers (lowest precedence)
  if (includeEnvProviders) {
    const envCandidates = getEnvProviderCandidates()
    for (const candidate of envCandidates) {
      if (!candidates.find((c) => c.providerId === candidate.providerId)) {
        candidates.push(candidate)
      }
    }
  }

  // Determine selected provider with fallback logic
  let selectedCandidate: ProviderCandidate | null = null
  let selectedModel: string | null = null
  let fallbackMetadata: FallbackMetadata | undefined
  let preferredProviderId: string | null = null

  // Track the first candidate for fallback detection
  const firstCandidate = candidates[0]

  // Determine the preferred provider ID based on precedence
  if (session.selectedProviderId) {
    preferredProviderId = session.selectedProviderId
  } else if (agentConfig.providerId) {
    preferredProviderId = agentConfig.providerId
  }

  // Try to use the first candidate in precedence order
  for (const candidate of candidates) {
    if (isUsableCandidate(candidate)) {
      selectedCandidate = candidate
      break
    }
  }

  // If no usable candidate found, return no-provider
  if (!selectedCandidate) {
    // Check if specific provider was requested but unavailable
    if (preferredProviderId) {
      return {
        type: 'no-provider',
        reason: 'requested_provider_unavailable',
        requestedProviderId: preferredProviderId,
        candidates,
      }
    }

    return {
      type: 'no-provider',
      reason: 'no_configured_providers',
      candidates,
    }
  }

  // Determine the model to use based on precedence
  if (session.selectedModel) {
    selectedModel = session.selectedModel
  } else if (agentConfig.model) {
    selectedModel = agentConfig.model
  } else {
    selectedModel = selectedCandidate.selectedModel
    if (!selectedModel) {
      const catalog = getProviderCatalogEntry(selectedCandidate.providerType)
      selectedModel = catalog?.defaultModel ?? null
    }
  }

  // Build fallback metadata if we didn't use the first candidate
  if (firstCandidate && firstCandidate.providerId !== selectedCandidate.providerId) {
    fallbackMetadata = {
      originalProviderId: firstCandidate.providerId,
      actualProviderId: selectedCandidate.providerId,
      fallbackReason: buildFallbackReason(firstCandidate),
      timestamp,
    }
  }

  return {
    type: 'success',
    selectedProviderId: selectedCandidate.providerId,
    selectedModel,
    candidates,
    fallbackMetadata,
  }
}
