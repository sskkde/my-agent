import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import type { ApiKeyStore } from '../../storage/api-key-store.js';
import { envelopeError } from '../response-envelope.js';

export interface ApiKeyIdentity {
  id: string;
  role: string;
  userId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKeyIdentity;
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function authenticateApiKey(
  request: FastifyRequest,
  apiKeyStore: ApiKeyStore
): Promise<ApiKeyIdentity | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token.startsWith('ak_')) {
    return null;
  }

  const keyHash = hashKey(token);
  const apiKey = apiKeyStore.getKeyByHash(keyHash);

  if (!apiKey) {
    return null;
  }

  if (!apiKey.isActive) {
    return null;
  }

  if (apiKey.expiresAt && new Date(apiKey.expiresAt) <= new Date()) {
    return null;
  }

  apiKeyStore.updateLastUsed(keyHash);

  return {
    id: apiKey.id,
    role: apiKey.role,
    userId: apiKey.userId,
  };
}

export function registerApiKeyAuth(
  server: FastifyInstance,
  apiKeyStore: ApiKeyStore
): void {
  server.addHook('preHandler', (request: FastifyRequest, reply: FastifyReply, done) => {
    if (request.user) {
      done();
      return;
    }

    if (!request.headers.authorization) {
      done();
      return;
    }

    authenticateApiKey(request, apiKeyStore)
      .then(identity => {
        if (identity) {
          request.apiKey = identity;
          request.user = {
            userId: identity.userId ?? identity.id,
            username: `api-key:${identity.id}`,
            role: identity.role as import('../../storage/user-store.js').UserRole,
          };
          done();
          return;
        }

        // If Authorization header starts with "Bearer ak_", it was an API key attempt
        // that failed validation - return 401 instead of letting RBAC return 403
        const authHeader = request.headers.authorization;
        if (authHeader.startsWith('Bearer ak_')) {
          reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid or expired API key'));
          return;
        }

        done();
      })
      .catch(done);
  });
}
