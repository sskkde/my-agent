import type { FastifyInstance } from 'fastify';
import type { ApprovalsResponse, ApprovalDecisionRequest, ApprovalInfo } from '../types.js';
import { ApiErrorFactory } from '../errors.js';
import type { ApiContext } from '../context.js';
import { APPROVAL_STATES } from '../../storage/approval-store.js';
import { generateId, GRANT_ID_PREFIX } from '../../shared/ids.js';

export function registerApprovalRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Reply: ApprovalsResponse }>('/api/approvals', async (request, reply): Promise<ApprovalsResponse> => {
    const userId = request.user?.userId ?? 'local-user';
    const userApprovals = context.stores.approvalStore.findByUser(userId);

    const approvals: ApprovalInfo[] = userApprovals.map(approval => ({
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
      respondedAt: approval.respondedAt ?? undefined,
      responseBy: approval.responseBy ?? undefined,
      responseReason: approval.responseReason ?? undefined,
    }));

    return reply.code(200).send({
      data: {
        approvals,
        total: approvals.length,
      },
    });
  });

  server.get<{ Params: { approvalId: string } }>(
    '/api/approvals/:approvalId',
    async (request, reply) => {
      const { approvalId } = request.params;
      const userId = request.user?.userId ?? 'local-user';

      const approval = context.stores.approvalStore.getById(approvalId);
      if (!approval) {
        const error = ApiErrorFactory.notFound(`Approval ${approvalId} not found`);
        return reply.code(404).send(error);
      }

      // Check ownership - only the owner can view detail
      if (approval.userId !== userId) {
        const error = ApiErrorFactory.notFound(`Approval ${approvalId} not found`);
        return reply.code(404).send(error);
      }

      const approvalInfo: ApprovalInfo = {
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
        respondedAt: approval.respondedAt ?? undefined,
        responseBy: approval.responseBy ?? undefined,
        responseReason: approval.responseReason ?? undefined,
      };

      return reply.send({ data: { approval: approvalInfo } });
    }
  );

  server.patch<{ Params: { approvalId: string }; Body: ApprovalDecisionRequest }>(
    '/api/approvals/:approvalId',
    async (request, reply) => {
      const { approvalId } = request.params;
      const { decision, reason } = request.body;

      if (!decision || (decision !== 'approved' && decision !== 'rejected')) {
        const error = ApiErrorFactory.badRequest('Invalid decision. Must be "approved" or "rejected"');
        return reply.code(400).send(error);
      }

      const existing = context.stores.approvalStore.getById(approvalId);
      if (!existing) {
        const error = ApiErrorFactory.notFound(`Approval ${approvalId} not found`);
        return reply.code(404).send(error);
      }

      if (existing.status !== APPROVAL_STATES.PENDING) {
        const error = ApiErrorFactory.conflict(`Approval ${approvalId} already resolved with status: ${existing.status}`);
        return reply.code(409).send(error);
      }

      const newStatus = decision === 'approved' ? APPROVAL_STATES.APPROVED : APPROVAL_STATES.REJECTED;
      const now = new Date().toISOString();
      const responseBy = request.user?.userId ?? 'local-user';

      context.stores.approvalStore.update(approvalId, {
        status: newStatus,
        respondedAt: now,
        responseBy,
        responseReason: reason,
      });

      // Create permission grant and event for approved decisions
      if (decision === 'approved') {
        // Create permission grant
        const grantId = generateId(GRANT_ID_PREFIX);
        context.stores.permissionGrantStore.create({
          id: grantId,
          userId: existing.userId,
          scope: existing.scope ?? 'tool',
          action: existing.actionType,
          resourcePattern: existing.resource ?? '*',
          sourceContext: approvalId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

        // Write approval_resolved event
        context.stores.eventStore.append({
          eventId: `evt-approval-${Date.now()}`,
          eventType: 'approval_resolved',
          sourceModule: 'permission',
          userId: existing.userId,
          sessionId: existing.sessionId,
          relatedRefs: { approvalId },
          payload: { approvalId, decision: 'approved', grantCreated: true },
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: now,
        });

        // Notify triggerRuntime if available
        if (context.triggerRuntime?.handleApprovalResolved) {
          context.triggerRuntime.handleApprovalResolved({
            approvalId,
            status: 'approved',
            result: { grantCreated: true },
          });
        }
      } else {
        // Write approval_resolved event for rejected
        context.stores.eventStore.append({
          eventId: `evt-approval-${Date.now()}`,
          eventType: 'approval_resolved',
          sourceModule: 'permission',
          userId: existing.userId,
          sessionId: existing.sessionId,
          relatedRefs: { approvalId },
          payload: { approvalId, decision: 'rejected', grantCreated: false },
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: now,
        });

        // Notify triggerRuntime if available
        if (context.triggerRuntime?.handleApprovalResolved) {
          context.triggerRuntime.handleApprovalResolved({
            approvalId,
            status: 'rejected',
            result: { grantCreated: false },
          });
        }
      }

      return reply.send({
        data: {
          success: true,
          approvalId,
          status: newStatus,
        },
      });
    }
  );
}