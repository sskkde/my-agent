import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { providerIdParamsSchema } from '../schemas/shared.js'
import type { ProviderSummary, CreateProviderRequest, UpdateProviderRequest, TestProviderResponse } from '../types.js'
import type { ProviderType, ProviderConfigSanitized } from '../../storage/provider-config-store.js'
import { randomUUID } from 'crypto'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import { isKnownProviderType, getProviderCatalogEntry } from '../../llm/catalog/provider-catalog.js'
import {
  fetchRemoteProviderModels,
  type RemoteModelsResult,
} from '../../llm/remote-models.js'

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

async function testEnvProvider(providerId: string): Promise<RemoteModelsResult | null> {
  switch (providerId) {
    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, models: [], error: 'OPENROUTER_API_KEY not configured' }
      }
      return fetchRemoteProviderModels({ providerType: 'openrouter', apiKey, baseUrl: null })
    }
    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL
      if (!baseUrl) {
        return { success: false, latencyMs: 0, models: [], error: 'OLLAMA_BASE_URL not configured' }
      }
      return fetchRemoteProviderModels({ providerType: 'ollama', apiKey: null, baseUrl })
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, models: [], error: 'OPENAI_API_KEY not configured' }
      }
      return fetchRemoteProviderModels({ providerType: 'openai', apiKey, baseUrl: null })
    }
    case 'deepseek': {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) {
        return { success: false, latencyMs: 0, models: [], error: 'DEEPSEEK_API_KEY not configured' }
      }
      return fetchRemoteProviderModels({
        providerType: 'deepseek',
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? null,
      })
    }
    default:
      return null
  }
}

async function testProviderConnection(
  providerType: ProviderType,
  apiKey: string | null,
  baseUrl: string | null,
): Promise<RemoteModelsResult> {
  const result = await fetchRemoteProviderModels({ providerType, apiKey, baseUrl })
  if (providerType === 'iflytek-spark' && result.error?.includes('Authentication failed')) {
    result.error = 'Authentication failed: Please enter your APIPassword in the API key field'
  }
  return result
}

function buildDiscoveredModels(models: string[]): Record<string, unknown>[] {
  return models.map((modelId) => ({
    modelId,
    capabilities: { functionCalling: true, streaming: true },
  }))
}

function persistDiscoveredModels(
  providerConfigStore: NonNullable<ApiContext['providerConfigStore']>,
  providerId: string,
  existingProvider: ProviderConfigSanitized,
  discovered: string[],
): void {
  providerConfigStore.update(providerId, { models: buildDiscoveredModels(discovered) })
  const currentSelected = existingProvider.selectedModel
  if ((!currentSelected || currentSelected.trim().length === 0) && discovered.length > 0) {
    providerConfigStore.update(providerId, { selectedModel: discovered[0] })
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

  // POST /api/providers/probe-models - Probe models for a providerType using body credentials (NO DB write)
  server.post<{
    Body: { providerType: string; apiKey?: string; baseUrl?: string }
  }>(
    '/api/v1/providers/probe-models',
    {
      schema: {
        body: {
          type: 'object',
          required: ['providerType'],
          properties: {
            providerType: { type: 'string', minLength: 1 },
            apiKey: { type: 'string' },
            baseUrl: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { providerType: string; apiKey?: string; baseUrl?: string }
      }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission('provider' as ResourceType, Action.execute)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { providerType, apiKey, baseUrl } = request.body || {}

      if (!validateProviderType(providerType)) {
        return reply
          .code(400)
          .send(envelopeError('INVALID_PROVIDER_TYPE', `Invalid provider type: ${providerType}`, request.requestId))
      }

      const result = await fetchRemoteProviderModels({
        providerType,
        apiKey: apiKey ?? null,
        baseUrl: baseUrl ?? null,
      })

      const response: TestProviderResponse = {
        success: result.success,
        latencyMs: result.latencyMs,
        modelCount: result.modelCount,
        models: result.models,
        error: result.error,
      }

      return reply.code(200).send(success(response, request.requestId))
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
          models: envProviderResult.models,
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

      if (testResult.success && testResult.models.length > 0) {
        persistDiscoveredModels(providerConfigStore, providerId, existingProvider, testResult.models)
        context.refreshProvidersForUser(userId)
      }

      const response: TestProviderResponse = {
        success: testResult.success,
        latencyMs: testResult.latencyMs,
        modelCount: testResult.modelCount,
        models: testResult.models,
        error: testResult.error,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )

  // POST /api/providers/:providerId/models/refresh - Refresh models using stored secrets (persists)
  server.post<{ Params: { providerId: string } }>(
    '/api/v1/providers/:providerId/models/refresh',
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

      const providerWithSecret = providerConfigStore.getByIdWithSecret(providerId)
      if (!providerWithSecret) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Provider configuration not found', request.requestId))
      }

      const result = await fetchRemoteProviderModels({
        providerType: providerWithSecret.providerType,
        apiKey: providerWithSecret.apiKey,
        baseUrl: providerWithSecret.baseUrl,
      })

      providerConfigStore.updateTestStatus(providerId, result.success ? 'success' : 'failed')

      if (result.success && result.models.length > 0) {
        persistDiscoveredModels(providerConfigStore, providerId, existingProvider, result.models)
        context.refreshProvidersForUser(userId)
      }

      const response: TestProviderResponse = {
        success: result.success,
        latencyMs: result.latencyMs,
        modelCount: result.modelCount,
        models: result.models,
        error: result.error,
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
