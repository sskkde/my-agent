# LLM Provider Configuration Design

> Version: 1.0.0
> Created: 2026-06-04
> Status: Implemented (v60)

---

## Overview

The LLM provider configuration system provides a unified abstraction layer for managing multiple LLM providers with capability-aware routing, priority-based fallback, and flexible model selection.

### Key Design Principles

1. **Provider Type vs Family vs Protocol**: Clear separation between user-facing provider types and underlying architectural concepts
2. **Capability-Aware Routing**: Requests are automatically routed to providers that support required capabilities
3. **Priority-Based Fallback**: Providers are sorted by priority, with automatic fallback on failure
4. **Catalog-Driven Configuration**: Built-in catalogs provide sensible defaults while allowing overrides

---

## Core Concepts

### Provider Type / Provider Family / Provider Protocol / Prompt Family

These four concepts serve different purposes in the configuration system:

| Concept                | Purpose                                           | Examples                                                                                                              |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ProviderType`         | User-facing identifier for provider configuration | `openai`, `openrouter`, `deepseek`, `ollama`, `custom`                                                                |
| `ProviderFamily`       | Architectural category for implementation routing | `openai`, `openai_compatible`, `deepseek`, `anthropic`, `gemini`, `ollama`, `bedrock`                                 |
| `ProviderProtocol`     | API communication format                          | `openai_chat`, `openai_responses`, `anthropic_messages`, `gemini_generate_content`, `ollama_chat`, `bedrock_converse` |
| `PromptProviderFamily` | Prompt template compatibility group               | `openai`, `deepseek`, `ollama`, `anthropic`, `gemini`                                                                 |

**TypeScript Definitions:**

```typescript
// src/llm/types.ts

export type ProviderType = 'openai' | 'openrouter' | 'ollama' | 'deepseek' | 'custom'

export type ProviderFamily = 'openai' | 'openai_compatible' | 'deepseek' | 'anthropic' | 'gemini' | 'ollama' | 'bedrock'

export type ProviderProtocol =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini_generate_content'
  | 'ollama_chat'
  | 'bedrock_converse'

export type PromptProviderFamily = 'openai' | 'deepseek' | 'ollama' | 'anthropic' | 'gemini'
```

### Example Mappings

| ProviderType | ProviderFamily      | ProviderProtocol | PromptProviderFamily |
| ------------ | ------------------- | ---------------- | -------------------- |
| `openai`     | `openai`            | `openai_chat`    | `openai`             |
| `openrouter` | `openai_compatible` | `openai_chat`    | `openai`             |
| `deepseek`   | `deepseek`          | `openai_chat`    | `deepseek`           |
| `ollama`     | `ollama`            | `ollama_chat`    | `ollama`             |
| `custom`     | `openai_compatible` | `openai_chat`    | `openai`             |

---

## Provider Catalog

The provider catalog defines built-in provider types with their default metadata.

**Location:** `src/llm/catalog/provider-catalog.ts`

### ProviderCatalogEntry

```typescript
interface ProviderCatalogEntry {
  providerType: ProviderType
  family: ProviderFamily
  protocol: ProviderProtocol
  promptFamily: PromptProviderFamily
  defaultBaseUrl?: string
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  defaultModel?: string
}
```

### Built-in Providers (v60)

| providerType | family              | protocol      | promptFamily | defaultBaseUrl             | requiresApiKey | requiresBaseUrl | defaultModel    |
| ------------ | ------------------- | ------------- | ------------ | -------------------------- | -------------- | --------------- | --------------- |
| `openai`     | `openai`            | `openai_chat` | `openai`     | -                          | true           | false           | -               |
| `openrouter` | `openai_compatible` | `openai_chat` | `openai`     | -                          | true           | false           | -               |
| `deepseek`   | `deepseek`          | `openai_chat` | `deepseek`   | `https://api.deepseek.com` | true           | false           | `deepseek-chat` |
| `ollama`     | `ollama`            | `ollama_chat` | `ollama`     | `http://localhost:11434`   | false          | true            | -               |
| `custom`     | `openai_compatible` | `openai_chat` | `openai`     | -                          | true           | true            | -               |

---

## Model Catalog

The model catalog provides model-specific capabilities and limits.

**Location:** `src/llm/catalog/model-catalog.ts`, `src/llm/catalog/builtin-models.ts`

