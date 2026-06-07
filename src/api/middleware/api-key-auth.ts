import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'crypto'
import type { ApiKeyStore } from '../../storage/api-key-store.js'
import { DEFAULT_TENANT_ID } from '../../tenancy/tenant-context.js'
import { envelopeError } from '../response-envelope.js'

export interface ApiKeyIdentity {
  id: string
  role: string
  userId: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyIdentity
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function authenticateApiKey(
  request: FastifyRequest,
  apiKeyStore: ApiKeyStore,
): Promise<ApiKeyIdentity | null> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.slice(7)
  if (!token.startsWith('ak_')) {
    return null
  }

  const keyHash = hashKey(token)
  const apiKey = apiKeyStore.getKeyByHash(keyHash)

  if (!apiKey) {
    return null
  }

  if (!apiKey.isActive) {
    return null
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) <= new Date()) {
    return null
  }

  apiKeyStore.updateLastUsed(keyHash)

  return {
    id: apiKey.id,
    role: apiKey.role,
    userId: apiKey.userId,
  }
}

export function registerApiKeyAuth(server: FastifyInstance, apiKeyStore: ApiKeyStore): void {
  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip if already authenticated or response already sent
    if (request.user || reply.sent) {
      return
    }

    const authHeader = request.headers.authorization
    if (!authHeader) {
      return
    }

    const identity = await authenticateApiKey(request, apiKeyStore)
    if (identity) {
      request.apiKey = identity
      request.user = {
        userId: identity.userId ?? identity.id,
        username: `api-key:${identity.id}`,
        role: identity.role as import('../../storage/user-store.js').UserRole,
        tenantId: DEFAULT_TENANT_ID,
      }
      return
    }

    // Bearer token present but no auth middleware recognized it.
    // Return 401 instead of letting RBAC return 403.
    // Covers: invalid ak_ key, malformed token, non-ak_ token without API_AUTH_TOKEN.
    if (authHeader.startsWith('Bearer ')) {
      request.headers = { ...request.headers, 'x-no-compression': 'true' }
      return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid or unrecognized Bearer token'))
    }
  })
}
