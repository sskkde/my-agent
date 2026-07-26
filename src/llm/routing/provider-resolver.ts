/**
 * Provider Resolver Module
 * Resolves and prioritizes provider candidates from database and environment sources
 */

import type {
  ModelInfo,
  ProviderCandidate,
  ProviderFamily,
  ProviderProtocol,
  ProviderRuntimeConfig,
  ProviderCapabilities,
} from '../types.js'
import type { ProviderConfigWithSecret, ProviderType } from '../../storage/provider-config-store.js'
import type { ProviderCatalogEntry } from '../catalog/provider-catalog.js'
import { getProviderCatalogEntry } from '../catalog/provider-catalog.js'
import { resolveModelInfo, getBuiltinModel } from '../catalog/model-catalog.js'
import { getDomesticProvider } from '../catalog/domestic-providers.js'

/**
 * Environment-derived provider descriptor
 * Represents a provider configured via environment variables
 */
export interface EnvProviderDescriptor {
  /** Provider type identifier */
  providerType: ProviderType
  /** Provider instance identifier */
  providerId: string
  /** API key (optional, some providers don't require it) */
  apiKey?: string
  /** Base URL for API endpoints */
  baseUrl?: string
  /** Selected model ID */
  model?: string
}

/**
 * Options for resolving provider candidates
 */
export interface ResolveProviderCandidatesOptions {
  /** User's stored provider configurations from database */
  dbProviders: ProviderConfigWithSecret[]
  /** Environment-derived provider configurations */
  envProviders: EnvProviderDescriptor[]
  /** Preferred provider ID (gets highest priority) */
  preferredProviderId?: string
  /** Custom model resolver function (defaults to resolveModelInfo) */
  modelResolver?: (
    providerId: string,
    modelId: string,
    family?: ProviderFamily,
    protocol?: ProviderProtocol,
  ) => ModelInfo
  /** Node environment (for test mode detection) */
  nodeEnv?: string
  /**
   * The model id requested by the current LLM request (request.model).
   * When provided, each DB candidate's model is resolved from this id when
   * the provider owns it (present in models_json, or equal to
   * selectedModel/defaultModel/catalog default). This fixes multi-model
   * same-provider routing: a session selecting model `b` on a provider whose
   * selectedModel is `a` no longer fails the `modelId === request.model`
   * filter. When the provider does not own requestModel, the candidate keeps
   * its default resolved model (selectedModel path).
   */
  requestModel?: string
}

/**
 * Default provider capabilities
 * Conservative defaults for providers without explicit capabilities
 */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: false,
  supportsVision: false,
  maxTokens: 8192,
  supportedModels: [],
}

/**
 * Merges boolean capability overrides from provider config into model capabilities
 * Only boolean fields are merged; non-boolean fields are ignored
 *
 * @param modelCapabilities - Base model capabilities
 * @param providerCapabilities - Provider capability overrides (from capabilities_json)
 * @returns Merged model capabilities
 */
export function mergeCapabilityOverrides(
  modelCapabilities: ModelInfo['capabilities'],
  providerCapabilities: Record<string, unknown> | null | undefined,
): ModelInfo['capabilities'] {
  if (!providerCapabilities) {
    return modelCapabilities
  }

  const booleanFields: Array<keyof ModelInfo['capabilities']> = [
    'streaming',
    'functionCalling',
    'jsonMode',
    'structuredOutput',
    'reasoning',
    'vision',
    'audioInput',
    'pdfInput',
    'toolChoice',
    'parallelToolCalls',
    'promptCache',
  ]

  const merged = { ...modelCapabilities }

  for (const field of booleanFields) {
    const value = providerCapabilities[field]
    if (typeof value === 'boolean') {
      merged[field] = value
    }
  }

  return merged
}

/**
 * Applies model-specific overrides from provider.models array
 * Finds matching model entry by modelId and applies overrides
 *
 * @param model - Base model info
 * @param providerModels - Provider models array (from models_json)
 * @returns Model info with overrides applied
 */
