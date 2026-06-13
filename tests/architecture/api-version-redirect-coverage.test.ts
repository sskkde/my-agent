import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLegacyRedirect, LEGACY_ROUTE_DEFINITIONS } from '../../src/api/v1-prefix.js'

const repoRoot = process.cwd()
const routeFiles = [
  'src/api/server.ts',
  'src/api/routes/admin.ts',
  'src/api/routes/agents.ts',
  'src/api/routes/api-keys.ts',
  'src/api/routes/approvals.ts',
  'src/api/routes/auth.ts',
  'src/api/routes/channels.ts',
  'src/api/routes/connectors.ts',
  'src/api/routes/debug.ts',
  'src/api/routes/dlq.ts',
  'src/api/routes/instances.ts',
  'src/api/routes/logs.ts',
  'src/api/routes/memory.ts',
  'src/api/routes/models.ts',
  'src/api/routes/oauth.ts',
  'src/api/routes/observability.ts',
  'src/api/routes/organizations.ts',
  'src/api/routes/planner-runs.ts',
  'src/api/routes/providers.ts',
  'src/api/routes/runs.ts',
  'src/api/routes/sessions.ts',
  'src/api/routes/settings.ts',
  'src/api/routes/setup.ts',
  'src/api/routes/skills.ts',
  'src/api/routes/status.ts',
  'src/api/routes/subagents.ts',
  'src/api/routes/tool-results.ts',
  'src/api/routes/tools.ts',
  'src/api/routes/triggers.ts',
  'src/api/routes/usage.ts',
  'src/api/routes/workflows.ts',
]

type RouteRegistration = { method: string; path: string }

function collectV1RouteRegistrations(): RouteRegistration[] {
  const registrations: RouteRegistration[] = []

  for (const file of routeFiles) {
    const source = readFileSync(join(repoRoot, file), 'utf8')
    const methodPattern = /server\.(get|post|patch|put|delete)(?:<[^]*?>)?\s*\(/g
    let match: RegExpExecArray | null

    while ((match = methodPattern.exec(source))) {
      const snippet = source.slice(match.index, match.index + 500)
      const pathMatch = snippet.match(/['"](\/api\/v1\/[^'"]+)['"]/)
      if (pathMatch) {
        registrations.push({ method: match[1].toUpperCase(), path: pathMatch[1] })
      }
    }
  }

  return registrations
}

describe('API version redirect coverage', () => {
  it('tracks every registered /api/v1/ route in the legacy compatibility inventory', () => {
    const expected = new Set(
      LEGACY_ROUTE_DEFINITIONS.flatMap((route) => route.methods.map((method) => `${method} ${route.path}`)),
    )
    const actual = new Set(collectV1RouteRegistrations().map((route) => `${route.method} ${route.path}`))

    expect([...actual].sort()).toEqual([...expected].sort())
  })

  it('defines a legacy /api/ redirect path for every compatible v1 route', () => {
    for (const route of LEGACY_ROUTE_DEFINITIONS) {
      expect(route.path.startsWith('/api/v1/')).toBe(true)
      expect(route.legacyPath).toBe(route.path.replace('/api/v1', '/api'))
      expect(route.legacyPath.startsWith('/api/')).toBe(true)
      expect(route.legacyPath.startsWith('/api/v1/')).toBe(false)
    }
  })

  it('uses 307 redirects for all body-preserving legacy methods', async () => {
    const bodyMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
    const bodyRoutes = LEGACY_ROUTE_DEFINITIONS.flatMap((route) =>
      route.methods.filter((method) => bodyMethods.has(method)).map((method) => ({ route, method })),
    )

    expect(bodyRoutes.length).toBeGreaterThan(0)
    for (const { route, method } of bodyRoutes) {
      const redirect = createLegacyRedirect(route.legacyPath, route.path, method)
      const reply = {
        header: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
      }

      await (redirect.handler as (request: unknown, reply: unknown) => Promise<unknown>).call(
        null,
        { params: {} },
        reply,
      )

      expect(redirect.method).toBe(method)
      expect(redirect.url).toBe(route.legacyPath)
      expect(reply.redirect).toHaveBeenCalledWith(route.path, 307)
    }
  })
})
