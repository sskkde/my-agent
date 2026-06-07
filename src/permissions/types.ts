import type { ApprovalRequest as StorageApprovalRequest } from '../storage/approval-store.js'
import type { PermissionGrant as StoragePermissionGrant } from '../storage/permission-grant-store.js'

export type PermissionMode = 'read_only' | 'ask_on_write' | 'background_limited' | 'hard_deny'

export type PermissionScopeType = 'one_shot' | 'session' | 'plan' | 'workflow_run' | 'background_run' | 'connector'

export type ApprovalCode = 'APPROVED' | 'REJECTED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED_PERMANENTLY'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export function modeAllowsOperation(mode: PermissionMode, operationType: string): boolean {
  switch (mode) {
    case 'read_only':
      return operationType === 'read' || operationType === 'query'
    case 'ask_on_write':
      return true
    case 'background_limited':
      return ['read', 'query', 'internal_read'].includes(operationType)
    case 'hard_deny':
      return false
    default:
      return false
  }
}

export interface PermissionContext {
  userId: string
  sessionId: string
  mode: PermissionMode
  grants: StoragePermissionGrant[]
  metadata?: Record<string, unknown>
}

export function createPermissionContext(
  userId: string,
  sessionId: string,
  mode: PermissionMode,
  grants: StoragePermissionGrant[] = [],
): PermissionContext {
  return {
    userId,
    sessionId,
    mode,
    grants,
  }
}

export interface PermissionCheckRequest {
  context: PermissionContext
  actionType: string
  resource?: string
  operationType: 'read' | 'write' | 'execute' | 'delete' | 'admin'
  justification?: string
  metadata?: Record<string, unknown>
  pendingActionId?: string
  connectorId?: string
  connectorResource?: string
  connectorAction?: string
  riskLevel?: RiskLevel
  scopeType?: PermissionScopeType
  scopeRef?: string
}

export type PermissionDecisionStatus = 'allowed' | 'denied' | 'requires_approval' | 'pending_approval'

export interface PermissionDecision {
  status: PermissionDecisionStatus
  allowed: boolean
  reason: string
  requestId?: string
  approvalRequest?: ApprovalRequest
  grant?: StoragePermissionGrant
  policyRef?: string
  auditLabel?: string
  approvalCode?: ApprovalCode
  bypassExpiresAt?: string
}

export function createAllowedDecision(reason: string, grant?: StoragePermissionGrant): PermissionDecision {
  return {
    status: 'allowed',
    allowed: true,
    reason,
    grant,
  }
}

export function createDeniedDecision(reason: string, policyRef?: string, auditLabel?: string): PermissionDecision {
  return {
    status: 'denied',
    allowed: false,
    reason,
    policyRef,
    auditLabel,
  }
}

export function createRequiresApprovalDecision(
  reason: string,
  requestId: string,
  approvalRequest: ApprovalRequest,
): PermissionDecision {
  return {
    status: 'requires_approval',
    allowed: false,
    reason,
    requestId,
    approvalRequest,
  }
}

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'

export interface ApprovalRequest {
  id: string
  userId: string
  sessionId: string
  status: ApprovalRequestStatus
  actionType: string
  resource?: string
  operationType: string
  justification?: string
  requestedBy: string
  requestedAt: string
  expiresAt?: string
  respondedAt?: string
  responseBy?: string
  responseReason?: string
  correlationId?: string
  approvalCode?: ApprovalCode
  scopeType?: PermissionScopeType
  scopeRef?: string
}

export interface CreateApprovalRequest {
  userId: string
  sessionId: string
  actionType: string
  resource?: string
  operationType: string
  justification?: string
  requestedBy: string
  expiresAt?: string
  expiresInMs?: number
  correlationId?: string
}