export function applyModelOverrides(
  model: ModelInfo,
  providerModels: Record<string, unknown>[] | null | undefined,
): ModelInfo {
  if (!providerModels || providerModels.length === 0) {
    return model
  }

  const modelOverride = providerModels.find((entry) => entry.modelId === model.modelId)

  if (!modelOverride) {
    return model
  }

  const overridden = { ...model }

  if (typeof modelOverride.displayName === 'string') {
    overridden.displayName = modelOverride.displayName
  }

  if (modelOverride.capabilities && typeof modelOverride.capabilities === 'object') {
    overridden.capabilities = mergeCapabilityOverrides(
      model.capabilities,
      modelOverride.capabilities as Record<string, unknown>,
    )
  }

  if (modelOverride.limits && typeof modelOverride.limits === 'object') {
    const limitsOverride = modelOverride.limits as Record<string, unknown>
    overridden.limits = { ...model.limits }

    if (typeof limitsOverride.contextTokens === 'number') {
      overridden.limits.contextTokens = limitsOverride.contextTokens
    }
    if (typeof limitsOverride.outputTokens === 'number') {
      overridden.limits.outputTokens = limitsOverride.outputTokens
    }
  }

  return overridden
}

/**
 * Checks whether a provider owns a given model id.
 *
 * A provider "owns" requestModel when any of the following holds:
 *   - requestModel appears in the provider's models_json entries (by modelId), OR
 *   - requestModel equals the provider's selectedModel, OR
 *   - requestModel equals the provider's defaultModel, OR
 *   - requestModel equals the catalog default model for the provider type, OR
 *   - the provider's models_json is empty/null AND requestModel equals the
 *     selectedModel/defaultModel/catalog default (fallback path for providers
 *     that carry no per-model manifest).
 *
 * @param provider - DB provider config with secret
 * @param requestModel - The model id requested by the LLM request
 * @param catalog - Provider catalog entry (or null)
 * @returns true if the provider owns requestModel
 */
function providerOwnsModel(
  provider: ProviderConfigWithSecret,
  requestModel: string,
  catalog: ProviderCatalogEntry | null,
): boolean {
  const models = provider.models
  if (models && models.length > 0) {
    if (models.some((entry) => entry.modelId === requestModel)) {
      return true
    }
  }

  const selectedModel = provider.selectedModel
  if (selectedModel !== null && selectedModel === requestModel) {
    return true
  }

  const defaultModel = provider.defaultModel
  if (defaultModel !== null && defaultModel !== undefined && defaultModel === requestModel) {
    return true
  }

  const catalogDefault = catalog?.defaultModel
  if (catalogDefault !== undefined && catalogDefault === requestModel) {
    return true
  }

  // Fallback path: provider carries no models manifest and requestModel equals
  // the provider's selected/default/catalog default. This is the path that
  // makes unknown models served by a provider with empty models_json still
  // route correctly when the session selected that provider's default.
  if ((!models || models.length === 0) && (selectedModel === null || selectedModel === requestModel)) {
    // When models_json is empty and selectedModel is null, the resolver falls
    // back to catalog default or 'gpt-4o-mini'. Treat requestModel as owned
    // only when it matches the effective fallback id.
    const effectiveDefault = selectedModel ?? catalogDefault ?? 'gpt-4o-mini'
    if (requestModel === effectiveDefault) {
      return true
    }
  }

  return false
}

/**
 * Resolves the ModelInfo for a request model id on a specific provider,
 * applying models_json overrides and provider-level capability overrides.
 *
 * This is the per-candidate model resolution used by the runtime to rebuild
 * each candidate's `model` from `request.model` (rather than from
 * `provider.selectedModel`), fixing multi-model same-provider routing.
 *
 * @param provider - DB provider config with secret
 * @param requestModel - The model id requested by the LLM request
 * @param catalog - Provider catalog entry (or null if unknown type)
 * @param modelResolver - Optional custom model resolver (defaults to resolveModelInfo)
 * @returns The resolved ModelInfo if the provider owns requestModel, null otherwise
 */
