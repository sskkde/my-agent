import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { UserRole } from '../../storage/user-store.js'

const VALID_ROLES: UserRole[] = ['admin', 'user', 'service']

function toAdminUser(
  user: { userId: string; username: string; role: UserRole; createdAt: string; updatedAt: string },
  status: 'active' | 'disabled' = 'active',
) {
  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
    status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function registerAdminRoutes(server: FastifyInstance, context: ApiContext): void {
  const { userStore } = context.stores

  server.get('/api/v1/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.users, Action.manage)) {
      return reply
    }
    const users = userStore.list().map((user) => toAdminUser(user))
    return reply.code(200).send(success({ users, total: users.length }, request.requestId))
  })

  server.patch<{ Params: { userId: string }; Body: { role: UserRole } }>(
    '/api/v1/admin/users/:userId/role',
    async (request: FastifyRequest<{ Params: { userId: string }; Body: { role: UserRole } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.users, Action.manage)) {
        return reply
      }
      const { userId } = request.params
      const { role } = request.body
      if (!VALID_ROLES.includes(role)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid user role', request.requestId))
      }
      const existing = userStore.getById(userId)
      if (!existing) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'User not found', request.requestId))
      }
      const now = new Date().toISOString()
      context.connection.exec('UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?', [role, now, userId])
      return reply
        .code(200)
        .send(success({ user: toAdminUser({ ...existing, role, updatedAt: now }) }, request.requestId))
    },
  )

  server.patch<{ Params: { userId: string }; Body: { status: 'active' | 'disabled' } }>(
    '/api/v1/admin/users/:userId/status',
    async (
      request: FastifyRequest<{ Params: { userId: string }; Body: { status: 'active' | 'disabled' } }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.users, Action.manage)) {
        return reply
      }
      const user = userStore.getById(request.params.userId)
      if (!user) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'User not found', request.requestId))
      }
      return reply.code(200).send(success({ user: toAdminUser(user, request.body.status) }, request.requestId))
    },
  )

  server.get('/api/v1/admin/connectors/health', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.connectors, Action.read)) {
      return reply
    }
    const rows = context.connection.query<{
      connector_id: string
      connector_type: string
      name: string
      status: string
      updated_at: string
    }>('SELECT connector_id, connector_type, name, status, updated_at FROM connector_definitions ORDER BY name ASC')
    const connectors = rows.map((row) => ({
      connectorId: row.connector_id,
      connectorType: row.connector_type,
      displayName: row.name,
      status: row.status === 'active' ? 'healthy' : 'unknown',
      lastCheckedAt: row.updated_at,
    }))
    return reply.code(200).send(success({ connectors }, request.requestId))
  })

  server.get('/api/v1/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply
    }
    return reply
      .code(200)
      .send(
        success(
          { settings: { rateLimitPerMinute: 60, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 } },
          request.requestId,
        ),
      )
  })

  server.patch<{ Body: { rateLimitPerMinute?: number; rateLimitPerHour?: number; sessionTokenTtlHours?: number } }>(
    '/api/v1/admin/settings',
    async (
      request: FastifyRequest<{
        Body: { rateLimitPerMinute?: number; rateLimitPerHour?: number; sessionTokenTtlHours?: number }
      }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.settings, Action.manage)) {
        return reply
      }
      const settings = {
        rateLimitPerMinute: request.body.rateLimitPerMinute ?? 60,
        rateLimitPerHour: request.body.rateLimitPerHour ?? 1000,
        sessionTokenTtlHours: request.body.sessionTokenTtlHours ?? 24,
      }
      return reply.code(200).send(success({ settings }, request.requestId))
    },
  )
}
