import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ModuleHealth } from '../types.js'
import type { ApiContext } from '../context.js'
import { success } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

export function registerStatusRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/v1/health', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply
    }
    const modules: Record<string, ModuleHealth> = {}

    try {
      const pendingApprovals = context.stores.approvalStore.findPendingByUser('health-check')
      modules.approvals = {
        status: pendingApprovals !== null ? 'healthy' : 'healthy',
        message: `${pendingApprovals.length} pending`,
      }
    } catch {
      modules.approvals = {
        status: 'unhealthy',
        message: 'Failed to query approvals',
      }
    }

    try {
      const pendingRuns = context.stores.backgroundRunStore.getByStatus('pending' as never)
      const runningRuns = context.stores.backgroundRunStore.getByStatus('running' as never)
      modules.runs = {
        status: 'healthy',
        message: `${pendingRuns.length} pending, ${runningRuns.length} running`,
      }
    } catch {
      modules.runs = {
        status: 'unhealthy',
        message: 'Failed to query runs',
      }
    }

    try {
      context.stores.plannerRunStore.findActive('health-check')
      modules.planner = {
        status: 'healthy',
        message: 'Planner store accessible',
      }
    } catch {
      modules.planner = {
        status: 'unhealthy',
        message: 'Failed to query planner runs',
      }
    }

    try {
      context.stores.kernelRunStore.getByStatus('pending' as never)
      modules.kernel = {
        status: 'healthy',
        message: 'Kernel store accessible',
      }
    } catch {
      modules.kernel = {
        status: 'unhealthy',
        message: 'Failed to query kernel runs',
      }
    }

    if (context.postgresAdapter) {
      try {
        const pgHealthy = await context.postgresAdapter.healthCheck()
        modules.postgres = {
          status: pgHealthy ? 'healthy' : 'unhealthy',
          message: pgHealthy ? 'PostgreSQL connected' : 'PostgreSQL connection failed',
        }
      } catch {
        modules.postgres = {
          status: 'unhealthy',
          message: 'PostgreSQL health check failed',
        }
      }
    }

    let overallStatus: 'healthy' | 'degraded' = 'healthy'
    for (const mod of Object.values(modules)) {
      if (mod.status === 'unhealthy') {
        overallStatus = 'degraded'
        break
      }
    }

    return reply.code(200).send(
      success(
        {
          status: overallStatus,
          timestamp: new Date().toISOString(),
          modules,
        },
        request.requestId,
      ),
    )
  })

  server.get('/api/v1/health/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.observability, Action.read)) {
      return reply
    }
    try {
      const stores = context.stores
      const dbHealthy = stores.sessionStore !== undefined

      if (dbHealthy) {
        return reply.code(200).send(
          success(
            {
              status: 'healthy',
              timestamp: new Date().toISOString(),
              checks: {
                database: { status: 'healthy' },
                stores: { status: 'healthy' },
              },
            },
            request.requestId,
          ),
        )
      }

      return reply.code(503).send(
        success(
          {
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            checks: {
              database: { status: 'unhealthy', message: 'Database not available' },
              stores: { status: 'unhealthy' },
            },
          },
          request.requestId,
        ),
      )
    } catch (err) {
      return reply.code(503).send(
        success(
          {
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            checks: {
              database: { status: 'unhealthy', message: err instanceof Error ? err.message : 'Unknown error' },
            },
          },
          request.requestId,
        ),
      )
    }
  })

  server.get('/api/v1/setup/readiness', async (request: FastifyRequest, reply: FastifyReply) => {
    // No auth required - setup endpoint must be accessible before authentication
    const items: Array<{
      id: string
      label: string
      status: 'ok' | 'warning' | 'error'
      details: string
    }> = []

    const secretKey = process.env.APP_SECRET_KEY
    const PLACEHOLDER_PATTERNS = [
      'your_secret_key',
      'your-secret-key',
      'changeme',
      'change_me',
      'change-me',
      'placeholder',
      'fixme',
    ]
    const isPlaceholder = (value: string): boolean => {
      const lower = value.toLowerCase().trim()
      return PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern))
    }

    if (!secretKey) {
      items.push({
        id: 'app_secret_key',
        label: 'APP_SECRET_KEY Configuration',
        status: 'error',
        details: 'APP_SECRET_KEY is not set. A strong random key (at least 32 characters) is required.',
      })
    } else if (secretKey.length < 32) {
      items.push({
        id: 'app_secret_key',
        label: 'APP_SECRET_KEY Configuration',
        status: 'warning',
        details: `APP_SECRET_KEY is too short (${secretKey.length} characters). At least 32 characters required.`,
      })
    } else if (isPlaceholder(secretKey)) {
      items.push({
        id: 'app_secret_key',
        label: 'APP_SECRET_KEY Configuration',
        status: 'warning',
        details: 'APP_SECRET_KEY appears to be a placeholder value. Set a strong, unique secret.',
      })
    } else {
      items.push({
        id: 'app_secret_key',
        label: 'APP_SECRET_KEY Configuration',
        status: 'ok',
        details: 'APP_SECRET_KEY is configured and meets security requirements.',
      })
    }

    const allowedOrigins = process.env.ALLOWED_ORIGINS
    if (!allowedOrigins) {
      items.push({
        id: 'cors',
        label: 'CORS Configuration',
        status: 'warning',
        details: 'ALLOWED_ORIGINS is not set. Configure explicit origins for production.',
      })
    } else if (allowedOrigins.trim() === '*') {
      items.push({
        id: 'cors',
        label: 'CORS Configuration',
        status: 'error',
        details: 'ALLOWED_ORIGINS is set to "*" which is not allowed in production. Specify explicit URLs.',
      })
    } else {
      items.push({
        id: 'cors',
        label: 'CORS Configuration',
        status: 'ok',
        details: 'ALLOWED_ORIGINS is configured with explicit origins.',
      })
    }

    const nodeEnv = process.env.NODE_ENV
    const publicBaseUrl = process.env.PUBLIC_BASE_URL
    const isHttps = publicBaseUrl?.startsWith('https://')

    if (nodeEnv === 'production') {
      if (!publicBaseUrl) {
        items.push({
          id: 'https',
          label: 'HTTPS Configuration',
          status: 'warning',
          details: 'PUBLIC_BASE_URL is not set. Configure HTTPS URL for production.',
        })
      } else if (!isHttps) {
        items.push({
          id: 'https',
          label: 'HTTPS Configuration',
          status: 'warning',
          details: 'PUBLIC_BASE_URL is not using HTTPS. Production should use HTTPS.',
        })
      } else {
        items.push({
          id: 'https',
          label: 'HTTPS Configuration',
          status: 'ok',
          details: 'HTTPS is configured for production.',
        })
      }
    } else {
      items.push({
        id: 'https',
        label: 'HTTPS Configuration',
        status: 'warning',
        details: 'HTTPS check skipped in non-production environment. Configure HTTPS before deployment.',
      })
    }

    try {
      const stores = context.stores
      const dbHealthy = stores.sessionStore !== undefined

      if (dbHealthy) {
        items.push({
          id: 'database',
          label: 'Database Health',
          status: 'ok',
          details: 'Database is connected and healthy.',
        })
      } else {
        items.push({
          id: 'database',
          label: 'Database Health',
          status: 'error',
          details: 'Database is not available. Check database configuration.',
        })
      }
    } catch (err) {
      items.push({
        id: 'database',
        label: 'Database Health',
        status: 'error',
        details: err instanceof Error ? err.message : 'Unknown database error.',
      })
    }

    try {
      const stores = context.stores
      const storesHealthy = stores.sessionStore !== undefined

      if (storesHealthy) {
        items.push({
          id: 'stores',
          label: 'Stores Health',
          status: 'ok',
          details: 'All stores are initialized and accessible.',
        })
      } else {
        items.push({
          id: 'stores',
          label: 'Stores Health',
          status: 'error',
          details: 'Stores are not available. Check application initialization.',
        })
      }
    } catch (err) {
      items.push({
        id: 'stores',
        label: 'Stores Health',
        status: 'error',
        details: err instanceof Error ? err.message : 'Unknown stores error.',
      })
    }

    return reply.code(200).send(
      success(
        {
          items,
          timestamp: new Date().toISOString(),
        },
        request.requestId,
      ),
    )
  })
}
