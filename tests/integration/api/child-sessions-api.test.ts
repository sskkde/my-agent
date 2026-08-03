import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Session } from '../../../src/storage/session-store.js'
import { generateSessionToken, hashToken } from '../../../src/storage/auth-crypto.js'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

/**
 * Todo 11 — tenant-safe child-session APIs.
 *
 * Covers:
 * - GET /api/v1/sessions/:sessionId/children (parent-scoped, owner + tenant checked)
 * - Child detail/timeline through the existing session routes (owner-only)
 * - Parent-scoped child resume/cancel endpoints
 * - Normal GET /sessions excludes internal children
 * - Parent PATCH archive cascades to descendants (archiveDescendants)
 * - POST /sessions/:childId/messages -> CHILD_SESSION_INTERNAL_ONLY
 * - Cross-user / cross-tenant access returns 403/404 without existence leakage
 */

interface ConsoleSessionInfoShape {
  sessionId: string
  userId: string
  status: string
  sessionKind?: string
  parentSessionId?: string
  taskId?: string
  agentProfile?: string
  launchMode?: string
  subagentDepth?: number
}

describe('Child sessions API (tenant-safe)', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let ownerCookie: string
  let ownerUserId: string
  let otherUserId: string

  let childSeq = 0

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    ownerCookie = ctx.authCookie

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: ownerCookie },
    })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { data: { user: { userId: string } } }
    ownerUserId = meBody.data.user.userId

    // Second user for cross-user / dedicated list tests (setup/user only allows one user)
    const otherAuthToken = generateSessionToken()
    ctx.apiContext.stores.userStore.create({
      userId: 'other-user-id',
      username: 'otheruser',
      passwordHash: 'not-used',
      role: 'user',
    })
    ctx.apiContext.stores.authTokenStore.create({
      tokenHash: hashToken(otherAuthToken),
      userId: 'other-user-id',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    otherUserId = 'other-user-id'
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  function createParent(userId: string, title = 'Parent session'): Session {
    const sessionId = `parent-${Date.now()}-${childSeq++}`
    ctx.apiContext.stores.sessionStore.create({
      sessionId,
      userId,
      title,
      status: 'active',
      messageCount: 0,
    })
    const created = ctx.apiContext.stores.sessionStore.getById(sessionId)
    if (!created) throw new Error('parent not created')
    return created
  }

  function createChild(parent: Session, title = 'Subagent task'): Session {
    const sessionId = `child-${Date.now()}-${childSeq++}`
    ctx.apiContext.stores.sessionStore.createChildSession({
      sessionId,
      userId: parent.userId,
      parentSessionId: parent.sessionId,
      title,
      taskId: sessionId,
      agentProfile: 'generic',
      launchMode: 'foreground',
      subagentDepth: 1,
    })
    const created = ctx.apiContext.stores.sessionStore.getChildSessionById(sessionId)
    if (!created) throw new Error('child not created')
    return created
  }

  describe('GET /api/v1/sessions/:sessionId/children', () => {
    it('lists child sessions for the owning parent', async () => {
      const parent = createParent(ownerUserId)
      const childA = createChild(parent)
      const childB = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: { items: ConsoleSessionInfoShape[]; total: number; limit: number; offset: number; hasMore: boolean }
      }
      expect(body.ok).toBe(true)
      expect(body.data.total).toBe(2)
      const ids = body.data.items.map((i) => i.sessionId)
      expect(ids).toContain(childA.sessionId)
      expect(ids).toContain(childB.sessionId)
      const first = body.data.items.find((i) => i.sessionId === childA.sessionId)!
      expect(first.sessionKind).toBe('subagent')
      expect(first.parentSessionId).toBe(parent.sessionId)
      expect(first.taskId).toBe(childA.sessionId)
      expect(first.agentProfile).toBe('generic')
      expect(first.launchMode).toBe('foreground')
      expect(first.subagentDepth).toBe(1)
      // The parent itself must never appear in its own children list
      expect(ids).not.toContain(parent.sessionId)
    })

    it('returns an empty list for a parent without children', async () => {
      const parent = createParent(ownerUserId)
      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { items: unknown[]; total: number } }
      expect(body.data.items).toEqual([])
      expect(body.data.total).toBe(0)
    })

    it('returns 404 for a missing parent', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sessions/nonexistent-parent/children`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { ok: false; error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('returns the same 404 for a parent owned by another user (no existence leak)', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const missingRes = await fetch(`${baseUrl}/api/v1/sessions/nonexistent-parent/children`, {
        headers: { Cookie: ownerCookie },
      })
      const forbiddenRes = await fetch(`${baseUrl}/api/v1/sessions/${foreignParent.sessionId}/children`, {
        headers: { Cookie: ownerCookie },
      })
      expect(forbiddenRes.status).toBe(404)

      const forbiddenBody = (await forbiddenRes.json()) as { ok: false; error: { code: string; message: string } }
      const missingBody = (await missingRes.json()) as { ok: false; error: { code: string; message: string } }
      // Identical response for "exists but forbidden" vs "does not exist"
      expect(forbiddenBody.error.code).toBe(missingBody.error.code)
      expect(forbiddenBody.error.message).toBe(missingBody.error.message)

      // Child discovery must not leak through the forbidden parent either
      const childProbe = await fetch(`${baseUrl}/api/v1/sessions/${foreignParent.sessionId}/children`, {
        headers: { Cookie: ownerCookie },
      })
      const childProbeBody = (await childProbe.json()) as { error?: { code: string } }
      expect(childProbe.status).toBe(404)
      expect(childProbeBody.error?.code).toBe('NOT_FOUND')
      expect(foreignChild.sessionId.length).toBeGreaterThan(0)
    })

    it('requires authentication', async () => {
      const parent = createParent(ownerUserId)
      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children`)
      expect(res.status).toBe(401)
    })
  })

  describe('normal GET /api/v1/sessions excludes internal children', () => {
    it('does not list child sessions and does not count them', async () => {
      // Dedicated user so the list/count assertions are deterministic
      const listUserId = `list-user-${Date.now()}`
      const listToken = generateSessionToken()
      ctx.apiContext.stores.userStore.create({
        userId: listUserId,
        username: listUserId,
        passwordHash: 'not-used',
        role: 'user',
      })
      ctx.apiContext.stores.authTokenStore.create({
        tokenHash: hashToken(listToken),
        userId: listUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      const listCookie = `agent-platform-session=${listToken}`

      const parent = createParent(listUserId, 'Visible parent')
      const child = createChild(parent, 'Hidden child')

      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: listCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { items: { sessionId: string }[]; total: number; limit: number; offset: number; hasMore: boolean }
      }
      const ids = body.data.items.map((i) => i.sessionId)
      expect(ids).toContain(parent.sessionId)
      expect(ids).not.toContain(child.sessionId)
      expect(body.data.total).toBe(1)
      expect(body.data.total).toBe(body.data.items.length)
    })
  })

  describe('child detail / timeline via existing session routes', () => {
    it('owner can open child detail with child fields', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${child.sessionId}`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { session: ConsoleSessionInfoShape } }
      expect(body.data.session.sessionKind).toBe('subagent')
      expect(body.data.session.parentSessionId).toBe(parent.sessionId)
      expect(body.data.session.taskId).toBe(child.sessionId)
    })

    it('owner can open child timeline', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${child.sessionId}/timeline`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: { items: unknown[]; total: number } }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.items)).toBe(true)
    })

    it('owner can open child timeline stream', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const controller = new AbortController()
      const res = await fetch(`${baseUrl}/api/v1/sessions/${child.sessionId}/timeline/stream`, {
        headers: { Cookie: ownerCookie },
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      controller.abort()
    })

    it('cross-user child detail returns 403 without leaking child kind', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${foreignChild.sessionId}`, {
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { ok: false; error: { code: string } }
      expect(body.error.code).toBe('FORBIDDEN')
    })

    it('cross-user child timeline and stream return 403', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const timelineRes = await fetch(`${baseUrl}/api/v1/sessions/${foreignChild.sessionId}/timeline`, {
        headers: { Cookie: ownerCookie },
      })
      expect(timelineRes.status).toBe(403)

      const streamRes = await fetch(`${baseUrl}/api/v1/sessions/${foreignChild.sessionId}/timeline/stream`, {
        headers: { Cookie: ownerCookie },
      })
      expect(streamRes.status).toBe(403)
    })
  })

  describe('parent-scoped child resume', () => {
    it('parent owner can resume a child task', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children/${child.sessionId}/resume`, {
        method: 'POST',
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        data: { session: ConsoleSessionInfoShape; timeline: unknown[] }
      }
      expect(body.ok).toBe(true)
      expect(body.data.session.sessionId).toBe(child.sessionId)
      expect(body.data.session.sessionKind).toBe('subagent')
      expect(Array.isArray(body.data.timeline)).toBe(true)
    })

    it('resume of a foreign parent returns the same 404 as a missing one', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const missingRes = await fetch(
        `${baseUrl}/api/v1/sessions/nonexistent-parent/children/${foreignChild.sessionId}/resume`,
        { method: 'POST', headers: { Cookie: ownerCookie } },
      )
      const forbiddenRes = await fetch(
        `${baseUrl}/api/v1/sessions/${foreignParent.sessionId}/children/${foreignChild.sessionId}/resume`,
        { method: 'POST', headers: { Cookie: ownerCookie } },
      )
      expect(forbiddenRes.status).toBe(404)
      const missingBody = (await missingRes.json()) as { error: { code: string; message: string } }
      const forbiddenBody = (await forbiddenRes.json()) as { error: { code: string; message: string } }
      expect(forbiddenBody.error.code).toBe('NOT_FOUND')
      expect(forbiddenBody.error.code).toBe(missingBody.error.code)
      expect(forbiddenBody.error.message).toBe(missingBody.error.message)
    })

    it('resume of a child that is not under the given parent returns 404', async () => {
      const parentA = createParent(ownerUserId)
      const parentB = createParent(ownerUserId)
      const childOfA = createChild(parentA)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parentB.sessionId}/children/${childOfA.sessionId}/resume`, {
        method: 'POST',
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('resume of a missing child returns 404', async () => {
      const parent = createParent(ownerUserId)
      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children/nonexistent-child/resume`, {
        method: 'POST',
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('parent-scoped child cancel', () => {
    it('parent owner can cancel a child task with an active run', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const runId = `krun_child_cancel_${Date.now()}_${childSeq++}`
      ctx.apiContext.stores.kernelRunStore.create({
        runId,
        sessionId: child.sessionId,
        agentId: 'test-agent',
        invocationSource: 'test',
        status: 'building_context',
      })

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children/${child.sessionId}/cancel`, {
        method: 'POST',
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; data: { status: string; runId: string } }
      expect(body.ok).toBe(true)
      expect(body.data.status).toBe('cancelled')
      expect(body.data.runId).toBe(runId)
      expect(ctx.apiContext.stores.kernelRunStore.getById(runId)?.status).toBe('cancelled')
    })

    it('cancel returns 404 when the child has no active run', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children/${child.sessionId}/cancel`, {
        method: 'POST',
        headers: { Cookie: ownerCookie },
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('cancel of a foreign parent returns the same 404 as a missing one', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const forbiddenRes = await fetch(
        `${baseUrl}/api/v1/sessions/${foreignParent.sessionId}/children/${foreignChild.sessionId}/cancel`,
        { method: 'POST', headers: { Cookie: ownerCookie } },
      )
      expect(forbiddenRes.status).toBe(404)
      const body = (await forbiddenRes.json()) as { error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('parent archive cascades to descendants', () => {
    it('archiving a parent soft-archives child and grandchild', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)
      const grandchild = createChild(child)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ status: 'archived' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { session: { status: string } } }
      expect(body.data.session.status).toBe('archived')

      // Children are soft-archived but never deleted
      expect(ctx.apiContext.stores.sessionStore.getById(child.sessionId)?.status).toBe('archived')
      expect(ctx.apiContext.stores.sessionStore.getById(grandchild.sessionId)?.status).toBe('archived')
      expect(ctx.apiContext.stores.sessionStore.getById(child.sessionId)).not.toBeNull()
      expect(ctx.apiContext.stores.sessionStore.getById(grandchild.sessionId)).not.toBeNull()
    })

    it('archiving a parent does not touch siblings or unrelated sessions', async () => {
      const parentA = createParent(ownerUserId)
      const parentB = createParent(ownerUserId)
      const childA = createChild(parentA)
      const childB = createChild(parentB)

      await fetch(`${baseUrl}/api/v1/sessions/${parentA.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ status: 'archived' }),
      })

      expect(ctx.apiContext.stores.sessionStore.getById(childA.sessionId)?.status).toBe('archived')
      expect(ctx.apiContext.stores.sessionStore.getById(childB.sessionId)?.status).toBe('active')
      expect(ctx.apiContext.stores.sessionStore.getById(parentB.sessionId)?.status).toBe('active')
    })

    it('archiving is idempotent for descendants already archived', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ status: 'archived' }),
      })
      const second = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ status: 'archived' }),
      })
      expect(second.status).toBe(200)
      expect(ctx.apiContext.stores.sessionStore.getById(child.sessionId)?.status).toBe('archived')
    })
  })

  describe('direct message submission to child sessions is forbidden', () => {
    it('returns CHILD_SESSION_INTERNAL_ONLY for the owner submitting to a child', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${child.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ text: 'direct message to child' }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { ok: false; error: { code: string } }
      expect(body.error.code).toBe('CHILD_SESSION_INTERNAL_ONLY')
    })

    it('cross-user child message returns plain 403 without revealing the child kind', async () => {
      const foreignParent = createParent(otherUserId)
      const foreignChild = createChild(foreignParent)

      const res = await fetch(`${baseUrl}/api/v1/sessions/${foreignChild.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ text: 'probe' }),
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('FORBIDDEN')
    })
  })

  describe('cross-tenant isolation', () => {
    it('child list/detail/resume/cancel return 404 when the tenant resolver points elsewhere', async () => {
      const parent = createParent(ownerUserId)
      const child = createChild(parent)

      const original = process.env.DEFAULT_TENANT_ID
      process.env.DEFAULT_TENANT_ID = 'tenant-other'
      try {
        const listRes = await fetch(`${baseUrl}/api/v1/sessions/${parent.sessionId}/children`, {
          headers: { Cookie: ownerCookie },
        })
        expect(listRes.status).toBe(404)

        const detailRes = await fetch(`${baseUrl}/api/v1/sessions/${child.sessionId}`, {
          headers: { Cookie: ownerCookie },
        })
        expect(detailRes.status).toBe(404)

        const resumeRes = await fetch(
          `${baseUrl}/api/v1/sessions/${parent.sessionId}/children/${child.sessionId}/resume`,
          { method: 'POST', headers: { Cookie: ownerCookie } },
        )
        expect(resumeRes.status).toBe(404)

        const cancelRes = await fetch(
          `${baseUrl}/api/v1/sessions/${parent.sessionId}/children/${child.sessionId}/cancel`,
          { method: 'POST', headers: { Cookie: ownerCookie } },
        )
        expect(cancelRes.status).toBe(404)
      } finally {
        if (original === undefined) {
          delete process.env.DEFAULT_TENANT_ID
        } else {
          process.env.DEFAULT_TENANT_ID = original
        }
      }
    })
  })

  describe('direct client creation of child sessions is not possible', () => {
    it('POST /sessions ignores child fields and never creates a subagent-kind session', async () => {
      const res = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ sessionKind: 'subagent', parentSessionId: 'some-parent', taskId: 'some-task' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { data: { session: { sessionId: string } } }
      const created = ctx.apiContext.stores.sessionStore.getById(body.data.session.sessionId)
      expect(created).not.toBeNull()
      expect(created?.sessionKind ?? 'foreground').not.toBe('subagent')
      expect(created?.parentSessionId).toBeUndefined()
      expect(created?.taskId).toBeUndefined()
    })
  })
})