export function fromStorageApprovalRequest(storage: StorageApprovalRequest): ApprovalRequest {
  return {
    id: storage.id,
    userId: storage.userId,
    sessionId: storage.sessionId,
    status: storage.status as ApprovalRequestStatus,
    actionType: storage.actionType,
    resource: storage.resource ?? undefined,
    operationType: storage.metadata ? JSON.parse(storage.metadata).operationType : 'unknown',
    justification: storage.justification ?? undefined,
    requestedBy: storage.requestedBy,
    requestedAt: storage.requestedAt,
    expiresAt: storage.expiresAt ?? undefined,
    respondedAt: storage.respondedAt ?? undefined,
    responseBy: storage.responseBy ?? undefined,
    responseReason: storage.responseReason ?? undefined,
    approvalCode: storage.approvalCode ?? undefined,
    scopeType: storage.scopeType ?? undefined,
    scopeRef: storage.scopeRef ?? undefined,
  }
}

export function toStorageApprovalRequest(
  request: ApprovalRequest,
): Omit<
  StorageApprovalRequest,
  'createdAt' | 'updatedAt' | 'riskLevel' | 'scope' | 'idempotencyKey' | 'sourceContext'
> {
  return {
    id: request.id,
    userId: request.userId,
    sessionId: request.sessionId,
    status: request.status,
    actionType: request.actionType,
    resource: request.resource ?? null,
    justification: request.justification ?? null,
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt ?? null,
    respondedAt: request.respondedAt ?? null,
    responseBy: request.responseBy ?? null,
    responseReason: request.responseReason ?? null,
    approvalCode: request.approvalCode ?? null,
    scopeType: request.scopeType ?? null,
    scopeRef: request.scopeRef ?? null,
  }
}

export type ApprovalResponseType = 'approve_once' | 'approve_always' | 'reject'

export interface ApprovalResponse {
  requestId: string
  responseType: ApprovalResponseType
  respondedBy: string
  reason?: string
  respondedAt: string
  grantScope?: string
  grantDuration?: number
  approvalCode?: ApprovalCode
}

export interface ApprovalResponseResult {
  success: boolean
  approved: boolean
  grant?: StoragePermissionGrant
  error?: string
}

export interface PermissionEngineConfig {
  defaultExpiryMs: number
  maxPendingApprovals: number
  auditAllDecisions: boolean
  respectExistingGrants: boolean
}

export const DEFAULT_PERMISSION_ENGINE_CONFIG: PermissionEngineConfig = {
  defaultExpiryMs: 3600000,
  maxPendingApprovals: 10,
  auditAllDecisions: true,
  respectExistingGrants: true,
}

export type PermissionAuditEventType =
  | 'permission_check'
  | 'permission_granted'
  | 'permission_denied'
  | 'approval_requested'
  | 'approval_responded'
  | 'grant_created'
  | 'grant_revoked'

export interface PermissionAuditEvent {
  eventType: PermissionAuditEventType | 'connector_policy_denied'
  userId: string
  sessionId: string
  actionType: string
  resource?: string
  decision: PermissionDecisionStatus
  reason: string
  requestId?: string
  grantId?: string
  correlationId: string
  timestamp: string
  policyRef?: string
  auditLabel?: string
  connectorId?: string
  connectorResource?: string
  connectorAction?: string
  approvalCode?: ApprovalCode
}

export type PreApprovalRecommendation = 'allow' | 'deny' | 'ask'

export interface PreApprovalJudgeResult {
  recommended: PreApprovalRecommendation
  confidence: number
  reason?: string
}

export interface PreApprovalJudgeAction {
  actionType: string
  resource?: string
  operationType: 'read' | 'write' | 'execute' | 'delete' | 'admin'
  userId: string
  sessionId: string
  riskLevel?: RiskLevel
  connectorId?: string
  connectorResource?: string
  connectorAction?: string
  scopeType?: PermissionScopeType
  scopeRef?: string
}

export interface PreApprovalJudge {
  evaluate(action: PreApprovalJudgeAction): Promise<PreApprovalJudgeResult>
}
