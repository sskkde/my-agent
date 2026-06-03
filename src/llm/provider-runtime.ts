import { AsyncLocalStorage } from 'async_hooks';
import type { LLMAdapter } from './adapter.js';
import { createLLMAdapter } from './adapter.js';
import type { LLMProvider } from './provider.js';
import type { ProviderCapabilities, ProviderConfig as RuntimeProviderConfig, ProviderCandidate, AllProvidersFailedError } from './types.js';
import { OllamaAdapter, OpenAIAdapter, OpenRouterAdapter } from './providers.js';
import type {
  ProviderConfigStore,
  ProviderConfigWithSecret,
  ProviderType,
} from '../storage/provider-config-store.js';
import { resolveProviderCandidates, type EnvProviderDescriptor } from './routing/provider-resolver.js';
import { deriveRequestRequirements, canServeRequest } from './routing/request-requirements.js';

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 2;
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: false,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  supportsVision: false,
  maxTokens: 8192,
  supportedModels: [],
};

interface RefreshLLMProvidersOptions {
  adapter: LLMAdapter;
  providerConfigStore: ProviderConfigStore;
  userId?: string;
}

export interface ProviderScopedLLMAdapter extends LLMAdapter {
  runWithUserProviders<T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T>;
}

interface CreateProviderScopedLLMAdapterOptions {
  providerConfigStore: ProviderConfigStore;
}

function providerCapabilities(selectedModel: string | null, providerType?: ProviderType): ProviderCapabilities {
  const supportsJsonMode = providerType === 'openai' || providerType === 'openrouter' || providerType === 'deepseek';
  return {
    ...DEFAULT_CAPABILITIES,
    supportsJsonMode,
    supportedModels: selectedModel ? [selectedModel] : [],
  };
}

function hasUsableCredentials(provider: ProviderConfigWithSecret): boolean {
  if (!provider.enabled) {
    return false;
  }

  if (provider.providerType === 'ollama') {
    return Boolean(provider.baseUrl);
  }

  return Boolean(provider.apiKey);
}

function createRuntimeConfig(
  id: string,
  name: string,
  selectedModel: string | null,
  providerType: ProviderType,
  overrides: Partial<RuntimeProviderConfig>
): RuntimeProviderConfig {
  return {
    id,
    name,
    enabled: true,
    priority: overrides.priority ?? 100,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: overrides.retries ?? DEFAULT_RETRIES,
    capabilities: overrides.capabilities ?? providerCapabilities(selectedModel, providerType),
    apiKey: overrides.apiKey,
    baseUrl: overrides.baseUrl,
    enableLogging: overrides.enableLogging,
    siteUrl: overrides.siteUrl,
    appName: overrides.appName,
  };
}

function createProvider(providerType: ProviderType, config: RuntimeProviderConfig): LLMProvider {
  switch (providerType) {
    case 'openrouter':
      return new OpenRouterAdapter(config);
    case 'ollama':
      return new OllamaAdapter(config);
    case 'deepseek':
      return new OpenAIAdapter({
        ...config,
        baseUrl: config.baseUrl || 'https://api.deepseek.com',
      });
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config);
  }
}

function createProviderFromCandidate(candidate: ProviderCandidate): LLMProvider {
  return createProvider(candidate.providerType as ProviderType, candidate.config);
}

function buildEnvProviderDescriptors(): EnvProviderDescriptor[] {
  if (process.env.NODE_ENV === 'test') {
    return [];
  }

  const descriptors: EnvProviderDescriptor[] = [];

  if (process.env.OPENROUTER_API_KEY) {
    descriptors.push({
      providerType: 'openrouter',
      providerId: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL,
    });
  }

  if (process.env.OPENAI_API_KEY) {
    descriptors.push({
      providerType: 'openai',
      providerId: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }

  if (process.env.OLLAMA_BASE_URL) {
    descriptors.push({
      providerType: 'ollama',
      providerId: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL,
    });
  }

  if (process.env.DEEPSEEK_API_KEY) {
    descriptors.push({
      providerType: 'deepseek',
      providerId: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: DEFAULT_DEEPSEEK_MODEL,
    });
  }

  return descriptors;
}

function createDatabaseProvider(provider: ProviderConfigWithSecret, priority: number): LLMProvider | null {
  if (!hasUsableCredentials(provider)) {
    return null;
  }

  const runtimeConfig = createRuntimeConfig(
    provider.providerId,
    provider.displayName,
    provider.selectedModel,
    provider.providerType,
    {
      priority,
      apiKey: provider.apiKey ?? undefined,
      baseUrl: provider.baseUrl ?? undefined,
    }
  );

  return createProvider(provider.providerType, runtimeConfig);
}

function createEnvProviders(): LLMProvider[] {
  if (process.env.NODE_ENV === 'test') {
    return [];
  }

  const providers: LLMProvider[] = [];

  if (process.env.OPENROUTER_API_KEY) {
    providers.push(new OpenRouterAdapter(createRuntimeConfig('openrouter', 'OpenRouter (Env)', null, 'openrouter', {
      priority: 10,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL,
    })));
  }

  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAIAdapter(createRuntimeConfig('openai', 'OpenAI (Env)', null, 'openai', {
      priority: 20,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })));
  }

  if (process.env.OLLAMA_BASE_URL) {
    providers.push(new OllamaAdapter(createRuntimeConfig('ollama', 'Ollama (Env)', null, 'ollama', {
      priority: 30,
      baseUrl: process.env.OLLAMA_BASE_URL,
    })));
  }

  if (process.env.DEEPSEEK_API_KEY) {
    providers.push(new OpenAIAdapter(createRuntimeConfig('deepseek', 'DeepSeek (Env)', DEFAULT_DEEPSEEK_MODEL, 'deepseek', {
      priority: 40,
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    })));
  }

  return providers;
}

