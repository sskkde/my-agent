import '../config/load-env.js'
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { envelopeError } from './response-envelope.js'
import type { HealthResponse } from './types.js'
import { registerSessionsRoutes } from './routes/sessions.js'
import { registerStatusRoutes } from './routes/status.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerUsageRoutes } from './routes/usage.js'
import { registerLogRoutes } from './routes/logs.js'
import { registerDebugRoutes } from './routes/debug.js'
import { registerInstanceRoutes } from './routes/instances.js'
import { registerChannelRoutes } from './routes/channels.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerSetupRoutes } from './routes/setup.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerProviderRoutes } from './routes/providers.js'
import { registerModelsRoutes } from './routes/models.js'
import { registerToolsRoutes } from './routes/tools.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerWorkflowRoutes } from './routes/workflows.js'
import { registerToolResultsRoutes } from './routes/tool-results.js'
import { registerTriggerRoutes } from './routes/triggers.js'
import { registerConnectorRoutes } from './routes/connectors.js'
import { registerFileRoutes } from './routes/files.js'
import { registerPlannerRunRoutes } from './routes/planner-runs.js'
import { registerObservabilityRoutes } from './routes/observability.js'
import { registerApiKeyRoutes } from './routes/api-keys.js'
import { registerOrganizationRoutes } from './routes/organizations.js'
import { registerOAuthRoutes } from './routes/oauth.js'
import { registerDlqRoutes } from './routes/dlq.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerSubagentRoutes } from './routes/subagents.js'
import { registerTodoRoutes } from './routes/todos.js'
import { registerApiKeyAuth } from './middleware/api-key-auth.js'
import { registerAuthMiddleware } from './middleware/auth.js'
import { registerAuthToken } from './middleware/auth-token.js'
import { registerRequestIdMiddleware } from './middleware/request-id.js'
import { registerRateLimitMiddleware } from './middleware/rate-limit.js'
import { registerRbacMiddleware } from './middleware/rbac.js'
import { registerSecurityHeaders } from './middleware/security-headers.js'
import { registerTenantResolution } from '../tenancy/tenant-resolution.js'
import { getCorsOrigin } from './middleware/cors-production.js'
import { createApiContext, type ApiContext } from './context.js'
import { createLegacyRedirect, LEGACY_ROUTE_DEFINITIONS } from './v1-prefix.js'
import { checkProductionConfig } from '../config/production-guard.js'
import { getUploadConfig } from '../config/upload-config.js'
import { createModelInputRedactor } from '../kernel/model-input/model-input-redactor.js'

const errorLogRedactor = createModelInputRedactor()

function redactErrorForLog(
  error: Error & { statusCode?: number; validation?: Array<{ message: string }> },
): Record<string, unknown> {
  return errorLogRedactor.redact({
    name: error.name,
    message: error.message,
    stack: error.stack,
    statusCode: error.statusCode,
    validation: error.validation,
    cause: error.cause,
  }) as Record<string, unknown>
}

function redactClientErrorMessage(message: string): string {
  return errorLogRedactor.redact(message)
}

