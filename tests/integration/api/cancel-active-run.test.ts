import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

describe('Cancel active run API', () => {
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

  it('returns 401 without auth', async () => {
    const response = await fetch(`${baseUrl}/api/v1/sessions/fake-session/cancel-active-run`, {
      method: 'POST',
    })
    expect(response.status).toBe(401)
  })

  it('returns 404 for non-existent session', async () => {
    const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/cancel-active-run`, {
      method: 'POST',
      headers: { Cookie: authCookie },
    })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('returns 404 when no active run exists for session', async () => {
    // Create a session via API
    const createRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({}),
    })
    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as { ok: true; data: { session: { sessionId: string } } }
    const sessionId = createBody.data.session.sessionId

    // No active run — should get 404
    const cancelRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/cancel-active-run`, {
      method: 'POST',
      headers: { Cookie: authCookie },
    })
    expect(cancelRes.status).toBe(404)
    const cancelBody = (await cancelRes.json()) as { ok: false; error: { code: string } }
    expect(cancelBody.error.code).toBe('NOT_FOUND')
  })

  it('cancels an active kernel run and returns success', async () => {
    // Create a session via API
    const createRes = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({}),
    })
    expect(createRes.status).toBe(201)
    const createBody = (await createRes.json()) as { ok: true; data: { session: { sessionId: string } } }
    const sessionId = createBody.data.session.sessionId

    // Create an active kernel run via the store
    const runId = `krun_cancel_test_${Date.now()}`
    ctx.apiContext.stores.kernelRunStore.create({
      runId,
      sessionId,
      agentId: 'test-agent',
      invocationSource: 'test',
      status: 'building_context',
    })

    // Cancel the active run
    const cancelRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/cancel-active-run`, {
      method: 'POST',
      headers: { Cookie: authCookie },
    })
    expect(cancelRes.status).toBe(200)
    const cancelBody = (await cancelRes.json()) as { ok: true; data: { status: string; runId: string } }
    expect(cancelBody.ok).toBe(true)
    expect(cancelBody.data.status).toBe('cancelled')
    expect(cancelBody.data.runId).toBe(runId)

    // Verify kernel run is now cancelled in store
    const updatedRun = ctx.apiContext.stores.kernelRunStore.getById(runId)
    expect(updatedRun?.status).toBe('cancelled')

    // Second cancel should be idempotent — run is already cancelled
    const cancelAgainRes = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/cancel-active-run`, {
      method: 'POST',
      headers: { Cookie: authCookie },
    })
    expect(cancelAgainRes.status).toBe(404)
  })
})
