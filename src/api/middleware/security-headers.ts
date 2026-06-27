import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import helmet from '@fastify/helmet'

/**
 * Security headers middleware.
 * Registers helmet with CSP disabled (conflicts with swagger-ui inline scripts),
 * then sets security headers manually. CSP is added only for /api/v1/docs path.
 *
 * NOTE: If CSP is enabled globally for the web frontend in the future, the
 * following AMap JSAPI domains must be allowlisted in the relevant directives:
 *   - script-src: 'self' https://webapi.amap.com https://*.amap.com
 *   - style-src:  'self' 'unsafe-inline' (AMap injects inline styles for map controls)
 *   - img-src:    'self' data: https://*.amap.com https://a.amap.com (map tiles)
 *   - connect-src: 'self' https://restapi.amap.com https://*.amap.com (API calls)
 *   - font-src:   'self' data: (AMap uses data: URIs for marker icons)
 * The AMap JSAPI loads scripts from webapi.amap.com, map tiles from a.amap.com,
 * and API requests go to restapi.amap.com. All *.amap.com subdomains should be
 * covered for resilience against AMap's internal domain shuffling.
 */
export async function registerSecurityHeaders(server: FastifyInstance): Promise<void> {
  await server.register(helmet, {
    contentSecurityPolicy: false,
  })

  server.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

    if (request.url.startsWith('/api/v1/docs')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;",
      )
    }
  })
}
