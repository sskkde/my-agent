import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApprovalDecisionRequest, ApprovalInfo, ApprovalResponseType } from '../types.js'
import { success, envelopeError } from '../response-envelope.js'
import type { ApiContext } from '../context.js'
import { APPROVAL_STATES, type ApprovalRequest } from '../../storage/approval-store.js'
import { generateId, GRANT_ID_PREFIX, ACTION_ID_PREFIX } from '../../shared/ids.js'
import type { RuntimeAction as DispatcherRuntimeAction, TargetRuntime } from '../../dispatcher/types.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

function extractPlannerRunId(approval: ApprovalRequest, context: ApiContext): string | undefined {
  if (!approval.metadata) return undefined

  try {
    const metadata = JSON.parse(approval.metadata) as Record<string, unknown>
    const pendingActionId = metadata.pendingActionId as string | undefined
    if (!pendingActionId) return undefined

    const pendingAction = context.stores.runtimeActionStore.findById(pendingActionId)
    if (!pendingAction) return undefined

    return pendingAction.targetRef?.plannerRunId
  } catch {
    return undefined
  }
}

async function dispatchPendingAction(
  approval: ApprovalRequest,
  decision: 'approved' | 'rejected',
  context: ApiContext,
): Promise<void> {
  if (!approval.metadata) return

  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(approval.metadata)
  } catch {
    return
  }

  const pendingActionId = metadata.pendingActionId as string | undefined
  if (!pendingActionId) return

  const pendingAction = context.stores.runtimeActionStore.findById(pendingActionId)
  if (!pendingAction) return

  if (pendingAction.status !== 'waiting_for_approval') return

  if (decision === 'approved') {
    context.stores.runtimeActionStore.updateStatus(pendingActionId, 'created')

    const resumeAction: DispatcherRuntimeAction = {
      actionId: generateId(ACTION_ID_PREFIX),
      actionType: 'resume_agent_run',
      source: { sourceModule: 'permission' },
      targetRuntime: pendingAction.targetRuntime as TargetRuntime,
      targetAction: 'resume_agent_run',
      payload: {
        originalActionId: pendingActionId,
        approvalId: approval.id,
        decision: 'approved',
      },
      sessionId: approval.sessionId,
      userId: approval.userId,
      targetRef: { ...pendingAction.targetRef, approvalId: approval.id },
      status: 'created',
      correlationId: pendingAction.correlationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await context.runtimeDispatcher.dispatch({
      requestId: `req-resume-${Date.now()}`,
      action: resumeAction,
      context: {
        callerModule: 'permission',
        userId: approval.userId,
        sessionId: approval.sessionId,
      },
    })
  } else {
    context.stores.runtimeActionStore.updateStatus(
      pendingActionId,
      'denied',
      `Approval rejected: ${approval.responseReason ?? 'No reason provided'}`,
    )
  }
}

