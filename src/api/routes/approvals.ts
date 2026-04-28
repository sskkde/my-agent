import type { FastifyInstance } from 'fastify';
import type { ApprovalsResponse, ApprovalDecisionRequest, ApprovalInfo } from '../types.js';
import { ApiErrorFactory } from '../errors.js';
import type { ApiContext } from '../context.js';
import { APPROVAL_STATES } from '../../storage/approval-store.js';

export function registerApprovalRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Reply: ApprovalsResponse }>('/api/approvals', async (): Promise<ApprovalsResponse> => {
    const pendingApprovals = context.stores.approvalStore.findPendingByUser('default');

    const approvals: ApprovalInfo[] = pendingApprovals.map(approval => ({
      id: approval.id,
      userId: approval.userId,
      sessionId: approval.sessionId,
      status: approval.status,
      riskLevel: approval.riskLevel ?? undefined,
      scope: approval.scope ?? undefined,
      actionType: approval.actionType,
      resource: approval.resource ?? undefined,
      justification: approval.justification ?? undefined,
      requestedBy: approval.requestedBy,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt ?? undefined,
    }));

    return {
      approvals,
      total: approvals.length,
    };
  });

  server.patch<{ Params: { approvalId: string }; Body: ApprovalDecisionRequest }>(
    '/api/approvals/:approvalId',
    async (request, reply) => {
      const { approvalId } = request.params;
      const { decision, reason } = request.body;

      if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
        const error = ApiErrorFactory.badRequest('Invalid decision. Must be "approved" or "rejected"');
        return reply.status(400).send(error);
      }

      const existing = context.stores.approvalStore.getById(approvalId);
      if (!existing) {
        const error = ApiErrorFactory.notFound(`Approval ${approvalId} not found`);
        return reply.status(404).send(error);
      }

      if (existing.status !== APPROVAL_STATES.PENDING) {
        const error = ApiErrorFactory.conflict(`Approval ${approvalId} already resolved with status: ${existing.status}`);
        return reply.status(409).send(error);
      }

      const newStatus = decision === 'approved' ? APPROVAL_STATES.APPROVED : APPROVAL_STATES.REJECTED;
      const now = new Date().toISOString();

      context.stores.approvalStore.update(approvalId, {
        status: newStatus,
        respondedAt: now,
        responseBy: 'api-user',
        responseReason: reason,
      });

      return reply.status(200).send({
        success: true,
        approvalId,
        status: newStatus,
      });
    }
  );
}