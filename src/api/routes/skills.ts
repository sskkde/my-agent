import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SkillSummary } from '../types.js';
import type { ApiContext } from '../context.js';
import { success } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

const BUILTIN_SKILLS: SkillSummary[] = [
  {
    skillId: 'artifact_create',
    name: 'artifact_create',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'artifact_update',
    name: 'artifact_update',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'ask_user',
    name: 'ask_user',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'status_query',
    name: 'status_query',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'memory_retrieve',
    name: 'memory_retrieve',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'transcript_search',
    name: 'transcript_search',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'plan_patch',
    name: 'plan_patch',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'docs_search',
    name: 'docs_search',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'web_search',
    name: 'web_search',
    type: 'builtin',
    enabled: true,
  },
];

export function registerSkillRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get('/api/v1/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply;
    }
    return reply.code(200).send(success({ skills: BUILTIN_SKILLS }, request.requestId));
  });
}