export function registerApprovalRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/v1/approvals', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission('approval' as ResourceType, Action.read)) {
      return reply
    }
    const userId = request.user?.userId ?? 'local-user'
    const userApprovals = context.stores.approvalStore.findByUser(userId)

    const approvals: ApprovalInfo[] = userApprovals.map((approval) => ({
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
      plannerRunId: extractPlannerRunId(approval, context),
    }))

    return reply.code(200).send(success({ approvals, total: approvals.length }, request.requestId))
  })

  server.get<{ Params: { approvalId: string } }>(
    '/api/v1/approvals/:approvalId',
    async (request: FastifyRequest<{ Params: { approvalId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('approval' as ResourceType, Action.read)) {
        return reply
      }
      const { approvalId } = request.params
      const userId = request.user?.userId ?? 'local-user'

      const approval = context.stores.approvalStore.getById(approvalId)
      if (!approval) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Approval ${approvalId} not found`, request.requestId))
      }

      if (approval.userId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Approval ${approvalId} not found`, request.requestId))
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
        plannerRunId: extractPlannerRunId(approval, context),
      }

      return reply.code(200).send(success({ approval: approvalInfo }, request.requestId))
    },
  )

  server.patch<{ Params: { approvalId: string }; Body: ApprovalDecisionRequest }>(
    '/api/v1/approvals/:approvalId',
    async (
      request: FastifyRequest<{ Params: { approvalId: string }; Body: ApprovalDecisionRequest }>,
      reply: FastifyReply,
    ) => {
      if (!request.requirePermission('approval' as ResourceType, Action.update)) {
        return reply
      }
      const { approvalId } = request.params
      const { decision, responseType, reason } = request.body

      // Normalize input: derive effectiveResponseType from either responseType or legacy decision
      let effectiveResponseType: ApprovalResponseType
      if (responseType) {
        // New canonical responseType takes precedence
        effectiveResponseType = responseType
      } else if (decision) {
        // Legacy decision mapping
        if (decision === 'approved') {
          effectiveResponseType = 'approve_once' // Default to approve_once for legacy approved
        } else if (decision === 'rejected') {
          effectiveResponseType = 'reject'
        } else {
          return reply
            .code(400)
            .send(envelopeError('BAD_REQUEST', 'Invalid decision. Must be "approved" or "rejected"', request.requestId))
        }
      } else {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'Either responseType or decision is required', request.requestId))
      }

      if (!['reject', 'approve_once', 'approve_always'].includes(effectiveResponseType)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Invalid responseType. Must be "reject", "approve_once", or "approve_always"`,
              request.requestId,
            ),
          )
      }

      const existing = context.stores.approvalStore.getById(approvalId)
      if (!existing) {
        return reply.code(404).send(envelopeError('NOT_FOUND', `Approval ${approvalId} not found`, request.requestId))
      }

      if (existing.status !== APPROVAL_STATES.PENDING) {
        return reply
          .code(409)
          .send(
            envelopeError(
              'CONFLICT',
              `Approval ${approvalId} already resolved with status: ${existing.status}`,
              request.requestId,
            ),
          )
      }

      const newStatus = effectiveResponseType === 'reject' ? APPROVAL_STATES.REJECTED : APPROVAL_STATES.APPROVED
      const now = new Date().toISOString()
      const responseBy = request.user?.userId ?? 'local-user'

      context.stores.approvalStore.update(approvalId, {
        status: newStatus,
        respondedAt: now,
        responseBy,
        responseReason: reason,
      })

      let grantCreated = false
      let grantId: string | undefined

      if (effectiveResponseType === 'reject') {
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
        })

        await dispatchPendingAction(existing, 'rejected', context)

        if (context.triggerRuntime?.handleApprovalResolved) {
          context.triggerRuntime.handleApprovalResolved({
            approvalId,
            status: 'rejected',
            result: { grantCreated: false },
          })
        }
      } else {
        grantId = generateId(GRANT_ID_PREFIX)
        grantCreated = true

        // Determine TTL based on response type
        // approve_once: 60 minutes (short TTL MVP fallback - not strict one-shot)
        // approve_always: 24 hours (preserves existing behavior)
        const ttlMs =
          effectiveResponseType === 'approve_once'
            ? 60 * 60 * 1000 // 60 minutes
            : 24 * 60 * 60 * 1000 // 24 hours

        context.stores.permissionGrantStore.create({
          id: grantId,
          userId: existing.userId,
          scope: existing.scope ?? 'tool',
          action: existing.actionType,
          resourcePattern: existing.resource ?? '*',
          sourceContext: approvalId,
          expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        })

        context.stores.eventStore.append({
          eventId: `evt-approval-${Date.now()}`,
          eventType: 'approval_resolved',
          sourceModule: 'permission',
          userId: existing.userId,
          sessionId: existing.sessionId,
          relatedRefs: { approvalId },
          payload: { approvalId, decision: 'approved', grantCreated: true, grantId },
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: now,
        })

        await dispatchPendingAction(existing, 'approved', context)

        if (context.triggerRuntime?.handleApprovalResolved) {
          context.triggerRuntime.handleApprovalResolved({
            approvalId,
            status: 'approved',
            result: { grantCreated: true, grantId },
          })
        }
      }

      return reply.code(200).send(
        success(
          {
            success: true,
            approvalId,
            status: newStatus,
            responseType: effectiveResponseType,
            grantCreated,
            grantId,
          },
          request.requestId,
        ),
      )
    },
  )
}