### ModelCapabilities

```typescript
interface ModelCapabilities {
  streaming: boolean
  functionCalling: boolean
  jsonMode: boolean
  structuredOutput: boolean
  reasoning: boolean
  vision: boolean
  audioInput: boolean
  pdfInput: boolean
  toolChoice: boolean
  parallelToolCalls: boolean
  promptCache: boolean
}
```

### ModelLimits

```typescript
interface ModelLimits {
  contextTokens: number
  outputTokens: number
}
```

### ModelInfo

```typescript
interface ModelInfo {
  providerId: string
  modelId: string
  family: ProviderFamily
  protocol: ProviderProtocol
  displayName?: string
  capabilities: ModelCapabilities
  limits: ModelLimits
  pricing?: ModelPricing
  requestOptions?: Record<string, unknown>
}
```

### Built-in Models (v60)

| providerId | modelId             | family     | displayName       | Key Capabilities                                     | Context Tokens |
| ---------- | ------------------- | ---------- | ----------------- | ---------------------------------------------------- | -------------- |
| `deepseek` | `deepseek-chat`     | `deepseek` | DeepSeek Chat     | functionCalling, jsonMode, promptCache               | 128,000        |
| `deepseek` | `deepseek-reasoner` | `deepseek` | DeepSeek Reasoner | reasoning                                            | 64,000         |
| `openai`   | `gpt-4o-mini`       | `openai`   | GPT-4o mini       | functionCalling, jsonMode, vision, parallelToolCalls | 128,000        |

### Default Capabilities

Unknown models receive conservative defaults:

```typescript
const DEFAULT_TEXT_MODEL_CAPABILITIES: ModelCapabilities = {
  streaming: false,
  functionCalling: false,
  jsonMode: false,
  structuredOutput: false,
  reasoning: false,
  vision: false,
  audioInput: false,
  pdfInput: false,
  toolChoice: false,
  parallelToolCalls: false,
  promptCache: false,
}

const DEFAULT_LIMITS: ModelLimits = {
  contextTokens: 8192,
  outputTokens: 4096,
}
```

---

## Provider Configuration Store

The provider configuration store manages user-configured providers in the database.

**Location:** `src/storage/provider-config-store.ts`

### Database Schema (provider_configs table)

| Column              | Type    | Description                                  |
| ------------------- | ------- | -------------------------------------------- |
| `provider_id`       | TEXT    | Unique provider identifier                   |
| `user_id`           | TEXT    | Owner user ID                                |
| `provider_type`     | TEXT    | Provider type (openai, openrouter, etc.)     |
| `display_name`      | TEXT    | Human-readable name                          |
| `enabled`           | INTEGER | Whether provider is active                   |
| `base_url`          | TEXT    | API base URL                                 |
| `selected_model`    | TEXT    | User-selected model ID                       |
| `encrypted_api_key` | TEXT    | Encrypted API key                            |
| `api_key_last4`     | TEXT    | Last 4 chars of API key (for display)        |
| `source`            | TEXT    | Configuration source (database, environment) |
| `last_test_status`  | TEXT    | Last test result                             |
| `last_tested_at`    | TEXT    | Last test timestamp                          |
| `created_at`        | TEXT    | Creation timestamp                           |
| `updated_at`        | TEXT    | Last update timestamp                        |
| `tenant_id`         | TEXT    | Tenant isolation                             |

### v60+ Extension Fields

| Column              | Type    | Description                        |
| ------------------- | ------- | ---------------------------------- |
| `family`            | TEXT    | Provider family override           |
| `protocol`          | TEXT    | Provider protocol override         |
| `priority`          | INTEGER | Custom priority value              |
| `headers_json`      | TEXT    | Custom HTTP headers (JSON)         |
| `capabilities_json` | TEXT    | Model capabilities override (JSON) |
| `models_json`       | TEXT    | Available models list (JSON)       |
| `default_model`     | TEXT    | Default model ID                   |
| `options_json`      | TEXT    | Provider-specific options (JSON)   |

### ProviderConfigWithSecret

Runtime configuration with decrypted secrets:

