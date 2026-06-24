import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { SkillSummary, SkillDetailResponse } from '../types.js'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

export function registerSkillRoutes(server: FastifyInstance, context: ApiContext): void {
  const { skillRegistry } = context

  server.get('/api/v1/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply
    }

    const skills = skillRegistry.list().map(
      (def): SkillSummary => ({
        skillId: def.skillId,
        name: def.name,
        description: def.description,
        category: def.category,
        sensitivity: def.sensitivity,
        enabled: def.enabled,
        source: def.source,
      }),
    )

    return reply.code(200).send(success({ skills, total: skills.length }, request.requestId))
  })

  server.get<{ Params: { skillId: string } }>(
    '/api/v1/skills/:skillId',
    async (request: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.read)) {
        return reply
      }

      const { skillId } = request.params
      const definition = skillRegistry.get(skillId)

      if (!definition) {
        return reply
          .code(404)
          .send(envelopeError('SKILL_NOT_FOUND', `Skill "${skillId}" not found`, request.requestId))
      }

      const response: SkillDetailResponse = {
        skillId: definition.skillId,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        sensitivity: definition.sensitivity,
        enabled: definition.enabled,
        source: definition.source,
        allowedAgentTypes: definition.allowedAgentTypes,
        defaultAgentProfiles: definition.defaultAgentProfiles,
        ...(definition.summary !== undefined ? { summary: definition.summary } : {}),
        ...(definition.tags !== undefined ? { tags: definition.tags } : {}),
      }

      return reply.code(200).send(success(response, request.requestId))
    },
  )
}
