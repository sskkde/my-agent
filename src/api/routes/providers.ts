import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { providerIdParamsSchema } from '../schemas/shared.js'
import type { ProviderSummary, CreateProviderRequest, UpdateProviderRequest, TestProviderResponse } from '../types.js'
import type { ProviderType, ProviderConfigSanitized } from '../../storage/provider-config-store.js'
import { randomUUID } from 'crypto'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import { isKnownProviderType, getProviderCatalogEntry } from '../../llm/catalog/provider-catalog.js'

const TEST_TIMEOUT_MS = 10000

function sanitizeProviderForResponse(provider: ProviderConfigSanitized): ProviderSummary {
  return {
    providerId: provider.providerId,
    providerType: provider.providerType,
    displayName: provider.displayName,
    enabled: provider.enabled,
    configured: provider.configured,
    apiKeyLast4: provider.apiKeyLast4,
    baseUrl: provider.baseUrl,
    selectedModel: provider.selectedModel,
    source: provider.source,
    lastTestStatus: provider.lastTestStatus,
    lastTestedAt: provider.lastTestedAt,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    family: provider.family,
    protocol: provider.protocol,
    priority: provider.priority,
    defaultModel: provider.defaultModel,
    capabilities: provider.capabilities,
    options: provider.options,
    models: provider.models,
    headersConfigured: provider.headersConfigured,
  }
}

function validateProviderType(providerType: unknown): providerType is ProviderType {
  return typeof providerType === 'string' && isKnownProviderType(providerType)
}

interface TestResult {
  success: boolean
  latencyMs: number
  modelCount?: number
  error?: string
}

function formatConnectionError(err: Error & { code?: string }, target: string): string {
  const details = err.message || err.code || 'unknown network error'
  const code = err.code && err.message ? ` (${err.code})` : ''
  return `Connection error: ${details}${code} while connecting to ${target}`
}

function buildOpenAICompatibleModelsPath(baseUrl: string): string {
  const url = new URL(baseUrl)
  const trimmedPath = url.pathname.replace(/\/+$/, '')

  if (trimmedPath.endsWith('/models')) {
    return trimmedPath || '/models'
  }

  if (/\/v\d+$/.test(trimmedPath) || /\/api\/v\d+$/.test(trimmedPath)) {
    return `${trimmedPath}/models`
  }

  return `${trimmedPath || ''}/v1/models`
}

async function testOpenAICompatibleConnection(apiKey: string, baseUrl: string): Promise<TestResult> {
  const startTime = Date.now()

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return {
      success: false,
      latencyMs: 0,
      error: 'Invalid base URL format',
    }
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
  const path = buildOpenAICompatibleModelsPath(baseUrl)
  const target = `${url.origin}${path}`

  return new Promise((resolve) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: TEST_TIMEOUT_MS,
      },
      (res) => {
        const latencyMs = Date.now() - startTime
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data)
              const modelCount = Array.isArray(parsed.data) ? parsed.data.length : undefined
              resolve({ success: true, latencyMs, modelCount })
            } catch {
              resolve({ success: true, latencyMs })
            }
          } else if (res.statusCode === 401) {
            resolve({
              success: false,
              latencyMs,
              error: 'Authentication failed: Invalid API key',
            })
          } else {
            resolve({
              success: false,
              latencyMs,
              error: `Provider returned status ${res.statusCode}`,
            })
          }
        })
      },
    )

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: formatConnectionError(err, target),
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: `Connection timed out while connecting to ${target}`,
      })
    })

    req.end()
  })
}

async function testOpenAIConnection(apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  return testOpenAICompatibleConnection(apiKey, baseUrl || 'https://api.openai.com/v1')
}

async function testOpenRouterConnection(apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  return testOpenAICompatibleConnection(apiKey, baseUrl || 'https://openrouter.ai/api/v1')
}

async function testDeepSeekConnection(apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  return testOpenAICompatibleConnection(apiKey, baseUrl || 'https://api.deepseek.com')
}

