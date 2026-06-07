import type { ApprovalStore, CreateApprovalRequest } from '../storage/approval-store.js'
import type { PermissionGrantStore } from '../storage/permission-grant-store.js'
import type { EventStore } from '../storage/event-store.js'
import { APPROVAL_STATES } from '../storage/approval-store.js'
import {
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalResponseResult,
  type CreateApprovalRequest as DomainCreateApprovalRequest,
  fromStorageApprovalRequest,
} from './types.js'

export interface ApprovalHandler {
  createApproval(params: DomainCreateApprovalRequest): ApprovalRequest
  processResponse(response: ApprovalResponse): ApprovalResponseResult
}

export interface ApprovalHandlerDeps {
  approvalStore: ApprovalStore
  grantStore: PermissionGrantStore
  eventStore: EventStore
}

export interface ApprovalHandlerConfig {
  defaultExpiryMs: number
}

const DEFAULT_CONFIG: ApprovalHandlerConfig = {
  defaultExpiryMs: 3600000,
}

export function createApprovalHandler(
  deps: ApprovalHandlerDeps,
  config: Partial<ApprovalHandlerConfig> = {},
): ApprovalHandler {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }

  function emitAuditEvent(params: {
    eventType: string
    userId: string
    sessionId: string
    actionType: string
    resource?: string
    decision: string
    reason: string
    requestId?: string
    grantId?: string
  }): void {
    deps.eventStore.append({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: params.eventType,
      sourceModule: 'permission',
      userId: params.userId,
      sessionId: params.sessionId,
      correlationId: `corr_${Date.now()}`,
      payload: {
        actionType: params.actionType,
        resource: params.resource,
        decision: params.decision,
        reason: params.reason,
        requestId: params.requestId,
        grantId: params.grantId,
      },
      sensitivity: 'medium',
      retentionClass: 'standard',
      createdAt: new Date().toISOString(),
    })
  }

  return {
    createApproval(params: DomainCreateApprovalRequest): ApprovalRequest {
      const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const now = new Date().toISOString()
      const expiresAt = params.expiresAt ?? new Date(Date.now() + fullConfig.defaultExpiryMs).toISOString()

      const storageRequest: CreateApprovalRequest = {
        id,
        userId: params.userId,
        sessionId: params.sessionId,
        status: APPROVAL_STATES.PENDING,
        actionType: params.actionType,
        resource: params.resource,
        justification: params.justification,
        requestedBy: params.requestedBy,
        requestedAt: now,
        expiresAt,
        metadata: JSON.stringify({
          operationType: params.operationType,
          correlationId: params.correlationId ?? `corr_${Date.now()}`,
        }),
      }

      const created = deps.approvalStore.create(storageRequest)

      emitAuditEvent({
        eventType: 'approval_requested',
        userId: params.userId,
        sessionId: params.sessionId,
        actionType: params.actionType,
        resource: params.resource,
        decision: 'pending',
        reason: 'Approval request created',
        requestId: created.id,
      })

      return fromStorageApprovalRequest(created)
    },

    processResponse(response: ApprovalResponse): ApprovalResponseResult {
      const approval = deps.approvalStore.getById(response.requestId)

      if (!approval) {
        return {
          success: false,
          approved: false,
          error: `Approval request not found: ${response.requestId}`,
        }
      }

      if (approval.status !== APPROVAL_STATES.PENDING) {
        return {
          success: false,
          approved: false,
          error: `Approval request is not pending: ${approval.status}`,
        }
      }

      const now = new Date().toISOString()

      if (response.responseType === 'reject') {
        deps.approvalStore.update(response.requestId, {
          status: APPROVAL_STATES.REJECTED,
          respondedAt: response.respondedAt,
          responseBy: response.respondedBy,
          responseReason: response.reason ?? 'No reason provided',
        })

        emitAuditEvent({
          eventType: 'approval_responded',
          userId: approval.userId,
          sessionId: approval.sessionId,
          actionType: approval.actionType,
          resource: approval.resource ?? undefined,
          decision: 'rejected',
          reason: response.reason ?? 'Approval rejected',
          requestId: response.requestId,
        })

        return {
          success: true,
          approved: false,
        }
      }

      deps.approvalStore.update(response.requestId, {
        status: APPROVAL_STATES.APPROVED,
        respondedAt: response.respondedAt,
        responseBy: response.respondedBy,
        responseReason: response.reason,
      })

      let grant: ReturnType<PermissionGrantStore['create']> | undefined

      if (response.responseType === 'approve_always') {
        const grantId = `grant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const expiresAt = response.grantDuration
          ? new Date(Date.now() + response.grantDuration).toISOString()
          : undefined

        grant = deps.grantStore.create({
          id: grantId,
          userId: approval.userId,
          scope: response.grantScope ?? 'default',
          action: approval.actionType,
          resourcePattern: approval.resource ?? undefined,
          sourceContext: JSON.stringify({
            approvalId: approval.id,
            approvedBy: response.respondedBy,
            approvedAt: now,
          }),
          expiresAt,
        })

        emitAuditEvent({
          eventType: 'grant_created',
          userId: approval.userId,
          sessionId: approval.sessionId,
          actionType: approval.actionType,
          resource: approval.resource ?? undefined,
          decision: 'granted',
          reason: 'Permanent grant created from approval',
          requestId: response.requestId,
          grantId: grant.id,
        })
      }

      emitAuditEvent({
        eventType: 'approval_responded',
        userId: approval.userId,
        sessionId: approval.sessionId,
        actionType: approval.actionType,
        resource: approval.resource ?? undefined,
        decision: 'approved',
        reason: response.reason ?? 'Approval granted',
        requestId: response.requestId,
        grantId: grant?.id,
      })

      return {
        success: true,
        approved: true,
        grant,
      }
    },
  }
}