export function resolveCandidateModelForRequest(
  provider: ProviderConfigWithSecret,
  requestModel: string,
  catalog: ProviderCatalogEntry | null,
  modelResolver?: (
    providerId: string,
    modelId: string,
    family?: ProviderFamily,
    protocol?: ProviderProtocol,
  ) => ModelInfo,
): ModelInfo | null {
  if (!providerOwnsModel(provider, requestModel, catalog)) {
    return null
  }

  const resolve = modelResolver ?? resolveModelInfo
  const family = (provider.family as ProviderFamily | null | undefined) ?? catalog?.family ?? 'openai_compatible'
  const protocol = (provider.protocol as ProviderProtocol | null | undefined) ?? catalog?.protocol ?? 'openai_chat'

  let model = resolve(provider.providerType, requestModel, family, protocol)

  // Domestic provider compat transform (mirrors resolveProviderCandidates)
  if (!getBuiltinModel(provider.providerType, requestModel)) {
    const domesticDef = getDomesticProvider(provider.providerType)
    if (domesticDef) {
      model = {
        ...model,
        capabilities: {
          ...model.capabilities,
          streaming: model.capabilities.streaming || domesticDef.features.supportsStreaming,
          functionCalling: model.capabilities.functionCalling || domesticDef.features.supportsFunctionCalling,
          jsonMode: model.capabilities.jsonMode || domesticDef.features.supportsJsonMode,
        },
      }
    }
  }

  // Apply models_json entry overrides for this specific modelId
  model = applyModelOverrides(model, provider.models)

  // Apply provider-level capabilities_json overrides (boolean merge)
  model = {
    ...model,
    capabilities: mergeCapabilityOverrides(model.capabilities, provider.capabilities),
  }

  return model
}

/**
 * Checks if a provider has usable credentials
 * Ollama requires baseUrl, all others require apiKey
 *
 * @param provider - Provider configuration to check
 * @returns true if provider has usable credentials
 */
function hasUsableCredentials(provider: {
  providerType: ProviderType
  apiKey: string | null
  baseUrl: string | null
}): boolean {
  if (provider.providerType === 'ollama') {
    return Boolean(provider.baseUrl)
  }
  if (provider.providerType === 'mock') {
    return true
  }
  return Boolean(provider.apiKey)
}

/**
 * Derives provider capabilities from provider type and model
 *
 * @param providerType - Type of provider
 * @param model - Model information
 * @returns Provider capabilities
 */
function deriveProviderCapabilities(_providerType: ProviderType, model: ModelInfo): ProviderCapabilities {
  return {
    ...DEFAULT_CAPABILITIES,
    supportsJsonMode: model.capabilities.jsonMode,
    supportsFunctionCalling: model.capabilities.functionCalling,
    supportsVision: model.capabilities.vision,
    maxTokens: model.limits.outputTokens,
    supportedModels: [model.modelId],
  }
}

/**
 * Builds runtime configuration for a provider
 * Merges database configuration with catalog defaults
 *
 * @param provider - Database provider configuration with secrets
 * @param catalog - Provider catalog entry (or null if unknown type)
 * @param model - Resolved model information
 * @returns Provider runtime configuration
 *
 * @example
 * ```typescript
 * const config = buildProviderRuntimeConfig(
 *   dbProvider,
 *   getProviderCatalogEntry('openai'),
 *   resolveModelInfo('openai', 'gpt-4o-mini')
 * );
 * ```
 */
