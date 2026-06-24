import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

interface WriteRoutePermission {
  file: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  permission: string
}

const ROUTES_DIR = join(process.cwd(), 'src/api/routes')
const WRITE_ROUTE_REGEX = /server\.(post|patch|put|delete)(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\2/gm
const NEXT_ROUTE_REGEX = /\n\s*server\.(?:get|post|patch|put|delete)\b/
const PERMISSION_REGEX = /requirePermission\(([^)]*)\)/g

const PUBLIC_WRITE_ROUTES = new Map<string, string>([
  ['auth.ts POST /api/v1/auth/login', 'public-auth'],
  ['auth.ts POST /api/v1/auth/logout', 'public-auth'],
  ['setup.ts POST /api/v1/setup/user', 'public-bootstrap'],
])

const EXPECTED_WRITE_ROUTE_PERMISSIONS: WriteRoutePermission[] = [
  {
    file: 'admin.ts',
    method: 'PATCH',
    path: '/api/v1/admin/users/:userId/role',
    permission: 'ResourceType.users, Action.manage',
  },
  {
    file: 'admin.ts',
    method: 'PATCH',
    path: '/api/v1/admin/users/:userId/status',
    permission: 'ResourceType.users, Action.manage',
  },
  {
    file: 'admin.ts',
    method: 'PATCH',
    path: '/api/v1/admin/settings',
    permission: 'ResourceType.settings, Action.manage',
  },
  {
    file: 'agents.ts',
    method: 'PATCH',
    path: '/api/v1/agents/:agentId/config/global',
    permission: 'ResourceType.settings, Action.manage',
  },
  {
    file: 'agents.ts',
    method: 'PATCH',
    path: '/api/v1/agents/:agentId/config/override',
    permission: 'ResourceType.settings, Action.update',
  },
  {
    file: 'agents.ts',
    method: 'DELETE',
    path: '/api/v1/agents/:agentId/config/override',
    permission: 'ResourceType.settings, Action.delete',
  },
  { file: 'api-keys.ts', method: 'POST', path: '/api/v1/api-keys', permission: 'ResourceType.apiKeys, Action.create' },
  {
    file: 'api-keys.ts',
    method: 'DELETE',
    path: '/api/v1/api-keys/:id',
    permission: 'ResourceType.apiKeys, Action.delete',
  },
  {
    file: 'approvals.ts',
    method: 'PATCH',
    path: '/api/v1/approvals/:approvalId',
    permission: "'approval' as ResourceType, Action.update",
  },
  { file: 'auth.ts', method: 'POST', path: '/api/v1/auth/login', permission: 'public-auth' },
  { file: 'auth.ts', method: 'POST', path: '/api/v1/auth/logout', permission: 'public-auth' },
  {
    file: 'connectors.ts',
    method: 'PATCH',
    path: '/api/v1/connectors/:id/instances/:iid/config',
    permission: 'ResourceType.connectors, Action.update',
  },
  {
    file: 'dlq.ts',
    method: 'POST',
    path: '/api/v1/dlq/batch-retry',
    permission: 'ResourceType.observability, Action.update',
  },
  {
    file: 'dlq.ts',
    method: 'POST',
    path: '/api/v1/dlq/batch-discard',
    permission: 'ResourceType.observability, Action.update',
  },
  {
    file: 'dlq.ts',
    method: 'POST',
    path: '/api/v1/dlq/:eventId/retry',
    permission: 'ResourceType.observability, Action.update',
  },
  {
    file: 'dlq.ts',
    method: 'DELETE',
    path: '/api/v1/dlq/:eventId',
    permission: 'ResourceType.observability, Action.delete',
  },
  {
    file: 'files.ts',
    method: 'POST',
    path: '/api/v1/sessions/:sessionId/files',
    permission: 'ResourceType.files, Action.create',
  },
  {
    file: 'files.ts',
    method: 'DELETE',
    path: '/api/v1/files/:fileId',
    permission: 'ResourceType.files, Action.delete',
  },
  {
    file: 'memory.ts',
    method: 'POST',
    path: '/api/v1/memory/debug/extract',
    permission: 'ResourceType.memory, Action.execute',
  },
  {
    file: 'memory.ts',
    method: 'DELETE',
    path: '/api/v1/memory/:memoryId',
    permission: 'ResourceType.memory, Action.delete',
  },
  {
    file: 'oauth.ts',
    method: 'POST',
    path: '/api/v1/connectors/:type/oauth/callback',
    permission: 'ResourceType.connectors, Action.create',
  },
  {
    file: 'oauth.ts',
    method: 'POST',
    path: '/api/v1/connectors/:instanceId/oauth/revoke',
    permission: 'ResourceType.connectors, Action.delete',
  },
  {
    file: 'observability.ts',
    method: 'DELETE',
    path: '/api/v1/alerts/rules/:ruleId',
    permission: 'ResourceType.observability, Action.delete',
  },
  {
    file: 'observability.ts',
    method: 'POST',
    path: '/api/v1/alerts/evaluate',
    permission: 'ResourceType.observability, Action.execute',
  },
  {
    file: 'organizations.ts',
    method: 'POST',
    path: '/api/v1/organizations',
    permission: 'ResourceType.organizations, Action.create',
  },
  {
    file: 'organizations.ts',
    method: 'PATCH',
    path: '/api/v1/organizations/:orgId',
    permission: 'ResourceType.organizations, Action.update',
  },
  {
    file: 'organizations.ts',
    method: 'DELETE',
    path: '/api/v1/organizations/:orgId',
    permission: 'ResourceType.organizations, Action.delete',
  },
  {
    file: 'organizations.ts',
    method: 'POST',
    path: '/api/v1/organizations/:orgId/members',
    permission: 'ResourceType.organizations, Action.update',
  },
  {
    file: 'organizations.ts',
    method: 'DELETE',
    path: '/api/v1/organizations/:orgId/members/:userId',
    permission: 'ResourceType.organizations, Action.update',
  },
  {
    file: 'organizations.ts',
    method: 'PATCH',
    path: '/api/v1/organizations/:orgId/members/:userId/role',
    permission: 'ResourceType.organizations, Action.update',
  },
  {
    file: 'providers.ts',
    method: 'POST',
    path: '/api/v1/providers',
    permission: "'provider' as ResourceType, Action.create",
  },
  {
    file: 'providers.ts',
    method: 'PATCH',
    path: '/api/v1/providers/:providerId',
    permission: "'provider' as ResourceType, Action.update",
  },
  {
    file: 'providers.ts',
    method: 'DELETE',
    path: '/api/v1/providers/:providerId',
    permission: "'provider' as ResourceType, Action.delete",
  },
  {
    file: 'providers.ts',
    method: 'POST',
    path: '/api/v1/providers/:providerId/test',
    permission: "'provider' as ResourceType, Action.execute",
  },
  { file: 'sessions.ts', method: 'POST', path: '/api/v1/sessions', permission: 'ResourceType.sessions, Action.create' },
  {
    file: 'sessions.ts',
    method: 'POST',
    path: '/api/v1/sessions/:sessionId/messages',
    permission: 'ResourceType.sessions, Action.execute',
  },
  {
    file: 'sessions.ts',
    method: 'POST',
    path: '/api/v1/sessions/:sessionId/resume',
    permission: 'ResourceType.sessions, Action.read',
  },
  {
    file: 'sessions.ts',
    method: 'PATCH',
    path: '/api/v1/sessions/:sessionId',
    permission: 'ResourceType.sessions, Action.update',
  },
  {
    file: 'sessions.ts',
    method: 'PATCH',
    path: '/api/v1/sessions/:sessionId/model',
    permission: 'ResourceType.sessions, Action.update',
  },
  { file: 'setup.ts', method: 'POST', path: '/api/v1/setup/user', permission: 'public-bootstrap' },
  {
    file: 'subagents.ts',
    method: 'PUT',
    path: '/api/v1/subagents/:agentType/preference',
    permission: 'ResourceType.settings, Action.update',
  },
  {
    file: 'subagents.ts',
    method: 'DELETE',
    path: '/api/v1/subagents/:agentType/preference',
    permission: 'ResourceType.settings, Action.delete',
  },
  {
    file: 'todos.ts',
    method: 'POST',
    path: '/api/v1/sessions/:sessionId/todos',
    permission: 'ResourceType.todos, Action.create',
  },
  {
    file: 'todos.ts',
    method: 'PATCH',
    path: '/api/v1/sessions/:sessionId/todos/:todoId',
    permission: 'ResourceType.todos, Action.update',
  },
  {
    file: 'todos.ts',
    method: 'DELETE',
    path: '/api/v1/sessions/:sessionId/todos/:todoId',
    permission: 'ResourceType.todos, Action.delete',
  },
  {
    file: 'triggers.ts',
    method: 'PATCH',
    path: '/api/v1/triggers/:triggerId',
    permission: 'ResourceType.triggers, Action.update',
  },
  {
    file: 'triggers.ts',
    method: 'POST',
    path: '/api/v1/triggers/schedules',
    permission: 'ResourceType.triggers, Action.create',
  },
  {
    file: 'triggers.ts',
    method: 'PATCH',
    path: '/api/v1/triggers/schedules/:scheduleId',
    permission: 'ResourceType.triggers, Action.update',
  },
  {
    file: 'triggers.ts',
    method: 'DELETE',
    path: '/api/v1/triggers/schedules/:scheduleId',
    permission: 'ResourceType.triggers, Action.delete',
  },
  {
    file: 'triggers.ts',
    method: 'POST',
    path: '/api/v1/triggers/webhooks',
    permission: 'ResourceType.triggers, Action.create',
  },
  {
    file: 'triggers.ts',
    method: 'PATCH',
    path: '/api/v1/triggers/webhooks/:webhookId',
    permission: 'ResourceType.triggers, Action.update',
  },
  {
    file: 'triggers.ts',
    method: 'DELETE',
    path: '/api/v1/triggers/webhooks/:webhookId',
    permission: 'ResourceType.triggers, Action.delete',
  },
  {
    file: 'triggers.ts',
    method: 'POST',
    path: '/api/v1/webhooks/:webhookId/deliver',
    permission: 'ResourceType.triggers, Action.execute',
  },
  {
    file: 'workflows.ts',
    method: 'POST',
    path: '/api/v1/workflows/drafts',
    permission: 'ResourceType.workflows, Action.create',
  },
  {
    file: 'workflows.ts',
    method: 'PATCH',
    path: '/api/v1/workflows/drafts/:draftId',
    permission: 'ResourceType.workflows, Action.update',
  },
  {
    file: 'workflows.ts',
    method: 'POST',
    path: '/api/v1/workflows/drafts/:draftId/validate',
    permission: 'ResourceType.workflows, Action.read',
  },
  {
    file: 'workflows.ts',
    method: 'POST',
    path: '/api/v1/workflows/drafts/:draftId/publish',
    permission: 'ResourceType.workflows, Action.update',
  },
  {
    file: 'workflows.ts',
    method: 'DELETE',
    path: '/api/v1/workflows/drafts/:draftId',
    permission: 'ResourceType.workflows, Action.delete',
  },
  {
    file: 'workflows.ts',
    method: 'POST',
    path: '/api/v1/workflows/runs',
    permission: 'ResourceType.workflows, Action.execute',
  },
]

