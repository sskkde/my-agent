import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { envelopeError } from '../response-envelope.js';

export interface AuthTokenOptions {
  token?: string;
  enabled?: boolean;
  exemptPaths?: string[];
}

const DEFAULT_EXEMPT_PATHS = [
  '/api/v1/health',
  '/api/v1/health/ready',
  '/api/v1/docs',
  '/api/v1/docs/json',
  '/api/v1/setup/status',
  '/api/v1/setup/user',
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/tools',
  '/api/v1/webhooks/*',
];

export function isAuthRequired(options: AuthTokenOptions): boolean {
  const token = options.token ?? process.env.API_AUTH_TOKEN;
  return options.enabled ?? Boolean(token);
}

function isPathExempt(path: string, exemptPaths: string[]): boolean {
  return exemptPaths.some(exemptPath => {
    if (exemptPath.endsWith('*')) {
      return path.startsWith(exemptPath.slice(0, -1));
    }
    return path === exemptPath;
  });
}

export async function registerAuthToken(
  app: FastifyInstance,
  options: AuthTokenOptions = {}
): Promise<void> {
  const token = options.token ?? process.env.API_AUTH_TOKEN;
  const enabled = options.enabled ?? Boolean(token);

  if (!enabled) {
    return;
  }

  const exemptPaths = options.exemptPaths ?? DEFAULT_EXEMPT_PATHS;

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPathExempt(request.url, exemptPaths)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send(
        envelopeError('UNAUTHORIZED', 'Missing or invalid Authorization header', request.requestId)
      );
    }

    const providedToken = authHeader.slice(7);
    if (providedToken !== token) {
      return reply.code(401).send(
        envelopeError('UNAUTHORIZED', 'Invalid API token', request.requestId)
      );
    }
  });
}
