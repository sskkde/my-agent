import type { ApprovalStore } from '../storage/approval-store.js'
import type { PermissionGrantStore } from '../storage/permission-grant-store.js'
import type { ConnectorPolicyStore, ConnectorPolicy } from '../storage/connector-policy-store.js'
import type { EventStore } from '../storage/event-store.js'
import type { AuditRecorder } from '../observability/audit-types.js'
import type { TraceStore } from '../observability/types.js'
import type { PreApprovalJudge } from './types.js'
import {
  type PermissionCheckRequest,
  type PermissionDecision,
  type PermissionAuditEvent,
  type PermissionEngineConfig,
  type PermissionScopeType,
  type RiskLevel,
  DEFAULT_PERMISSION_ENGINE_CONFIG,
  createAllowedDecision,
  createDeniedDecision,
  createRequiresApprovalDecision,
  modeAllowsOperation,
  fromStorageApprovalRequest,
} from './types.js'
import { isDeniedByRestricted } from './tool-risk-policy.js'
import { APPROVAL_STATES } from '../storage/approval-store.js'

export interface PermissionEngine {
  checkPermission(request: PermissionCheckRequest): PermissionDecision
  checkPermissionWithJudge?(request: PermissionCheckRequest): Promise<PermissionDecision>
  checkConnectorPolicy(
    connectorId: string,
    resource: string,
    action: string,
    userId: string,
    riskLevel?: RiskLevel,
  ): { denied: boolean; policy?: ConnectorPolicy }
}

export interface PermissionEngineDeps {
  approvalStore: ApprovalStore
  grantStore: PermissionGrantStore
  eventStore: EventStore
  connectorPolicyStore?: ConnectorPolicyStore
  auditRecorder?: AuditRecorder
  traceStore?: TraceStore
  preApprovalJudge?: PreApprovalJudge
}

