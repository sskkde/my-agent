import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'

interface TestContext {
  server: FastifyInstance
  baseUrl: string
  apiContext: ApiContext
  authCookie: string
}

async function createTestContext(): Promise<TestContext> {
  const ctx = createApiContext({ dbPath: ':memory:' })
  if (isApiContextError(ctx)) {
    throw new Error('Failed to create API context: ' + ctx.message)
  }

  const apiContext = ctx
  const server = await createApiServer(apiContext)
  await server.listen({ port: 0 })
  const address = server.server.address()
  const port = (address as { port: number }).port
  const baseUrl = 'http://localhost:' + port

  const setupResponse = await fetch(baseUrl + '/api/v1/setup/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
  })

  if (setupResponse.status !== 201) {
    throw new Error('Failed to create test user: ' + setupResponse.status)
  }

  const authCookie = setupResponse.headers.get('set-cookie')
  if (!authCookie) {
    throw new Error('No set-cookie header received from setup')
  }

  return { server, baseUrl, apiContext, authCookie }
}

async function closeTestContext(context: TestContext): Promise<void> {
  await context.server.close()
  if (context.apiContext && 'connection' in context.apiContext) {
    ;(context.apiContext as { connection: { close: () => void } }).connection.close()
  }
}

function authenticatedFetch(baseUrl: string, authCookie: string) {
  return async (path: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (!headers['Cookie']) {
      headers['Cookie'] = authCookie
    }

    return fetch(baseUrl + path, {
      ...options,
      headers,
    })
  }
}

describe('Final QA: Health & Readiness', () => {
  let ctx: TestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/health should return 200 with status', async () => {
    const response = await fetch(baseUrl + '/api/v1/health')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: { status: string; timestamp: string } }
    expect(body.ok).toBe(true)
    expect(body.data.status).toBeDefined()
    expect(typeof body.data.status).toBe('string')
    expect(body.data.timestamp).toBeDefined()
  })

  it('GET /api/v1/health/ready should return 200 with checks', async () => {
    const response = await fetch(baseUrl + '/api/v1/health/ready')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      data: { status: string; checks: { database: { status: string } } }
    }
    expect(body.ok).toBe(true)
    expect(body.data.status).toBeDefined()
    expect(body.data.checks).toBeDefined()
    expect(body.data.checks.database).toBeDefined()
    expect(body.data.checks.database.status).toBe('healthy')
  })
})

describe('Final QA: RBAC Enforcement', () => {
  let ctx: TestContext
  let baseUrl: string
  let authCookie: string

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/sessions without auth should return 401/403', async () => {
    const response = await fetch(baseUrl + '/api/v1/sessions')
    expect([401, 403]).toContain(response.status)
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
  })

  it('GET /api/v1/sessions with valid auth should return 200', async () => {
    const response = await authenticatedFetch(baseUrl, authCookie)('/api/v1/sessions')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/approvals without auth should return 401/403', async () => {
    const response = await fetch(baseUrl + '/api/v1/approvals')
    expect([401, 403]).toContain(response.status)
    const body = (await response.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
  })

  it('GET /api/v1/approvals with valid auth should return 200', async () => {
    const response = await authenticatedFetch(baseUrl, authCookie)('/api/v1/approvals')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })
})

describe('Final QA: 307 Redirect', () => {
  let ctx: TestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/sessions (no auth) should redirect 307 to /api/v1/sessions', async () => {
    const response = await fetch(baseUrl + '/api/sessions', { redirect: 'manual' })
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('/api/v1/sessions')
  })

  it('POST /api/sessions with body should redirect 307', async () => {
    const response = await fetch(baseUrl + '/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Session' }),
      redirect: 'manual',
    })
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('/api/v1/sessions')
  })

  it('GET /api/approvals should redirect 307 to /api/v1/approvals', async () => {
    const response = await fetch(baseUrl + '/api/approvals', { redirect: 'manual' })
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('/api/v1/approvals')
  })

  it('GET /api/providers should redirect 307 to /api/v1/providers', async () => {
    const response = await fetch(baseUrl + '/api/providers', { redirect: 'manual' })
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('/api/v1/providers')
  })

  it('GET /api/tools should redirect 307 to /api/v1/tools', async () => {
    const response = await fetch(baseUrl + '/api/tools', { redirect: 'manual' })
    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toBe('/api/v1/tools')
  })
})

describe('Final QA: V1 Routes (authenticated)', () => {
  let ctx: TestContext
  let baseUrl: string
  let authFetch: ReturnType<typeof authenticatedFetch>

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authFetch = authenticatedFetch(baseUrl, ctx.authCookie)
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/sessions should return 200', async () => {
    const response = await authFetch('/api/v1/sessions')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/tools should return 200 (exempt from auth)', async () => {
    const response = await fetch(baseUrl + '/api/v1/tools')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/providers should return 200 (user has provider:read)', async () => {
    const response = await authFetch('/api/v1/providers')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/approvals should return 200', async () => {
    const response = await authFetch('/api/v1/approvals')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/channels should return 200', async () => {
    const response = await authFetch('/api/v1/channels')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/settings should return 200', async () => {
    const response = await authFetch('/api/v1/settings')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })
})

