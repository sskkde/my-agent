import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

export interface RateLimitMiddlewareOptions {
  /** Global max requests per timeWindow (default: 100) */
  globalMax?: number;
  /** Auth endpoints max requests per timeWindow (default: 5) */
  authMax?: number;
  /** Time window (default: '1 minute') */
  timeWindow?: string;
}

const SSE_TIMELINE_STREAM = '/timeline/stream';
const SSE_RUNS_STREAM = '/api/runs/stream';
const SSE_SESSIONS_PREFIX = '/api/sessions/';

function isSseEndpoint(url: string): boolean {
  if (url === SSE_RUNS_STREAM || url.startsWith(SSE_RUNS_STREAM)) {
    return true;
  }
  return url.startsWith(SSE_SESSIONS_PREFIX) && url.includes(SSE_TIMELINE_STREAM);
}

function isAuthEndpoint(url: string): boolean {
  return url.startsWith('/api/auth/login');
}

/**
 * Register rate limiting middleware on a Fastify instance.
 *
 * Global limit: 100 requests/minute per IP.
 * Auth login endpoint: 5 requests/minute per IP.
 * SSE endpoints (/api/sessions/* /timeline/stream, /api/runs/stream): exempt.
 */
export async function registerRateLimitMiddleware(
  server: FastifyInstance,
  options?: RateLimitMiddlewareOptions,
): Promise<void> {
  const globalMax = options?.globalMax ?? 100;
  const authMax = options?.authMax ?? 5;
  const timeWindow = options?.timeWindow ?? '1 minute';

  await server.register(rateLimit, {
    global: true,
    timeWindow,
    max: (request: FastifyRequest) => {
      if (isAuthEndpoint(request.url)) {
        return authMax;
      }
      return globalMax;
    },
    allowList: (request: FastifyRequest, key: string | number) => {
      if (isSseEndpoint(request.url)) {
        return true;
      }
      if (key === '127.0.0.1' || key === '::1') {
        return true;
      }
      return false;
    },
    errorResponseBuilder: (_request: FastifyRequest, context) => {
      const msg = `Rate limit exceeded. Max ${context.max} requests per ${context.after}.`;
      const err = new Error(msg) as Error & { statusCode: number };
      err.statusCode = 429;
      return err;
    },
  });
}