```typescript
interface ProviderConfigWithSecret extends ProviderConfig {
  apiKey: string | null
  family?: string | null
  protocol?: string | null
  priority?: number | null
  headers?: Record<string, string> | null
  capabilities?: Record<string, unknown> | null
  models?: Record<string, unknown>[] | null
  defaultModel?: string | null
  options?: Record<string, unknown> | null
}
```

---

## Capability-Aware Routing Strategy

The routing system selects providers based on request requirements and model capabilities.

**Location:** `src/llm/routing/request-requirements.ts`, `src/llm/routing/provider-resolver.ts`

### Request Requirements

```typescript
interface RequestRequirements {
  requiresTools: boolean
  requiresJsonMode: boolean
  requiresStreaming: boolean
  requiresVision: boolean
  requiresAudio: boolean
  requiresPdf: boolean
  minOutputTokens?: number
}
```

### deriveRequestRequirements()

Analyzes an LLM request to determine required capabilities:

```typescript
function deriveRequestRequirements(request: LLMRequest): RequestRequirements {
  return {
    requiresTools: Array.isArray(request.tools) && request.tools.length > 0,
    requiresJsonMode: request.responseFormat?.type === 'json_object',
    requiresStreaming: false, // Conservative default
    requiresVision: false, // No vision content detection yet
    requiresAudio: false, // No audio in current request shape
    requiresPdf: false, // No PDF in current request shape
    minOutputTokens: request.maxTokens,
  }
}
```

### canServeRequest()

Validates that a model can fulfill the request:

```typescript
function canServeRequest(requirements: RequestRequirements, model: ModelInfo): boolean {
  if (requirements.requiresTools && !model.capabilities.functionCalling) {
    return false
  }
  if (requirements.requiresJsonMode && !model.capabilities.jsonMode) {
    return false
  }
  if (requirements.requiresStreaming && !model.capabilities.streaming) {
    return false
  }
  if (requirements.requiresVision && !model.capabilities.vision) {
    return false
  }
  if (requirements.requiresAudio && !model.capabilities.audioInput) {
    return false
  }
  if (requirements.requiresPdf && !model.capabilities.pdfInput) {
    return false
  }
  if (requirements.minOutputTokens && model.limits.outputTokens < requirements.minOutputTokens) {
    return false
  }
  return true
}
```

### resolveProviderCandidates()

Resolves and prioritizes provider candidates from database and environment sources.

**Priority Rules:**

1. **Preferred provider**: priority 1
2. **DB providers**: start at 10, increment by 10
3. **Env providers**: start at 100, increment by 10
4. **DB providers override** env providers with same ID
5. **Env providers are skipped** in test mode (NODE_ENV === 'test')

```typescript
function resolveProviderCandidates(options: ResolveProviderCandidatesOptions): ProviderCandidate[] {
  // 1. Process database providers with priority 10, 20, 30...
  // 2. Process environment providers with priority 100, 110, 120...
  // 3. Sort by priority ascending
  // 4. Return sorted candidates
}
```

### ProviderCandidate

```typescript
interface ProviderCandidate {
  providerId: string
  providerType: string
  config: ProviderRuntimeConfig
  model: ModelInfo
  priority: number
}
```

---

## Provider Runtime Integration

The runtime layer integrates catalogs, configuration store, and routing for request handling.

**Location:** `src/llm/provider-runtime.ts`

### ProviderScopedLLMAdapter

Creates request-scoped adapters with user-specific provider configurations:

```typescript
interface ProviderScopedLLMAdapter extends LLMAdapter {
  runWithUserProviders<T>(userId: string, fn: () => Promise<T>, preferredProviderId?: string): Promise<T>
}
```

### Capability-Aware Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     LLMRequest                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              deriveRequestRequirements()                     │
│  - Analyzes tools, responseFormat, maxTokens                │
│  - Returns RequestRequirements                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              resolveProviderCandidates()                     │
│  - Loads DB providers (priority 10+)                        │
│  - Loads env providers (priority 100+)                      │
│  - Applies preferred provider override                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Filter by canServeRequest()                     │
│  - Removes providers lacking required capabilities          │
│  - Returns eligible candidates                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Execute with fallback                           │
│  - Try providers in priority order                          │
│  - Automatic fallback on failure                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Environment-Derived Providers

Providers can be configured via environment variables for development and testing:

