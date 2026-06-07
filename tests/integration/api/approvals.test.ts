import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

describe('Approvals API', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string
  let userId: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: authCookie },
    })
    const meBody = (await meResponse.json()) as { data: { user: { userId: string } } }
    userId = meBody.data.user.userId
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  describe('GET /api/approvals', () => {
    it('should return empty approvals list when no approvals exist for user', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { approvals: unknown[]; total: number } }
      expect(body.data.approvals).toEqual([])
      expect(body.data.total).toBe(0)
    })

    it('should return only approvals for authenticated user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval1 = approvalStore.create({
        id: 'approval-user-1',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const approval2 = approvalStore.create({
        id: 'approval-other-user',
        userId: 'other-user',
        sessionId: 'session-2',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: { approvals: Array<{ id: string; userId: string }>; total: number }
      }
      expect(body.data.total).toBe(1)
      expect(body.data.approvals[0].id).toBe(approval1.id)
      expect(body.data.approvals[0].userId).toBe(userId)

      approvalStore.delete(approval1.id)
      approvalStore.delete(approval2.id)
    })

    it('should return both pending and resolved approvals for user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const pendingApproval = approvalStore.create({
        id: 'pending-approval',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const resolvedApproval = approvalStore.create({
        id: 'resolved-approval',
        userId,
        sessionId: 'session-2',
        status: 'approved',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: { approvals: Array<{ id: string; status: string }>; total: number }
      }
      expect(body.data.total).toBe(2)

      const ids = body.data.approvals.map((a) => a.id)
      expect(ids).toContain('pending-approval')
      expect(ids).toContain('resolved-approval')

      approvalStore.delete(pendingApproval.id)
      approvalStore.delete(resolvedApproval.id)
    })
  })

  describe('GET /api/approvals/:approvalId', () => {
    it('should return 404 for non-existent approval', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return 404 for approval owned by different user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const otherUserApproval = approvalStore.create({
        id: 'other-user-approval',
        userId: 'other-user',
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${otherUserApproval.id}`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(404)

      approvalStore.delete(otherUserApproval.id)
    })

    it('should return approval detail for owner', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'owner-approval',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        resource: 'test-resource',
        justification: 'test justification',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: { approval: { id: string; userId: string; actionType: string; resource?: string } }
      }
      expect(body.data.approval.id).toBe(approval.id)
      expect(body.data.approval.userId).toBe(userId)
      expect(body.data.approval.actionType).toBe('test_action')
      expect(body.data.approval.resource).toBe('test-resource')

      approvalStore.delete(approval.id)
    })
  })

  describe('PATCH /api/approvals/:approvalId', () => {
    it('should return 404 for non-existent approval', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(404)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return 400 for invalid decision', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'invalid' }),
      })
      expect(response.status).toBe(400)
    })

    it('should return 400 for missing decision field', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ reason: 'some reason' }),
      })
      expect(response.status).toBe(400)
    })

    it('should return 409 for already resolved approval', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'already-resolved',
        userId,
        sessionId: 'session-1',
        status: 'approved',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(409)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONFLICT')

      approvalStore.delete(approval.id)
    })

    it('should use authenticated user for responseBy', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'test-response-by',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved', reason: 'looks good' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; approvalId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.approvalId).toBe(approval.id)
      expect(body.data.status).toBe('approved')

      const updated = approvalStore.getById(approval.id)
      expect(updated?.responseBy).toBe(userId)
      expect(updated?.responseReason).toBe('looks good')

      approvalStore.delete(approval.id)
    })

    it('should reject approval with reason', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'test-reject',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'not authorized' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; approvalId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('rejected')

      const updated = approvalStore.getById(approval.id)
      expect(updated?.responseBy).toBe(userId)
      expect(updated?.responseReason).toBe('not authorized')

      approvalStore.delete(approval.id)
    })

    it('should NOT create permission grant when approval is rejected', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-reject-no-grant',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'not authorized' }),
      })
      expect(response.status).toBe(200)

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length)

      approvalStore.delete(approval.id)
    })

    it('should create permission grant with correct fields when approval is approved', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-approve-with-grant',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved', reason: 'looks good' }),
      })
      expect(response.status).toBe(200)

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length + 1)

      const newGrant = grantsAfter.find((g) => !grantsBefore.some((b) => b.id === g.id))
      expect(newGrant).toBeDefined()
      expect(newGrant!.userId).toBe(userId)
      expect(newGrant!.scope).toBe('tool')
      expect(newGrant!.action).toBe('test_action')
      expect(newGrant!.resourcePattern).toBe('test-resource')
      expect(newGrant!.sourceContext).toBe(approval.id)
      expect(newGrant!.expiresAt).toBeDefined()

      const expiresAt = new Date(newGrant!.expiresAt!)
      const now = new Date()
      const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      expect(hoursUntilExpiry).toBeGreaterThan(0.5)
      expect(hoursUntilExpiry).toBeLessThan(2)

      approvalStore.delete(approval.id)
      grantStore.delete(newGrant!.id)
    })

    it('should not crash when approval has null metadata', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'test-null-metadata',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        metadata: undefined,
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; approvalId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')

      approvalStore.delete(approval.id)
    })

    it('should not crash when approval has invalid JSON metadata', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'test-invalid-json-metadata',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        metadata: '{invalid json',
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; approvalId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')

      approvalStore.delete(approval.id)
    })

    it('should not crash when metadata contains non-existent pendingActionId', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'test-nonexistent-pending-action',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        metadata: JSON.stringify({ pendingActionId: 'action_nonexistent_123' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; approvalId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')

      approvalStore.delete(approval.id)
    })

    it('should dispatch resume_agent_run when approved with waiting_for_approval action', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const runtimeActionStore = ctx.apiContext.stores.runtimeActionStore

      const pendingActionId = `action_${Date.now()}_test`
      runtimeActionStore.save({
        actionId: pendingActionId,
        actionType: 'execute_tool',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'execute_tool',
        payload: { toolName: 'test' },
        sessionId: 'session-1',
        userId,
        status: 'waiting_for_approval',
        correlationId: 'corr_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const approval = approvalStore.create({
        id: 'test-approved-resume',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        metadata: JSON.stringify({ pendingActionId }),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })
      expect(response.status).toBe(200)

      const updatedAction = runtimeActionStore.findById(pendingActionId)
      expect(updatedAction?.status).toBe('created')

      approvalStore.delete(approval.id)
    })

    it('should mark action as denied when rejected with waiting_for_approval action', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const runtimeActionStore = ctx.apiContext.stores.runtimeActionStore

      const pendingActionId = `action_${Date.now()}_test_reject`
      runtimeActionStore.save({
        actionId: pendingActionId,
        actionType: 'execute_tool',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'execute_tool',
        payload: { toolName: 'test' },
        sessionId: 'session-1',
        userId,
        status: 'waiting_for_approval',
        correlationId: 'corr_456',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const approval = approvalStore.create({
        id: 'test-rejected-deny',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        metadata: JSON.stringify({ pendingActionId }),
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'not allowed' }),
      })
      expect(response.status).toBe(200)

      const updatedAction = runtimeActionStore.findById(pendingActionId)
      expect(updatedAction?.status).toBe('denied')
      expect(updatedAction?.statusMessage).toContain('Approval rejected')

      approvalStore.delete(approval.id)
    })

    it('should support responseType: reject', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-reject-response-type',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ responseType: 'reject', reason: 'not authorized' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          success: boolean
          approvalId: string
          status: string
          responseType: string
          grantCreated: boolean
          grantId?: string
        }
      }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('rejected')
      expect(body.data.responseType).toBe('reject')
      expect(body.data.grantCreated).toBe(false)
      expect(body.data.grantId).toBeUndefined()

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length)

      approvalStore.delete(approval.id)
    })

    it('should support responseType: approve_once with short TTL', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-approve-once',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ responseType: 'approve_once', reason: 'approved for this operation' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          success: boolean
          approvalId: string
          status: string
          responseType: string
          grantCreated: boolean
          grantId?: string
        }
      }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')
      expect(body.data.responseType).toBe('approve_once')
      expect(body.data.grantCreated).toBe(true)
      expect(body.data.grantId).toBeDefined()

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length + 1)

      const newGrant = grantsAfter.find((g) => !grantsBefore.some((b) => b.id === g.id))
      expect(newGrant).toBeDefined()
      expect(newGrant!.userId).toBe(userId)
      expect(newGrant!.scope).toBe('tool')
      expect(newGrant!.action).toBe('test_action')
      expect(newGrant!.resourcePattern).toBe('test-resource')
      expect(newGrant!.sourceContext).toBe(approval.id)
      expect(newGrant!.expiresAt).toBeDefined()

      const expiresAt = new Date(newGrant!.expiresAt!)
      const now = new Date()
      const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      // approve_once grants 60min TTL, allow [59min, 61min] for test execution variance
      expect(hoursUntilExpiry).toBeGreaterThan(59 / 60)
      expect(hoursUntilExpiry).toBeLessThan(61 / 60)

      approvalStore.delete(approval.id)
      grantStore.delete(newGrant!.id)
    })

    it('should support responseType: approve_always with 24h TTL', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-approve-always',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ responseType: 'approve_always', reason: 'approved permanently' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          success: boolean
          approvalId: string
          status: string
          responseType: string
          grantCreated: boolean
          grantId?: string
        }
      }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')
      expect(body.data.responseType).toBe('approve_always')
      expect(body.data.grantCreated).toBe(true)
      expect(body.data.grantId).toBeDefined()

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length + 1)

      const newGrant = grantsAfter.find((g) => !grantsBefore.some((b) => b.id === g.id))
      expect(newGrant).toBeDefined()
      expect(newGrant!.userId).toBe(userId)
      expect(newGrant!.scope).toBe('tool')
      expect(newGrant!.action).toBe('test_action')
      expect(newGrant!.resourcePattern).toBe('test-resource')
      expect(newGrant!.sourceContext).toBe(approval.id)
      expect(newGrant!.expiresAt).toBeDefined()

      const expiresAt = new Date(newGrant!.expiresAt!)
      const now = new Date()
      const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      // approve_always grants 24h TTL, allow [23h, 25h] for test execution variance
      expect(hoursUntilExpiry).toBeGreaterThan(23)
      expect(hoursUntilExpiry).toBeLessThan(25)

      approvalStore.delete(approval.id)
      grantStore.delete(newGrant!.id)
    })

    it('should map legacy decision: approved to approve_once', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-legacy-approved',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'approved', reason: 'legacy approved' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          success: boolean
          approvalId: string
          status: string
          responseType: string
          grantCreated: boolean
          grantId?: string
        }
      }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('approved')
      expect(body.data.responseType).toBe('approve_once')
      expect(body.data.grantCreated).toBe(true)
      expect(body.data.grantId).toBeDefined()

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length + 1)

      const newGrant = grantsAfter.find((g) => !grantsBefore.some((b) => b.id === g.id))
      const expiresAt = new Date(newGrant!.expiresAt!)
      const now = new Date()
      const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
      // Legacy 'approved' maps to approve_once with 60min TTL
      expect(hoursUntilExpiry).toBeGreaterThan(59 / 60)
      expect(hoursUntilExpiry).toBeLessThan(61 / 60)

      approvalStore.delete(approval.id)
      grantStore.delete(newGrant!.id)
    })

    it('should map legacy decision: rejected to reject', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore
      const grantStore = ctx.apiContext.stores.permissionGrantStore

      const approval = approvalStore.create({
        id: 'test-legacy-rejected',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        scope: 'tool',
        resource: 'test-resource',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const grantsBefore = grantStore.findByUser(userId)

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'legacy rejected' }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: {
          success: boolean
          approvalId: string
          status: string
          responseType: string
          grantCreated: boolean
          grantId?: string
        }
      }
      expect(body.data.success).toBe(true)
      expect(body.data.status).toBe('rejected')
      expect(body.data.responseType).toBe('reject')
      expect(body.data.grantCreated).toBe(false)
      expect(body.data.grantId).toBeUndefined()

      const grantsAfter = grantStore.findByUser(userId)
      expect(grantsAfter.length).toBe(grantsBefore.length)

      approvalStore.delete(approval.id)
    })

    it('should return 400 for invalid responseType', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ responseType: 'banana' }),
      })
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('BAD_REQUEST')
    })

    it('should return 409 for already resolved approval with responseType', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore

      const approval = approvalStore.create({
        id: 'already-resolved-tristate',
        userId,
        sessionId: 'session-1',
        status: 'approved',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      })

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ responseType: 'approve_once' }),
      })
      expect(response.status).toBe(409)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONFLICT')

      approvalStore.delete(approval.id)
    })
  })
})
