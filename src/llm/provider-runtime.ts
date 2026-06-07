import { AsyncLocalStorage } from 'async_hooks'
import type { LLMAdapter } from './adapter.js'
import { createLLMAdapter } from './adapter.js'
import type { LLMProvider } from './provider.js'
import type { ProviderConfig as RuntimeProviderConfig, ProviderCandidate, AllProvidersFailedError } from './types.js'
import { OllamaAdapter, OpenAIAdapter, OpenRouterAdapter } from './providers.js'
import type { ProviderConfigStore, ProviderConfigWithSecret, ProviderType } from '../storage/provider-config-store.js'
import { resolveProviderCandidates, type EnvProviderDescriptor } from './routing/provider-resolver.js'
import { deriveRequestRequirements, canServeRequest } from './routing/request-requirements.js'

const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

interface RefreshLLMProvidersOptions {
  adapter: LLMAdapter
  providerConfigStore: ProviderConfigStore
  userId?: string
}

export interface ProviderScopedLLMAdapter extends LLMAdapter {
  runWithUserProviders<T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T>
}

interface CreateProviderScopedLLMAdapterOptions {
  providerConfigStore: ProviderConfigStore
}

function createProvider(providerType: ProviderType, config: RuntimeProviderConfig): LLMProvider {
  switch (providerType) {
    case 'openrouter':
      return new OpenRouterAdapter(config)
    case 'ollama':
      return new OllamaAdapter(config)
    case 'deepseek':
      return new OpenAIAdapter({
        ...config,
        baseUrl: config.baseUrl || 'https://api.deepseek.com',
      })
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config)
  }
}

function createProviderFromCandidate(candidate: ProviderCandidate): LLMProvider {
  return createProvider(candidate.providerType as ProviderType, candidate.config)
}

