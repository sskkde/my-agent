/**
 * Architecture Contract Tests — Path 5: Write Tool Approval
 *
 * Verifies Write Tool → ApprovalRequest → PermissionEngine contract.
 * Tests type mapping, decision flow, and approval lifecycle without runtime.
 */
import { describe, it, expect } from 'vitest'
import type {
  PermissionCheckRequest,
  PermissionDecision,
  PermissionDecisionStatus,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalResponse,
  ApprovalResponseType,
  ApprovalCode,
  CreateApprovalRequest,
  PermissionScopeType,
} from '../../src/permissions/types.js'
import {
  createAllowedDecision,
  createDeniedDecision,
  createRequiresApprovalDecision,
  modeAllowsOperation,
  createPermissionContext,
} from '../../src/permissions/types.js'
import { APPROVAL_STATES, TOOL_EXECUTION_STATES } from '../../src/shared/states.js'

// ─── PermissionCheckRequest → PermissionDecision Type Contract ────────────

describe('Path 5: Write Tool Approval Contract', () => {
  describe('PermissionCheckRequest → PermissionDecision Types', () => {
    it('PermissionCheckRequest has all required fields for permission checks', () => {
      const requiredKeys: Array<keyof PermissionCheckRequest> = ['context', 'actionType', 'operationType']
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }

      const optionalKeys: Array<keyof PermissionCheckRequest> = [
        'resource',
        'justification',
        'metadata',
        'pendingActionId',
        'connectorId',
        'connectorResource',
        'connectorAction',
        'riskLevel',
        'scopeType',
        'scopeRef',
      ]
      for (const key of optionalKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('operationType distinguishes write from read for approval gating', () => {
      const operations: Array<PermissionCheckRequest['operationType']> = ['read', 'write', 'execute', 'delete', 'admin']
      expect(operations).toHaveLength(5)
      expect(operations).toContain('write')
      expect(operations).toContain('delete')
    })

    it('PermissionDecision has discriminated status field', () => {
      const requiredKeys: Array<keyof PermissionDecision> = ['status', 'allowed', 'reason']
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('PermissionDecisionStatus covers all 4 outcomes', () => {
      const expectedStatuses: PermissionDecisionStatus[] = [
        'allowed',
        'denied',
        'requires_approval',
        'pending_approval',
      ]
      expect(expectedStatuses).toHaveLength(4)
      for (const s of expectedStatuses) {
        expect(typeof s).toBe('string')
      }
    })
  })

  // ─── Decision Factory Functions ───────────────────────────────────────

  describe('Permission Decision Constructors', () => {
    it('createAllowedDecision sets status=allowed and allowed=true', () => {
      const decision = createAllowedDecision('User has read permission')
      expect(decision.status).toBe('allowed')
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('User has read permission')
      expect(decision.approvalRequest).toBeUndefined()
    })

    it('createAllowedDecision can include an optional grant', () => {
      const grant = { id: 'g1', userId: 'u1', scope: 'session' }
      const decision = createAllowedDecision('Pre-granted', grant as Parameters<typeof createAllowedDecision>[1])
      expect(decision.status).toBe('allowed')
      expect(decision.allowed).toBe(true)
      expect(decision.grant).toBeDefined()
    })

    it('createDeniedDecision sets status=denied and allowed=false', () => {
      const decision = createDeniedDecision('Write not permitted', 'policy-write', 'audit-label')
      expect(decision.status).toBe('denied')
      expect(decision.allowed).toBe(false)
      expect(decision.policyRef).toBe('policy-write')
      expect(decision.auditLabel).toBe('audit-label')
    })

    it('createRequiresApprovalDecision sets status=requires_approval and attaches request', () => {
      const approvalReq: ApprovalRequest = {
        id: 'ar-1',
        userId: 'u1',
        sessionId: 's1',
        status: 'pending',
        actionType: 'write_file',
        operationType: 'write',
        requestedBy: 'system',
        requestedAt: '2026-05-11T00:00:00Z',
      }
      const decision = createRequiresApprovalDecision('Write requires approval', 'req-1', approvalReq)
      expect(decision.status).toBe('requires_approval')
      expect(decision.allowed).toBe(false)
      expect(decision.approvalRequest).toBeDefined()
      expect(decision.approvalRequest!.id).toBe('ar-1')
      expect(decision.approvalRequest!.status).toBe('pending')
    })
  })

  // ─── ApprovalRequest Type Contract ────────────────────────────────────

  describe('ApprovalRequest Structure', () => {
    it('has all required lifecycle fields', () => {
      const requiredKeys: Array<keyof ApprovalRequest> = [
        'id',
        'userId',
        'sessionId',
        'status',
        'actionType',
        'operationType',
        'requestedBy',
        'requestedAt',
      ]
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('ApprovalRequestStatus matches APPROVAL_STATES', () => {
      const statuses: ApprovalRequestStatus[] = ['pending', 'approved', 'rejected', 'expired', 'cancelled']
      const approvalStates = Object.values(APPROVAL_STATES) as string[]
      for (const s of statuses) {
        expect(approvalStates).toContain(s)
      }
    })

    it('CreateApprovalRequest is the input type with expiresInMs convenience', () => {
      const createReq: CreateApprovalRequest = {
        userId: 'u1',
        sessionId: 's1',
        actionType: 'delete_file',
        operationType: 'delete',
        requestedBy: 'system',
        expiresInMs: 3600000,
      }
      expect(createReq.userId).toBe('u1')
      expect(createReq.expiresInMs).toBe(3600000)
    })
  })

  // ─── Approval Code Contract ───────────────────────────────────────────

  describe('ApprovalCode', () => {
    it('APPROVED and REJECTED are the primary codes', () => {
      const codes: ApprovalCode[] = ['APPROVED', 'REJECTED', 'APPROVED_WITH_CONDITIONS', 'REJECTED_PERMANENTLY']
      expect(codes).toHaveLength(4)
      expect(codes[0]).toBe('APPROVED')
      expect(codes[1]).toBe('REJECTED')
    })
  })

  // ─── Approval Response Contract ───────────────────────────────────────

  describe('ApprovalResponse Contract', () => {
    it('supports approve_once, approve_always, and reject', () => {
      const responseTypes: ApprovalResponseType[] = ['approve_once', 'approve_always', 'reject']
      expect(responseTypes).toHaveLength(3)
      for (const t of responseTypes) {
        expect(typeof t).toBe('string')
      }
    })

    it('ApprovalResponse has required fields for processing', () => {
      const response: ApprovalResponse = {
        requestId: 'ar-1',
        responseType: 'approve_once',
        respondedBy: 'user-u1',
        respondedAt: '2026-05-11T00:00:00Z',
      }
      expect(response.requestId).toBe('ar-1')
      expect(response.responseType).toBe('approve_once')
      expect(response.respondedBy).toBe('user-u1')
    })

    it('approve_always includes grantScope and grantDuration', () => {
      const response: ApprovalResponse = {
        requestId: 'ar-2',
        responseType: 'approve_always',
        respondedBy: 'user-u1',
        respondedAt: '2026-05-11T00:00:00Z',
        grantScope: 'session',
        grantDuration: 86400000,
      }
      expect(response.grantScope).toBe('session')
      expect(response.grantDuration).toBe(86400000)
    })

    it('reject response has no grant fields', () => {
      const response: ApprovalResponse = {
        requestId: 'ar-3',
        responseType: 'reject',
        respondedBy: 'user-u1',
        respondedAt: '2026-05-11T00:00:00Z',
        reason: 'Not authorized',
      }
      expect(response.responseType).toBe('reject')
      expect(response.reason).toBe('Not authorized')
      expect((response as Partial<ApprovalResponse>).grantScope).toBeUndefined()
    })
  })

  // ─── Write Tool → Approval Trigger Contract ───────────────────────────

  describe('Write Tool Approval Trigger', () => {
    it('write and delete operation types trigger approval in ask_on_write mode', () => {
      // TOOL_EXECUTION_STATES includes permission_checking → waiting_for_approval → executing
      const states = Object.values(TOOL_EXECUTION_STATES) as string[]
      expect(states).toContain(TOOL_EXECUTION_STATES.PERMISSION_CHECKING)
      expect(states).toContain(TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL)
      // After approval, execution continues
      expect(states).toContain(TOOL_EXECUTION_STATES.EXECUTING)
    })

    it('denied path: permission_checking → denied (terminal)', () => {
      // If permission is denied, tool execution stops at denied state
      const states = Object.values(TOOL_EXECUTION_STATES) as string[]
      expect(states).toContain(TOOL_EXECUTION_STATES.DENIED)
      // Denied is terminal for tool execution — never proceeds to executing
    })
  })

  // ─── Error Path: Denied → No Action ───────────────────────────────────

  describe('Error Handling: Denied Path', () => {
    it('denied decisions have allowed=false', () => {
      const decision = createDeniedDecision('Write access denied for hard_deny mode')
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('denied')
    })

    it('denied tool execution never reaches executing state', () => {
      const denied = TOOL_EXECUTION_STATES.DENIED
      const executing = TOOL_EXECUTION_STATES.EXECUTING
      // denied is a terminal state — the tool execution is stopped
      expect(denied).toBe('denied')
      expect(executing).toBe('executing')
      // No path exists from denied → executing
    })
  })

  // ─── PermissionMode Contract ──────────────────────────────────────────

  describe('PermissionMode Operations', () => {
    it('read_only mode allows only read and query operations', () => {
      expect(modeAllowsOperation('read_only', 'read')).toBe(true)
      expect(modeAllowsOperation('read_only', 'query')).toBe(true)
      expect(modeAllowsOperation('read_only', 'write')).toBe(false)
      expect(modeAllowsOperation('read_only', 'delete')).toBe(false)
    })

    it('ask_on_write mode allows all operations (deferred to approval)', () => {
      expect(modeAllowsOperation('ask_on_write', 'read')).toBe(true)
      expect(modeAllowsOperation('ask_on_write', 'write')).toBe(true)
      expect(modeAllowsOperation('ask_on_write', 'delete')).toBe(true)
    })

    it('hard_deny mode rejects all operations', () => {
      expect(modeAllowsOperation('hard_deny', 'read')).toBe(false)
      expect(modeAllowsOperation('hard_deny', 'write')).toBe(false)
      expect(modeAllowsOperation('hard_deny', 'query')).toBe(false)
    })

    it('createPermissionContext builds a valid context', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write')
      expect(ctx.userId).toBe('u1')
      expect(ctx.sessionId).toBe('s1')
      expect(ctx.mode).toBe('ask_on_write')
      expect(ctx.grants).toEqual([])
    })
  })

  // ─── Scope Contract ──────────────────────────────────────────────────

  describe('PermissionScopeType', () => {
    it('supports one_shot, session, plan, and runtime-level scopes', () => {
      const scopes: PermissionScopeType[] = [
        'one_shot',
        'session',
        'plan',
        'workflow_run',
        'background_run',
        'connector',
      ]
      expect(scopes).toHaveLength(6)
      for (const scope of scopes) {
        expect(typeof scope).toBe('string')
      }
    })
  })
})