async function testOllamaConnection(baseUrl: string): Promise<TestResult> {
  const startTime = Date.now()

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return {
      success: false,
      latencyMs: 0,
      error: 'Invalid base URL format',
    }
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: '/api/v1/tags',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: TEST_TIMEOUT_MS,
      },
      (res) => {
        const latencyMs = Date.now() - startTime
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data)
              const modelCount = Array.isArray(parsed.models) ? parsed.models.length : undefined
              resolve({ success: true, latencyMs, modelCount })
            } catch {
              resolve({ success: true, latencyMs })
            }
          } else {
            resolve({
              success: false,
              latencyMs,
              error: `Ollama returned status ${res.statusCode}`,
            })
          }
        })
      },
    )

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: formatConnectionError(err, `${baseUrl.replace(/\/+$/, '')}/api/tags`),
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: 'Connection timed out',
      })
    })

    req.end()
  })
}

async function testCustomConnection(apiKey: string, baseUrl: string): Promise<TestResult> {
  const startTime = Date.now()

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return {
      success: false,
      latencyMs: 0,
      error: 'Invalid base URL format',
    }
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest
  const path = buildOpenAICompatibleModelsPath(baseUrl)

  return new Promise((resolve) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: TEST_TIMEOUT_MS,
      },
      (res) => {
        const latencyMs = Date.now() - startTime
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data)
              const modelCount = Array.isArray(parsed.data) ? parsed.data.length : undefined
              resolve({ success: true, latencyMs, modelCount })
            } catch {
              resolve({ success: true, latencyMs })
            }
          } else if (res.statusCode === 401) {
            resolve({
              success: false,
              latencyMs,
              error: 'Authentication failed: Invalid API key',
            })
          } else {
            resolve({
              success: false,
              latencyMs,
              error: `Provider returned status ${res.statusCode}`,
            })
          }
        })
      },
    )

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: formatConnectionError(err, `${url.origin}${path}`),
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        error: 'Connection timed out',
      })
    })

    req.end()
  })
}

async function testEnvProvider(providerId: string): Promise<TestResult | null> {
  switch (providerId) {
    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'OPENROUTER_API_KEY not configured' }
      }
      return testOpenRouterConnection(apiKey, null)
    }
    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL
      if (!baseUrl) {
        return { success: false, latencyMs: 0, error: 'OLLAMA_BASE_URL not configured' }
      }
      return testOllamaConnection(baseUrl)
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'OPENAI_API_KEY not configured' }
      }
      return testOpenAIConnection(apiKey, null)
    }
    case 'deepseek': {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'DEEPSEEK_API_KEY not configured' }
      }
      return testDeepSeekConnection(apiKey, process.env.DEEPSEEK_BASE_URL)
    }
    default:
      return null
  }
}

async function testProviderConnection(
  providerType: ProviderType,
  apiKey: string | null,
  baseUrl: string | null,
): Promise<TestResult> {
  const catalogEntry = getProviderCatalogEntry(providerType)
  const effectiveBaseUrl = baseUrl ?? catalogEntry?.defaultBaseUrl ?? null

  switch (providerType) {
    case 'openai':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for OpenAI' }
      }
      return testOpenAIConnection(apiKey, effectiveBaseUrl)
    case 'openrouter':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for OpenRouter' }
      }
      return testOpenRouterConnection(apiKey, effectiveBaseUrl)
    case 'ollama':
      if (!effectiveBaseUrl) {
        return { success: false, latencyMs: 0, error: 'Base URL is required for Ollama' }
      }
      return testOllamaConnection(effectiveBaseUrl)
    case 'deepseek':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for DeepSeek' }
      }
      return testDeepSeekConnection(apiKey, effectiveBaseUrl)
    case 'custom':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for custom provider' }
      }
      if (!effectiveBaseUrl) {
        return { success: false, latencyMs: 0, error: 'Base URL is required for custom provider' }
      }
      return testCustomConnection(apiKey, effectiveBaseUrl)
    default: {
      // Handle any known domestic/built-in provider type as OpenAI-compatible
      if (!catalogEntry) {
        return { success: false, latencyMs: 0, error: 'Unknown provider type' }
      }
      if (!apiKey) {
        return {
          success: false,
          latencyMs: 0,
          error: `API key is required for ${providerType} provider`,
        }
      }
      if (!effectiveBaseUrl) {
        return {
          success: false,
          latencyMs: 0,
          error: `Base URL is required for ${providerType} provider`,
        }
      }
      const result = await testOpenAICompatibleConnection(apiKey, effectiveBaseUrl)
      // Spark-specific: clarify that APIPassword goes in the API key field
      if (providerType === 'iflytek-spark' && result.error?.includes('Authentication failed')) {
        result.error = 'Authentication failed: Please enter your APIPassword in the API key field'
      }
      return result
    }
  }
}