function normalizePermission(permission: string): string {
  return permission.replace(/\s+/g, ' ').trim()
}

function extractWriteRoutePermissions(): WriteRoutePermission[] {
  return readdirSync(ROUTES_DIR)
    .filter((file) => file.endsWith('.ts'))
    .sort()
    .flatMap((file) => {
      const content = readFileSync(join(ROUTES_DIR, file), 'utf8')
      return [...content.matchAll(WRITE_ROUTE_REGEX)].map((match) => {
        const routeStart = match.index ?? 0
        const remaining = content.slice(routeStart + 1)
        const nextRoute = remaining.search(NEXT_ROUTE_REGEX)
        const routeBlock =
          nextRoute >= 0 ? content.slice(routeStart, routeStart + 1 + nextRoute) : content.slice(routeStart)
        const method = match[1].toUpperCase() as WriteRoutePermission['method']
        const path = match[3]
        const permissions = [...routeBlock.matchAll(PERMISSION_REGEX)].map((permissionMatch) =>
          normalizePermission(permissionMatch[1]),
        )
        const key = `${file} ${method} ${path}`

        return {
          file,
          method,
          path,
          permission: permissions[0] ?? PUBLIC_WRITE_ROUTES.get(key) ?? 'MISSING',
        }
      })
    })
}

describe('write route permission map', () => {
  it('keeps every POST/PATCH/PUT/DELETE route bound to an audited permission or explicit public bootstrap/auth exception', () => {
    const actual = extractWriteRoutePermissions()

    expect(actual).toEqual(EXPECTED_WRITE_ROUTE_PERMISSIONS)
    expect(actual.filter((route) => route.permission === 'MISSING')).toEqual([])
  })

  it('keeps management route files bound to admin-only or explicit management permissions', () => {
    const managementFiles = new Set([
      'admin.ts',
      'api-keys.ts',
      'providers.ts',
      'connectors.ts',
      'workflows.ts',
      'triggers.ts',
    ])
    const actual = extractWriteRoutePermissions().filter((route) => managementFiles.has(route.file))

    expect(actual).toMatchSnapshot()
    expect(actual.every((route) => route.permission !== 'MISSING')).toBe(true)
  })
})
