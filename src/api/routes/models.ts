import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { ModelsResponse, ProviderSummary } from '../types.js'
import type { ProviderConfigSanitized } from '../../storage/provider-config-store.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

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
  }
}

export function registerModelsRoutes(server: FastifyInstance, context: ApiContext): void {
  const providerConfigStore = context.providerConfigStore
  const sessionStore = context.stores.sessionStore

  server.get<{ Querystring: { sessionId?: string } }>(
    '/api/v1/models',
    async (request: FastifyRequest<{ Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('provider' as ResourceType, Action.read)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { sessionId } = request.query

      const providers: ProviderSummary[] = []

      if (process.env.OPENROUTER_API_KEY) {
        providers.push({
          providerId: 'openrouter',
          providerType: 'openrouter',
          displayName: 'OpenRouter (Env)',
          enabled: true,
          configured: true,
          apiKeyLast4: null,
          baseUrl: null,
          selectedModel: null,
          source: 'env',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      if (process.env.OLLAMA_BASE_URL) {
        providers.push({
          providerId: 'ollama',
          providerType: 'ollama',
          displayName: 'Ollama (Env)',
          enabled: true,
          configured: true,
          apiKeyLast4: null,
          baseUrl: process.env.OLLAMA_BASE_URL,
          selectedModel: null,
          source: 'env',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      if (process.env.OPENAI_API_KEY) {
        providers.push({
          providerId: 'openai',
          providerType: 'openai',
          displayName: 'OpenAI (Env)',
          enabled: true,
          configured: true,
          apiKeyLast4: null,
          baseUrl: null,
          selectedModel: null,
          source: 'env',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      if (process.env.DEEPSEEK_API_KEY) {
        providers.push({
          providerId: 'deepseek',
          providerType: 'deepseek',
          displayName: 'DeepSeek (Env)',
          enabled: true,
          configured: true,
          apiKeyLast4: null,
          baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
          selectedModel: 'deepseek-v4-flash',
          source: 'env',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }

      if (providerConfigStore) {
        const userProviders = providerConfigStore.listByUser(userId)
        for (const provider of userProviders) {
          providers.push(sanitizeProviderForResponse(provider))
        }
      }

      const response: ModelsResponse = {
        providers,
      }

      if (sessionId && sessionStore) {
        const session = sessionStore.getById(sessionId)
        if (session && session.userId === userId) {
          response.selectedModel = session.selectedModel
          response.selectedProviderId = session.selectedProviderId
        }
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
