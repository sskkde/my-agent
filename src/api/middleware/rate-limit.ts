import type { FastifyInstance, FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'

export interface RateLimitMiddlewareOptions {
  /** Global max requests per timeWindow (default: 100) */
  globalMax?: number
  /** Auth endpoints max requests per timeWindow (default: 5) */
  authMax?: number
  /** Time window (default: '1 minute') */
  timeWindow?: string
}

const SSE_TIMELINE_STREAM = '/timeline/stream'
const SSE_RUNS_STREAM = '/api/runs/stream'
const SSE_RUNS_STREAM_V1 = '/api/v1/runs/stream'
const SSE_SESSIONS_PREFIX = '/api/sessions/'
const SSE_SESSIONS_PREFIX_V1 = '/api/v1/sessions/'

function isSseEndpoint(url: string): boolean {
  if (
    url === SSE_RUNS_STREAM ||
    url.startsWith(SSE_RUNS_STREAM) ||
    url === SSE_RUNS_STREAM_V1 ||
    url.startsWith(SSE_RUNS_STREAM_V1)
  ) {
    return true
  }
  if (
    (url.startsWith(SSE_SESSIONS_PREFIX) || url.startsWith(SSE_SESSIONS_PREFIX_V1)) &&
    url.includes(SSE_TIMELINE_STREAM)
  ) {
    return true
  }
  return false
}

function isAuthEndpoint(url: string): boolean {
  return url.startsWith('/api/v1/auth/login') || url.startsWith('/api/auth/login')
}

/**
 * Check if TRUST_PROXY is enabled.
 * When enabled, the rate limiter will use X-Forwarded-For header for client IP.
 */
function isTrustProxyEnabled(): boolean {
  const trustProxy = process.env.TRUST_PROXY
  if (!trustProxy) return false
  // Accept 'true', '1', 'yes' (case-insensitive) as truthy values
  const normalized = trustProxy.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

/**
 * Extract client IP for rate limiting.
 * - If TRUST_PROXY is set, use X-Forwarded-For header (first IP in chain)
 * - Otherwise, use the socket's remote address
 */
function getClientIp(request: FastifyRequest): string {
  if (isTrustProxyEnabled()) {
    const forwardedFor = request.headers['x-forwarded-for']
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      // X-Forwarded-For may contain multiple IPs: client, proxy1, proxy2, ...
      // The first IP is the original client
      const ips = forwardedFor.split(',').map((ip) => ip.trim())
      if (ips.length > 0 && ips[0].length > 0) {
        return ips[0]
      }
    }
  }
  // Fallback to socket remote address
  return request.ip || request.socket.remoteAddress || 'unknown'
}

/**
 * Register rate limiting middleware on a Fastify instance.
 *
 * Global limit: 100 requests/minute per IP.
 * Auth login endpoint: 5 requests/minute per IP.
 * SSE endpoints (/api/sessions/* /timeline/stream, /api/runs/stream): exempt.
 *
 * Production behavior:
 * - Localhost (127.0.0.1, ::1) is NOT exempt in production
 * - TRUST_PROXY env var enables X-Forwarded-For support for client IP detection
 */
export async function registerRateLimitMiddleware(
  server: FastifyInstance,
  options?: RateLimitMiddlewareOptions,
): Promise<void> {
  const globalMax = options?.globalMax ?? 100
  const authMax = options?.authMax ?? 5
  const timeWindow = options?.timeWindow ?? '1 minute'
  const isProduction = process.env.NODE_ENV === 'production'

  await server.register(rateLimit, {
    global: true,
    timeWindow,
    max: (request: FastifyRequest) => {
      if (isAuthEndpoint(request.url)) {
        return authMax
      }
      return globalMax
    },
    // Custom key generator for TRUST_PROXY support
    keyGenerator: (request: FastifyRequest) => getClientIp(request),
    allowList: (request: FastifyRequest, key: string | number) => {
      // SSE endpoints are always exempt
      if (isSseEndpoint(request.url)) {
        return true
      }
      // Localhost exemption only in non-production environments
      if (!isProduction) {
        if (key === '127.0.0.1' || key === '::1') {
          return true
        }
      }
      return false
    },
    errorResponseBuilder: (_request: FastifyRequest, context) => {
      const msg = `Rate limit exceeded. Max ${context.max} requests per ${context.after}.`
      const err = new Error(msg) as Error & { statusCode: number }
      err.statusCode = 429
      return err
    },
  })
}
