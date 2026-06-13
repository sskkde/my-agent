import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Role, ResourceType, Action } from '../../permissions/rbac-types.js'
import { checkPermission, filterResources, getRolePermissions } from '../../permissions/rbac-engine.js'
import type { OwnershipContext } from '../../permissions/rbac-engine.js'
import { envelopeError } from '../response-envelope.js'
import type { AuthenticatedUser } from './auth.js'

export interface Rbac {
  checkPermission: typeof checkPermission
  getRolePermissions: typeof getRolePermissions
  filterResources: typeof filterResources
}

export interface RbacMiddlewareOptions {
  exemptPaths?: string[]
}

const DEFAULT_EXEMPT_PATHS = [
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
]

function isPathExempt(path: string, exemptPaths: string[]): boolean {
  return exemptPaths.some((exemptPath) => {
    if (exemptPath.endsWith('*')) {
      return path.startsWith(exemptPath.slice(0, -1))
    }
    return path === exemptPath
  })
}

function getRoleFromRequest(request: FastifyRequest): Role | null {
  const user = request.user as AuthenticatedUser | undefined
  if (!user) {
    return null
  }
  return user.role
}

declare module 'fastify' {
  interface FastifyInstance {
    rbac: Rbac
  }

  interface FastifyRequest {
    rbacRole: Role | null
    rbacCheck(resource: ResourceType, action: Action, context?: OwnershipContext): boolean
    requirePermission(resource: ResourceType, action: Action, context?: OwnershipContext): boolean
  }
}

export async function registerRbacMiddleware(
  server: FastifyInstance,
  options: RbacMiddlewareOptions = {},
): Promise<void> {
  const exemptPaths = options.exemptPaths ?? DEFAULT_EXEMPT_PATHS

  const rbac: Rbac = {
    checkPermission,
    getRolePermissions,
    filterResources,
  }

  server.decorate('rbac', rbac)
  server.decorateRequest('rbacRole', null)
  server.decorateRequest(
    'rbacCheck',
    function (this: FastifyRequest, _resource: ResourceType, _action: Action, _context?: OwnershipContext): boolean {
      return false
    },
  )
  server.decorateRequest(
    'requirePermission',
    function (this: FastifyRequest, _resource: ResourceType, _action: Action, _context?: OwnershipContext): boolean {
      return true
    },
  )

  server.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPathExempt(request.url, exemptPaths)) {
      return
    }

    // Skip if reply already sent by a previous hook (e.g., auth middleware)
    if (reply.sent) {
      return
    }

    const role = getRoleFromRequest(request)
    request.rbacRole = role

    request.rbacCheck = (resource: ResourceType, action: Action, context?: OwnershipContext): boolean => {
      if (!role) {
        return false
      }
      return checkPermission(role, resource, action, context)
    }

    request.requirePermission = (resource: ResourceType, action: Action, context?: OwnershipContext): boolean => {
      if (reply.sent) {
        return false
      }
      if (!role) {
        request.headers = { ...request.headers, 'x-no-compression': 'true' }
        reply.code(403).send(envelopeError('FORBIDDEN', `No role found for request`, request.requestId))
        return false
      }
      if (!checkPermission(role, resource, action, context)) {
        request.headers = { ...request.headers, 'x-no-compression': 'true' }
        reply
          .code(403)
          .send(
            envelopeError('FORBIDDEN', `Role '${role}' cannot perform '${action}' on '${resource}'`, request.requestId),
          )
        return false
      }
      return true
    }
  })
}
