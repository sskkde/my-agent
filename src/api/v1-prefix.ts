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

export type ApiRouteDefinition = {
  path: string
  methods: HTTPMethods[]
}

export const API_ROUTE_DEFINITIONS: ApiRouteDefinition[] = [
  { path: '/api/v1/admin/connectors/health', methods: ['GET'] },
  { path: '/api/v1/admin/settings', methods: ['GET', 'PATCH'] },
  { path: '/api/v1/admin/users', methods: ['GET'] },
  { path: '/api/v1/admin/users/:userId/role', methods: ['PATCH'] },
  { path: '/api/v1/admin/users/:userId/status', methods: ['PATCH'] },
  { path: '/api/v1/agents/:agentId/config', methods: ['GET'] },
  { path: '/api/v1/agents/:agentId/config/global', methods: ['PATCH'] },
  { path: '/api/v1/agents/:agentId/config/override', methods: ['DELETE', 'PATCH'] },
  { path: '/api/v1/alerts/evaluate', methods: ['POST'] },
  { path: '/api/v1/alerts/rules', methods: ['GET', 'POST'] },
  { path: '/api/v1/alerts/rules/:ruleId', methods: ['DELETE', 'GET'] },
  { path: '/api/v1/alerts/state', methods: ['GET'] },
  { path: '/api/v1/api-keys', methods: ['GET', 'POST'] },
  { path: '/api/v1/api-keys/:id', methods: ['DELETE'] },
  { path: '/api/v1/approvals', methods: ['GET'] },
  { path: '/api/v1/approvals/:approvalId', methods: ['GET', 'PATCH'] },
  { path: '/api/v1/auth/login', methods: ['POST'] },
  { path: '/api/v1/auth/logout', methods: ['POST'] },
  { path: '/api/v1/auth/me', methods: ['GET'] },
  { path: '/api/v1/channels', methods: ['GET'] },
  { path: '/api/v1/connectors', methods: ['GET'] },
  { path: '/api/v1/connectors/:id', methods: ['GET'] },
  { path: '/api/v1/connectors/:id/instances', methods: ['GET'] },
  { path: '/api/v1/connectors/:id/instances/:iid/config', methods: ['PATCH'] },
  { path: '/api/v1/connectors/:instanceId/oauth/revoke', methods: ['POST'] },
  { path: '/api/v1/connectors/:type/oauth/authorize', methods: ['GET'] },
  { path: '/api/v1/connectors/:type/oauth/callback', methods: ['POST'] },
  { path: '/api/v1/debug/replay/:sessionId', methods: ['GET'] },
  { path: '/api/v1/dlq', methods: ['GET'] },
  { path: '/api/v1/dlq/:eventId', methods: ['DELETE', 'GET'] },
  { path: '/api/v1/dlq/:eventId/retry', methods: ['POST'] },
  { path: '/api/v1/dlq/batch-discard', methods: ['POST'] },
  { path: '/api/v1/dlq/batch-retry', methods: ['POST'] },
  { path: '/api/v1/health', methods: ['GET'] },
  { path: '/api/v1/health/ready', methods: ['GET'] },
  { path: '/api/v1/instances', methods: ['GET'] },
  { path: '/api/v1/logs', methods: ['GET'] },
  { path: '/api/v1/logs/stream', methods: ['GET'] },
  { path: '/api/v1/memory', methods: ['GET'] },
  { path: '/api/v1/memory/:memoryId', methods: ['DELETE', 'GET'] },
  { path: '/api/v1/memory/debug/extract', methods: ['POST'] },
  { path: '/api/v1/memory/debug/extraction-runs', methods: ['GET'] },
  { path: '/api/v1/metrics', methods: ['GET'] },
  { path: '/api/v1/models', methods: ['GET'] },
  { path: '/api/v1/observability/runs', methods: ['GET'] },
  { path: '/api/v1/observability/runs/:runId/console', methods: ['GET'] },
  { path: '/api/v1/observability/runs/:runId/replay-preview', methods: ['GET'] },
  { path: '/api/v1/organizations', methods: ['GET', 'POST'] },
  { path: '/api/v1/organizations/:orgId', methods: ['DELETE', 'GET', 'PATCH'] },
  { path: '/api/v1/organizations/:orgId/members', methods: ['GET', 'POST'] },
  { path: '/api/v1/organizations/:orgId/members/:userId', methods: ['DELETE'] },
  { path: '/api/v1/organizations/:orgId/members/:userId/role', methods: ['PATCH'] },
  { path: '/api/v1/planner-runs/:plannerRunId/events', methods: ['GET'] },
  { path: '/api/v1/planner-runs/:plannerRunId/summary', methods: ['GET'] },
  { path: '/api/v1/providers', methods: ['GET', 'POST'] },
  { path: '/api/v1/providers/:providerId', methods: ['DELETE', 'GET', 'PATCH'] },
  { path: '/api/v1/providers/:providerId/test', methods: ['POST'] },
  { path: '/api/v1/runs', methods: ['GET'] },
  { path: '/api/v1/runs/stream', methods: ['GET'] },
  { path: '/api/v1/sessions', methods: ['GET', 'POST'] },
  { path: '/api/v1/sessions/:sessionId', methods: ['GET', 'PATCH'] },
  { path: '/api/v1/sessions/:sessionId/messages', methods: ['POST'] },
  { path: '/api/v1/sessions/:sessionId/model', methods: ['PATCH'] },
  { path: '/api/v1/sessions/:sessionId/resume', methods: ['POST'] },
  { path: '/api/v1/sessions/:sessionId/timeline', methods: ['GET'] },
  { path: '/api/v1/sessions/:sessionId/timeline/stream', methods: ['GET'] },
  { path: '/api/v1/sessions/:sessionId/transcripts', methods: ['GET'] },
  { path: '/api/v1/sessions/:sessionId/usage', methods: ['GET'] },
  { path: '/api/v1/settings', methods: ['GET'] },
  { path: '/api/v1/setup/readiness', methods: ['GET'] },
  { path: '/api/v1/setup/status', methods: ['GET'] },
  { path: '/api/v1/setup/user', methods: ['POST'] },
  { path: '/api/v1/skills', methods: ['GET'] },
  { path: '/api/v1/subagents', methods: ['GET'] },
  { path: '/api/v1/subagents/:agentType', methods: ['GET'] },
  { path: '/api/v1/subagents/:agentType/preference', methods: ['DELETE', 'GET', 'PUT'] },
  { path: '/api/v1/tool-results/:resultId', methods: ['GET'] },
  { path: '/api/v1/tools', methods: ['GET'] },
  { path: '/api/v1/triggers', methods: ['GET'] },
  { path: '/api/v1/triggers/:triggerId', methods: ['PATCH'] },
  { path: '/api/v1/triggers/:triggerId/logs', methods: ['GET'] },
  { path: '/api/v1/triggers/schedules', methods: ['GET', 'POST'] },
  { path: '/api/v1/triggers/schedules/:scheduleId', methods: ['DELETE', 'GET', 'PATCH'] },
  { path: '/api/v1/triggers/webhooks', methods: ['GET', 'POST'] },
  { path: '/api/v1/triggers/webhooks/:webhookId', methods: ['DELETE', 'GET', 'PATCH'] },
  { path: '/api/v1/usage', methods: ['GET'] },
  { path: '/api/v1/webhooks/:webhookId/deliver', methods: ['POST'] },
  { path: '/api/v1/workflows/definitions', methods: ['GET'] },
  { path: '/api/v1/workflows/definitions/:workflowId', methods: ['GET'] },
  { path: '/api/v1/workflows/drafts', methods: ['GET', 'POST'] },
  { path: '/api/v1/workflows/drafts/:draftId', methods: ['DELETE', 'GET', 'PATCH'] },
  { path: '/api/v1/workflows/drafts/:draftId/publish', methods: ['POST'] },
  { path: '/api/v1/workflows/drafts/:draftId/validate', methods: ['POST'] },
  { path: '/api/v1/workflows/runs', methods: ['GET', 'POST'] },
  { path: '/api/v1/workflows/runs/:workflowRunId', methods: ['GET'] },
]

export type LegacyRouteDefinition = ApiRouteDefinition & {
  legacyPath: string
}

export const LEGACY_ROUTE_DEFINITIONS: LegacyRouteDefinition[] = API_ROUTE_DEFINITIONS.map((route) => {
  if (!route.path.startsWith(`${V1_PREFIX}/`)) {
    throw new Error(`Versioned API route must start with ${V1_PREFIX}/: ${route.path}`)
  }

  return {
    ...route,
    legacyPath: route.path.replace(V1_PREFIX, '/api'),
  }
})

export const ROUTE_MAP: Record<string, string> = Object.fromEntries(
  LEGACY_ROUTE_DEFINITIONS.map((route) => [route.legacyPath, route.path]),
)