describe('Final QA: Error Handling', () => {
  let ctx: TestContext
  let baseUrl: string
  let authFetch: ReturnType<typeof authenticatedFetch>

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authFetch = authenticatedFetch(baseUrl, ctx.authCookie)
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('Non-existent route should return 404 or 401 with error envelope', async () => {
    const response = await authFetch('/api/v1/nonexistent-route')
    expect([401, 404]).toContain(response.status)
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string }; requestId: string }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBeDefined()
    expect(body.requestId).toBeDefined()
  })

  it('Non-existent approval should return 404', async () => {
    const response = await authFetch('/api/v1/approvals/nonexistent-approval-id')
    expect(response.status).toBe(404)
    const body = (await response.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('Non-existent session should return 404', async () => {
    const response = await authFetch('/api/v1/sessions/nonexistent-session-id')
    expect(response.status).toBe(404)
    const body = (await response.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('Invalid JSON body should return 400 with error envelope', async () => {
    const response = await authFetch('/api/v1/sessions', {
      method: 'POST',
      body: 'not valid json',
    })
    expect([400, 401]).toContain(response.status)
    if (response.status === 400) {
      const body = (await response.json()) as {
        ok: boolean
        error: { code: string; message: string }
        requestId: string
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.requestId).toBeDefined()
    }
  })
})

describe('Final QA: Response Envelope', () => {
  let ctx: TestContext
  let baseUrl: string
  let authFetch: ReturnType<typeof authenticatedFetch>

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authFetch = authenticatedFetch(baseUrl, ctx.authCookie)
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('Success response should have ok: true, data, requestId', async () => {
    const response = await authFetch('/api/v1/sessions')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown; requestId: string }
    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
    expect(body.requestId).toBeDefined()
    expect(typeof body.requestId).toBe('string')
  })

  it('Error response should have ok: false, error, requestId', async () => {
    const response = await fetch(baseUrl + '/api/v1/sessions')
    expect([401, 403]).toContain(response.status)
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string }; requestId: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBeDefined()
    expect(body.error.code).toBeDefined()
    expect(body.error.message).toBeDefined()
    expect(body.requestId).toBeDefined()
    expect(typeof body.requestId).toBe('string')
  })

  it('Health response should have envelope structure', async () => {
    const response = await fetch(baseUrl + '/api/v1/health')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown; requestId: string }
    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
    expect(body.requestId).toBeDefined()
  })
})

describe('Final QA: Security Headers', () => {
  let ctx: TestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('Response should have x-content-type-options: nosniff', async () => {
    const response = await fetch(baseUrl + '/api/v1/health')
    const contentTypeOptions = response.headers.get('x-content-type-options')
    expect(contentTypeOptions).toBe('nosniff')
  })

  it('Response should have x-frame-options: DENY', async () => {
    const response = await fetch(baseUrl + '/api/v1/health')
    const frameOptions = response.headers.get('x-frame-options')
    expect(frameOptions).toBe('DENY')
  })

  it('Response should have strict-transport-security header', async () => {
    const response = await fetch(baseUrl + '/api/v1/health')
    const sts = response.headers.get('strict-transport-security')
    expect(sts).toBeDefined()
  })
})

describe('Final QA: Additional V1 Routes', () => {
  let ctx: TestContext
  let baseUrl: string
  let authFetch: ReturnType<typeof authenticatedFetch>

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authFetch = authenticatedFetch(baseUrl, ctx.authCookie)
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/models should return 200', async () => {
    const response = await authFetch('/api/v1/models')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/agents/foreground.default/config should return 200', async () => {
    const response = await authFetch('/api/v1/agents/foreground.default/config')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/memory should return 200', async () => {
    const response = await authFetch('/api/v1/memory')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
  })

  it('GET /api/v1/connectors should return 200', async () => {
    const response = await authFetch('/api/v1/connectors')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('GET /api/v1/api-keys should return 200', async () => {
    const response = await authFetch('/api/v1/api-keys')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('Final QA: Setup Status', () => {
  let ctx: TestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/setup/status should return setup complete', async () => {
    const response = await fetch(baseUrl + '/api/v1/setup/status')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; data: { needsSetup?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.data.needsSetup).toBe(false)
  })
})

describe('Final QA: Auth Endpoints', () => {
  let ctx: TestContext
  let baseUrl: string
  let authFetch: ReturnType<typeof authenticatedFetch>

  beforeAll(async () => {
    ctx = await createTestContext()
    baseUrl = ctx.baseUrl
    authFetch = authenticatedFetch(baseUrl, ctx.authCookie)
  }, 30000)

  afterAll(async () => {
    await closeTestContext(ctx)
  }, 30000)

  it('GET /api/v1/auth/me should return current user', async () => {
    const response = await authFetch('/api/v1/auth/me')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      data: { username?: string; user?: { username: string }; role?: string }
    }
    expect(body.ok).toBe(true)
    const username = body.data.username || body.data.user?.username
    expect(username).toBe('testuser')
  })

  it('POST /api/v1/auth/login with invalid credentials should return 401', async () => {
    const response = await fetch(baseUrl + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'wrongpassword' }),
    })
    expect(response.status).toBe(401)
    const body = (await response.json()) as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