export function buildProviderRuntimeConfig(
  provider: ProviderConfigWithSecret,
  catalog: ProviderCatalogEntry | null,
  model: ModelInfo,
): ProviderRuntimeConfig {
  // Use provider overrides or catalog defaults
  const family = (provider.family as ProviderFamily | null | undefined) ?? catalog?.family ?? 'openai_compatible'

  const protocol = (provider.protocol as ProviderProtocol | null | undefined) ?? catalog?.protocol ?? 'openai_chat'

  const defaultModel = provider.defaultModel ?? provider.selectedModel ?? catalog?.defaultModel ?? 'gpt-4o-mini'

  // Derive capabilities
  const capabilities = deriveProviderCapabilities(provider.providerType, model)

  // Apply catalog default baseUrl if not set
  const baseUrl = provider.baseUrl ?? catalog?.defaultBaseUrl ?? undefined

  return {
    id: provider.providerId,
    name: provider.displayName,
    enabled: provider.enabled,
    priority: provider.priority ?? 100,
    timeoutMs: 60000,
    retries: 2,
    capabilities,
    apiKey: provider.apiKey ?? undefined,
    baseUrl,
    family,
    protocol,
    defaultModel,
    headers: provider.headers ?? undefined,
    customCapabilities: provider.capabilities as Partial<ModelInfo['capabilities']> | undefined,
    options: provider.options ?? undefined,
    promptFamily: catalog?.promptFamily,
    providerType: provider.providerType,
  }
}

/**
 * Resolves provider candidates from database and environment sources
 * Returns a prioritized list of provider candidates sorted by priority (lowest first)
 *
 * Priority rules:
 * - Preferred provider: priority 1
 * - DB providers: start at 10, increment by 10
 * - Env providers: start at 100, increment by 10
 * - DB providers override env providers with same ID
 * - Env providers are skipped in test mode (NODE_ENV === 'test')
 *
 * @param options - Resolution options
 * @returns Sorted array of provider candidates
 *
 * @example
 * ```typescript
 * const candidates = resolveProviderCandidates({
 *   dbProviders: userProviders,
 *   envProviders: [{ providerType: 'openai', providerId: 'openai', apiKey: 'sk-...' }],
 *   preferredProviderId: 'my-favorite',
 *   nodeEnv: process.env.NODE_ENV
 * });
 * ```
 */
