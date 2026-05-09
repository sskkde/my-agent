import type { ApprovalStore } from '../storage/approval-store.js';
import type { PermissionGrantStore } from '../storage/permission-grant-store.js';
import type { EventStore } from '../storage/event-store.js';
import {
  type PermissionCheckRequest,
  type PermissionDecision,
  type PermissionAuditEvent,
  type PermissionEngineConfig,
  DEFAULT_PERMISSION_ENGINE_CONFIG,
  createAllowedDecision,
  createDeniedDecision,
  createRequiresApprovalDecision,
  modeAllowsOperation,
  fromStorageApprovalRequest,
} from './types.js';
import { APPROVAL_STATES } from '../storage/approval-store.js';

export interface PermissionEngine {
  checkPermission(request: PermissionCheckRequest): PermissionDecision;
}

export interface PermissionEngineDeps {
  approvalStore: ApprovalStore;
  grantStore: PermissionGrantStore;
  eventStore: EventStore;
}

export function createPermissionEngine(
  deps: PermissionEngineDeps,
  config: Partial<PermissionEngineConfig> = {}
): PermissionEngine {
  const fullConfig = { ...DEFAULT_PERMISSION_ENGINE_CONFIG, ...config };

  function emitAuditEvent(event: PermissionAuditEvent): void {
    if (!fullConfig.auditAllDecisions) return;

    deps.eventStore.append({
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      eventType: event.eventType,
      sourceModule: 'permission',
      userId: event.userId,
      sessionId: event.sessionId,
      correlationId: event.correlationId,
      payload: {
        actionType: event.actionType,
        resource: event.resource,
        decision: event.decision,
        reason: event.reason,
        requestId: event.requestId,
        grantId: event.grantId,
      },
      sensitivity: 'medium',
      retentionClass: 'standard',
      createdAt: event.timestamp,
    });
  }

  function checkExistingGrants(
    request: PermissionCheckRequest
  ): { allowed: boolean; grant?: ReturnType<PermissionGrantStore['findActiveByUserAndScope']>[number] } {
    const { context, actionType, resource } = request;
    
    for (const grant of context.grants) {
      if (grant.action !== actionType && grant.action !== '*') {
        continue;
      }
      
      if (grant.resourcePattern && resource) {
        const pattern = grant.resourcePattern.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        if (!regex.test(resource)) {
          continue;
        }
      }
      
      return { allowed: true, grant };
    }
    
    return { allowed: false };
  }

  function createApprovalRequest(
    request: PermissionCheckRequest
  ): ReturnType<typeof fromStorageApprovalRequest> {
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + fullConfig.defaultExpiryMs).toISOString();

    const metadata: Record<string, unknown> = {
      operationType: request.operationType,
      correlationId,
    };
    if (request.pendingActionId) {
      metadata.pendingActionId = request.pendingActionId;
    }

    const storageRequest = deps.approvalStore.create({
      id,
      userId: request.context.userId,
      sessionId: request.context.sessionId,
      status: APPROVAL_STATES.PENDING,
      actionType: request.actionType,
      resource: request.resource,
      justification: request.justification,
      requestedBy: 'permission_engine',
      requestedAt: now,
      expiresAt,
      metadata: JSON.stringify(metadata),
    });

    return fromStorageApprovalRequest(storageRequest);
  }

  return {
    checkPermission(request: PermissionCheckRequest): PermissionDecision {
      const { context, actionType, resource, operationType } = request;
      const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const timestamp = new Date().toISOString();

      if (context.mode === 'hard_deny') {
        emitAuditEvent({
          eventType: 'permission_denied',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'denied',
          reason: 'hard_deny policy enforced',
          correlationId,
          timestamp,
        });
        return createDeniedDecision('Operation denied by hard_deny policy');
      }

      if (!modeAllowsOperation(context.mode, operationType)) {
        emitAuditEvent({
          eventType: 'permission_denied',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'denied',
          reason: `Mode ${context.mode} does not allow ${operationType} operations`,
          correlationId,
          timestamp,
        });
        return createDeniedDecision(
          `Operation type '${operationType}' not allowed in mode '${context.mode}'`
        );
      }

      if (fullConfig.respectExistingGrants) {
        const grantCheck = checkExistingGrants(request);
        if (grantCheck.allowed) {
          emitAuditEvent({
            eventType: 'permission_granted',
            userId: context.userId,
            sessionId: context.sessionId,
            actionType,
            resource,
            decision: 'allowed',
            reason: 'Active grant allows this operation',
            grantId: grantCheck.grant?.id,
            correlationId,
            timestamp,
          });
          return createAllowedDecision('Operation allowed by existing grant', grantCheck.grant);
        }
      }

      if (context.mode === 'ask_on_write' && (operationType === 'write' || operationType === 'delete' || operationType === 'execute')) {
        const pendingApprovals = deps.approvalStore.findPendingBySession(context.sessionId);
        if (pendingApprovals.length >= fullConfig.maxPendingApprovals) {
          emitAuditEvent({
            eventType: 'permission_denied',
            userId: context.userId,
            sessionId: context.sessionId,
            actionType,
            resource,
            decision: 'denied',
            reason: 'Too many pending approvals',
            correlationId,
            timestamp,
          });
          return createDeniedDecision('Too many pending approval requests');
        }

        const approvalRequest = createApprovalRequest(request);
        
        emitAuditEvent({
          eventType: 'approval_requested',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'requires_approval',
          reason: 'Write operation requires approval in ask_on_write mode',
          requestId: approvalRequest.id,
          correlationId,
          timestamp,
        });

        return createRequiresApprovalDecision(
          'Write operation requires approval',
          approvalRequest.id,
          approvalRequest
        );
      }

      emitAuditEvent({
        eventType: 'permission_granted',
        userId: context.userId,
        sessionId: context.sessionId,
        actionType,
        resource,
        decision: 'allowed',
        reason: 'Operation allowed by mode policy',
        correlationId,
        timestamp,
      });

      return createAllowedDecision('Operation allowed by permission mode');
    },
  };
}
