import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomBytes, randomUUID } from 'crypto'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { ApiKeyRole } from '../../storage/api-key-store.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

const VALID_ROLES: ApiKeyRole[] = ['admin', 'user', 'service']
const KEY_BYTES = 32

function generateApiKey(): string {
  return `ak_${randomBytes(KEY_BYTES).toString('hex')}`
}

interface CreateApiKeyBody {
  name: string
  role: ApiKeyRole
  expiresAt?: string
}

interface ApiKeyListEntry {
  id: string
  name: string
  prefix: string
  role: string
  userId: string | null
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  isActive: boolean
}

interface CreateApiKeyResponse {
  id: string
  name: string
  key: string
  prefix: string
  role: string
  createdAt: string
}

export function registerApiKeyRoutes(server: FastifyInstance, context: ApiContext): void {
  const apiKeyStore = context.stores.apiKeyStore

  server.post<{ Body: CreateApiKeyBody }>(
    '/api/v1/api-keys',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'role'],
          properties: {
            name: { type: 'string', minLength: 1 },
            role: { type: 'string', enum: VALID_ROLES },
            expiresAt: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateApiKeyBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.apiKeys, Action.create)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { name, role, expiresAt } = request.body

      const rawKey = generateApiKey()
      const id = randomUUID()

      const created = apiKeyStore.createKey({
        id,
        name,
        key: rawKey,
        role,
        userId,
        expiresAt,
      })

      const response: CreateApiKeyResponse = {
        id: created.id,
        name: created.name,
        key: rawKey,
        prefix: created.keyPrefix,
        role: created.role,
        createdAt: created.createdAt,
      }

      return reply.code(201).send(success(response, request.requestId))
    },
  )

  server.get('/api/v1/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.apiKeys, Action.read)) {
      return reply
    }
    const userId = request.user?.userId
    if (!userId) {
      return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
    }

    const keys = apiKeyStore.listKeysByUser(userId)

    const list: ApiKeyListEntry[] = keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.keyPrefix,
      role: k.role,
      userId: k.userId,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      isActive: k.isActive,
    }))

    return reply.code(200).send(success(list, request.requestId))
  })

  server.delete<{ Params: { id: string } }>(
    '/api/v1/api-keys/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.apiKeys, Action.delete)) {
        return reply
      }
      const userId = request.user?.userId
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId))
      }

      const { id } = request.params

      const keys = apiKeyStore.listKeysByUser(userId)
      const targetKey = keys.find((k) => k.id === id)

      if (!targetKey) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'API key not found', request.requestId))
      }

      const revoked = apiKeyStore.revokeKey(id)
      if (!revoked) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to revoke API key', request.requestId))
      }

      return reply.code(200).send(success({ id, isActive: false }, request.requestId))
    },
  )
}
