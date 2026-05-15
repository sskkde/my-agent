import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SkillSummary } from '../types.js';
import type { ApiContext } from '../context.js';
import { success } from '../response-envelope.js';

const BUILTIN_SKILLS: SkillSummary[] = [
  {
    skillId: 'artifact.create',
    name: 'artifact.create',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'artifact.update',
    name: 'artifact.update',
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
    skillId: 'status.query',
    name: 'status.query',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'memory.retrieve',
    name: 'memory.retrieve',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'transcript.search',
    name: 'transcript.search',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'plan.patch',
    name: 'plan.patch',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'docs.search',
    name: 'docs.search',
    type: 'builtin',
    enabled: true,
  },
  {
    skillId: 'web.search',
    name: 'web.search',
    type: 'builtin',
    enabled: true,
  },
];

export function registerSkillRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get('/api/v1/skills', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send(success({ skills: BUILTIN_SKILLS }, request.requestId));
  });
}