export function resolveProviderCandidates(options: ResolveProviderCandidatesOptions): ProviderCandidate[] {
  const { dbProviders, envProviders, preferredProviderId, modelResolver, nodeEnv, requestModel } = options

  const resolve = modelResolver ?? resolveModelInfo
  const candidates: ProviderCandidate[] = []
  const seen = new Set<string>()

  // Process database providers
  let dbPriority = 10
  for (const provider of dbProviders) {
    // Skip disabled providers
    if (!provider.enabled) {
      continue
    }

    // Skip providers without usable credentials
    if (!hasUsableCredentials(provider)) {
      continue
    }

    const isPreferred = provider.providerId === preferredProviderId
    const priority = isPreferred ? 1 : (provider.priority ?? dbPriority)

    const catalog = getProviderCatalogEntry(provider.providerType)

    // T5: when requestModel is provided and the provider owns it, resolve the
    // candidate's model from requestModel (not selectedModel). This fixes
    // multi-model same-provider routing — a session selecting model `b` on a
    // provider whose selectedModel is `a` no longer fails the
    // `modelId === request.model` filter.
    let model: ModelInfo
    let modelId: string
    if (requestModel) {
      const requestResolved = resolveCandidateModelForRequest(provider, requestModel, catalog, modelResolver)
      if (requestResolved) {
        model = requestResolved
        modelId = requestModel
      } else {
        // Provider does not own requestModel — fall back to selectedModel path
        // so the candidate is still built (it will be filtered out by the
        // `modelId === request.model` check in provider-runtime).
        modelId = provider.selectedModel ?? catalog?.defaultModel ?? 'gpt-4o-mini'
        model = resolve(provider.providerType, modelId, catalog?.family, catalog?.protocol)

        if (!getBuiltinModel(provider.providerType, modelId)) {
          const domesticDef = getDomesticProvider(provider.providerType)
          if (domesticDef) {
            model = {
              ...model,
              capabilities: {
                ...model.capabilities,
                streaming: model.capabilities.streaming || domesticDef.features.supportsStreaming,
                functionCalling: model.capabilities.functionCalling || domesticDef.features.supportsFunctionCalling,
                jsonMode: model.capabilities.jsonMode || domesticDef.features.supportsJsonMode,
              },
            }
          }
        }

        model = applyModelOverrides(model, provider.models)
        model = {
          ...model,
          capabilities: mergeCapabilityOverrides(model.capabilities, provider.capabilities),
        }
      }
    } else {
      modelId = provider.selectedModel ?? catalog?.defaultModel ?? 'gpt-4o-mini'
      model = resolve(provider.providerType, modelId, catalog?.family, catalog?.protocol)

      if (!getBuiltinModel(provider.providerType, modelId)) {
        const domesticDef = getDomesticProvider(provider.providerType)
        if (domesticDef) {
          model = {
            ...model,
            capabilities: {
              ...model.capabilities,
              streaming: model.capabilities.streaming || domesticDef.features.supportsStreaming,
              functionCalling: model.capabilities.functionCalling || domesticDef.features.supportsFunctionCalling,
              jsonMode: model.capabilities.jsonMode || domesticDef.features.supportsJsonMode,
            },
          }
        }
      }

      model = applyModelOverrides(model, provider.models)
      model = {
        ...model,
        capabilities: mergeCapabilityOverrides(model.capabilities, provider.capabilities),
      }
    }

    const config = buildProviderRuntimeConfig(provider, catalog, model)

    candidates.push({
      providerId: provider.providerId,
      providerType: provider.providerType,
      config: { ...config, priority },
      model,
      priority,
    })

    seen.add(provider.providerId)

    if (!isPreferred && (provider.priority === null || provider.priority === undefined)) {
      dbPriority += 10
    }
  }

  // Process environment providers (skip in test mode)
  if (nodeEnv !== 'test') {
    let envPriority = 100
    for (const env of envProviders) {
      // Skip if already have DB provider with same ID
      if (seen.has(env.providerId)) {
        continue
      }

      const catalog = getProviderCatalogEntry(env.providerType)
      if (!catalog) {
        continue
      }

      // Check credentials for env provider
      const hasCredentials = env.providerType === 'ollama' ? Boolean(env.baseUrl) : Boolean(env.apiKey)

      if (!hasCredentials) {
        continue
      }

      // Create synthetic provider config from env
      const syntheticProvider: ProviderConfigWithSecret = {
        providerId: env.providerId,
        userId: 'env',
        providerType: env.providerType,
        displayName: env.providerId,
        enabled: true,
        baseUrl: env.baseUrl ?? null,
        selectedModel: env.model ?? null,
        apiKey: env.apiKey ?? null,
        source: 'environment',
        lastTestStatus: null,
        lastTestedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const isPreferred = env.providerId === preferredProviderId
      const priority = isPreferred ? 1 : envPriority

      const modelId = env.model ?? catalog.defaultModel ?? 'gpt-4o-mini'
      let model = resolve(env.providerId, modelId, catalog.family, catalog.protocol)

      if (!getBuiltinModel(env.providerId, modelId)) {
        const domesticDef = getDomesticProvider(env.providerType)
        if (domesticDef) {
          model = {
            ...model,
            capabilities: {
              ...model.capabilities,
              streaming: model.capabilities.streaming || domesticDef.features.supportsStreaming,
              functionCalling: model.capabilities.functionCalling || domesticDef.features.supportsFunctionCalling,
              jsonMode: model.capabilities.jsonMode || domesticDef.features.supportsJsonMode,
            },
          }
        }
      }

      const config = buildProviderRuntimeConfig(syntheticProvider, catalog, model)

      candidates.push({
        providerId: env.providerId,
        providerType: env.providerType,
        config: { ...config, priority },
        model,
        priority,
      })

      // Only increment priority if not preferred
      if (!isPreferred) {
        envPriority += 10
      }
    }
  }

  // Sort by priority ascending (lowest first)
  candidates.sort((a, b) => a.priority - b.priority)

  return candidates
}