export function createPermissionEngine(
  deps: PermissionEngineDeps,
  config: Partial<PermissionEngineConfig> = {},
): PermissionEngine {
  const fullConfig = { ...DEFAULT_PERMISSION_ENGINE_CONFIG, ...config }

  function emitAuditEvent(event: PermissionAuditEvent): void {
    if (!fullConfig.auditAllDecisions) return

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
    })
  }

  function checkConnectorPolicyInternal(
    connectorId: string,
    resource: string,
    action: string,
    userId: string,
    riskLevel: RiskLevel = 'low',
  ): { denied: boolean; policy?: ConnectorPolicy } {
    if (!deps.connectorPolicyStore) {
      return { denied: false }
    }

    const effectivePolicies = deps.connectorPolicyStore.getEffectivePolicies(connectorId, resource, action, userId)

    for (const policy of effectivePolicies) {
      if (policy.effect === 'deny') {
        return { denied: true, policy }
      }

      if (policy.effect === 'allow') {
        if (policy.allowedScopes && policy.allowedScopes.length > 0) {
          const actionScope =
            action === 'read'
              ? 'read'
              : action === 'write'
                ? 'write'
                : action === 'delete'
                  ? 'delete'
                  : action === 'execute'
                    ? 'execute'
                    : action
          const hasAllowedScope = policy.allowedScopes.some((scope) => scope === '*' || scope === actionScope)
          if (!hasAllowedScope) {
            return { denied: true, policy }
          }
        }

        if (policy.riskCap) {
          const riskLevels = ['low', 'medium', 'high', 'critical']
          const capIndex = riskLevels.indexOf(policy.riskCap)
          const requestIndex = riskLevels.indexOf(riskLevel)
          if (requestIndex > capIndex) {
            return { denied: true, policy }
          }
        }

        return { denied: false, policy }
      }
    }

    return { denied: false }
  }

  function checkExistingGrants(request: PermissionCheckRequest): {
    allowed: boolean
    grant?: ReturnType<PermissionGrantStore['findActiveByUserAndScope']>[number]
    reason?: string
  } {
    const { context, actionType, resource, riskLevel, scopeType, scopeRef } = request
    const now = new Date().toISOString()

    for (const grant of context.grants) {
      if (grant.action !== actionType && grant.action !== '*') {
        continue
      }

      if (grant.resourcePattern && resource) {
        const pattern = grant.resourcePattern.replace(/\*/g, '.*')
        const regex = new RegExp(`^${pattern}$`)
        if (!regex.test(resource)) {
          continue
        }
      }

      if (grant.expiresAt && new Date(grant.expiresAt) < new Date(now)) {
        continue
      }

      if (grant.riskLevelMax && riskLevel) {
        const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical']
        const maxIndex = riskLevels.indexOf(grant.riskLevelMax as RiskLevel)
        const requestIndex = riskLevels.indexOf(riskLevel)
        if (requestIndex > maxIndex) {
          continue
        }
      }

      if (scopeType && scopeRef && grant.scope) {
        const grantScopeParts = grant.scope.split(':')
        if (grantScopeParts.length === 2) {
          const grantScopeType = grantScopeParts[0] as PermissionScopeType
          const grantScopeRef = grantScopeParts[1]

          if (grantScopeType !== scopeType || grantScopeRef !== scopeRef) {
            continue
          }
        }
      }

      return { allowed: true, grant }
    }

    return { allowed: false }
  }

  function createApprovalRequest(request: PermissionCheckRequest): ReturnType<typeof fromStorageApprovalRequest> {
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + fullConfig.defaultExpiryMs).toISOString()

    const metadata: Record<string, unknown> = {
      operationType: request.operationType,
      correlationId,
    }
    if (request.pendingActionId) {
      metadata.pendingActionId = request.pendingActionId
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
      scopeType: request.scopeType,
      scopeRef: request.scopeRef,
      metadata: JSON.stringify(metadata),
    })

    return fromStorageApprovalRequest(storageRequest)
  }

  return {
    checkPermission(request: PermissionCheckRequest): PermissionDecision {
      const { context, actionType, resource, operationType } = request
      const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const timestamp = new Date().toISOString()
      const spanId = `span_perm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      deps.traceStore?.createSpan({
        spanId,
        traceId: correlationId,
        spanType: 'permission_check',
        module: 'permission',
        operation: actionType,
        status: 'started',
        startTime: timestamp,
        metadata: { permissionId: spanId, action: actionType, resource, operationType },
      })

      function finishDecision(decision: PermissionDecision): PermissionDecision {
        deps.traceStore?.updateSpan(spanId, {
          status: 'completed',
          endTime: new Date().toISOString(),
          durationMs: Date.now() - new Date(timestamp).getTime(),
          metadata: { permissionId: spanId, action: actionType, resource, decision: decision.status },
        })
        deps.auditRecorder?.recordPermissionDecision({
          decisionId: spanId,
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          operationType,
          decision: decision.status,
          reason: decision.reason,
          approvalId: decision.approvalRequest?.id ?? decision.requestId,
          correlationId,
        })
        return decision
      }

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
        })
        return finishDecision(createDeniedDecision('Operation denied by hard_deny policy'))
      }

      if (request.connectorId && request.connectorResource && request.connectorAction) {
        const policyCheck = checkConnectorPolicyInternal(
          request.connectorId,
          request.connectorResource,
          request.connectorAction,
          context.userId,
          request.riskLevel,
        )

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
          })

          if (deps.auditRecorder) {
            deps.auditRecorder.recordConnectorAccess({
              userId: context.userId,
              sessionId: context.sessionId,
              connectorInstanceId: request.connectorId,
              operation: request.connectorAction,
              status: 'failure',
              correlationId,
            })
          }

          return finishDecision(
            createDeniedDecision(
              `Connector policy denies this operation`,
              policyCheck.policy.policyId,
              policyCheck.policy.auditLabel ?? undefined,
            ),
          )
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
          })
          return finishDecision(createAllowedDecision('Connector policy allows this operation'))
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
        })
        return finishDecision(
          createDeniedDecision(`Operation type '${operationType}' not allowed in mode '${context.mode}'`),
        )
      }

      if (context.mode === 'restricted' && request.riskLevel && isDeniedByRestricted(request.riskLevel)) {
        emitAuditEvent({
          eventType: 'permission_denied',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'denied',
          reason: `Restricted mode denies ${request.riskLevel}-risk operations`,
          correlationId,
          timestamp,
        })
        return finishDecision(
          createDeniedDecision(`Restricted mode denies ${request.riskLevel}-risk operation '${actionType}'`),
        )
      }

      if (fullConfig.respectExistingGrants) {
        const grantCheck = checkExistingGrants(request)
        if (grantCheck.allowed) {
          if (request.connectorId && request.connectorResource && request.connectorAction) {
            const policyCheck = checkConnectorPolicyInternal(
              request.connectorId,
              request.connectorResource,
              request.connectorAction,
              context.userId,
              request.riskLevel,
            )
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
              })

              return finishDecision(
                createDeniedDecision(
                  `Connector hard-deny policy overrides bypass grant`,
                  policyCheck.policy.policyId,
                  policyCheck.policy.auditLabel ?? undefined,
                ),
              )
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
          })
          return finishDecision(createAllowedDecision('Operation allowed by existing grant', grantCheck.grant))
        }
      }

      if (
        (context.mode === 'ask_on_write' || context.mode === 'write_allowed') &&
        (operationType === 'write' || operationType === 'delete' || operationType === 'execute')
      ) {
        const pendingApprovals = deps.approvalStore.findPendingBySession(context.sessionId)
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
          })
          return finishDecision(createDeniedDecision('Too many pending approval requests'))
        }

        const approvalRequest = createApprovalRequest(request)

        emitAuditEvent({
          eventType: 'approval_requested',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'requires_approval',
          reason: `Write operation requires approval in ${context.mode} mode (intersection: envelope + profile + policy)`,
          requestId: approvalRequest.id,
          correlationId,
          timestamp,
        })

        return finishDecision(
          createRequiresApprovalDecision('Write operation requires approval', approvalRequest.id, approvalRequest),
        )
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
      })

      return finishDecision(createAllowedDecision('Operation allowed by permission mode'))
    },

    async checkPermissionWithJudge(request: PermissionCheckRequest): Promise<PermissionDecision> {
      const { context, actionType, resource, operationType } = request
      const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const timestamp = new Date().toISOString()
      const spanId = `span_perm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      deps.traceStore?.createSpan({
        spanId,
        traceId: correlationId,
        spanType: 'permission_check',
        module: 'permission',
        operation: actionType,
        status: 'started',
        startTime: timestamp,
        metadata: { permissionId: spanId, action: actionType, resource, operationType },
      })

      function finishDecision(decision: PermissionDecision): PermissionDecision {
        deps.traceStore?.updateSpan(spanId, {
          status: 'completed',
          endTime: new Date().toISOString(),
          durationMs: Date.now() - new Date(timestamp).getTime(),
          metadata: { permissionId: spanId, action: actionType, resource, decision: decision.status },
        })
        deps.auditRecorder?.recordPermissionDecision({
          decisionId: spanId,
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          operationType,
          decision: decision.status,
          reason: decision.reason,
          approvalId: decision.approvalRequest?.id ?? decision.requestId,
          correlationId,
        })
        return decision
      }

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
        })
        return finishDecision(createDeniedDecision('Operation denied by hard_deny policy'))
      }

      if (deps.preApprovalJudge) {
        const judgeResult = await deps.preApprovalJudge.evaluate({
          actionType,
          resource,
          operationType,
          userId: context.userId,
          sessionId: context.sessionId,
          riskLevel: request.riskLevel,
          connectorId: request.connectorId,
          connectorResource: request.connectorResource,
          connectorAction: request.connectorAction,
          scopeType: request.scopeType,
          scopeRef: request.scopeRef,
        })

        emitAuditEvent({
          eventType: 'permission_check',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'allowed',
          reason: `Pre-approval judge recommended: ${judgeResult.recommended} (confidence: ${judgeResult.confidence})`,
          correlationId,
          timestamp,
        })

        if (judgeResult.recommended === 'deny' && judgeResult.confidence >= 0.8) {
          return finishDecision(createDeniedDecision(judgeResult.reason ?? 'Pre-approval judge denied this operation'))
        }
      }

      if (request.connectorId && request.connectorResource && request.connectorAction) {
        const policyCheck = checkConnectorPolicyInternal(
          request.connectorId,
          request.connectorResource,
          request.connectorAction,
          context.userId,
          request.riskLevel,
        )

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
          })

          if (deps.auditRecorder) {
            deps.auditRecorder.recordConnectorAccess({
              userId: context.userId,
              sessionId: context.sessionId,
              connectorInstanceId: request.connectorId,
              operation: request.connectorAction,
              status: 'failure',
              correlationId,
            })
          }

          return finishDecision(
            createDeniedDecision(
              `Connector policy denies this operation`,
              policyCheck.policy.policyId,
              policyCheck.policy.auditLabel ?? undefined,
            ),
          )
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
          })
          return finishDecision(createAllowedDecision('Connector policy allows this operation'))
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
        })
        return finishDecision(
          createDeniedDecision(`Operation type '${operationType}' not allowed in mode '${context.mode}'`),
        )
      }

      if (context.mode === 'restricted' && request.riskLevel && isDeniedByRestricted(request.riskLevel)) {
        emitAuditEvent({
          eventType: 'permission_denied',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'denied',
          reason: `Restricted mode denies ${request.riskLevel}-risk operations`,
          correlationId,
          timestamp,
        })
        return finishDecision(
          createDeniedDecision(`Restricted mode denies ${request.riskLevel}-risk operation '${actionType}'`),
        )
      }

      if (fullConfig.respectExistingGrants) {
        const grantCheck = checkExistingGrants(request)
        if (grantCheck.allowed) {
          if (request.connectorId && request.connectorResource && request.connectorAction) {
            const policyCheck = checkConnectorPolicyInternal(
              request.connectorId,
              request.connectorResource,
              request.connectorAction,
              context.userId,
              request.riskLevel,
            )
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
              })

              return finishDecision(
                createDeniedDecision(
                  `Connector hard-deny policy overrides bypass grant`,
                  policyCheck.policy.policyId,
                  policyCheck.policy.auditLabel ?? undefined,
                ),
              )
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
          })
          return finishDecision(createAllowedDecision('Operation allowed by existing grant', grantCheck.grant))
        }
      }

      if (
        (context.mode === 'ask_on_write' || context.mode === 'write_allowed') &&
        (operationType === 'write' || operationType === 'delete' || operationType === 'execute')
      ) {
        const pendingApprovals = deps.approvalStore.findPendingBySession(context.sessionId)
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
          })
          return finishDecision(createDeniedDecision('Too many pending approval requests'))
        }

        const approvalRequest = createApprovalRequest(request)

        emitAuditEvent({
          eventType: 'approval_requested',
          userId: context.userId,
          sessionId: context.sessionId,
          actionType,
          resource,
          decision: 'requires_approval',
          reason: `Write operation requires approval in ${context.mode} mode (intersection: envelope + profile + policy)`,
          requestId: approvalRequest.id,
          correlationId,
          timestamp,
        })

        return finishDecision(
          createRequiresApprovalDecision('Write operation requires approval', approvalRequest.id, approvalRequest),
        )
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
      })

      return finishDecision(createAllowedDecision('Operation allowed by permission mode'))
    },

    checkConnectorPolicy(
      connectorId: string,
      resource: string,
      action: string,
      userId: string,
      riskLevel: RiskLevel = 'low',
    ): { denied: boolean; policy?: ConnectorPolicy } {
      return checkConnectorPolicyInternal(connectorId, resource, action, userId, riskLevel)
    },
  }
}
