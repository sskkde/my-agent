import { AsyncLocalStorage } from 'async_hooks';
import type { LLMAdapter } from './adapter.js';
import { createLLMAdapter } from './adapter.js';
import type { LLMProvider } from './provider.js';
import type { ProviderCapabilities, ProviderConfig as RuntimeProviderConfig } from './types.js';
import { OllamaAdapter, OpenAIAdapter, OpenRouterAdapter } from './providers.js';
import type {
  ProviderConfigStore,
  ProviderConfigWithSecret,
  ProviderType,
} from '../storage/provider-config-store.js';

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRIES = 2;

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

function providerCapabilities(selectedModel: string | null): ProviderCapabilities {
  return {
    ...DEFAULT_CAPABILITIES,
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
  overrides: Partial<RuntimeProviderConfig>
): RuntimeProviderConfig {
  return {
    id,
    name,
    enabled: true,
    priority: overrides.priority ?? 100,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: overrides.retries ?? DEFAULT_RETRIES,
    capabilities: overrides.capabilities ?? providerCapabilities(selectedModel),
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
    case 'openai':
    case 'custom':
      return new OpenAIAdapter(config);
  }
}

function createDatabaseProvider(provider: ProviderConfigWithSecret, priority: number): LLMProvider | null {
  if (!hasUsableCredentials(provider)) {
    return null;
  }

  const runtimeConfig = createRuntimeConfig(
    provider.providerId,
    provider.displayName,
    provider.selectedModel,
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
    providers.push(new OpenRouterAdapter(createRuntimeConfig('openrouter', 'OpenRouter (Env)', null, {
      priority: 10,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.OPENROUTER_BASE_URL,
    })));
  }

  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAIAdapter(createRuntimeConfig('openai', 'OpenAI (Env)', null, {
      priority: 20,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })));
  }

  if (process.env.OLLAMA_BASE_URL) {
    providers.push(new OllamaAdapter(createRuntimeConfig('ollama', 'Ollama (Env)', null, {
      priority: 30,
      baseUrl: process.env.OLLAMA_BASE_URL,
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

export function refreshLLMProvidersForUser(options: RefreshLLMProvidersOptions): void {
  const providers = buildLLMProvidersForUser(options.providerConfigStore, options.userId);
  replaceProviders(options.adapter, providers);
}

export function createProviderScopedLLMAdapter(
  options: CreateProviderScopedLLMAdapterOptions
): ProviderScopedLLMAdapter {
  const providerScope = new AsyncLocalStorage<LLMProvider[]>();

  const currentProviders = (): LLMProvider[] => {
    return providerScope.getStore() ?? buildLLMProvidersForUser(options.providerConfigStore);
  };

  const complete: LLMAdapter['complete'] = async (request) => {
    const scopedAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      enableCircuitBreaker: true,
      enableLogging: false,
    });

    for (const provider of currentProviders()) {
      scopedAdapter.addProvider(provider);
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
      return providerScope.run(providers, fn);
    },
  };
}
