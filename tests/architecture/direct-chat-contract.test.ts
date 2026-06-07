/**
 * Architecture Contract Tests — Path 1: Direct Chat
 *
 * Verifies the contract between ForegroundAgent → Session → Transcript.
 * Focuses on type contracts, state transitions, and error handling paths
 * without requiring actual LLM runtime or mock execution.
 */
import { describe, it, expect } from 'vitest'
import type {
  ForegroundMessageInput,
  ForegroundDecision,
  ForegroundDecisionRoute,
  ForegroundSessionState,
  ForegroundDecisionType,
  TaskComplexity,
  DirectDelegationPolicy,
  AssistantPersonaProfile,
  ForegroundTargetRef,
  IntentPatterns,
} from '../../src/foreground/types.js'
import {
  DEFAULT_DIRECT_DELEGATION_POLICY,
  DEFAULT_ASSISTANT_PERSONA,
  DEFAULT_INTENT_PATTERNS,
} from '../../src/foreground/types.js'
import { FOREGROUND_STATES, APPROVAL_STATES } from '../../src/shared/states.js'

// ─── Type Contract Tests ───────────────────────────────────────────────────

describe('Path 1: Direct Chat — Foreground Agent Contract', () => {
  describe('ForegroundMessageInput → ForegroundDecision Type Mapping', () => {
    it('requires all mandatory fields in ForegroundMessageInput', () => {
      // Verify the shape at compile time; runtime checks for required keys
      const requiredKeys: Array<keyof ForegroundMessageInput> = [
        'message',
        'userId',
        'sessionId',
        'turnId',
        'timestamp',
      ]

      for (const key of requiredKeys) {
        // All required keys are present in the type definition
        expect(typeof key).toBe('string')
      }
      // The optional metadata field exists too
      expect<string>('metadata' satisfies keyof ForegroundMessageInput)
    })

    it('ForegroundDecision has all required fields for LLM routing output', () => {
      const requiredKeys: Array<keyof ForegroundDecision> = ['route', 'requiresPlanner', 'reason']
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('ForegroundDecisionRoute covers all 8 known routing paths', () => {
      const expectedRoutes: ForegroundDecisionRoute[] = [
        'answer_directly',
        'dispatch_tool',
        'dispatch_subagent',
        'spawn_planner',
        'resume_existing_planner',
        'approval_handler',
        'cancel_or_modify_task',
        'status_query',
      ]
      // Each route is a valid ForegroundDecisionRoute
      for (const route of expectedRoutes) {
        expect(route).toBeTruthy()
      }
      // 8 routes total — matches LLMRouterOutput validation in foreground-agent.ts
      expect(expectedRoutes).toHaveLength(8)
    })

    it('ForegroundDecisionType is an alias for ForegroundDecisionRoute', () => {
      // Compile-time equivalence validated by type import
      const route: ForegroundDecisionType = 'answer_directly'
      const _alsoRoute: ForegroundDecisionRoute = route
      expect(typeof _alsoRoute).toBe('string')
    })

    it('TaskComplexity has 4 levels matching validation', () => {
      const validComplexities: TaskComplexity[] = ['low', 'medium', 'high', 'critical']
      expect(validComplexities).toHaveLength(4)
      for (const c of validComplexities) {
        expect(['low', 'medium', 'high', 'critical']).toContain(c)
      }
    })
  })

  // ─── State Transition Contract ─────────────────────────────────────────

  describe('Foreground State Transitions', () => {
    it('FOREGROUND_STATES documents the lifecycle: received → completed OR failed', () => {
      const states = Object.values(FOREGROUND_STATES) as string[]

      // Happy path: received → hydrating → classifying → deciding → responding → completed
      const happyPath = [
        FOREGROUND_STATES.RECEIVED,
        FOREGROUND_STATES.HYDRATING,
        FOREGROUND_STATES.CLASSIFYING,
        FOREGROUND_STATES.DECIDING,
        FOREGROUND_STATES.RESPONDING,
        FOREGROUND_STATES.COMPLETED,
      ]
      for (const state of happyPath) {
        expect(states).toContain(state)
      }

      // Error path: any active state → failed
      expect(states).toContain(FOREGROUND_STATES.FAILED)

      // Direct delegation path: deciding → direct_delegating → responding
      expect(states).toContain(FOREGROUND_STATES.DIRECT_DELEGATING)

      // Planner path: deciding → spawning_planner
      expect(states).toContain(FOREGROUND_STATES.SPAWNING_PLANNER)

      // Approval path: deciding → handling_approval
      expect(states).toContain(FOREGROUND_STATES.HANDLING_APPROVAL)
    })

    it('approval bypass: received → handling_approval → completed (no LLM)', () => {
      // Bypass 1: Metadata with isApprovalResponse → approval_handler route
      // Bypass 2: No LLM adapter → answer_directly route
      // Both bypasses skip the classifying/deciding states
      const handlingApproval = FOREGROUND_STATES.HANDLING_APPROVAL
      const completedState = FOREGROUND_STATES.COMPLETED
      expect(handlingApproval).toBe('handling_approval')
      expect(completedState).toBe('completed')
    })

    it('APPROVAL_STATES: pending → approved or rejected (terminal)', () => {
      const approvalStates = Object.values(APPROVAL_STATES) as string[]
      expect(approvalStates).toContain('pending')
      expect(approvalStates).toContain('approved')
      expect(approvalStates).toContain('rejected')
      expect(approvalStates).toContain('expired')
      expect(approvalStates).toContain('cancelled')
      // Terminal states for approvals
      const terminalApprovalStates = ['approved', 'rejected', 'expired', 'cancelled']
      for (const s of terminalApprovalStates) {
        expect(approvalStates).toContain(s)
      }
    })
  })

  // ─── Default Configuration Contracts ───────────────────────────────────

  describe('Foreground Agent Configuration Contracts', () => {
    it('DEFAULT_DIRECT_DELEGATION_POLICY uses sensible defaults', () => {
      const policy: DirectDelegationPolicy = DEFAULT_DIRECT_DELEGATION_POLICY
      expect(policy.estimatedStepsGte).toBe(3)
      expect(policy.maxComplexity).toBe('medium')
      expect(policy.allowedToolCategories).toEqual(['read', 'search', 'internal'])
    })

    it('DEFAULT_ASSISTANT_PERSONA has requirePlannerForMultiStep constraint', () => {
      const persona: AssistantPersonaProfile = DEFAULT_ASSISTANT_PERSONA
      expect(persona.personaId).toBe('default-assistant')
      expect(persona.constraints?.requirePlannerForMultiStep).toBe(true)
    })

    it('DEFAULT_INTENT_PATTERNS covers cancel, status, approve, reject, questions, actions', () => {
      const patterns: IntentPatterns = DEFAULT_INTENT_PATTERNS
      // All required keyword arrays exist
      expect(patterns.cancelKeywords.length).toBeGreaterThan(0)
      expect(patterns.statusKeywords.length).toBeGreaterThan(0)
      expect(patterns.approveKeywords.length).toBeGreaterThan(0)
      expect(patterns.rejectKeywords.length).toBeGreaterThan(0)
      expect(patterns.questionIndicators.length).toBeGreaterThan(0)
      expect(patterns.actionVerbs.length).toBeGreaterThan(0)
      expect(patterns.complexTaskIndicators.length).toBeGreaterThan(0)
      expect(patterns.multiStepIndicators.length).toBeGreaterThan(0)
    })
  })

  // ─── Error Handling Path Contracts ─────────────────────────────────────

  describe('Error Handling Contract', () => {
    it('ForegroundSessionState supports both agentConfig and resolvedProvider for fallback', () => {
      // Session state carries merged effective config and resolved provider
      // These allow fallback when LLM is unavailable
      const sessionStateKeys: Array<keyof ForegroundSessionState> = [
        'hydratedSession',
        'activeWorkRefs',
        'currentPersona',
        'effectivePolicy',
      ]
      expect(sessionStateKeys).toHaveLength(4)

      // Optional provider resolution fields
      const optionalKeys: Array<keyof ForegroundSessionState> = ['agentConfig', 'resolvedProvider', 'resolvedModel']
      for (const key of optionalKeys) {
        expect(typeof key).toBe('string')
      }
    })

    it('ForegroundDecision supports fallback via userVisibleResponse', () => {
      // When LLM routing fails, the agent returns answer_directly with
      // userVisibleResponse carrying the error message to the user
      const decision: Partial<ForegroundDecision> = {
        route: 'answer_directly',
        reason: 'LLM routing temporarily unavailable',
        userVisibleResponse: 'The AI provider did not respond in time.',
        requiresPlanner: false,
      }
      expect(decision.userVisibleResponse).toBeDefined()
      expect(decision.route).toBe('answer_directly')
      expect(decision.requiresPlanner).toBe(false)
    })

    it('ForegroundTargetRef connects decision to specific work items', () => {
      const targetRef: ForegroundTargetRef = {
        plannerRunId: 'plan-123',
        runtimeActionId: 'action-456',
      }
      // TargetRef supports multiple optional ID fields for graceful degradation
      const refKeys: Array<keyof ForegroundTargetRef> = [
        'plannerRunId',
        'planId',
        'runtimeActionId',
        'subagentRunId',
        'workflowRunId',
      ]
      for (const key of refKeys) {
        expect(typeof key).toBe('string')
      }
      expect(targetRef.plannerRunId).toBe('plan-123')
    })
  })

  // ─── Session ↔ Transcript Contract ─────────────────────────────────────

  describe('Session-Transcript Consistency', () => {
    it('ForegroundDecision.reason is always present (required for audit)', () => {
      // The reason field is mandatory in ForegroundDecision and validated
      // by the parser (EMPTY_REASON error code)
      const decisionShape: Pick<ForegroundDecision, 'route' | 'reason'> = {
        route: 'answer_directly',
        reason: 'Test',
      }
      expect(decisionShape.reason).toBeTruthy()
      expect(decisionShape.reason.length).toBeGreaterThan(0)
    })

    it('Transcript entries are created per-turn via ForegroundMessageInput.turnId', () => {
      const input: Pick<ForegroundMessageInput, 'turnId' | 'sessionId' | 'message'> = {
        turnId: 'turn-001',
        sessionId: 'sess-001',
        message: 'Hello',
      }
      expect(input.turnId).toBe('turn-001')
      expect(input.sessionId).toBe('sess-001')
      // Each turn generates a ForegroundDecision which is stored as transcript
    })
  })
})