| Environment Variable | ProviderType | ProviderId   |
| -------------------- | ------------ | ------------ |
| `OPENROUTER_API_KEY` | `openrouter` | `openrouter` |
| `OPENAI_API_KEY`     | `openai`     | `openai`     |
| `OLLAMA_BASE_URL`    | `ollama`     | `ollama`     |
| `DEEPSEEK_API_KEY`   | `deepseek`   | `deepseek`   |

**Environment providers are skipped when `NODE_ENV === 'test'`.**

---

## Supported Providers (v60)

The following providers are currently supported:

| Provider   | Type         | Family              | API Key Required | Default URL                  |
| ---------- | ------------ | ------------------- | ---------------- | ---------------------------- |
| OpenAI     | `openai`     | `openai`            | Yes              | https://api.openai.com/v1    |
| OpenRouter | `openrouter` | `openai_compatible` | Yes              | https://openrouter.ai/api/v1 |
| DeepSeek   | `deepseek`   | `deepseek`          | Yes              | https://api.deepseek.com     |
| Ollama     | `ollama`     | `ollama`            | No               | http://localhost:11434       |
| Custom     | `custom`     | `openai_compatible` | Yes              | (user-specified)             |

---

## Out of Scope

The following are explicitly out of scope for v60:

1. **Anthropic/Gemini/Bedrock real routes**: These provider families are defined in types but not implemented
2. **Streaming LLMEvent**: The streaming interface does not emit structured events
3. **AI SDK backend**: No integration with Vercel AI SDK

---

## File Reference

### Core Types

| File               | Lines | Description                             |
| ------------------ | ----- | --------------------------------------- |
| `src/llm/types.ts` | 335   | Core type definitions for LLM subsystem |

### Catalogs

| File                                  | Lines | Description                          |
| ------------------------------------- | ----- | ------------------------------------ |
| `src/llm/catalog/provider-catalog.ts` | 106   | Built-in provider catalog            |
| `src/llm/catalog/model-catalog.ts`    | 84    | Model lookup and fallback resolution |
| `src/llm/catalog/builtin-models.ts`   | 90    | Static model definitions             |

### Routing

| File                                      | Lines | Description                                |
| ----------------------------------------- | ----- | ------------------------------------------ |
| `src/llm/routing/request-requirements.ts` | 85    | Request analysis and capability validation |
| `src/llm/routing/provider-resolver.ts`    | 334   | Provider candidate resolution              |

### Runtime

| File                          | Lines | Description                                          |
| ----------------------------- | ----- | ---------------------------------------------------- |
| `src/llm/provider-runtime.ts` | 399   | Provider-scoped adapter and capability-aware routing |

### Storage

| File                                   | Lines | Description                                      |
| -------------------------------------- | ----- | ------------------------------------------------ |
| `src/storage/provider-config-store.ts` | 446   | Database persistence for provider configurations |

---

## Usage Example

```typescript
import { createProviderScopedLLMAdapter } from './llm/provider-runtime.js';
import { createProviderConfigStore } from './storage/provider-config-store.js';

// Setup
const store = createProviderConfigStore(connection);
const adapter = createProviderScopedLLMAdapter({ providerConfigStore: store });

// Execute with user providers
const result = await adapter.runWithUserProviders(
  'user-123',
  async () => {
    return adapter.complete({
      model: 'auto',  // Will select best available model
      messages: [{ role: 'user', content: 'Hello!' }],
      tools: [{ type: 'function', function: { name: 'get_weather', ... } }],
    });
  },
  'my-favorite-provider'  // Optional: preferred provider
);
```

---

## Migration Notes

### v60 Migration

Database migration adds the following columns to `provider_configs`:

```sql
ALTER TABLE provider_configs ADD COLUMN family TEXT;
ALTER TABLE provider_configs ADD COLUMN protocol TEXT;
ALTER TABLE provider_configs ADD COLUMN priority INTEGER;
ALTER TABLE provider_configs ADD COLUMN headers_json TEXT;
ALTER TABLE provider_configs ADD COLUMN capabilities_json TEXT;
ALTER TABLE provider_configs ADD COLUMN models_json TEXT;
ALTER TABLE provider_configs ADD COLUMN default_model TEXT;
ALTER TABLE provider_configs ADD COLUMN options_json TEXT;
```

All new columns are nullable and optional. Existing configurations continue to work without modification.