function buildEnvProviderDescriptors(): EnvProviderDescriptor[] {
  if (process.env.NODE_ENV === 'test') {
    return []
  }

  const descriptors: EnvProviderDescriptor[] = []

  if (process.env.OPENROUTER_API_KEY) {
    descriptors.push({
      providerType: 'openrouter',
      providerId: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL,
    })
  }

  if (process.env.OPENAI_API_KEY) {
    descriptors.push({
      providerType: 'openai',
      providerId: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
  }

  if (process.env.OLLAMA_BASE_URL) {
    descriptors.push({
      providerType: 'ollama',
      providerId: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL,
    })
  }

  if (process.env.DEEPSEEK_API_KEY) {
    descriptors.push({
      providerType: 'deepseek',
      providerId: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: DEFAULT_DEEPSEEK_MODEL,
    })
  }

  return descriptors
}

function replaceProviders(adapter: LLMAdapter, providers: LLMProvider[]): void {
  for (const provider of adapter.providers) {
    adapter.removeProvider(provider.id)
  }

  for (const provider of providers) {
    adapter.addProvider(provider)
  }
}

function buildLLMProvidersForUser(
  providerConfigStore: ProviderConfigStore,
  userId?: string,
  preferredProviderId?: string,
): LLMProvider[] {
  let dbProviders: ProviderConfigWithSecret[] = []
  if (userId) {
    const storedProviders = providerConfigStore.listByUser(userId)
    dbProviders = storedProviders
      .map((p) => providerConfigStore.getByIdWithSecret(p.providerId))
      .filter((p): p is ProviderConfigWithSecret => p !== null)
  }

  const candidates = resolveProviderCandidates({
    dbProviders,
    envProviders: buildEnvProviderDescriptors(),
    preferredProviderId,
    nodeEnv: process.env.NODE_ENV,
  })

  return candidates.map((candidate) => createProviderFromCandidate(candidate))
}

interface ScopeContext {
  userId?: string
  preferredProviderId?: string
  providers: LLMProvider[]
}

export function refreshLLMProvidersForUser(options: RefreshLLMProvidersOptions): void {
  const providers = buildLLMProvidersForUser(options.providerConfigStore, options.userId)
  replaceProviders(options.adapter, providers)
}

export function createProviderScopedLLMAdapter(
  options: CreateProviderScopedLLMAdapterOptions,
): ProviderScopedLLMAdapter {
  const providerScope = new AsyncLocalStorage<ScopeContext>()

  const buildCapabilityCandidates = (): ProviderCandidate[] => {
    const ctx = providerScope.getStore()

    let dbProviders: ProviderConfigWithSecret[] = []
    if (ctx?.userId) {
      const store = options.providerConfigStore
      const storedProviders = store.listByUser(ctx.userId)
      dbProviders = storedProviders
        .map((p) => store.getByIdWithSecret(p.providerId))
        .filter((p): p is ProviderConfigWithSecret => p !== null)
    }

    const candidates = resolveProviderCandidates({
      dbProviders,
      envProviders: buildEnvProviderDescriptors(),
      preferredProviderId: ctx?.preferredProviderId,
      nodeEnv: process.env.NODE_ENV,
    })

    return candidates
  }

  const buildProvidersFromCandidates = (candidates: ProviderCandidate[]): LLMProvider[] => {
    return candidates.map((candidate) => createProviderFromCandidate(candidate))
  }

  const complete: LLMAdapter['complete'] = async (request) => {
    const scopedAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      enableCircuitBreaker: true,
      enableLogging: false,
    })

    const candidates = buildCapabilityCandidates()

    const requirements = deriveRequestRequirements(request)
    const eligible = candidates.filter((c) => canServeRequest(requirements, c.model))

    if (eligible.length === 0) {
      const error: AllProvidersFailedError = {
        errorId: `err_no_capable_provider_${Date.now()}`,
        category: 'model_error',
        code: 'ALL_PROVIDERS_FAILED',
        message: 'No provider can serve the request based on capability requirements',
        recoverability: 'retryable_later',
        source: { module: 'provider_runtime', runId: request.model },
        attempts: [],
        createdAt: new Date().toISOString(),
      }
      return { success: false, error, providerId: 'none' }
    }

    for (const candidate of eligible) {
      scopedAdapter.addProvider(createProviderFromCandidate(candidate))
    }

    return scopedAdapter.complete(request)
  }

  const stream: LLMAdapter['stream'] = async function* (request) {
    const scopedAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      enableCircuitBreaker: true,
      enableLogging: false,
    })

    const candidates = buildCapabilityCandidates()

    const requirements = deriveRequestRequirements(request)
    const eligible = candidates.filter((c) => canServeRequest(requirements, c.model))

    if (eligible.length === 0) {
      return
    }

    for (const candidate of eligible) {
      scopedAdapter.addProvider(createProviderFromCandidate(candidate))
    }

    yield* scopedAdapter.stream(request)
  }

  const currentProviders = (): LLMProvider[] => {
    const candidates = buildCapabilityCandidates()
    return buildProvidersFromCandidates(candidates)
  }

  return {
    get config() {
      return {
        providers: currentProviders().map((provider) => provider.config),
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        enableCircuitBreaker: true,
        enableLogging: false,
      }
    },
    get providers() {
      return currentProviders()
    },
    complete,
    stream,
    addProvider() {
      throw new Error('Cannot add providers directly to a request-scoped adapter')
    },
    removeProvider() {
      throw new Error('Cannot remove providers directly from a request-scoped adapter')
    },
    getProvider(providerId: string) {
      return currentProviders().find((provider) => provider.id === providerId)
    },
    getHealthyProviders() {
      return currentProviders()
        .filter((provider) => provider.isHealthy())
        .sort((a, b) => a.config.priority - b.config.priority)
    },
    updateProviderPriority() {
      throw new Error('Cannot update provider priority directly on a request-scoped adapter')
    },
    runWithUserProviders<T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T> {
      const candidates = resolveProviderCandidates({
        dbProviders: options.providerConfigStore
          .listByUser(userId)
          .map((p) => options.providerConfigStore.getByIdWithSecret(p.providerId))
          .filter((p): p is ProviderConfigWithSecret => p !== null),
        envProviders: buildEnvProviderDescriptors(),
        preferredProviderId,
        nodeEnv: process.env.NODE_ENV,
      })
      const providers = buildProvidersFromCandidates(candidates)
      return providerScope.run({ userId, preferredProviderId, providers }, fn)
    },
  }
}
