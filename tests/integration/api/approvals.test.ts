import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Approvals API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;
    
    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { 'Cookie': authCookie },
    });
    const meBody = await meResponse.json() as { data: { user: { userId: string } } };
    userId = meBody.data.user.userId;
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/approvals', () => {
    it('should return empty approvals list when no approvals exist for user', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { approvals: unknown[]; total: number } };
      expect(body.data.approvals).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('should return only approvals for authenticated user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
      const approval1 = approvalStore.create({
        id: 'approval-user-1',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      const approval2 = approvalStore.create({
        id: 'approval-other-user',
        userId: 'other-user',
        sessionId: 'session-2',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { approvals: Array<{ id: string; userId: string }>; total: number } };
      expect(body.data.total).toBe(1);
      expect(body.data.approvals[0].id).toBe(approval1.id);
      expect(body.data.approvals[0].userId).toBe(userId);

      approvalStore.delete(approval1.id);
      approvalStore.delete(approval2.id);
    });

    it('should return both pending and resolved approvals for user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
      const pendingApproval = approvalStore.create({
        id: 'pending-approval',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

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
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { approvals: Array<{ id: string; status: string }>; total: number } };
      expect(body.data.total).toBe(2);
      
      const ids = body.data.approvals.map(a => a.id);
      expect(ids).toContain('pending-approval');
      expect(ids).toContain('resolved-approval');

      approvalStore.delete(pendingApproval.id);
      approvalStore.delete(resolvedApproval.id);
    });
  });

  describe('GET /api/approvals/:approvalId', () => {
    it('should return 404 for non-existent approval', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for approval owned by different user', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
      const otherUserApproval = approvalStore.create({
        id: 'other-user-approval',
        userId: 'other-user',
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals/${otherUserApproval.id}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      approvalStore.delete(otherUserApproval.id);
    });

    it('should return approval detail for owner', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
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
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { approval: { id: string; userId: string; actionType: string; resource?: string } } };
      expect(body.data.approval.id).toBe(approval.id);
      expect(body.data.approval.userId).toBe(userId);
      expect(body.data.approval.actionType).toBe('test_action');
      expect(body.data.approval.resource).toBe('test-resource');

      approvalStore.delete(approval.id);
    });
  });

  describe('PATCH /api/approvals/:approvalId', () => {
    it('should return 404 for non-existent approval', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid decision', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'invalid' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing decision field', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ reason: 'some reason' }),
      });
      expect(response.status).toBe(400);
    });

    it('should return 409 for already resolved approval', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
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
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'approved' }),
      });
      expect(response.status).toBe(409);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('CONFLICT');

      approvalStore.delete(approval.id);
    });

    it('should use authenticated user for responseBy', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
      const approval = approvalStore.create({
        id: 'test-response-by',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'approved', reason: 'looks good' }),
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { success: boolean; approvalId: string; status: string } };
      expect(body.data.success).toBe(true);
      expect(body.data.approvalId).toBe(approval.id);
      expect(body.data.status).toBe('approved');

      const updated = approvalStore.getById(approval.id);
      expect(updated?.responseBy).toBe(userId);
      expect(updated?.responseReason).toBe('looks good');

      approvalStore.delete(approval.id);
    });

    it('should reject approval with reason', async () => {
      const approvalStore = ctx.apiContext.stores.approvalStore;
      
      const approval = approvalStore.create({
        id: 'test-reject',
        userId,
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({ decision: 'rejected', reason: 'not authorized' }),
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { success: boolean; approvalId: string; status: string } };
      expect(body.data.success).toBe(true);
      expect(body.data.status).toBe('rejected');

      const updated = approvalStore.getById(approval.id);
      expect(updated?.responseBy).toBe(userId);
      expect(updated?.responseReason).toBe('not authorized');

      approvalStore.delete(approval.id);
    });
  });
});
