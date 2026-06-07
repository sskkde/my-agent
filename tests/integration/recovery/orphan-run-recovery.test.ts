import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createOrphanScanner,
  type OrphanScanner,
  type OrphanScannerStore,
} from '../../../src/recovery/orphan-scanner.js'
import type { EventStore } from '../../../src/recovery/types.js'

function mockEventStore(): { store: EventStore; events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = []
  return {
    events,
    store: {
      append: vi.fn((event: Record<string, unknown>) => {
        events.push(event)
      }),
    } as unknown as EventStore,
  }
}

function fixedClock(isoTime: string) {
  const time = new Date(isoTime)
  return () => new Date(time)
}

describe('Orphan Run Recovery', () => {
  describe('OrphanScanner creation', () => {
    it('should create a scanner with empty stores', () => {
      const scanner = createOrphanScanner({ stores: {} })
      expect(scanner).toBeDefined()
      expect(typeof scanner.scanOrphanedRuns).toBe('function')
      expect(typeof scanner.isRecoverable).toBe('function')
    })
  })

  describe('isRecoverable classification', () => {
    let scanner: OrphanScanner

    beforeEach(() => {
      scanner = createOrphanScanner({ stores: {} })
    })

    it('should classify PlannerRun as recoverable', () => {
      expect(scanner.isRecoverable('PlannerRun', 'planning')).toBe(true)
    })

    it('should classify KernelRun as recoverable', () => {
      expect(scanner.isRecoverable('KernelRun', 'running')).toBe(true)
    })

    it('should classify BackgroundRun as recoverable', () => {
      expect(scanner.isRecoverable('BackgroundRun', 'running')).toBe(true)
    })

    it('should classify WorkflowRun as recoverable', () => {
      expect(scanner.isRecoverable('WorkflowRun', 'running')).toBe(true)
    })

    it('should classify ToolExecution as non-recoverable', () => {
      expect(scanner.isRecoverable('ToolExecution', 'executing')).toBe(false)
    })

    it('should classify ApprovalRequest as non-recoverable', () => {
      expect(scanner.isRecoverable('ApprovalRequest', 'pending')).toBe(false)
    })

    it('should classify RuntimeAction with read category as recoverable', () => {
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'read')).toBe(true)
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'search')).toBe(true)
    })

    it('should classify RuntimeAction with write category as non-recoverable', () => {
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'write')).toBe(false)
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'delete')).toBe(false)
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'send')).toBe(false)
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'execute')).toBe(false)
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched', 'mutate')).toBe(false)
    })

    it('should classify RuntimeAction without category as non-recoverable', () => {
      expect(scanner.isRecoverable('RuntimeAction', 'dispatched')).toBe(false)
    })

    it('should classify unknown run type as non-recoverable', () => {
      expect(scanner.isRecoverable('UnknownType', 'running')).toBe(false)
    })
  })

  describe('scanOrphanedRuns', () => {
    it('should return empty result when no active runs', () => {
      const scanner = createOrphanScanner({
        stores: {
          planner: { listActive: () => [] },
          kernel: { listActive: () => [] },
        },
        now: fixedClock('2024-06-01T00:00:00.000Z'),
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(0)
      expect(result.recoveredCount).toBe(0)
      expect(result.failedCount).toBe(0)
      expect(result.orphans).toHaveLength(0)
      expect(result.scannedAt).toBeDefined()
    })

    it('should identify overdue PlannerRun as recoverable orphan', () => {
      const now = fixedClock('2024-06-01T01:00:00.000Z')
      const startedAt = '2024-06-01T00:40:00.000Z'

      const plannerStore: OrphanScannerStore = {
        listActive: () => [
          {
            runId: 'planner-1',
            runType: 'PlannerRun',
            status: 'planning',
            startedAt,
          },
        ],
      }

      const scanner = createOrphanScanner({
        stores: { planner: plannerStore },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(1)
      expect(result.recoveredCount).toBe(1)
      expect(result.failedCount).toBe(0)
      expect(result.orphans[0]).toMatchObject({
        runId: 'planner-1',
        runType: 'PlannerRun',
        action: 'recover',
      })
    })

    it('should not flag runs that are within their timeout window', () => {
      const now = fixedClock('2024-06-01T00:02:00.000Z')
      const startedJustNow = '2024-06-01T00:01:00.000Z'

      const plannerStore: OrphanScannerStore = {
        listActive: () => [
          {
            runId: 'planner-1',
            runType: 'PlannerRun',
            status: 'planning',
            startedAt: startedJustNow,
          },
        ],
      }

      const scanner = createOrphanScanner({
        stores: { planner: plannerStore },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(0)
    })

    it('should mark non-recoverable overdue runs as failed', () => {
      const now = fixedClock('2024-06-01T01:00:00.000Z')
      const startedAt = '2024-06-01T00:58:00.000Z'

      const toolStore: OrphanScannerStore = {
        listActive: () => [
          {
            runId: 'tool-1',
            runType: 'ToolExecution',
            status: 'executing',
            startedAt,
          },
        ],
      }

      const scanner = createOrphanScanner({
        stores: { tool: toolStore },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(1)
      expect(result.recoveredCount).toBe(0)
      expect(result.failedCount).toBe(1)
      expect(result.orphans[0]).toMatchObject({
        runId: 'tool-1',
        runType: 'ToolExecution',
        action: 'mark_failed',
      })
    })

    it('should handle mixed recoverable and non-recoverable orphans', () => {
      const now = fixedClock('2024-06-01T02:00:00.000Z')
      const longAgo = '2024-06-01T00:00:00.000Z'

      const plannerStore: OrphanScannerStore = {
        listActive: () => [{ runId: 'planner-1', runType: 'PlannerRun', status: 'planning', startedAt: longAgo }],
      }

      const kernelStore: OrphanScannerStore = {
        listActive: () => [{ runId: 'kernel-1', runType: 'KernelRun', status: 'running', startedAt: longAgo }],
      }

      const toolStore: OrphanScannerStore = {
        listActive: () => [
          { runId: 'tool-1', runType: 'ToolExecution', status: 'executing', startedAt: longAgo },
          { runId: 'tool-2', runType: 'ToolExecution', status: 'executing', startedAt: longAgo },
        ],
      }

      const scanner = createOrphanScanner({
        stores: {
          planner: plannerStore,
          kernel: kernelStore,
          tool: toolStore,
        },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(4)
      expect(result.recoveredCount).toBe(2)
      expect(result.failedCount).toBe(2)

      const recoveredIds = result.orphans.filter((o) => o.action === 'recover').map((o) => o.runId)
      expect(recoveredIds).toEqual(expect.arrayContaining(['planner-1', 'kernel-1']))

      const failedIds = result.orphans.filter((o) => o.action === 'mark_failed').map((o) => o.runId)
      expect(failedIds).toEqual(expect.arrayContaining(['tool-1', 'tool-2']))
    })

    it('should emit audit events for detected orphans', () => {
      const now = fixedClock('2024-06-01T02:00:00.000Z')
      const longAgo = '2024-06-01T00:00:00.000Z'
      const { store: eventStore, events } = mockEventStore()

      const plannerStore: OrphanScannerStore = {
        listActive: () => [{ runId: 'planner-1', runType: 'PlannerRun', status: 'planning', startedAt: longAgo }],
      }

      const scanner = createOrphanScanner({
        stores: { planner: plannerStore },
        eventStore,
        now,
      })

      scanner.scanOrphanedRuns()

      expect(events.length).toBe(1)
      expect(events[0]).toMatchObject({
        eventType: 'orphan_run_detected',
        sourceModule: 'recovery',
        correlationId: 'planner-1',
      })
    })

    it('should not emit events when no eventStore is configured', () => {
      const now = fixedClock('2024-06-01T02:00:00.000Z')
      const longAgo = '2024-06-01T00:00:00.000Z'

      const plannerStore: OrphanScannerStore = {
        listActive: () => [{ runId: 'planner-1', runType: 'PlannerRun', status: 'planning', startedAt: longAgo }],
      }

      const scanner = createOrphanScanner({
        stores: { planner: plannerStore },
        now,
      })

      expect(() => scanner.scanOrphanedRuns()).not.toThrow()
    })

    it('should include timeoutMs in orphan records', () => {
      const now = fixedClock('2024-06-01T02:00:00.000Z')
      const longAgo = '2024-06-01T00:00:00.000Z'

      const kernelStore: OrphanScannerStore = {
        listActive: () => [{ runId: 'kernel-1', runType: 'KernelRun', status: 'running', startedAt: longAgo }],
      }

      const scanner = createOrphanScanner({
        stores: { kernel: kernelStore },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphans[0].timeoutMs).toBe(180_000)
    })

    it('should handle RuntimeAction with write category as non-recoverable', () => {
      const now = fixedClock('2024-06-01T02:00:00.000Z')
      const longAgo = '2024-06-01T00:00:00.000Z'

      const runtimeStore: OrphanScannerStore = {
        listActive: () => [
          {
            runId: 'action-1',
            runType: 'RuntimeAction',
            status: 'dispatched',
            startedAt: longAgo,
            actionCategory: 'write',
          },
          {
            runId: 'action-2',
            runType: 'RuntimeAction',
            status: 'dispatched',
            startedAt: longAgo,
            actionCategory: 'read',
          },
        ],
      }

      const scanner = createOrphanScanner({
        stores: { runtime: runtimeStore },
        now,
      })

      const result = scanner.scanOrphanedRuns()
      expect(result.orphanedCount).toBe(2)

      const writeAction = result.orphans.find((o) => o.runId === 'action-1')
      expect(writeAction?.action).toBe('mark_failed')
      expect(writeAction?.reason).toContain('not recoverable')

      const readAction = result.orphans.find((o) => o.runId === 'action-2')
      expect(readAction?.action).toBe('recover')
    })
  })
})