function replaceProviders(adapter: LLMAdapter, providers: LLMProvider[]): void {
  for (const provider of adapter.providers) {
    adapter.removeProvider(provider.id);
  }

  for (const provider of providers) {
    adapter.addProvider(provider);
  }
}

function buildLLMProvidersForUser(
  providerConfigStore: ProviderConfigStore,
  userId?: string,
  preferredProviderId?: string
): LLMProvider[] {
  const providers: LLMProvider[] = [];

  if (userId) {
    const storedProviders = providerConfigStore.listByUser(userId);
    let priority = 10;

    for (const storedProvider of storedProviders) {
      const providerWithSecret = providerConfigStore.getByIdWithSecret(storedProvider.providerId);
      if (!providerWithSecret) {
        continue;
      }

      const isPreferred = storedProvider.providerId === preferredProviderId;
      const effectivePriority = isPreferred ? 1 : priority;
      
      const provider = createDatabaseProvider(providerWithSecret, effectivePriority);
      if (provider) {
        providers.push(provider);
        if (!isPreferred) {
          priority += 10;
        }
      }
    }
  }

  const envProviders = createEnvProviders();
  for (const envProvider of envProviders) {
    if (providers.some((provider) => provider.id === envProvider.id)) {
      continue;
    }

    const envPriority = 100 + (envProvider.config.priority ?? 0);
    const effectivePriority = envProvider.id === preferredProviderId ? 1 : envPriority;
    envProvider.updateConfig({ ...envProvider.config, priority: effectivePriority });
    providers.push(envProvider);
  }

  providers.sort((a, b) => a.config.priority - b.config.priority);

  return providers;
}

interface ScopeContext {
  userId?: string;
  preferredProviderId?: string;
  providers: LLMProvider[];
}

export function refreshLLMProvidersForUser(options: RefreshLLMProvidersOptions): void {
  const providers = buildLLMProvidersForUser(options.providerConfigStore, options.userId);
  replaceProviders(options.adapter, providers);
}

export function createProviderScopedLLMAdapter(
  options: CreateProviderScopedLLMAdapterOptions
): ProviderScopedLLMAdapter {
  const providerScope = new AsyncLocalStorage<ScopeContext>();

  const currentProviders = (): LLMProvider[] => {
    const ctx = providerScope.getStore();
    return ctx?.providers ?? buildLLMProvidersForUser(options.providerConfigStore);
  };

  const buildCapabilityCandidates = (): ProviderCandidate[] => {
    const ctx = providerScope.getStore();

    let dbProviders: ProviderConfigWithSecret[] = [];
    if (ctx?.userId) {
      const store = options.providerConfigStore;
      const storedProviders = store.listByUser(ctx.userId);
      dbProviders = storedProviders
        .map(p => store.getByIdWithSecret(p.providerId))
        .filter((p): p is ProviderConfigWithSecret => p !== null);
    }

    const candidates = resolveProviderCandidates({
      dbProviders,
      envProviders: buildEnvProviderDescriptors(),
      preferredProviderId: ctx?.preferredProviderId,
      nodeEnv: process.env.NODE_ENV,
    });

    return candidates;
  };

  const complete: LLMAdapter['complete'] = async (request) => {
    const scopedAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      enableCircuitBreaker: true,
      enableLogging: false,
    });

    const candidates = buildCapabilityCandidates();

    const requirements = deriveRequestRequirements(request);
    const eligible = candidates.filter(c => canServeRequest(requirements, c.model));

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
      };
      return { success: false, error, providerId: 'none' };
    }

    for (const candidate of eligible) {
      scopedAdapter.addProvider(createProviderFromCandidate(candidate));
    }

    return scopedAdapter.complete(request);
  };

  const stream: LLMAdapter['stream'] = async function* (request) {
    const scopedAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      enableCircuitBreaker: true,
      enableLogging: false,
    });

    for (const provider of currentProviders()) {
      scopedAdapter.addProvider(provider);
    }

    yield* scopedAdapter.stream(request);
  };

  return {
    get config() {
      return {
        providers: currentProviders().map((provider) => provider.config),
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        enableCircuitBreaker: true,
        enableLogging: false,
      };
    },
    get providers() {
      return currentProviders();
    },
    complete,
    stream,
    addProvider() {
      throw new Error('Cannot add providers directly to a request-scoped adapter');
    },
    removeProvider() {
      throw new Error('Cannot remove providers directly from a request-scoped adapter');
    },
    getProvider(providerId: string) {
      return currentProviders().find((provider) => provider.id === providerId);
    },
    getHealthyProviders() {
      return currentProviders()
        .filter((provider) => provider.isHealthy())
        .sort((a, b) => a.config.priority - b.config.priority);
    },
    updateProviderPriority() {
      throw new Error('Cannot update provider priority directly on a request-scoped adapter');
    },
    runWithUserProviders<T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T> {
      const providers = buildLLMProvidersForUser(options.providerConfigStore, userId, preferredProviderId);
      return providerScope.run({ userId, preferredProviderId, providers }, fn);
    },
  };
}