export function registerProviderRoutes(server: FastifyInstance, context: ApiContext): void {
  const providerConfigStore = context.providerConfigStore

  // GET /api/providers - List all providers for current user
  server.get('/api/v1/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission('provider' as ResourceType, Action.read)) {
      return reply
    }
    const userId = request.user?.userId
    if (!userId) {
      return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
    }

    if (!providerConfigStore) {
      return reply
        .code(503)
        .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
    }

    const providers = providerConfigStore.listByUser(userId)
    const summaries = providers.map(sanitizeProviderForResponse)

    return reply.code(200).send(success(summaries, request.requestId))
  })

  // GET /api/providers/:providerId - Get a specific provider
  server.get<{ Params: { providerId: string } }>(
    '/api/v1/providers/:providerId',
    {
      schema: {
        params: providerIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('provider' as ResourceType, Action.read)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      if (!providerConfigStore) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
      }

      const { providerId } = request.params
      const provider = providerConfigStore.getById(providerId)

      if (!provider) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found', request.requestId))
      }

      if (provider.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this provider', request.requestId))
      }

      return reply.code(200).send(success(sanitizeProviderForResponse(provider), request.requestId))
    },
  )

  // POST /api/providers - Create a new provider
  server.post<{ Body: CreateProviderRequest }>(
    '/api/v1/providers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['providerType'],
          properties: {
            providerType: { type: 'string', minLength: 1 },
            displayName: { type: 'string' },
            apiKey: { type: 'string' },
            baseUrl: { type: 'string' },
            selectedModel: { type: 'string' },
            family: { type: 'string' },
            protocol: { type: 'string' },
            priority: { type: 'integer', minimum: 0 },
            defaultModel: { type: 'string' },
            headers: { type: 'object' },
            capabilities: { type: 'object' },
            options: { type: 'object' },
            models: { type: 'array' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateProviderRequest }>, reply: FastifyReply) => {
      if (!request.requirePermission('provider' as ResourceType, Action.create)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      if (!providerConfigStore) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
      }

      const {
        providerType,
        displayName,
        apiKey,
        baseUrl,
        selectedModel,
        family,
        protocol,
        priority,
        defaultModel,
        headers,
        capabilities,
        options,
        models,
      } = request.body || {}

      if (!validateProviderType(providerType)) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_PROVIDER_TYPE', `Invalid provider type: ${providerType}`, request.requestId))
      }

      const catalogEntry = getProviderCatalogEntry(providerType)

      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0)) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_DISPLAY_NAME', 'Display name must be a non-empty string', request.requestId))
      }

      if (priority !== undefined && priority !== null) {
        if (!Number.isInteger(priority) || priority < 0) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_PRIORITY', 'Priority must be a non-negative integer', request.requestId))
        }
      }

      if (headers !== undefined && headers !== null) {
        if (typeof headers !== 'object' || Array.isArray(headers)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_HEADERS', 'Headers must be a plain object', request.requestId))
        }
      }

      if (capabilities !== undefined && capabilities !== null) {
        if (typeof capabilities !== 'object' || Array.isArray(capabilities)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_CAPABILITIES', 'Capabilities must be a plain object', request.requestId))
        }
      }

      if (options !== undefined && options !== null) {
        if (typeof options !== 'object' || Array.isArray(options)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_OPTIONS', 'Options must be a plain object', request.requestId))
        }
      }

      if (models !== undefined && models !== null) {
        if (!Array.isArray(models)) {
          return reply.code(400).send(envelopeError('INVALID_MODELS', 'Models must be an array', request.requestId))
        }
      }

      const requiresApiKey = catalogEntry?.requiresApiKey ?? true
      const requiresBaseUrl = catalogEntry?.requiresBaseUrl ?? false

      if (requiresApiKey && !apiKey) {
        return reply
          .code(400)
          .send(
            envelopeError('API_KEY_REQUIRED', `API key is required for ${providerType} provider`, request.requestId),
          )
      }

      if (requiresBaseUrl && !baseUrl) {
        const catalogDefaultUrl = catalogEntry?.defaultBaseUrl
        if (!catalogDefaultUrl) {
          return reply
            .code(400)
            .send(
              envelopeError(
                'BASE_URL_REQUIRED',
                `Base URL is required for ${providerType} provider`,
                request.requestId,
              ),
            )
        }
      }

      const providerId = randomUUID()
      const finalDisplayName = displayName?.trim() || `${providerType}-${providerId.slice(0, 8)}`

      const finalFamily = family ?? catalogEntry?.family ?? null
      const finalProtocol = protocol ?? catalogEntry?.protocol ?? null
      const finalBaseUrl = baseUrl ?? catalogEntry?.defaultBaseUrl
      const finalDefaultModel = defaultModel ?? catalogEntry?.defaultModel ?? null
      const finalSelectedModel = selectedModel ?? catalogEntry?.defaultModel

      try {
        const provider = providerConfigStore.create({
          providerId,
          userId,
          providerType,
          displayName: finalDisplayName,
          apiKey,
          baseUrl: finalBaseUrl,
          selectedModel: finalSelectedModel,
          enabled: true,
          family: finalFamily,
          protocol: finalProtocol,
          priority: priority ?? null,
          headers: headers ?? null,
          capabilities: capabilities ?? null,
          options: options ?? null,
          models: models ?? null,
          defaultModel: finalDefaultModel,
        })
        context.refreshProvidersForUser(userId)

        const summary = sanitizeProviderForResponse(provider)
        return reply.code(201).send(success(summary, request.requestId))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create provider'
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId))
      }
    },
  )

  // PATCH /api/providers/:providerId - Update a provider
  server.patch<{ Params: { providerId: string }; Body: UpdateProviderRequest }>(
    '/api/v1/providers/:providerId',
    {
      schema: {
        params: providerIdParamsSchema,
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
            apiKey: { type: 'string' },
            baseUrl: { type: 'string' },
            selectedModel: { type: 'string' },
            enabled: { type: 'boolean' },
            family: { type: 'string' },
            protocol: { type: 'string' },
            priority: { type: 'integer', minimum: 0 },
            defaultModel: { type: 'string' },
            headers: { type: 'object' },
            capabilities: { type: 'object' },
            options: { type: 'object' },
            models: { type: 'array' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { providerId: string }; Body: UpdateProviderRequest }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission('provider' as ResourceType, Action.update)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      if (!providerConfigStore) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
      }

      const { providerId } = request.params
      const existingProvider = providerConfigStore.getById(providerId)

      if (!existingProvider) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found', request.requestId))
      }

      if (existingProvider.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this provider', request.requestId))
      }

      const {
        displayName,
        apiKey,
        baseUrl,
        selectedModel,
        enabled,
        family,
        protocol,
        priority,
        defaultModel,
        headers,
        capabilities,
        options,
        models,
      } = request.body || {}

      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0)) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_DISPLAY_NAME', 'Display name must be a non-empty string', request.requestId))
      }

      if (priority !== undefined && priority !== null) {
        if (!Number.isInteger(priority) || priority < 0) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_PRIORITY', 'Priority must be a non-negative integer', request.requestId))
        }
      }

      if (headers !== undefined && headers !== null) {
        if (typeof headers !== 'object' || Array.isArray(headers)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_HEADERS', 'Headers must be a plain object', request.requestId))
        }
      }

      if (capabilities !== undefined && capabilities !== null) {
        if (typeof capabilities !== 'object' || Array.isArray(capabilities)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_CAPABILITIES', 'Capabilities must be a plain object', request.requestId))
        }
      }

      if (options !== undefined && options !== null) {
        if (typeof options !== 'object' || Array.isArray(options)) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_OPTIONS', 'Options must be a plain object', request.requestId))
        }
      }

      if (models !== undefined && models !== null) {
        if (!Array.isArray(models)) {
          return reply.code(400).send(envelopeError('INVALID_MODELS', 'Models must be an array', request.requestId))
        }
      }

      const updates: Record<string, unknown> = {}
      if (displayName !== undefined) updates.displayName = displayName.trim()
      if (apiKey !== undefined) updates.apiKey = apiKey
      if (baseUrl !== undefined) updates.baseUrl = baseUrl
      if (selectedModel !== undefined) updates.selectedModel = selectedModel
      if (enabled !== undefined) updates.enabled = enabled
      if (family !== undefined) updates.family = family
      if (protocol !== undefined) updates.protocol = protocol
      if (priority !== undefined) updates.priority = priority
      if (defaultModel !== undefined) updates.defaultModel = defaultModel
      if (headers !== undefined) updates.headers = headers
      if (capabilities !== undefined) updates.capabilities = capabilities
      if (options !== undefined) updates.options = options
      if (models !== undefined) updates.models = models

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send(envelopeError('NO_UPDATES', 'No valid fields to update', request.requestId))
      }

      try {
        const updated = providerConfigStore.update(providerId, updates)
        if (!updated) {
          return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to update provider', request.requestId))
        }

        const provider = providerConfigStore.getById(providerId)
        if (!provider) {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found after update', request.requestId))
        }
        context.refreshProvidersForUser(userId)

        const summary = sanitizeProviderForResponse(provider)
        return reply.code(200).send(success(summary, request.requestId))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update provider'
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId))
      }
    },
  )

  // DELETE /api/providers/:providerId - Delete a provider
  server.delete<{ Params: { providerId: string } }>(
    '/api/v1/providers/:providerId',
    {
      schema: {
        params: providerIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('provider' as ResourceType, Action.delete)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      if (!providerConfigStore) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
      }

      const { providerId } = request.params
      const existingProvider = providerConfigStore.getById(providerId)

      if (!existingProvider) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found', request.requestId))
      }

      if (existingProvider.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this provider', request.requestId))
      }

      try {
        const deleted = providerConfigStore.remove(providerId)
        if (!deleted) {
          return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to delete provider', request.requestId))
        }
        context.refreshProvidersForUser(userId)

        return reply.code(204).send()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete provider'
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId))
      }
    },
  )

  // POST /api/providers/:providerId/test - Test provider connection
  server.post<{ Params: { providerId: string } }>(
    '/api/v1/providers/:providerId/test',
    {
      schema: {
        params: providerIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('provider' as ResourceType, Action.execute)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { providerId } = request.params

      const envProviderResult = await testEnvProvider(providerId)
      if (envProviderResult) {
        const response: TestProviderResponse = {
          success: envProviderResult.success,
          latencyMs: envProviderResult.latencyMs,
          modelCount: envProviderResult.modelCount,
          error: envProviderResult.error,
        }
        return reply.code(200).send(success(response, request.requestId))
      }

      if (!providerConfigStore) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Provider configuration store not available', request.requestId))
      }

      const existingProvider = providerConfigStore.getById(providerId)

      if (!existingProvider) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider not found', request.requestId))
      }

      if (existingProvider.userId !== userId) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this provider', request.requestId))
      }

      const providerWithSecret = providerConfigStore.getByIdWithSecret(providerId)
      if (!providerWithSecret) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider configuration not found', request.requestId))
      }

      const testResult = await testProviderConnection(
        providerWithSecret.providerType,
        providerWithSecret.apiKey,
        providerWithSecret.baseUrl,
      )

      providerConfigStore.updateTestStatus(providerId, testResult.success ? 'success' : 'failed')

      const response: TestProviderResponse = {
        success: testResult.success,
        latencyMs: testResult.latencyMs,
        modelCount: testResult.modelCount,
        error: testResult.error,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
