import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { SubagentProviderPreference } from '../../storage/subagent-provider-preference-store.js'
import type { SubagentDefinition } from '../../subagents/registry.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

const VALID_FALLBACK_MODES: SubagentProviderPreference['fallbackMode'][] = ['none', 'same_provider', 'any_compatible']

interface SubagentSummary {
  agentType: string
  displayName: string
  description: string
  modality: string
  providerPolicy: {
    defaultProviderId?: string
    defaultModel?: string
    allowedProviderIds?: string[]
    allowedModelIds?: string[]
    requiredCapabilities?: string[]
    fallbackMode: string
  }
}

interface SetPreferenceRequest {
  providerId?: string | null
  model?: string | null
  fallbackMode?: 'none' | 'same_provider' | 'any_compatible'
}

function toSubagentSummary(def: SubagentDefinition): SubagentSummary {
  return {
    agentType: def.agentType,
    displayName: def.displayName,
    description: def.description,
    modality: def.modality,
    providerPolicy: {
      defaultProviderId: def.providerPolicy.defaultProviderId,
      defaultModel: def.providerPolicy.defaultModel,
      allowedProviderIds: def.providerPolicy.allowedProviderIds,
      allowedModelIds: def.providerPolicy.allowedModelIds,
      requiredCapabilities: def.providerPolicy.requiredCapabilities,
      fallbackMode: def.providerPolicy.fallbackMode,
    },
  }
}

function validatePreferenceInput(
  input: SetPreferenceRequest,
  providerConfigStore: ApiContext['providerConfigStore'],
  userId: string,
  definition: SubagentDefinition,
): { valid: boolean; error?: { code: string; message: string } } {
  if (input.providerId !== undefined && input.providerId !== null) {
    if (typeof input.providerId !== 'string' || input.providerId.trim().length === 0) {
      return {
        valid: false,
        error: { code: 'INVALID_PROVIDER_ID', message: 'Provider ID must be a non-empty string' },
      }
    }
    const provider = providerConfigStore.getById(input.providerId)
    if (!provider) {
      return {
        valid: false,
        error: { code: 'INVALID_PROVIDER_ID', message: 'Provider not found' },
      }
    }
    if (provider.userId !== userId) {
      return {
        valid: false,
        error: { code: 'PROVIDER_ACCESS_DENIED', message: 'Provider does not belong to the current user' },
      }
    }

    const policy = definition.providerPolicy
    if (policy.allowedProviderIds && policy.allowedProviderIds.length > 0) {
      if (!policy.allowedProviderIds.includes(input.providerId)) {
        return {
          valid: false,
          error: {
            code: 'PROVIDER_NOT_ALLOWED',
            message: 'Provider is not in the allowed list for this subagent type',
          },
        }
      }
    }
  }

  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'string' || input.model.trim().length === 0) {
      return {
        valid: false,
        error: { code: 'INVALID_MODEL', message: 'Model must be a non-empty string' },
      }
    }

    const policy = definition.providerPolicy
    if (policy.allowedModelIds && policy.allowedModelIds.length > 0) {
      if (!policy.allowedModelIds.includes(input.model)) {
        return {
          valid: false,
          error: {
            code: 'MODEL_NOT_ALLOWED',
            message: 'Model is not in the allowed list for this subagent type',
          },
        }
      }
    }
  }

  if (input.fallbackMode !== undefined) {
    if (!VALID_FALLBACK_MODES.includes(input.fallbackMode)) {
      return {
        valid: false,
        error: {
          code: 'INVALID_FALLBACK_MODE',
          message: `Fallback mode must be one of: ${VALID_FALLBACK_MODES.join(', ')}`,
        },
      }
    }
  }

  return { valid: true }
}

export function registerSubagentRoutes(server: FastifyInstance, context: ApiContext): void {
  const { subagentRegistry, subagentProviderPreferenceStore, providerConfigStore } = context

  // GET /api/v1/subagents — list all registered subagent definitions
  server.get('/api/v1/subagents', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply
    }
    const userId = request.user?.userId
    if (!userId) {
      return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
    }

    const definitions = subagentRegistry.list()
    const summaries = definitions.map(toSubagentSummary)

    return reply.code(200).send(success(summaries, request.requestId))
  })

  // GET /api/v1/subagents/:agentType — get a single subagent definition
  server.get<{ Params: { agentType: string } }>(
    '/api/v1/subagents/:agentType',
    async (request: FastifyRequest<{ Params: { agentType: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.read)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { agentType } = request.params
      const definition = subagentRegistry.get(agentType)

      if (!definition) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', `Subagent type "${agentType}" not found`, request.requestId))
      }

      return reply.code(200).send(success(toSubagentSummary(definition), request.requestId))
    },
  )

  // GET /api/v1/subagents/:agentType/preference — get user's provider preference
  server.get<{ Params: { agentType: string } }>(
    '/api/v1/subagents/:agentType/preference',
    async (request: FastifyRequest<{ Params: { agentType: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.read)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { agentType } = request.params
      const definition = subagentRegistry.get(agentType)
      if (!definition) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', `Subagent type "${agentType}" not found`, request.requestId))
      }

      const preference = subagentProviderPreferenceStore.get(userId, agentType)

      return reply.code(200).send(
        success(
          {
            agentType,
            preference: preference ?? null,
            providerPolicy: definition.providerPolicy,
          },
          request.requestId,
        ),
      )
    },
  )

  // PUT /api/v1/subagents/:agentType/preference — set user's provider preference
  server.put<{ Params: { agentType: string }; Body: SetPreferenceRequest }>(
    '/api/v1/subagents/:agentType/preference',
    async (
      request: FastifyRequest<{ Params: { agentType: string }; Body: SetPreferenceRequest }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.settings, Action.update)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { agentType } = request.params
      const definition = subagentRegistry.get(agentType)
      if (!definition) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', `Subagent type "${agentType}" not found`, request.requestId))
      }

      const body = request.body ?? {}
      const validation = validatePreferenceInput(body, providerConfigStore, userId, definition)
      if (!validation.valid) {
        return reply.code(400).send(envelopeError(validation.error!.code, validation.error!.message, request.requestId))
      }

      const fallbackMode = body.fallbackMode ?? definition.providerPolicy.fallbackMode

      const preference: SubagentProviderPreference = {
        providerId: body.providerId ?? undefined,
        model: body.model ?? undefined,
        fallbackMode,
      }

      try {
        subagentProviderPreferenceStore.set(userId, agentType, preference)
        const saved = subagentProviderPreferenceStore.get(userId, agentType)

        return reply.code(200).send(
          success(
            {
              agentType,
              preference: saved,
              providerPolicy: definition.providerPolicy,
            },
            request.requestId,
          ),
        )
      } catch (error) {
        // SECURITY: Log error internally but never expose details to client
        console.error('Failed to set subagent preference:', error)
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to set preference', request.requestId))
      }
    },
  )

  // DELETE /api/v1/subagents/:agentType/preference — reset user's provider preference
  server.delete<{ Params: { agentType: string } }>(
    '/api/v1/subagents/:agentType/preference',
    async (request: FastifyRequest<{ Params: { agentType: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.delete)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { agentType } = request.params
      const definition = subagentRegistry.get(agentType)
      if (!definition) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', `Subagent type "${agentType}" not found`, request.requestId))
      }

      try {
        subagentProviderPreferenceStore.delete(userId, agentType)
        return reply.code(204).send()
      } catch (error) {
        // SECURITY: Log error internally but never expose details to client
        console.error('Failed to delete subagent preference:', error)
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to delete preference', request.requestId))
      }
    },
  )
}