export async function createApiServer(context?: ApiContext): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true,
  })

  await server.register(cors, getCorsOrigin())

  await server.register(compress, { global: true, threshold: 0 })

  const uploadConfig = getUploadConfig()
  await server.register(multipart, {
    limits: {
      fileSize: uploadConfig.maxFileSizeBytes,
      files: uploadConfig.maxAttachmentsPerMessage,
    },
  })

  if (context?.webSearchBrowserProvider) {
    server.addHook('onClose', async () => {
      await context.webSearchBrowserProvider?.closeBrowser()
    })
  }

  await registerSecurityHeaders(server)

  // Register Swagger/OpenAPI documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Agent Platform API',
        description:
          'Agent Platform Product Experience API - A multi-agent platform for task orchestration and execution with LLM providers, background task processing, workflows, triggers, and connectors.',
        version: '0.8.0-ga-candidate',
      },
      servers: [
        { url: 'http://localhost:3003', description: 'Development' },
        { url: 'http://localhost:3103', description: 'E2E Testing' },
      ],
      components: {
        securitySchemes: {
          cookieSession: {
            type: 'apiKey',
            in: 'cookie',
            name: 'agent-platform-session',
            description: 'Session cookie set after login',
          },
        },
      },
    },
  })

  await server.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })

  registerRequestIdMiddleware(server)

  if (context) {
    await registerRateLimitMiddleware(server)
    registerSetupRoutes(server, context)
    registerAuthRoutes(server, context)

    registerAuthMiddleware(server, {
      userStore: context.stores.userStore,
      authTokenStore: context.stores.authTokenStore,
      excludedPaths: [
        '/api/health',
        '/api/health/ready',
        '/api/docs',
        '/api/docs/json',
        '/api/setup/status',
        '/api/setup/user',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/tools',
        '/api/webhooks/*',
        '/api/metrics',
        '/api/v1/health',
        '/api/v1/health/ready',
        '/api/v1/docs',
        '/api/v1/docs/json',
        '/api/v1/setup/status',
        '/api/v1/setup/user',
        '/api/v1/setup/readiness',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/tools',
        '/api/v1/webhooks/*',
        '/api/v1/metrics',
      ],
    })

    await registerAuthToken(server, { token: process.env.API_AUTH_TOKEN })

    registerApiKeyAuth(server, context.stores.apiKeyStore)

    // Register RBAC middleware after auth and api-key-auth
    await registerRbacMiddleware(server)

    registerTenantResolution(server, { organizationStore: context.stores.organizationStore })

    await registerSessionsRoutes(server, context)
    registerStatusRoutes(server, context)
    registerApprovalRoutes(server, context)
    registerRunRoutes(server, context)
    registerUsageRoutes(server, context)
    registerLogRoutes(server, context)
    registerDebugRoutes(server, context)
    registerInstanceRoutes(server, context)
    registerChannelRoutes(server, context)
    registerSkillRoutes(server, context)
    registerSettingsRoutes(server, context)
    registerProviderRoutes(server, context)
    registerModelsRoutes(server, context)
    registerToolsRoutes(server, context)
    registerAgentRoutes(server, context)
    registerMemoryRoutes(server, context)
    registerWorkflowRoutes(server, context)
    registerToolResultsRoutes(server, context)
    registerTriggerRoutes(server, context)
    registerConnectorRoutes(server, context)
    registerFileRoutes(server, context)
    registerPlannerRunRoutes(server, context)
    registerObservabilityRoutes(server, context)
    registerApiKeyRoutes(server, context)
    registerOrganizationRoutes(server, context)
    registerOAuthRoutes(server, context)
    registerDlqRoutes(server, context)
    registerAdminRoutes(server, context)
    registerSubagentRoutes(server, context)
    registerTodoRoutes(server, context)

    // Register legacy redirects for all old /api/ paths → /api/v1/ from the shared route inventory.
    for (const route of LEGACY_ROUTE_DEFINITIONS) {
      for (const method of route.methods) {
        server.route(createLegacyRedirect(route.legacyPath, route.path, method))
      }
    }
  } else {
    server.get('/api/v1/health', async (): Promise<HealthResponse> => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: {},
      }
    })
  }

  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (request, body, done) {
    try {
      if (!body || (body as string).trim() === '') {
        request.body = {}
        done(null, {})
        return
      }
      const json = JSON.parse(body as string)
      request.body = json
      done(null, json)
    } catch (err) {
      const error = new Error('Invalid JSON in request body') as Error & { statusCode?: number }
      error.statusCode = 400
      done(error, undefined)
    }
  })

  server.setErrorHandler(
    async (
      error: Error & { statusCode?: number; validation?: Array<{ message: string }> },
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const errorStatusCode = error.statusCode
      const errorMsg = error.message || String(error)
      if (errorStatusCode === 429) {
        return reply
          .code(429)
          .send(envelopeError('RATE_LIMIT_EXCEEDED', redactClientErrorMessage(errorMsg), request.requestId))
      }
      if (error.validation && error.validation.length > 0) {
        const messages = error.validation.map((e) => redactClientErrorMessage(e.message)).join('; ')
        return reply.code(400).send(envelopeError('VALIDATION_ERROR', messages, request.requestId))
      }
      if (
        errorStatusCode === 400 ||
        errorMsg.includes('Invalid JSON') ||
        errorMsg.includes('Unexpected token') ||
        errorMsg.includes('JSON')
      ) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid JSON in request body', request.requestId))
      }

      request.log.error(
        {
          error: redactErrorForLog(error),
          requestId: request.requestId,
          method: request.method,
          url: request.url,
        },
        'Unhandled API error',
      )
      return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Internal server error', request.requestId))
    },
  )

  server.setNotFoundHandler(async (request, reply) => {
    return reply
      .code(404)
      .send(envelopeError('NOT_FOUND', `Route ${request.method} ${request.url} not found`, request.requestId))
  })

  return server
}

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === decodeURI(`file://${process.argv[1]}`) ||
  process.argv[1]?.endsWith('/server.ts')

if (isMainModule) {
  const start = async () => {
    try {
      const productionGuard = checkProductionConfig()
      if (!productionGuard.ok) {
        console.error('Production configuration check FAILED:')
        for (const err of productionGuard.errors) {
          console.error(`  - ${err}`)
        }
        process.exit(1)
      }

      const dbPath = process.env.DATABASE_PATH || './data/agent-platform.db'
      const contextResult = createApiContext({ dbPath })
      if ('code' in contextResult) {
        console.error('Failed to create API context:', contextResult)
        process.exit(1)
      }
      const server = await createApiServer(contextResult)
      const { port, host } = resolveListenOptions()
      await server.listen({ port, host })
      console.log(`API server listening on http://${host}:${port}`)
    } catch (err) {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
  }
  start()
}

/**
 * Resolve API listen options from environment.
 * - Default port: 3003
 * - Default host: localhost (always, regardless of NODE_ENV)
 * - HOST env var explicitly overrides the default host.
 *   Production public ingress requires explicit HOST=0.0.0.0.
 * - PORT must be a valid integer in Node.js listen range (0-65535).
 *   Port 0 is allowed for dynamic port assignment (used by tests).
 */
export function resolveListenOptions(env: Record<string, string | undefined> = process.env): {
  port: number
  host: string
} {
  const portStr = env.PORT ?? '3003'

  // Strict validation: only pure decimal digit strings are accepted.
  // This rejects empty strings, partial numerics (123abc), decimals (3003.5),
  // negatives (-1), and non-numeric values (abc).
  if (!/^\d+$/.test(portStr)) {
    throw new Error(`Invalid PORT "${portStr}": must be an integer between 0 and 65535`)
  }

  const port = Number(portStr)
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${portStr}": must be an integer between 0 and 65535`)
  }

  // Default host is always localhost; production public ingress requires explicit HOST=0.0.0.0
  const host = env.HOST ?? 'localhost'
  return { port, host }
}

export { FastifyInstance }
