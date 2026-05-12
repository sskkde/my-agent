import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

/**
 * Generate a short, human-friendly request ID.
 * Uses first 8 chars of UUID + timestamp suffix for readability
 * while maintaining global uniqueness.
 */
function generateRequestId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Register request-id middleware on a Fastify instance.
 * - Reads `x-request-id` from the incoming request header if present
 * - Generates a new UUID-based ID otherwise
 * - Sets `x-request-id` on the response header
 * - Makes `request.requestId` available in route handlers
 */
export function registerRequestIdMiddleware(server: FastifyInstance): void {
  server.decorateRequest('requestId', '');

  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientId = request.headers['x-request-id'];
    const requestId = typeof clientId === 'string' && clientId.length > 0
      ? clientId
      : generateRequestId();

    request.requestId = requestId;
    reply.header('x-request-id', requestId);
  });
}
