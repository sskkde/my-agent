import type { ApprovalStore } from '../storage/approval-store.js';
import type { PermissionGrantStore } from '../storage/permission-grant-store.js';
import type { ConnectorPolicyStore, ConnectorPolicy } from '../storage/connector-policy-store.js';
import type { EventStore } from '../storage/event-store.js';
import type { AuditRecorder } from '../observability/audit-types.js';
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
  checkConnectorPolicy(
    connectorId: string,
    resource: string,
    action: string,
    userId: string,
    riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  ): { denied: boolean; policy?: ConnectorPolicy };
}

export interface PermissionEngineDeps {
  approvalStore: ApprovalStore;
  grantStore: PermissionGrantStore;
  eventStore: EventStore;
  connectorPolicyStore?: ConnectorPolicyStore;
  auditRecorder?: AuditRecorder;
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
        policyRef: event.policyRef,
        auditLabel: event.auditLabel,
        connectorId: event.connectorId,
        connectorResource: event.connectorResource,
        connectorAction: event.connectorAction,
      },
      sensitivity: 'medium',
      retentionClass: 'standard',
      createdAt: event.timestamp,
    });
  }

  function checkConnectorPolicyInternal(
    connectorId: string,
    resource: string,
    action: string,
    userId: string,
    riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'
  ): { denied: boolean; policy?: ConnectorPolicy } {
    if (!deps.connectorPolicyStore) {
      return { denied: false };
    }

    const effectivePolicies = deps.connectorPolicyStore.getEffectivePolicies(
      connectorId,
      resource,
      action,
      userId
    );

    for (const policy of effectivePolicies) {
      if (policy.effect === 'deny') {
        return { denied: true, policy };
      }

      if (policy.effect === 'allow') {
        if (policy.allowedScopes && policy.allowedScopes.length > 0) {
          const actionScope = action === 'read' ? 'read' : 
                              action === 'write' ? 'write' : 
                              action === 'delete' ? 'delete' : 
                              action === 'execute' ? 'execute' : action;
          const hasAllowedScope = policy.allowedScopes.some(scope => 
            scope === '*' || scope === actionScope
          );
          if (!hasAllowedScope) {
            return { denied: true, policy };
          }
        }

        if (policy.riskCap) {
          const riskLevels = ['low', 'medium', 'high', 'critical'];
          const capIndex = riskLevels.indexOf(policy.riskCap);
          const requestIndex = riskLevels.indexOf(riskLevel);
          if (requestIndex > capIndex) {
            return { denied: true, policy };
          }
        }

        return { denied: false, policy };
      }
    }

    return { denied: false };
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

      if (request.connectorId && request.connectorResource && request.connectorAction) {
        const policyCheck = checkConnectorPolicyInternal(
          request.connectorId,
          request.connectorResource,
          request.connectorAction,
          context.userId,
          request.riskLevel
        );

        if (policyCheck.denied && policyCheck.policy) {
          emitAuditEvent({
            eventType: 'connector_policy_denied',
            userId: context.userId,
            sessionId: context.sessionId,
            actionType,
            resource,
            decision: 'denied',
            reason: `Connector policy ${policyCheck.policy.policyId} denies this operation`,
            correlationId,
            timestamp,
            policyRef: policyCheck.policy.policyId,
            auditLabel: policyCheck.policy.auditLabel ?? undefined,
            connectorId: request.connectorId,
            connectorResource: request.connectorResource,
            connectorAction: request.connectorAction,
          });

          if (deps.auditRecorder) {
            deps.auditRecorder.recordConnectorAccess({
              userId: context.userId,
              sessionId: context.sessionId,
              connectorInstanceId: request.connectorId,
              operation: request.connectorAction,
              status: 'failure',
              correlationId,
            });
          }

          return createDeniedDecision(
            `Connector policy denies this operation`,
            policyCheck.policy.policyId,
            policyCheck.policy.auditLabel ?? undefined
          );
        }

        if (policyCheck.policy && policyCheck.policy.effect === 'allow') {
          emitAuditEvent({
            eventType: 'permission_granted',
            userId: context.userId,
            sessionId: context.sessionId,
            actionType,
            resource,
            decision: 'allowed',
            reason: 'Connector policy allows this operation',
            policyRef: policyCheck.policy.policyId,
            correlationId,
            timestamp,
            connectorId: request.connectorId,
            connectorResource: request.connectorResource,
            connectorAction: request.connectorAction,
          });
          return createAllowedDecision('Connector policy allows this operation');
        }
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
          if (request.connectorId && request.connectorResource && request.connectorAction) {
            const policyCheck = checkConnectorPolicyInternal(
              request.connectorId,
              request.connectorResource,
              request.connectorAction,
              context.userId,
              request.riskLevel
            );
            if (policyCheck.denied && policyCheck.policy) {
              emitAuditEvent({
                eventType: 'connector_policy_denied',
                userId: context.userId,
                sessionId: context.sessionId,
                actionType,
                resource,
                decision: 'denied',
                reason: `Connector hard-deny policy ${policyCheck.policy.policyId} overrides bypass grant`,
                correlationId,
                timestamp,
                policyRef: policyCheck.policy.policyId,
                auditLabel: policyCheck.policy.auditLabel ?? undefined,
                connectorId: request.connectorId,
                connectorResource: request.connectorResource,
                connectorAction: request.connectorAction,
              });

              return createDeniedDecision(
                `Connector hard-deny policy overrides bypass grant`,
                policyCheck.policy.policyId,
                policyCheck.policy.auditLabel ?? undefined
              );
            }
          }

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

    checkConnectorPolicy(
      connectorId: string,
      resource: string,
      action: string,
      userId: string,
      riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'
    ): { denied: boolean; policy?: ConnectorPolicy } {
      return checkConnectorPolicyInternal(connectorId, resource, action, userId, riskLevel);
    },
  };
}
