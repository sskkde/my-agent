import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import helmet from '@fastify/helmet'

/**
 * Security headers middleware.
 * Registers helmet with CSP disabled (conflicts with swagger-ui inline scripts),
 * then sets security headers manually. CSP is added only for /api/v1/docs path.
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
