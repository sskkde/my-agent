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
} from '../types.js';
import type {
  ProviderConfigWithSecret,
  ProviderType,
} from '../../storage/provider-config-store.js';
import type { ProviderCatalogEntry } from '../catalog/provider-catalog.js';
import { getProviderCatalogEntry } from '../catalog/provider-catalog.js';
import { resolveModelInfo } from '../catalog/model-catalog.js';

/**
 * Environment-derived provider descriptor
 * Represents a provider configured via environment variables
 */
export interface EnvProviderDescriptor {
  /** Provider type identifier */
  providerType: ProviderType;
  /** Provider instance identifier */
  providerId: string;
  /** API key (optional, some providers don't require it) */
  apiKey?: string;
  /** Base URL for API endpoints */
  baseUrl?: string;
  /** Selected model ID */
  model?: string;
}

/**
 * Options for resolving provider candidates
 */
export interface ResolveProviderCandidatesOptions {
  /** User's stored provider configurations from database */
  dbProviders: ProviderConfigWithSecret[];
  /** Environment-derived provider configurations */
  envProviders: EnvProviderDescriptor[];
  /** Preferred provider ID (gets highest priority) */
  preferredProviderId?: string;
  /** Custom model resolver function (defaults to resolveModelInfo) */
  modelResolver?: (providerId: string, modelId: string, family?: ProviderFamily, protocol?: ProviderProtocol) => ModelInfo;
  /** Node environment (for test mode detection) */
  nodeEnv?: string;
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
};

/**
 * Checks if a provider has usable credentials
 * Ollama requires baseUrl, all others require apiKey
 * 
 * @param provider - Provider configuration to check
 * @returns true if provider has usable credentials
 */
function hasUsableCredentials(provider: {
  providerType: ProviderType;
  apiKey: string | null;
  baseUrl: string | null;
}): boolean {
  if (provider.providerType === 'ollama') {
    return Boolean(provider.baseUrl);
  }
  return Boolean(provider.apiKey);
}

/**
 * Derives provider capabilities from provider type and model
 * 
 * @param providerType - Type of provider
 * @param model - Model information
 * @returns Provider capabilities
 */
function deriveProviderCapabilities(
  providerType: ProviderType,
  model: ModelInfo
): ProviderCapabilities {
  const supportsJsonMode =
    providerType === 'openai' ||
    providerType === 'openrouter' ||
    providerType === 'deepseek';

  return {
    ...DEFAULT_CAPABILITIES,
    supportsJsonMode,
    supportsFunctionCalling: model.capabilities.functionCalling,
    supportsVision: model.capabilities.vision,
    maxTokens: model.limits.outputTokens,
    supportedModels: [model.modelId],
  };
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
  model: ModelInfo
): ProviderRuntimeConfig {
  // Use provider overrides or catalog defaults
  const family = (provider.family as ProviderFamily | null | undefined) ??
    catalog?.family ??
    'openai_compatible';
  
  const protocol = (provider.protocol as ProviderProtocol | null | undefined) ??
    catalog?.protocol ??
    'openai_chat';
  
  const defaultModel = provider.defaultModel ??
    provider.selectedModel ??
    catalog?.defaultModel ??
    'gpt-4o-mini';

  // Derive capabilities
  const capabilities = deriveProviderCapabilities(provider.providerType, model);

  // Apply DeepSeek default baseUrl if not set
  let baseUrl = provider.baseUrl ?? undefined;
  if (provider.providerType === 'deepseek' && !baseUrl) {
    baseUrl = 'https://api.deepseek.com';
  }

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
  };
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
export function resolveProviderCandidates(
  options: ResolveProviderCandidatesOptions
): ProviderCandidate[] {
  const {
    dbProviders,
    envProviders,
    preferredProviderId,
    modelResolver,
    nodeEnv,
  } = options;

  const resolve = modelResolver ?? resolveModelInfo;
  const candidates: ProviderCandidate[] = [];
  const seen = new Set<string>();

  // Process database providers
  let dbPriority = 10;
  for (const provider of dbProviders) {
    // Skip disabled providers
    if (!provider.enabled) {
      continue;
    }

    // Skip providers without usable credentials
    if (!hasUsableCredentials(provider)) {
      continue;
    }

    const isPreferred = provider.providerId === preferredProviderId;
    const priority = isPreferred ? 1 : dbPriority;

    const catalog = getProviderCatalogEntry(provider.providerType);
    const modelId = provider.selectedModel ??
      catalog?.defaultModel ??
      'gpt-4o-mini';
    const model = resolve(
      provider.providerId,
      modelId,
      catalog?.family,
      catalog?.protocol
    );

    const config = buildProviderRuntimeConfig(provider, catalog, model);

    candidates.push({
      providerId: provider.providerId,
      providerType: provider.providerType,
      config: { ...config, priority },
      model,
      priority,
    });

    seen.add(provider.providerId);
    
    // Only increment priority if not preferred
    if (!isPreferred) {
      dbPriority += 10;
    }
  }

  // Process environment providers (skip in test mode)
  if (nodeEnv !== 'test') {
    let envPriority = 100;
    for (const env of envProviders) {
      // Skip if already have DB provider with same ID
      if (seen.has(env.providerId)) {
        continue;
      }

      const catalog = getProviderCatalogEntry(env.providerType);
      if (!catalog) {
        continue;
      }

      // Check credentials for env provider
      const hasCredentials = env.providerType === 'ollama'
        ? Boolean(env.baseUrl)
        : Boolean(env.apiKey);
      
      if (!hasCredentials) {
        continue;
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
      };

      const isPreferred = env.providerId === preferredProviderId;
      const priority = isPreferred ? 1 : envPriority;

      const modelId = env.model ?? catalog.defaultModel ?? 'gpt-4o-mini';
      const model = resolve(
        env.providerId,
        modelId,
        catalog.family,
        catalog.protocol
      );

      const config = buildProviderRuntimeConfig(syntheticProvider, catalog, model);

      candidates.push({
        providerId: env.providerId,
        providerType: env.providerType,
        config: { ...config, priority },
        model,
        priority,
      });

      // Only increment priority if not preferred
      if (!isPreferred) {
        envPriority += 10;
      }
    }
  }

  // Sort by priority ascending (lowest first)
  candidates.sort((a, b) => a.priority - b.priority);

  return candidates;
}
