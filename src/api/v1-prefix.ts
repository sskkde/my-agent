import type { FastifyRequest, FastifyReply, RouteOptions, HTTPMethods } from 'fastify'

export const V1_PREFIX = '/api/v1'

export function withV1Prefix(path: string): string {
  if (!path || path === '/') {
    return `${V1_PREFIX}/`
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (normalizedPath.startsWith(`${V1_PREFIX}/`) || normalizedPath === V1_PREFIX) {
    return normalizedPath
  }

  return `${V1_PREFIX}${normalizedPath}`
}

export function createLegacyRedirect(legacyPath: string, v1Path: string, method: HTTPMethods = 'GET'): RouteOptions {
  return {
    method,
    url: legacyPath,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      let redirectPath = v1Path

      const params = request.params as Record<string, string>
      for (const [key, value] of Object.entries(params)) {
        redirectPath = redirectPath.replace(`:${key}`, value)
      }

      // Add deprecation headers for legacy API routes
      reply.header('Deprecation', 'true')
      reply.header('Link', `<${redirectPath}>; rel="successor-version"`)

      return reply.redirect(redirectPath, 307)
    },
  }
}

export const ROUTE_MAP: Record<string, string> = {
  '/api/health': '/api/v1/health',
  '/api/health/ready': '/api/v1/health/ready',

  '/api/sessions': '/api/v1/sessions',
  '/api/sessions/:sessionId': '/api/v1/sessions/:sessionId',
  '/api/sessions/:sessionId/transcripts': '/api/v1/sessions/:sessionId/transcripts',
  '/api/sessions/:sessionId/messages': '/api/v1/sessions/:sessionId/messages',
  '/api/sessions/:sessionId/resume': '/api/v1/sessions/:sessionId/resume',
  '/api/sessions/:sessionId/timeline': '/api/v1/sessions/:sessionId/timeline',
  '/api/sessions/:sessionId/timeline/stream': '/api/v1/sessions/:sessionId/timeline/stream',
  '/api/sessions/:sessionId/model': '/api/v1/sessions/:sessionId/model',

  '/api/approvals': '/api/v1/approvals',
  '/api/approvals/:approvalId': '/api/v1/approvals/:approvalId',
  '/api/approvals/:approvalId/respond': '/api/v1/approvals/:approvalId/respond',

  '/api/runs': '/api/v1/runs',
  '/api/runs/:runId': '/api/v1/runs/:runId',

  '/api/usage': '/api/v1/usage',

  '/api/logs': '/api/v1/logs',

  '/api/debug/events': '/api/v1/debug/events',

  '/api/instances': '/api/v1/instances',
  '/api/instances/:instanceId': '/api/v1/instances/:instanceId',

  '/api/channels': '/api/v1/channels',

  '/api/skills': '/api/v1/skills',
  '/api/skills/:skillId': '/api/v1/skills/:skillId',

  '/api/settings': '/api/v1/settings',

  '/api/setup/status': '/api/v1/setup/status',
  '/api/setup/user': '/api/v1/setup/user',

  '/api/auth/login': '/api/v1/auth/login',
  '/api/auth/logout': '/api/v1/auth/logout',
  '/api/auth/me': '/api/v1/auth/me',

  '/api/providers': '/api/v1/providers',
  '/api/providers/:providerId': '/api/v1/providers/:providerId',
  '/api/providers/:providerId/test': '/api/v1/providers/:providerId/test',

  '/api/models': '/api/v1/models',

  '/api/tools': '/api/v1/tools',

  '/api/agents/:agentId/config': '/api/v1/agents/:agentId/config',
  '/api/agents/:agentId/config/global': '/api/v1/agents/:agentId/config/global',
  '/api/agents/:agentId/config/override': '/api/v1/agents/:agentId/config/override',

  '/api/memory': '/api/v1/memory',

  '/api/workflows/drafts': '/api/v1/workflows/drafts',
  '/api/workflows/drafts/:draftId': '/api/v1/workflows/drafts/:draftId',
  '/api/workflows/drafts/:draftId/validate': '/api/v1/workflows/drafts/:draftId/validate',
  '/api/workflows/drafts/:draftId/publish': '/api/v1/workflows/drafts/:draftId/publish',
  '/api/workflows/definitions': '/api/v1/workflows/definitions',
  '/api/workflows/definitions/:workflowId': '/api/v1/workflows/definitions/:workflowId',
  '/api/workflows/runs': '/api/v1/workflows/runs',
  '/api/workflows/runs/:workflowRunId': '/api/v1/workflows/runs/:workflowRunId',

  '/api/tool-results/:resultId': '/api/v1/tool-results/:resultId',

  '/api/triggers': '/api/v1/triggers',
  '/api/triggers/:triggerId': '/api/v1/triggers/:triggerId',
  '/api/triggers/:triggerId/logs': '/api/v1/triggers/:triggerId/logs',
  '/api/triggers/schedules': '/api/v1/triggers/schedules',
  '/api/triggers/schedules/:scheduleId': '/api/v1/triggers/schedules/:scheduleId',
  '/api/triggers/webhooks': '/api/v1/triggers/webhooks',
  '/api/triggers/webhooks/:webhookId': '/api/v1/triggers/webhooks/:webhookId',

  '/api/webhooks/:webhookId/deliver': '/api/v1/webhooks/:webhookId/deliver',

  '/api/connectors': '/api/v1/connectors',
  '/api/connectors/:connectorId': '/api/v1/connectors/:connectorId',
  '/api/connectors/:connectorId/tools': '/api/v1/connectors/:connectorId/tools',
  '/api/connectors/:connectorId/events': '/api/v1/connectors/:connectorId/events',

  '/api/planner-runs': '/api/v1/planner-runs',
  '/api/planner-runs/:plannerRunId': '/api/v1/planner-runs/:plannerRunId',

  '/api/observability/runs': '/api/v1/observability/runs',
  '/api/observability/runs/:runId': '/api/v1/observability/runs/:runId',
  '/api/observability/runs/:runId/timeline': '/api/v1/observability/runs/:runId/timeline',
  '/api/observability/runs/:runId/replay': '/api/v1/observability/runs/:runId/replay',

  '/api/dlq': '/api/v1/dlq',
  '/api/dlq/:eventId': '/api/v1/dlq/:eventId',
  '/api/dlq/:eventId/retry': '/api/v1/dlq/:eventId/retry',
  '/api/dlq/batch-retry': '/api/v1/dlq/batch-retry',
  '/api/dlq/batch-discard': '/api/v1/dlq/batch-discard',

  '/api/admin/users': '/api/v1/admin/users',
  '/api/admin/users/:userId/role': '/api/v1/admin/users/:userId/role',
  '/api/admin/users/:userId/status': '/api/v1/admin/users/:userId/status',
  '/api/admin/connectors/health': '/api/v1/admin/connectors/health',
  '/api/admin/settings': '/api/v1/admin/settings',

  '/api/api-keys': '/api/v1/api-keys',
  '/api/api-keys/:id': '/api/v1/api-keys/:id',

  '/api/subagents': '/api/v1/subagents',
  '/api/subagents/:agentType': '/api/v1/subagents/:agentType',
  '/api/subagents/:agentType/preference': '/api/v1/subagents/:agentType/preference',
}
