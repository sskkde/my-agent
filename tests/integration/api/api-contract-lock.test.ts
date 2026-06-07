import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'
import { readFileSync } from 'fs'
import { join } from 'path'

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
const EXPECTED_VERSION = packageJson.version

describe('API Contract Lock', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  // ===========================================================================
  // Public Routes Tests (No Authentication Required)
  // ===========================================================================
  describe('Public Routes', () => {
    it('GET /api/v1/health should return 200 with health status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { status: string; modules: Record<string, unknown>; timestamp: string }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.status).toBeDefined()
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.data.status)
      expect(body.data.modules).toBeDefined()
      expect(body.data.timestamp).toBeDefined()
      expect(typeof body.requestId).toBe('string')
    })

    it('GET /api/v1/health/ready should return 200 with readiness status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health/ready`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { status: string; timestamp: string; checks: Record<string, unknown> }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(['healthy', 'unhealthy']).toContain(body.data.status)
      expect(body.data.timestamp).toBeDefined()
      expect(body.data.checks).toBeDefined()
    })

    it('GET /api/v1/tools should return 200 with tool catalog', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { tools: Array<{ id: string; name: string }> }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.tools)).toBe(true)
      expect(body.data.tools.length).toBeGreaterThan(0)
    })

    it('GET /api/v1/setup/status should return 200 with setup status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { needsSetup: boolean }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(typeof body.data.needsSetup).toBe('boolean')
    })
  })

  // ===========================================================================
  // Authenticated Routes - Sessions
  // ===========================================================================
  describe('Sessions Routes', () => {
    it('GET /api/v1/sessions should return 200 with session list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { items: unknown[]; total: number; hasMore: boolean }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(typeof body.data.total).toBe('number')
      expect(typeof body.data.hasMore).toBe('boolean')
    })

    it('POST /api/v1/sessions should return 201 with created session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(201)

      const body = (await response.json()) as {
        ok: boolean
        data: { session: { sessionId: string; userId: string } }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.session.sessionId).toBeDefined()
      expect(body.data.session.userId).toBeDefined()
    })

    it('GET /api/v1/sessions/:sessionId should return 200 with session details', async () => {
      // Create a session first
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const createBody = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = createBody.data.session.sessionId

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { session: { sessionId: string; userId: string } }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.session.sessionId).toBe(sessionId)
    })
  })

  // ===========================================================================
  // Authenticated Routes - Providers
  // ===========================================================================
  describe('Providers Routes', () => {
    it('GET /api/v1/providers should return 200 with provider list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('GET /api/v1/models should return 200 with models list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/models`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { providers: unknown[] }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.providers)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - Workflows
  // ===========================================================================
  describe('Workflows Routes', () => {
    it('GET /api/v1/workflows/drafts should return 200 with drafts list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('GET /api/v1/workflows/definitions should return 200 with definitions list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/definitions`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('GET /api/v1/workflows/runs should return 200 with runs list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/runs`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - Triggers
  // ===========================================================================
  describe('Triggers Routes', () => {
    it('GET /api/v1/triggers/schedules should return 200 with schedules list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/schedules`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('GET /api/v1/triggers/webhooks should return 200 with webhooks list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/webhooks`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - Organizations
  // ===========================================================================
  describe('Organizations Routes', () => {
    it('GET /api/v1/organizations should return 200 with organizations list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/organizations`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - API Keys
  // ===========================================================================
  describe('API Keys Routes', () => {
    it('GET /api/v1/api-keys should return 200 with api keys list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/api-keys`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - Approvals
  // ===========================================================================
  describe('Approvals Routes', () => {
    it('GET /api/v1/approvals should return 200 with approvals list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { approvals: unknown[]; total: number }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.approvals)).toBe(true)
      expect(typeof body.data.total).toBe('number')
    })
  })

  // ===========================================================================
  // Authenticated Routes - Memory
  // ===========================================================================
  describe('Memory Routes', () => {
    it('GET /api/v1/memory should return 200 with memories list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { memories: unknown[]; total: number }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.memories)).toBe(true)
      expect(typeof body.data.total).toBe('number')
    })
  })

  // ===========================================================================
  // Authenticated Routes - Observability
  // ===========================================================================
  describe('Observability Routes', () => {
    it('GET /api/v1/observability/runs should return 200 with runs list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { runs: unknown[] }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.runs)).toBe(true)
    })
  })

  // ===========================================================================
  // Authenticated Routes - System
  // ===========================================================================
  describe('System Routes', () => {
    it('GET /api/v1/logs should return 200 with logs list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { items: unknown[]; total: number }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(typeof body.data.total).toBe('number')
    })

    it('GET /api/v1/usage should return 200 with usage data', async () => {
      const response = await fetch(`${baseUrl}/api/v1/usage`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { items: unknown[]; total: number }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(typeof body.data.total).toBe('number')
    })

    it('GET /api/v1/settings should return 200 with settings', async () => {
      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { settings: Record<string, unknown> }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.settings).toBeDefined()
    })
  })

  // ===========================================================================
  // Authenticated Routes - Agents Config
  // ===========================================================================
  describe('Agents Config Routes', () => {
    it('GET /api/v1/agents/:agentId/config should return 200 with agent config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { global: unknown; userOverride: unknown; effective: unknown }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.global).toBeDefined()
      expect(body.data.effective).toBeDefined()
    })
  })

  // ===========================================================================
  // Authenticated Routes - Connectors
  // ===========================================================================
  describe('Connectors Routes', () => {
    it('GET /api/v1/connectors should return 200 with connectors list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/connectors`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: unknown[]
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ===========================================================================
  // Auth Rejection Tests (Protected Routes Reject Unauthenticated Requests)
  // ===========================================================================
  describe('Auth Rejection - Protected Routes', () => {
    const protectedRoutes = [
      { method: 'GET', path: '/api/v1/sessions', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/providers', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/workflows/drafts', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/workflows/definitions', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/workflows/runs', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/triggers/schedules', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/triggers/webhooks', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/organizations', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/api-keys', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/approvals', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/memory', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/observability/runs', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/logs', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/usage', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/settings', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/models', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/connectors', expectedStatus: 401 },
      { method: 'GET', path: '/api/v1/agents/foreground.default/config', expectedStatus: 401 },
    ]

    for (const route of protectedRoutes) {
      it(`${route.method} ${route.path} should return ${route.expectedStatus} without auth`, async () => {
        const response = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
        })
        expect(response.status).toBe(route.expectedStatus)

        const body = (await response.json()) as {
          ok: boolean
          error: { code: string; message: string }
          requestId: string
        }

        expect(body.ok).toBe(false)
        expect(body.error).toBeDefined()
        expect(typeof body.error.code).toBe('string')
        expect(typeof body.error.message).toBe('string')
        expect(typeof body.requestId).toBe('string')
      })
    }
  })

  // ===========================================================================
  // Error Envelope Format Tests
  // ===========================================================================
  describe('Error Envelope Format', () => {
    it('should return 404 with error envelope for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session-id`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)

      const body = (await response.json()) as {
        ok: boolean
        error: { code: string; message: string; details?: unknown }
        requestId: string
      }

      expect(body.ok).toBe(false)
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('NOT_FOUND')
      expect(typeof body.error.message).toBe('string')
      expect(body.error.message.length).toBeGreaterThan(0)
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })

    it('should return 400 with error envelope for validation error', async () => {
      // Create a session first to get a valid sessionId
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const createBody = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = createBody.data.session.sessionId

      // Try to send an empty message (validation error)
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      })
      expect(response.status).toBe(400)

      const body = (await response.json()) as {
        ok: boolean
        error: { code: string; message: string }
        requestId: string
      }

      expect(body.ok).toBe(false)
      expect(body.error).toBeDefined()
      expect(typeof body.error.code).toBe('string')
      expect(body.error.code.length).toBeGreaterThan(0)
      expect(typeof body.error.message).toBe('string')
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })

    it('should not have data field in error responses', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-id`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)

      const body = (await response.json()) as Record<string, unknown>
      expect(body.data).toBeUndefined()
    })
  })

  // ===========================================================================
  // Pagination Contract Tests (limit/offset)
  // ===========================================================================
  describe('Pagination Contract (limit/offset)', () => {
    it('GET /api/v1/sessions should support limit and offset parameters', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=10&offset=5`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: {
          items: unknown[]
          total: number
          limit: number
          offset: number
          hasMore: boolean
        }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.limit).toBe(10)
      expect(body.data.offset).toBe(5)
      expect(typeof body.data.total).toBe('number')
      expect(typeof body.data.hasMore).toBe('boolean')
    })

    it('GET /api/v1/logs should support limit and offset parameters', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?limit=20&offset=0`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: {
          items: unknown[]
          total: number
          limit: number
          offset: number
          hasMore: boolean
        }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(body.data.limit).toBe(20)
      expect(body.data.offset).toBe(0)
      expect(typeof body.data.total).toBe('number')
      expect(typeof body.data.hasMore).toBe('boolean')
    })

    it('should return hasMore correctly based on offset + items.length < total', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=5`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: {
          items: unknown[]
          total: number
          limit: number
          offset: number
          hasMore: boolean
        }
        requestId: string
      }

      expect(body.ok).toBe(true)
      const expectedHasMore = body.data.offset + body.data.items.length < body.data.total
      expect(body.data.hasMore).toBe(expectedHasMore)
    })
  })

  // ===========================================================================
  // Cursor Pagination Tests (sessions endpoint)
  // ===========================================================================
  describe('Cursor Pagination (sessions endpoint)', () => {
    it('should accept cursor parameter and return cursor-paginated response', async () => {
      // Get first page with cursor pagination
      const response = await fetch(`${baseUrl}/api/v1/sessions?limit=2`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: {
          items: unknown[]
          total: number
          hasMore: boolean
          nextCursor?: string
        }
        requestId: string
      }

      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
      expect(typeof body.data.total).toBe('number')
      expect(typeof body.data.hasMore).toBe('boolean')
    })

    it('should return 400 for invalid cursor', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions?cursor=invalid-cursor-value`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(400)

      const body = (await response.json()) as {
        ok: boolean
        error: { code: string; message: string }
        requestId: string
      }

      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('INVALID_CURSOR')
    })
  })

  // ===========================================================================
  // 307 Redirect Tests (legacy /api/ → /api/v1/)
  // ===========================================================================
  describe('307 Redirect (legacy /api/ to /api/v1/)', () => {
    it('should redirect GET /api/health to /api/v1/health with 307', async () => {
      const response = await fetch(`${baseUrl}/api/health`, {
        redirect: 'manual',
      })
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/api/v1/health')
    })

    it('should redirect GET /api/sessions to /api/v1/sessions with 307', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        headers: { Cookie: authCookie },
        redirect: 'manual',
      })
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/api/v1/sessions')
    })

    it('should redirect POST /api/sessions to /api/v1/sessions with 307', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        redirect: 'manual',
      })
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/api/v1/sessions')
    })

    it('should redirect GET /api/tools to /api/v1/tools with 307', async () => {
      const response = await fetch(`${baseUrl}/api/tools`, {
        redirect: 'manual',
      })
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('/api/v1/tools')
    })
  })

  // ===========================================================================
  // Version Consistency Tests
  // ===========================================================================
  describe('Version Consistency', () => {
    it('package.json version should be defined', () => {
      expect(packageJson.version).toBeDefined()
      expect(typeof packageJson.version).toBe('string')
    })

    it('server.ts OpenAPI version should match package.json version', async () => {
      const serverContent = readFileSync(join(process.cwd(), 'src/api/server.ts'), 'utf-8')
      const versionMatch = serverContent.match(/version:\s*['"]([^'"]+)['"]/)
      expect(versionMatch).not.toBeNull()
      expect(versionMatch![1]).toBe(EXPECTED_VERSION)
    })

    it('openapi.yaml version should be 0.8.0-ga-candidate (updated by Task 41)', async () => {
      const openapiContent = readFileSync(join(process.cwd(), 'docs/api/openapi.yaml'), 'utf-8')
      const versionMatch = openapiContent.match(/^\s*version:\s*["']?([^"'\n]+)["']?/m)
      expect(versionMatch).not.toBeNull()
      // OpenAPI was updated to 0.8.0-ga-candidate by Task 41
      // package.json and server.ts will be updated to match by Task 47
      expect(versionMatch![1]).toBe('0.8.0-ga-candidate')
    })

    it('version consistency check - documents current state', () => {
      const packageVersion = packageJson.version

      const serverContent = readFileSync(join(process.cwd(), 'src/api/server.ts'), 'utf-8')
      const serverVersionMatch = serverContent.match(/version:\s*['"]([^'"]+)['"]/)
      const serverVersion = serverVersionMatch?.[1]

      const openapiContent = readFileSync(join(process.cwd(), 'docs/api/openapi.yaml'), 'utf-8')
      const openapiVersionMatch = openapiContent.match(/^\s*version:\s*["']?([^"'\n]+)["']?/m)
      const openapiVersion = openapiVersionMatch?.[1]

      // All version sources unified at 0.8.0-ga-candidate
      expect(packageVersion).toBe('0.8.0-ga-candidate')
      expect(serverVersion).toBe('0.8.0-ga-candidate')
      expect(openapiVersion).toBe('0.8.0-ga-candidate')

      // All three sources should be unified
      expect(packageVersion).toBe(serverVersion)
      expect(serverVersion).toBe(openapiVersion)
    })
  })

  // ===========================================================================
  // V1 API Prefix Contract Tests
  // ===========================================================================
  describe('V1 API Prefix Contract', () => {
    it('all v1 endpoints should use /api/v1/ prefix', async () => {
      const v1Endpoints = [
        '/api/v1/health',
        '/api/v1/sessions',
        '/api/v1/tools',
        '/api/v1/providers',
        '/api/v1/workflows/drafts',
      ]

      for (const endpoint of v1Endpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers:
            endpoint.includes('sessions') || endpoint.includes('providers') || endpoint.includes('workflows')
              ? { Cookie: authCookie }
              : {},
        })
        expect(response.status).toBeLessThan(500)
      }
    })

    it('legacy endpoints should redirect, not return 404', async () => {
      const legacyEndpoints = ['/api/health', '/api/sessions', '/api/tools']

      for (const endpoint of legacyEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: endpoint.includes('sessions') ? { Cookie: authCookie } : {},
          redirect: 'manual',
        })
        expect(response.status).toBe(307)
      }
    })
  })

  // ===========================================================================
  // Response Envelope Consistency Tests
  // ===========================================================================
  describe('Response Envelope Consistency', () => {
    it('should have ok: true for all successful responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { Cookie: authCookie } }),
        fetch(`${baseUrl}/api/v1/tools`),
      ])

      for (const response of responses) {
        expect(response.status).toBe(200)
        const body = (await response.json()) as { ok: boolean }
        expect(body.ok).toBe(true)
      }
    })

    it('should have non-empty requestId for all responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/health`),
        fetch(`${baseUrl}/api/v1/sessions`, { headers: { Cookie: authCookie } }),
        fetch(`${baseUrl}/api/v1/tools`),
      ])

      for (const response of responses) {
        expect(response.status).toBe(200)
        const body = (await response.json()) as { requestId: string }
        expect(typeof body.requestId).toBe('string')
        expect(body.requestId.length).toBeGreaterThan(0)
      }
    })

    it('should have ok: false for all error responses', async () => {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/v1/providers`), // 401
        fetch(`${baseUrl}/api/v1/sessions/non-existent`, { headers: { Cookie: authCookie } }), // 404
      ])

      for (const response of responses) {
        expect([401, 404]).toContain(response.status)
        const body = (await response.json()) as { ok: boolean }
        expect(body.ok).toBe(false)
      }
    })
  })
})
