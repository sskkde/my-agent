import { describe, it, expect } from 'vitest'
import { closeSmokeHarness, createSession, createSmokeHarness } from './smoke-test-utils.js'

describe('MVP smoke: approval resume flow', () => {
  it('approves a waiting action, grants permission, and re-dispatches resume action', async () => {
    const harness = await createSmokeHarness({ username: 'smoke-approval-user' })

    try {
      const sessionId = await createSession(harness)
      const now = new Date().toISOString()
      const pendingActionId = 'smoke-pending-action'

      harness.baseCtx.stores.runtimeActionStore.save({
        actionId: pendingActionId,
        actionType: 'execute_tool',
        source: { sourceModule: 'smoke', sourceAction: 'approval_fixture' },
        targetRuntime: 'tool_plane',
        targetAction: 'execute_tool',
        payload: {
          toolCallId: 'smoke-approved-tool-call',
          toolName: 'docs_search',
          params: { query: 'approval smoke' },
        },
        correlationId: 'smoke-approval-correlation',
        sessionId,
        userId: harness.userId,
        status: 'waiting_for_approval',
        createdAt: now,
        updatedAt: now,
      })

      const approval = harness.baseCtx.stores.approvalStore.create({
        id: 'smoke-approval-request',
        userId: harness.userId,
        sessionId,
        status: 'pending',
        riskLevel: 'medium',
        scope: 'tool',
        actionType: 'execute_tool',
        resource: 'docs_search',
        justification: 'Smoke test approval resume',
        requestedBy: 'smoke-test',
        requestedAt: now,
        metadata: JSON.stringify({ pendingActionId }),
      })

      const response = await fetch(`${harness.baseUrl}/api/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      })

      const responseBody = (await response.json()) as unknown
      expect(response.status, JSON.stringify(responseBody)).toBe(200)

      const updatedApproval = harness.baseCtx.stores.approvalStore.getById(approval.id)
      expect(updatedApproval?.status).toBe('approved')

      const grants = harness.baseCtx.stores.permissionGrantStore.findByUser(harness.userId)
      expect(grants.some((grant) => grant.sourceContext === approval.id)).toBe(true)

      const originalAction = harness.baseCtx.stores.runtimeActionStore.findById(pendingActionId)
      expect(originalAction?.status).not.toBe('waiting_for_approval')

      const actions = harness.baseCtx.stores.runtimeActionStore.query({ sessionId })
      expect(actions.some((action) => action.actionType === 'resume_agent_run')).toBe(true)
    } finally {
      await closeSmokeHarness(harness)
    }
  }, 15000)
})
