import { describe, it, expect } from 'vitest'
import { getTimeout, isOverdue, TIMEOUT_POLICIES, type RunType } from '../../../src/recovery/timeout-policy.js'

describe('Runtime Timeout Policy', () => {
  describe('TIMEOUT_POLICIES constants', () => {
    it('should cover all defined RunType values', () => {
      const expectedTypes: RunType[] = [
        'PlannerRun',
        'RuntimeAction',
        'KernelRun',
        'ToolExecution',
        'BackgroundRun',
        'WorkflowRun',
        'ApprovalRequest',
      ]

      for (const runType of expectedTypes) {
        expect(TIMEOUT_POLICIES[runType]).toBeDefined()
        expect(typeof TIMEOUT_POLICIES[runType].defaultTimeoutMs).toBe('number')
        expect(TIMEOUT_POLICIES[runType].defaultTimeoutMs).toBeGreaterThan(0)
      }
    })

    it('should have configurable flag set for all policies', () => {
      for (const [_key, policy] of Object.entries(TIMEOUT_POLICIES)) {
        expect(policy.configurable).toBe(true)
      }
    })

    it('should have maxTimeoutMs >= defaultTimeoutMs for all policies', () => {
      for (const policy of Object.values(TIMEOUT_POLICIES)) {
        if (policy.maxTimeoutMs !== undefined) {
          expect(policy.maxTimeoutMs).toBeGreaterThanOrEqual(policy.defaultTimeoutMs)
        }
      }
    })
  })

  describe('getTimeout', () => {
    it('should return PlannerRun default timeout (300000)', () => {
      expect(getTimeout('PlannerRun')).toBe(300_000)
    })

    it('should return RuntimeAction default timeout (120000)', () => {
      expect(getTimeout('RuntimeAction')).toBe(120_000)
    })

    it('should return ToolExecution default timeout (60000)', () => {
      expect(getTimeout('ToolExecution')).toBe(60_000)
    })

    it('should return KernelRun default timeout (180000)', () => {
      expect(getTimeout('KernelRun')).toBe(180_000)
    })

    it('should return BackgroundRun default timeout (600000)', () => {
      expect(getTimeout('BackgroundRun')).toBe(600_000)
    })

    it('should return WorkflowRun default timeout (600000)', () => {
      expect(getTimeout('WorkflowRun')).toBe(600_000)
    })

    it('should return ApprovalRequest default timeout (300000)', () => {
      expect(getTimeout('ApprovalRequest')).toBe(300_000)
    })

    it('should use config override when provided', () => {
      expect(getTimeout('PlannerRun', { timeoutMs: 120_000 })).toBe(120_000)
    })

    it('should clamp config override to maxTimeoutMs', () => {
      expect(getTimeout('PlannerRun', { timeoutMs: 999_999 })).toBe(600_000)
    })

    it('should honour override within max bounds', () => {
      expect(getTimeout('WorkflowRun', { timeoutMs: 900_000 })).toBe(900_000)
    })

    it('should clamp BackgroundRun override to its max', () => {
      expect(getTimeout('BackgroundRun', { timeoutMs: 9_999_999 })).toBe(1_800_000)
    })

    it('should return default for unknown run type', () => {
      expect(getTimeout('UnknownType' as RunType)).toBe(120_000)
    })
  })

  describe('isOverdue', () => {
    it('should return false for a run that just started', () => {
      const now = new Date()
      expect(isOverdue('ToolExecution', now.toISOString())).toBe(false)
    })

    it('should return true for a run that started long ago', () => {
      const longAgo = new Date(Date.now() - 120_000)
      expect(isOverdue('ToolExecution', longAgo.toISOString())).toBe(true)
    })

    it('should handle Date object input', () => {
      const longAgo = new Date(Date.now() - 500_000)
      expect(isOverdue('PlannerRun', longAgo)).toBe(true)
    })

    it('should accept config for custom timeout', () => {
      const fiftySecondsAgo = new Date(Date.now() - 50_000)
      expect(isOverdue('ToolExecution', fiftySecondsAgo, { timeoutMs: 30_000 })).toBe(true)
      expect(isOverdue('ToolExecution', fiftySecondsAgo, { timeoutMs: 100_000 })).toBe(false)
    })

    it('should return false for start times in the future', () => {
      const future = new Date(Date.now() + 60_000)
      expect(isOverdue('ToolExecution', future)).toBe(false)
    })
  })
})
