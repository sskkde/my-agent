import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { UserRole } from '../../storage/user-store.js'
import type { Organization } from '../../storage/organization-store.js'

interface CreateOrganizationBody {
  name: string
  slug: string
}

interface UpdateOrganizationBody {
  name?: string
  slug?: string
}

interface AddMemberBody {
  userId: string
  role?: 'owner' | 'admin' | 'member'
}

interface UpdateMemberRoleBody {
  role: 'owner' | 'admin' | 'member'
}

export function registerOrganizationRoutes(server: FastifyInstance, context: ApiContext): void {
  const organizationStore = context.stores.organizationStore

  server.post<{ Body: CreateOrganizationBody }>(
    '/api/v1/organizations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', minLength: 1 },
            slug: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateOrganizationBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.create)) {
        return reply
      }

      const { name, slug } = request.body

      const existing = organizationStore.getBySlug(slug)
      if (existing) {
        return reply
          .code(409)
          .send(envelopeError('CONFLICT', `Organization with slug '${slug}' already exists`, request.requestId))
      }

      const orgId = randomUUID()
      const org = organizationStore.create({ orgId, name, slug })

      return reply.code(201).send(success(org, request.requestId))
    },
  )

  server.get('/api/v1/organizations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.organizations, Action.read)) {
      return reply
    }

    const role = request.user?.role as UserRole | undefined
    const userId = request.user?.userId

    let orgs: Organization[]
    if (role === 'admin') {
      orgs = organizationStore.list()
    } else if (userId) {
      orgs = organizationStore.getUserOrganizations(userId)
    } else {
      orgs = []
    }

    return reply.code(200).send(success(orgs, request.requestId))
  })

  server.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.read)) {
        return reply
      }

      const { orgId } = request.params
      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      return reply.code(200).send(success(org, request.requestId))
    },
  )

  server.patch<{ Params: { orgId: string }; Body: UpdateOrganizationBody }>(
    '/api/v1/organizations/:orgId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            slug: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { orgId: string }; Body: UpdateOrganizationBody }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.organizations, Action.update)) {
        return reply
      }

      const { orgId } = request.params
      const { name, slug } = request.body

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      if (slug && slug !== org.slug) {
        const existing = organizationStore.getBySlug(slug)
        if (existing) {
          return reply
            .code(409)
            .send(envelopeError('CONFLICT', `Organization with slug '${slug}' already exists`, request.requestId))
        }
      }

      const updated = organizationStore.update(orgId, { name, slug })
      if (!updated) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to update organization', request.requestId))
      }

      const updatedOrg = organizationStore.getById(orgId)
      return reply.code(200).send(success(updatedOrg, request.requestId))
    },
  )

  server.delete<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.delete)) {
        return reply
      }

      const { orgId } = request.params

      if (orgId === 'org_default') {
        return reply
          .code(403)
          .send(envelopeError('FORBIDDEN', 'Cannot delete the default organization', request.requestId))
      }

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      const deleted = organizationStore.delete(orgId)
      if (!deleted) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to delete organization', request.requestId))
      }

      return reply.code(200).send(success({ orgId, deleted: true }, request.requestId))
    },
  )

  server.post<{ Params: { orgId: string }; Body: AddMemberBody }>(
    '/api/v1/organizations/:orgId/members',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', minLength: 1 },
            role: { type: 'string', enum: ['owner', 'admin', 'member'] },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orgId: string }; Body: AddMemberBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.update)) {
        return reply
      }

      const { orgId } = request.params
      const { userId, role } = request.body

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      const membership = organizationStore.addUser(userId, orgId, role)

      return reply.code(201).send(success(membership, request.requestId))
    },
  )

  server.delete<{ Params: { orgId: string; userId: string } }>(
    '/api/v1/organizations/:orgId/members/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId', 'userId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
            userId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orgId: string; userId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.update)) {
        return reply
      }

      const { orgId, userId } = request.params

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      const members = organizationStore.getOrganizationUsers(orgId)
      const targetMember = members.find((m) => m.userId === userId)
      if (!targetMember) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Member not found in organization', request.requestId))
      }

      const removed = organizationStore.removeUser(userId, orgId)
      if (!removed) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to remove member', request.requestId))
      }

      return reply.code(200).send(success({ userId, orgId, removed: true }, request.requestId))
    },
  )

  server.patch<{ Params: { orgId: string; userId: string }; Body: UpdateMemberRoleBody }>(
    '/api/v1/organizations/:orgId/members/:userId/role',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId', 'userId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
            userId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['owner', 'admin', 'member'] },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { orgId: string; userId: string }; Body: UpdateMemberRoleBody }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission(ResourceType.organizations, Action.update)) {
        return reply
      }

      const { orgId, userId } = request.params
      const { role } = request.body

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      const updated = organizationStore.updateUserRole(userId, orgId, role)
      if (!updated) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Member not found in organization', request.requestId))
      }

      return reply.code(200).send(success({ userId, orgId, role }, request.requestId))
    },
  )

  server.get<{ Params: { orgId: string } }>(
    '/api/v1/organizations/:orgId/members',
    {
      schema: {
        params: {
          type: 'object',
          required: ['orgId'],
          properties: {
            orgId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { orgId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.organizations, Action.read)) {
        return reply
      }

      const { orgId } = request.params

      const org = organizationStore.getById(orgId)
      if (!org) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Organization not found', request.requestId))
      }

      const members = organizationStore.getOrganizationUsers(orgId)

      return reply.code(200).send(success(members, request.requestId))
    },
  )
}
